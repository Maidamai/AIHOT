import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, stopBoss, enqueueOn, shutdownSignal, workModuleQueues } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import fishery from "../server.ts";
import { acquireProcessingLease, assertProcessingLease, type ProcessingLease } from "../backend/processing-lease.ts";
import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { authorizationKey, assertFisheryCapacity, withFisheryAuthorization } from "../backend/authorization.ts";
import { TRIAL, amountOnlyPolicy, trialBudget, trialUsage, type TrialEntry } from "../backend/trial-transport.ts";
import { paidRequest, completeReceipt } from "@aihot/backend/providers/receipts";
import { publicationQueue } from "../backend/publication-queue.ts";
import { flowQueue } from "../backend/flow.ts";
import { createHash } from "node:crypto";
import { COLUMNS } from "../backend/official-columns.ts";
import { importCapturedMaterial, registerSource, storeCapturedNews } from "../backend/store.ts";
import { assignNativeDocumentPurpose } from "../backend/native-permit.ts";
import { acquireFullWorkerLease, assertLegacyNewsRetired, configureNativeProcessing, nativeProcessingConfiguration, nativeProcessingPermit, prepareNativeModelRequest, requiredNativeWorkerProfile, sendNativeModelRequest, withNativeProcessing } from "../backend/native-processing.ts";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { observationFixture, sourceFixture } from "./fixtures.ts";

after(async()=>{await stopBoss();await closeDb();});
const wire={method:"POST",body:JSON.stringify({model:TRIAL.model,messages:[{role:"system",content:"Synthetic lease test"},{role:"user",content:"Synthetic body"}],temperature:0,max_tokens:2048,response_format:{type:"json_object"},thinking:{type:"disabled"}})};
const response=()=>new Response(JSON.stringify({model:"mock",usage:{prompt_tokens:10,completion_tokens:2}}),{status:200});
async function seedTestLedger(initialEntries:TrialEntry[] = []) {
  assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/,"never initialize/reset a real authorization ledger");
  await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({id:TRIAL.id,entries:initialEntries,maxRequests:null,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
}
async function entries() {return (await sql`SELECT value->'entries' AS entries FROM settings WHERE key=${authorizationKey}`)[0]!.entries as {state:string}[];}
async function terminateOwnLease(lease:Pick<ProcessingLease,"backendPid">) {
  assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/);
  const [row]=await sql`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=${lease.backendPid} AND datname=current_database() AND application_name='fishery-processing-lease'`;
  assert.equal(row?.terminated,true,"terminate only this test database's named lease connection");
}
function configure(t:TestContext) {
  for(const [key,value] of Object.entries({LLM_MODEL:TRIAL.model,LLM_BASE_URL:"https://api.deepseek.com",LLM_REASONING_TOKENS:"0",LLM_EXTRA_JSON:'{"thinking":{"type":"disabled"}}'})) {
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined) delete process.env[key];else process.env[key]=previous;});
  }
}

test('automatic authorization is checked after waiting for the cumulative amount lock, before any reservation or HTTP',async t=>{
 configure(t);await seedTestLedger();const lease=await acquireProcessingLease();let allowed=true,sends=0,unlock!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>unlock=r);
 t.mock.method(globalThis,'fetch',async()=>{sends++;return response();});
 const held=sql.begin(async tx=>{await tx`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;entered();await barrier;});await ready;
 try{
  const run=lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire),{assertAuthorized:async()=>{if(!allowed)throw new Error('Automatic material authorization revoked');}}));
  const until=Date.now()+5000;let waiting=false;
  while(Date.now()<until){const [r]=await sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%settings%FOR UPDATE%') AS waiting`;if(r.waiting){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true,'Real reservation must be waiting on the held ledger row');allowed=false;unlock();await held;
  await assert.rejects(run,/authorization revoked/);assert.equal(sends,0);assert.equal((await entries()).length,0);
 }finally{unlock();await held;await lease.release();}
});
test('automatic authorization revoked after reserve leaves pending evidence and blocks further paid sends',async t=>{
 configure(t);await seedTestLedger();const lease=await acquireProcessingLease();let allowed=true,sends=0,checks=0,release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);
 t.mock.method(globalThis,'fetch',async()=>{sends++;return response();});
 try{
  const run=lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire),{assertAuthorized:async()=>{if(++checks===2){entered();await barrier;}if(!allowed)throw new Error('Automatic material authorization revoked before send');}}));
  await ready;assert.equal((await entries()).at(-1)?.state,'pending');allowed=false;release();
  await assert.rejects(run,/revoked before send/);assert.equal(sends,0);assert.equal((await entries()).length,1);assert.equal((await entries())[0].state,'pending');
  await assert.rejects(lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire))),/pending/);assert.equal(sends,0);assert.equal((await entries()).length,1);
 }finally{release();await lease.release();}
});

test("consumer and single-task CLI share one lease, and terminating its session permanently fences the old owner",async()=>{
  const boss=await getBoss({schedule:false,supervise:false}),lease=await acquireProcessingLease();
  let replacement:ProcessingLease|undefined;
  try {
    await lease.assertHeld();await assert.rejects(acquireProcessingLease(),/already running/);
    await assert.rejects(registerManualFlowConsumer(boss),/already running/);
    await assert.rejects(promisify(execFile)(process.execPath,["modules/fishery/scripts/run-flow.ts","--id","synthetic-no-model-task","--run-once"],{env:{...process.env,MODEL_CALLS_ENABLED:"true"},timeout:10000}),error=>{assert.match((error as {stderr:string}).stderr,/already running/);return true;});
    await terminateOwnLease(lease);
    await assert.rejects(lease.assertHeld());
    replacement=await acquireProcessingLease();await replacement.assertHeld();
    assert.notEqual(replacement.backendPid,lease.backendPid);
    await assert.rejects(lease.run(async()=>{throw new Error("Old owner must never execute again");}));
    await assert.rejects(lease.assertHeld(),/lease/);
  } finally {await replacement?.release();await lease.release();}
});

test("normal lease release stops an in-flight watchdog without reporting a false ownership loss",async()=>{
  const lease=await acquireProcessingLease();let lost=0;
  lease.watch(()=>{lost++;},10);
  await lease.release();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(lost,0);await assert.rejects(lease.assertHeld(),/released/);
});

test("idle lease loss stops polling before a later job can be consumed",async()=>{
  const boss=await getBoss({schedule:false,supervise:false}),lost=Promise.withResolvers<void>();let calls=0;
  const release=await registerManualFlowConsumer(boss,async()=>{calls++;},{onLeaseLost:()=>lost.resolve(),watchIntervalMs:20});
  let jobId:string|null=null;
  try {
    const sessions=await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='fishery-processing-lease'`;
    assert.equal(sessions.length,1);await terminateOwnLease({backendPid:sessions[0]!.pid});
    await Promise.race([lost.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Idle lease loss was not detected")),5000))]);
    jobId=await enqueueOn(flowQueue,{id:"idle-lost-must-not-claim"});
    await new Promise(resolve=>setTimeout(resolve,2200));
    assert.equal(calls,0);assert.equal((await boss.getJobById(flowQueue.name,jobId!))?.state,"created");
  } finally {if(jobId) await boss.cancel(flowQueue.name,jobId);await release();}
});

test("lease is rechecked after waiting for the locked ledger, before writing a pending reservation",async t=>{
  configure(t);await seedTestLedger();const lease=await acquireProcessingLease(),blocker=await sql.reserve();let sends=0,unblocked=false;
  t.mock.method(globalThis,"fetch",async()=>{sends++;return response();});
  try {
    await blocker`BEGIN`;await blocker`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    const refused=assert.rejects(lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire))));
    const until=Date.now()+5000;let waiting=false;
    while(Date.now()<until&&!waiting) {
      const [row]=await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT value FROM settings%FOR UPDATE%'`;
      waiting=row!.n>0;if(!waiting) await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,"the reservation must actually wait for the existing ledger row lock");
    await terminateOwnLease(lease);await blocker`COMMIT`;unblocked=true;await refused;
    assert.equal(sends,0);assert.deepEqual(await entries(),[],"loss while waiting cannot create a pending reservation after the lock is acquired");
  } finally {if(!unblocked) await blocker`ROLLBACK`;blocker.release();await lease.release();}
});

test("authorization requires a lease and a committed reservation stays pending if ownership is lost before send",async t=>{
  configure(t);await seedTestLedger();let sends=0;
  t.mock.method(globalThis,"fetch",async()=>{sends++;return response();});
  await assert.rejects(withFisheryAuthorization(async()=>{}),/lease guard required/);
  const lease=await acquireProcessingLease(),check=lease.assertHeld;let killed=false;
  t.mock.method(lease,"assertHeld",async()=>{
    if(!killed&&(await entries()).some(e=>e.state==="pending")) {killed=true;await terminateOwnLease(lease);}
    await check();
  });
  try {
    await assert.rejects(lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire))));
    assert.equal(killed,true);assert.equal(sends,0);assert.deepEqual((await entries()).map(e=>e.state),["pending"]);
    await assert.rejects(assertFisheryCapacity(),/pending/);
    const next=await acquireProcessingLease();
    try {await assert.rejects(next.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire))),/pending/);assert.equal(sends,0);assert.equal((await entries()).length,1);}
    finally {await next.release();}
  } finally {await lease.release();}
});

test("a response already sent can settle after lease loss, but the old owner cannot reserve or send again",async t=>{
  configure(t);await seedTestLedger();const lease=await acquireProcessingLease();let sends=0;
  t.mock.method(globalThis,"fetch",async()=>{sends++;await terminateOwnLease(lease);return response();});
  try {
    await lease.run(()=>withFisheryAuthorization(async()=>{
      assert.equal((await fetch(TRIAL.endpoint,wire)).status,200);
      assert.deepEqual((await entries()).map(e=>e.state),["received"]);
      await assert.rejects(fetch(TRIAL.endpoint,wire));
    }));
    assert.equal(sends,1);assert.deepEqual((await entries()).map(e=>e.state),["received"]);
  } finally {await lease.release();}
});


function nearLimitHistory() {
  return Array.from({length:50},(_,i)=>({id:i+1,state:"received",wireBytes:100,reservedMicroCny:TRIAL.reserveMicroCny,usage:trialUsage({prompt_tokens:96_000,completion_tokens:0})}));
}
async function budgetLedger() {
  const [row]=await sql<{value:{entries:TrialEntry[]}}[]>`SELECT value FROM settings WHERE key=${authorizationKey}`;
  assert.ok(row);return row.value;
}

test("near-limit concurrent reservations serialize at the original ledger and unknown costs never release",async t=>{
  configure(t);
  for(const outcome of ["received","unknown"] as const) await t.test(outcome,async child=>{
    const history=nearLimitHistory();await seedTestLedger(history);
    assert.equal(trialBudget(history).occupiedMicroCny,9_600_000);
    const lease=await acquireProcessingLease(),blocker=await sql.reserve();
    const sent=Promise.withResolvers<void>(),reply=Promise.withResolvers<Response>(),refused=Promise.withResolvers<void>();
    let sends=0,unblocked=false,execution:Promise<PromiseSettledResult<Response>[]>|undefined;
    child.mock.method(globalThis,"fetch",async()=>{sends++;sent.resolve();return reply.promise;});
    try {
      await blocker`BEGIN`;await blocker`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
      execution=lease.run(()=>withFisheryAuthorization(async()=>{
        const requests=[fetch(TRIAL.endpoint,wire),fetch(TRIAL.endpoint,wire)];
        for(const request of requests) void request.catch(()=>refused.resolve());
        return Promise.allSettled(requests);
      }));
      const until=Date.now()+5000;let waiting=0;
      while(Date.now()<until&&waiting<2) {
        const [row]=await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT value FROM settings%FOR UPDATE%'`;
        waiting=row!.n;if(waiting<2) await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,2,"both real reservation transactions must contend for the same locked ledger row");
      await blocker`COMMIT`;unblocked=true;
      await sent.promise;await refused.promise;
      const pending=await budgetLedger();
      assert.equal(sends,1);assert.equal(pending.entries.length,51);assert.deepEqual(pending.entries.slice(0,50),history);
      assert.equal(pending.entries[50]!.state,"pending");assert.equal(trialBudget(pending.entries).occupiedMicroCny,10_000_000);
      await assert.rejects(assertFisheryCapacity(),/pending/);
      if(outcome==="received") reply.resolve(new Response(JSON.stringify({model:"mock",usage:{prompt_tokens:96_000,completion_tokens:0}}),{status:200}));
      else reply.reject(new Error("Synthetic uncertain provider outcome"));
      const results=await execution;const failures=results.filter(r=>r.status==="rejected");
      assert.equal(results.filter(r=>r.status==="fulfilled").length,outcome==="received"?1:0);
      assert.ok(failures.some(r=>r.status==="rejected"&&/pending|limit/.test(String(r.reason))));
      const settled=await budgetLedger(),budget=trialBudget(settled.entries);
      assert.deepEqual(settled.entries.slice(0,50),history);assert.equal(settled.entries.length,51);assert.equal(sends,1);
      assert.equal(settled.entries[50]!.state,outcome);assert.equal(settled.entries[50]!.reservedMicroCny,400_000);
      assert.equal(budget.occupiedMicroCny,outcome==="received"?9_792_000:10_000_000);
      assert.ok(budget.occupiedMicroCny<=TRIAL.maxReservedMicroCny);
      if(outcome==="unknown") assert.equal(budget.unsettledReserveMicroCny,400_000);
      await assert.rejects(lease.run(()=>withFisheryAuthorization(()=>fetch(TRIAL.endpoint,wire))),outcome==="unknown"?/unknown/:/limit/);
      assert.deepEqual(await budgetLedger(),settled);assert.equal(sends,1);
    } finally {
      if(!unblocked) await blocker`ROLLBACK`;
      reply.resolve(response());await execution?.catch(()=>{});blocker.release();await lease.release();
    }
  });
});

test("received request cache and repeated business completion add no reservation, send, cost or receipt attempt",async t=>{
  configure(t);const history=nearLimitHistory();await seedTestLedger(history);
  const lease=await acquireProcessingLease();let sends=0,calls=0;
  t.mock.method(globalThis,"fetch",async()=>{sends++;return new Response(JSON.stringify({model:"mock",usage:{prompt_tokens:96_000,completion_tokens:0}}),{status:200});});
  const request={service:"fishery-budget-local-mock",model:TRIAL.model,purpose:"fishery_budget_boundary",subject:"same-received-request",identity:{source:"synthetic",attempt:1}};
  const call=async()=>{calls++;return {response:await(await fetch(TRIAL.endpoint,wire)).json()};};
  try {
    await lease.run(()=>withFisheryAuthorization(async()=>{
      const first=await paidRequest(request,call);assert.equal(first.reused,false);
      const before=await budgetLedger();assert.equal(before.entries.length,51);assert.equal(trialBudget(before.entries).occupiedMicroCny,9_792_000);
      await assert.rejects(assertFisheryCapacity(),/limit/,"a duplicate send would exceed remaining capacity");
      const cached=await Promise.all([paidRequest(request,call),paidRequest(request,call)]);
      for(const result of cached) {assert.equal(result.reused,true);assert.equal(result.receiptId,first.receiptId);assert.deepEqual(result.response,first.response);}
      await Promise.all([completeReceipt(sql,first.receiptId),completeReceipt(sql,first.receiptId)]);
      const completed=await paidRequest(request,call);assert.equal(completed.reused,true);assert.equal(completed.receiptId,first.receiptId);
      assert.equal(sends,1);assert.equal(calls,1);assert.deepEqual(await budgetLedger(),before);
      const [receipt]=await sql`SELECT status,attempts,(SELECT count(*)::int FROM receipt_attempts WHERE receipt_id=${first.receiptId}) AS attempt_rows FROM receipts WHERE id=${first.receiptId}`;
      assert.equal(receipt!.status,"completed");assert.equal(receipt!.attempts,1);assert.equal(receipt!.attempt_rows,1);
    }));
  } finally {await lease.release();}
});

async function nativeRequestFixture(marker='BUDGET') {
  const now=new Date().toISOString(),body=`${marker}：远洋渔船船员换班安排已经更新，港口将按公告执行。`.repeat(12),url=`https://yyj.moa.gov.cn/gzdt/synthetic-native-${Date.now()}-${Math.random()}`;
  const doc=await importCapturedMaterial({id:'moa',...COLUMNS.moa},url,{...observationFixture,originalTitle:`${marker} synthetic native news`,language:'zh',sourceCapture:{adapter:'moa',sourceUrl:url,capturedAt:now,publishedAt:now,httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:createHash('sha256').update(body).digest('hex'),parser:'synthetic/v1',parseStatus:'parsed',attachmentSha256:null,conflicts:[]}},'tester');
  const material=await storeCapturedNews('moa',doc.id,body,'tester');assert.ok('articleId' in material&&material.articleId);
  await assignNativeDocumentPurpose(doc.id);
  await configureNativeProcessing({enabled:true,sourceIds:['fishery-column-moa'],createdAfter:'2020-01-01T00:00:00Z'},'tester','Synthetic native authorization fixture');
  return {documentId:doc.id,articleId:material.articleId,purpose:'score_article',subject:`article:${material.articleId}`,model:TRIAL.model,maxTokens:2048,url:TRIAL.endpoint,options:{...wire,redirect:'error' as const}};
}

test('native parallel stages retain the original ledger, serialize sends and preserve uncertain reservations',async t=>{
  configure(t);
  for(const outcome of ['received','unknown'] as const) await t.test(outcome,async()=>{
    const request=await nativeRequestFixture(),history=nearLimitHistory();await seedTestLedger(history);
    const lease=await acquireProcessingLease(),sent=Promise.withResolvers<void>(),reply=Promise.withResolvers<Response>();let sends=0;
    try {
      const execution=lease.run(()=>withNativeProcessing(async()=>{
        assert.deepEqual(await prepareNativeModelRequest({...request,maxTokens:16384}),{maxTokens:2048,rejectTruncated:true});
        return Promise.allSettled([1,2].map(()=>sendNativeModelRequest(request,async()=>{sends++;sent.resolve();return reply.promise;})));
      }));
      await sent.promise;
      const pending=await budgetLedger();assert.deepEqual(pending.entries.slice(0,50),history);assert.equal(pending.entries.length,51);assert.equal(pending.entries[50]!.state,'pending');assert.equal(sends,1);
      assert.equal(trialBudget(pending.entries).occupiedMicroCny,10_000_000);
      if(outcome==='received')reply.resolve(new Response(JSON.stringify({model:'mock',usage:{prompt_tokens:96000,completion_tokens:0}}),{status:200}));
      else reply.reject(new Error('Synthetic native uncertain outcome'));
      const results=await execution;
      assert.equal(results.filter(r=>r.status==='fulfilled').length,outcome==='received'?1:0);
      assert.ok(results.some(r=>r.status==='rejected'&&/limit|unknown/.test(String(r.reason))));
      const settled=await budgetLedger();assert.deepEqual(settled.entries.slice(0,50),history);assert.equal(settled.entries.length,51);assert.equal(settled.entries[50]!.state,outcome);assert.equal(sends,1);
      assert.equal(trialBudget(settled.entries).occupiedMicroCny,outcome==='received'?9_792_000:10_000_000);
      await assert.rejects(lease.run(()=>withNativeProcessing(()=>sendNativeModelRequest(request,async()=>{sends++;return response();}))),outcome==='received'?/limit/:/unknown/);
      assert.deepEqual(await budgetLedger(),settled);assert.equal(sends,1);
    } finally {reply.resolve(response());await lease.release();}
  });
});

test('native configuration preserves unmanaged source processing while managed news requires an authorized execution',async()=>{
  const source=`unmanaged-native-${Date.now()}`;
  await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Synthetic unmanaged source','external')`;
  const material=await upsertMaterial({sourceId:source,url:`https://example.org/${source}`,title:'Synthetic unmanaged news',publishedAt:new Date(),bodyText:'Synthetic unmanaged body',bodyStatus:'ok',via:'test'});
  const managed=await nativeRequestFixture();
  for(const enabled of [false,true]){
    await configureNativeProcessing({enabled,sourceIds:['fishery-column-moa'],createdAfter:'2020-01-01T00:00:00Z'},'tester','Synthetic native scope comparison');
    assert.equal(await nativeProcessingPermit(material.articleId),true);
    assert.deepEqual(await prepareNativeModelRequest({...managed,subject:`article:${material.articleId}`,maxTokens:16384}),{});
    assert.equal(await nativeProcessingPermit(managed.subject.slice('article:'.length)),enabled);
    await assert.rejects(prepareNativeModelRequest(managed),/lease|execution/);
  }
  const orphanSource='fishery-column-itf-fisheries';
  await sql`INSERT INTO sources(id,name,kind) VALUES(${orphanSource},'Synthetic uncaptured source','external')`;
  const orphan=await upsertMaterial({sourceId:orphanSource,url:'https://example.org/uncaptured-native',title:'Synthetic uncaptured article',publishedAt:new Date(),bodyText:'No fishery capture evidence exists.',bodyStatus:'ok',via:'test'});
  await configureNativeProcessing({enabled:true,sourceIds:[orphanSource],createdAfter:'2020-01-01T00:00:00Z'},'tester','Synthetic uncaptured source scope');
  assert.equal(await nativeProcessingPermit(orphan.articleId),false,'a registered adapter name is not verified capture evidence');
});

test('native wire limits reject altered destinations, output capacity and nontext inputs before any reservation',async()=>{
  const request=await nativeRequestFixture();await seedTestLedger();const lease=await acquireProcessingLease();let sends=0;
  try {
    await lease.run(()=>withNativeProcessing(async()=>{
      for(const changed of [
        {...request,url:'https://example.org/chat/completions'},
        {...request,options:{...request.options,body:JSON.stringify({...JSON.parse(wire.body),max_tokens:2049})}},
        {...request,options:{...request.options,body:JSON.stringify({...JSON.parse(wire.body),messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.org/image'}}]}]})}},
        {...request,options:{...request.options,body:'x'.repeat(96001)}},
      ])await assert.rejects(sendNativeModelRequest(changed,async()=>{sends++;return response();}));
    }));
    assert.equal(sends,0);assert.deepEqual(await entries(),[]);
  } finally {await lease.release();}
});

test('native preflight refuses unstarted and active legacy news while retaining completed history',async()=>{
  const boss=await getBoss({schedule:false,supervise:false});await boss.createQueue('fishery.news');
  const id=await boss.send('fishery.news',{articleId:'synthetic-legacy-preflight'});assert.ok(id);
  try {
    for(const state of ['created','retry','active']){
      await sql`UPDATE pgboss.job SET state=${state}::pgboss.job_state WHERE id=${id}`;
      await assert.rejects(assertLegacyNewsRetired(),/retire-legacy/);
      assert.equal((await sql`SELECT state FROM pgboss.job WHERE id=${id}`)[0].state,state,'preflight must never cancel or rewrite old work');
    }
    await sql`UPDATE pgboss.job SET state='completed',completed_on=now() WHERE id=${id}`;
    await assertLegacyNewsRetired();assert.equal((await sql`SELECT state FROM pgboss.job WHERE id=${id}`)[0].state,'completed');
  } finally {await sql`DELETE FROM pgboss.job WHERE id=${id}`;}
});

test('full worker ownership fences native configuration and notifies once when its database session is lost',async()=>{
  const policy={enabled:false,sourceIds:['fishery-column-moa'],createdAfter:'2020-01-01T00:00:00Z'};
  const disabled=await configureNativeProcessing(policy,'tester','Synthetic full worker ownership fixture');
  const lost=Promise.withResolvers<void>();let notices=0;
  const release=await acquireFullWorkerLease({watchIntervalMs:10,onLeaseLost:()=>{notices++;lost.resolve();}});
  try {
    await assert.rejects(acquireProcessingLease(),/already running/);
    await assert.rejects(configureNativeProcessing({...policy,enabled:true},'tester','Synthetic forbidden concurrent enable'),/already running/);
    assert.deepEqual(await nativeProcessingConfiguration(),disabled);assert.equal(await requiredNativeWorkerProfile(),null);
    const sessions=await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='fishery-processing-lease'`;
    assert.equal(sessions.length,1);await terminateOwnLease({backendPid:sessions[0]!.pid});
    await Promise.race([lost.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Full worker lease loss was not detected')),5000))]);
    assert.equal(notices,1);
  } finally {await release();}
  await configureNativeProcessing({...policy,enabled:true},'tester','Synthetic explicit enable after full shutdown');
  assert.equal(await requiredNativeWorkerProfile(),'fishery-native');
});

test('installed fishery native processing runs real analysis, grouping, digest and editions with the original receipts',async t=>{
  configure(t);
  const {installModules,serverModules}=await import('@aihot/backend/modules');
  const {SERVER_MODULES}=await import('../../../site/modules/server.ts');
  const {CAPABILITIES,invalidateModelCache}=await import('@aihot/backend/editorial/models');
  const {analysisStep}=await import('../../../tests/analysis-steps.ts');
  const {processArticle}=await import('@aihot/backend/jobs/content');
  const {groupArticle}=await import('@aihot/backend/events/group');
  const {composeStoryDigest,DIGEST_SYSTEM}=await import('@aihot/backend/events/digest');
  const {composeDaily,composeWeekly}=await import('@aihot/backend/reports/compose');
  const {beijingDate,beijingAt,addDays,isoWeekLabel}=await import('@aihot/contracts/time');
  const {EDITION_TIMES}=await import('@aihot/site');
  const {v1Items}=await import('@aihot/backend/publication/v1');
  const {itemFeed}=await import('@aihot/backend/publication/feeds');
  const {buildApp}=await import('../../../apps/api/src/app.ts');
  const previous=serverModules();installModules(SERVER_MODULES);t.after(()=>installModules(previous));
  for(const capability of Object.values(CAPABILITIES)){
    const before=process.env[capability.env];process.env[capability.env]='deepseek-flash';
    t.after(()=>{if(before===undefined)delete process.env[capability.env];else process.env[capability.env]=before;});
  }
  for(const [name,value] of Object.entries({DEEPSEEK_BASE_URL:'https://api.deepseek.com',DEEPSEEK_API_KEY:'test-key'})){
    const before=process.env[name];process.env[name]=value;t.after(()=>{if(before===undefined)delete process.env[name];else process.env[name]=before;});
  }
  invalidateModelCache();t.after(invalidateModelCache);
  const high=await nativeRequestFixture('NATIVEHIGH'),low=await nativeRequestFixture('NATIVELOW'),block=await nativeRequestFixture('NATIVEBLOCK'),reviewOnly=await nativeRequestFixture('NATIVEREVIEW');
  const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
  await registerSource('fishery-column-moa',{...sourceFixture,expectedRevision:source.revision},'tester');
  for(const record of [high,low,block,reviewOnly])await assignNativeDocumentPurpose(record.documentId);
  await sql`UPDATE fishery_document_purposes SET purpose='review_only',reason='Synthetic explicit review-only restriction' WHERE document_id=${reviewOnly.documentId}`;
  const history=[{id:1,state:'received',reservedMicroCny:400000,usage:trialUsage({prompt_tokens:10,completion_tokens:2})}];await seedTestLedger(history);
  const requests:Array<{marker:string;step:string}>=[],scoreValues={NATIVEHIGH:[90,88],NATIVELOW:[20,18]};
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{
    assert.equal(input,TRIAL.endpoint,'all provider traffic is intercepted; no network request is sent');
    const body=String(options?.body),parsed=JSON.parse(body),system=parsed.messages[0]?.content,user=parsed.messages.at(-1).content;
    const marker=['NATIVEHIGH','NATIVELOW','NATIVEBLOCK','NATIVEREVIEW'].find(m=>String(user).includes(m))??'';
    let step:string,answer:unknown;
    if(system===DIGEST_SYSTEM){step='digest';answer={title:'远洋船员换班安排更新',digest:'远洋船员换班安排已经更新。港口按公布的安排执行，具体条件以来源为准。'};}
    else if(String(user).includes('【运营】')||String(user).includes('远洋船员换班安排更新')&&!marker){step='period';answer={overview:'远洋船员换班安排更新。',sections:{}};}
    else {
      step=analysisStep(body);
      if(step==='prefilter')answer={label:marker==='NATIVEBLOCK'?'BLOCK':marker==='NATIVELOW'?'UNKNOWN':'PASS',reason:'Synthetic local replay'};
      else if(step==='score')answer={attentionScore:scoreValues[marker as keyof typeof scoreValues]?.shift()};
      else if(step==='structure')answer={category:'operations',tags:['运营'],subjects:[],scope:'single',fact:{title:'远洋船员换班安排更新',subject:'港口',action:'更新',object:'船员换班安排',occurredAt:null,evidence:'远洋渔船船员换班安排已经更新',conditions:[]}};
      else if(step==='understand')answer={itemType:'industry_event',authorRole:'principal',tags:[],editorialJudgment:'公布了船员换班安排。',titleZh:'远洋船员换班安排更新',summaryZh:'远洋船员换班安排已经更新。港口按公告执行，具体要求以原文为准。'};
      else if(step==='summarize')answer='title_zh: 远洋船员换班例行动态\nsummary_zh: 远洋渔船换班安排发布了例行信息。具体要求以原文为准。';
      else throw new Error(`Unexpected native replay step ${step}`);
    }
    requests.push({marker,step});
    return new Response(JSON.stringify({model:TRIAL.model,choices:[{message:{content:typeof answer==='string'?answer:JSON.stringify(answer)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200});
  });
  const [unclaimed]=await sql`SELECT processing_state,processing_attempts FROM articles WHERE id=${high.articleId}`;
  await assert.rejects(processArticle(high.articleId),/native execution owner/);
  assert.deepEqual((await sql`SELECT processing_state,processing_attempts FROM articles WHERE id=${high.articleId}`)[0],unclaimed);
  assert.equal(requests.length,0,'an unowned consumer retains the job without paid work or article failure');
  const lease=await acquireProcessingLease();let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try {
    await getBoss({schedule:false,supervise:false});
    await lease.run(()=>withNativeProcessing(async()=>{
      assert.equal((await processArticle(reviewOnly.articleId)).state,'restricted');assert.equal(requests.length,0);
      assert.equal((await processArticle(high.articleId)).state,'pass');
      const [beforeGroup]=await sql`SELECT selected FROM publications WHERE article_id=${high.articleId}`;assert.equal(beforeGroup.selected,false);
      await groupArticle(high.articleId);
      const [membership]=await sql`SELECT f.story_id FROM fact_articles fa JOIN facts f ON f.id=fa.fact_id WHERE fa.article_id=${high.articleId}`;assert.ok(membership);
      assert.equal((await composeStoryDigest(Number(membership.story_id))).updated,true);
      assert.equal((await processArticle(low.articleId)).state,'pass');
      assert.equal((await processArticle(block.articleId)).state,'block');
      const callsBefore=requests.length,ledgerBefore=await budgetLedger();
      await processArticle(high.articleId);await processArticle(low.articleId);await processArticle(block.articleId);await groupArticle(high.articleId);
      assert.equal((await composeStoryDigest(Number(membership.story_id))).updated,false);
      assert.equal(requests.length,callsBefore,'reconsumption reuses received receipts without another provider send');assert.deepEqual(await budgetLedger(),ledgerBefore);
      const now=new Date(),today=beijingDate(now),date=beijingAt(today,EDITION_TIMES.daily)>now?today:addDays(today,1);
      assert.ok((await composeDaily(date)).entries>0);
      assert.ok((await composeWeekly(isoWeekLabel(date),'Synthetic native replay'))!.entries>0);
    }));
    const query={mode:'all' as const,window:'7d' as const,by:'timeline' as const,category:null,q:null,limit:100,cursor:null};
    const all=await v1Items(query),selected=await v1Items({...query,mode:'selected'});
    assert.ok(all.items.some(i=>i.id===low.articleId));assert.ok(all.items.some(i=>i.id===high.articleId));assert.ok(selected.items.some(i=>i.id===high.articleId));assert.ok(!selected.items.some(i=>i.id===low.articleId));
    app=await buildApp();
    const exits=[JSON.stringify(all),JSON.stringify(selected),await itemFeed('all',null),await itemFeed('selected',null),JSON.stringify((await v1Items({...query,q:'远洋'})).items)];
    for(const path of ['/api/v1/items?mode=all&window=7d','/api/v1/items?mode=selected&window=7d','/api/v1/agent/latest?mode=all&window=7d','/feed/all.xml','/feed.xml']){const result:{statusCode:number;body:string}=await app.inject({url:path});assert.equal(result.statusCode,200);exits.push(result.body);}
    const {MCP_TOOL_NAMES}=await import('@aihot/contracts/mcp');
    const mcp:{statusCode:number;body:string}=await app.inject({method:'POST',url:'/api/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:MCP_TOOL_NAMES.latest,arguments:{mode:'all',window:'7d'}}}});
    assert.equal(mcp.statusCode,200);assert.ok(mcp.body.includes(high.articleId));assert.ok(mcp.body.includes(low.articleId));exits.push(mcp.body);
    for(const record of [block,reviewOnly])for(const exit of exits)assert.ok(!exit.includes(record.articleId));
    for(const record of [block,reviewOnly])for(const path of [`/api/site/items/${record.articleId}`,`/items/${record.articleId}/markdown`])assert.equal((await app.inject({url:path})).statusCode,404);
    for(const record of [high,low]){
      const [analysis]=await sql`SELECT output,receipt_ids FROM analyses WHERE article_id=${record.articleId} ORDER BY id DESC LIMIT 1`;
      assert.equal(analysis.output.scores.length,2);assert.notEqual(analysis.output.scores[0],analysis.output.scores[1]);
      assert.equal(requests.filter(r=>r.marker===(record===high?'NATIVEHIGH':'NATIVELOW')&&r.step==='score').length,2);
    }
    const ledger=await budgetLedger();assert.deepEqual(ledger.entries[0],history[0]);assert.ok(ledger.entries.every(e=>e.state==='received'));
    const receipts=await sql`SELECT purpose,status,attempts FROM receipts WHERE subject LIKE ${`article:${high.articleId}%`} OR subject LIKE ${`article:${low.articleId}%`}`;
    assert.ok(receipts.length>=10);assert.ok(receipts.every(r=>r.status==='completed'&&r.attempts===1));
    assert.ok(requests.some(r=>r.step==='digest'));assert.ok(requests.some(r=>r.step==='period'));assert.equal(requests.filter(r=>r.marker==='NATIVEBLOCK').length,1);assert.equal(requests.filter(r=>r.marker==='NATIVEREVIEW').length,0);
  } finally {await app?.close();await lease.release();}
});

test('specialized queues belong only to explicit manual and native consumers',async()=>{
  await seedTestLedger();
  await configureNativeProcessing({enabled:false,sourceIds:['fishery-column-moa'],createdAfter:'2020-01-01T00:00:00Z'},'tester','Synthetic explicit queue ownership');
  installModules([fishery]);
  const boss=await getBoss({schedule:false,supervise:false});
  const publication={kind:'article' as const,itemId:'synthetic-owned-publication',decisionId:'synthetic',decisionHash:'synthetic',actor:'tester'};
  const flowId=await enqueueOn(flowQueue,{id:'synthetic-owned-flow'},{singletonKey:'ownership-flow'});
  const publicationId=await enqueueOn(publicationQueue,publication,{singletonKey:'ownership-publication'});
  assert.ok(flowId&&publicationId,'producers create queues without global consumer registration');
  await workModuleQueues(boss);
  assert.ok(!boss.getWipData().some(worker=>[flowQueue.name,publicationQueue.name].includes(worker.name)));
  assert.equal((await boss.getJobById(flowQueue.name,flowId))?.state,'created');
  assert.equal((await boss.getJobById(publicationQueue.name,publicationId))?.state,'created');
  let flows=0,publications=0;
  const release=await registerManualFlowConsumer(boss,async jobs=>{await assertProcessingLease();flows+=jobs.length;},{publicationRun:async jobs=>{await assertProcessingLease();publications+=jobs.length;}});
  try{
    for(const worker of boss.getWipData())boss.notifyWorker(worker.id);
    for(let n=0;n<200&&(flows!==1||publications!==1);n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(flows,1);assert.equal(publications,1);
  }finally{await release();installModules([]);}
  await configureNativeProcessing({enabled:true,sourceIds:['fishery-column-moa'],createdAfter:'2020-01-01T00:00:00Z'},'tester','Synthetic native queue ownership');
  const code=`
    import {installModules} from '@aihot/backend/modules';
    import {SERVER_MODULES} from '@aihot/site/modules/server';
    import {getBoss,enqueueOn} from '@aihot/backend/jobs/queue';
    import {closeDb} from '@aihot/backend/db';
    import {startNativeProfile} from './modules/fishery/backend/native-processing.ts';
    import {assertProcessingLease} from './modules/fishery/backend/processing-lease.ts';
    import {flowQueue} from './modules/fishery/backend/flow.ts';
    import {publicationQueue} from './modules/fishery/backend/publication-queue.ts';
    installModules(SERVER_MODULES);let flows=0,publications=0;
    flowQueue.run=async jobs=>{await assertProcessingLease();flows+=jobs.length;};
    publicationQueue.run=async jobs=>{await assertProcessingLease();publications+=jobs.length;};
    const stop=await startNativeProfile();
    try{
      const boss=await getBoss({schedule:false,supervise:false});
      await enqueueOn(flowQueue,{id:'synthetic-native-owned-flow'},{singletonKey:'native-owned-flow'});
      await enqueueOn(publicationQueue,{kind:'article',itemId:'synthetic-native-owned-publication',decisionId:'synthetic',decisionHash:'synthetic',actor:'tester'},{singletonKey:'native-owned-publication'});
      for(const worker of boss.getWipData())boss.notifyWorker(worker.id);
      for(let n=0;n<200&&(flows!==1||publications!==1);n++)await new Promise(resolve=>setTimeout(resolve,20));
      console.log('NATIVE_QUEUE_OWNERSHIP '+JSON.stringify({flows,publications}));
      if(flows!==1||publications!==1)throw new Error('Native consumers did not own specialized jobs');
    }finally{await stop();await closeDb();}
  `;
  const child=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:{...process.env,MODEL_CALLS_ENABLED:'false',COLLECT_ENABLED:'false'},timeout:20000});
  assert.match(child.stdout,/NATIVE_QUEUE_OWNERSHIP \{"flows":1,"publications":1\}/);
  assert.equal((await entries()).length,0,'registration and fake handlers never spend the retained authorization');
});

test("active HTTP lease loss drains consumer release and shutdown until the deferred response settles",async t=>{
  configure(t);assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/);
  await seedTestLedger();
  const before=await entries(),boss=await getBoss({schedule:false,supervise:false});
  assert.ok(before.every(e=>e.state==="received"));assert.equal(shutdownSignal.signal.aborted,false);
  const sent=Promise.withResolvers<void>(),reply=Promise.withResolvers<Response>(),lost=Promise.withResolvers<void>();
  let sends=0,claims=0,publicationCalls=0,aborted=false,releaseReturned=false,shuttingDown:Promise<void>|undefined;
  t.mock.method(globalThis,"fetch",async(_input:unknown,options?:RequestInit)=>{
    sends++;assert.equal(options?.signal,shutdownSignal.signal);
    const abort=()=>{aborted=true;reply.reject(new Error("An already-sent HTTP request was aborted during drain"));};
    options!.signal!.addEventListener("abort",abort,{once:true});sent.resolve();
    try {return await reply.promise;} finally {options!.signal!.removeEventListener("abort",abort);}
  });
  const release=await registerManualFlowConsumer(boss,async()=>{
    claims++;
    await withFisheryAuthorization(async()=>{
      assert.equal((await fetch(TRIAL.endpoint,{...wire,signal:shutdownSignal.signal})).status,200);
      await assert.rejects(fetch(TRIAL.endpoint,wire),/lease/);
    });
  },{watchIntervalMs:20,publicationRun:async()=>{publicationCalls++;},onLeaseLost:()=>{
    lost.resolve();
    shuttingDown=(async()=>{await release();releaseReturned=true;await stopBoss();})();
  }});
  try {
    const activeId=await enqueueOn(flowQueue,{id:"active-http-deferred"});assert.ok(activeId);
    await Promise.race([sent.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Mock HTTP was not sent")),5000))]);
    // A second queue may claim a job, but it cannot overlap the in-flight transport owner.
    const publicationId=await enqueueOn(publicationQueue,{kind:"article",itemId:"synthetic-waiting",decisionId:"synthetic",decisionHash:"synthetic",actor:"tester"});
    for(let n=0;n<100;n++){if((await boss.getJobById(publicationQueue.name,publicationId!))?.state==="active")break;await new Promise(r=>setTimeout(r,20));}
    assert.equal((await boss.getJobById(publicationQueue.name,publicationId!))?.state,"active");assert.equal(publicationCalls,0);
    const sessions=await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='fishery-processing-lease'`;
    assert.equal(sessions.length,1);await terminateOwnLease({backendPid:sessions[0]!.pid});
    await Promise.race([lost.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Active lease loss was not detected")),5000))]);
    const queuedId=await enqueueOn(flowQueue,{id:"after-loss-must-stay-queued"});assert.ok(queuedId);
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(releaseReturned,false);assert.equal(aborted,false);assert.equal(shutdownSignal.signal.aborted,false);
    assert.equal((await entries()).at(-1)!.state,"pending");
    reply.resolve(response());await shuttingDown;
    assert.equal(releaseReturned,true);assert.equal(aborted,false);assert.equal(shutdownSignal.signal.aborted,true);assert.equal(sends,1);assert.equal(claims,1);assert.equal(publicationCalls,0);
    const after=await entries();assert.equal(after.length,before.length+1);assert.deepEqual(after.slice(0,-1),before);assert.equal(after.at(-1)!.state,"received");
    const jobs=await sql`SELECT id,state FROM pgboss.job WHERE id IN (${activeId},${queuedId})`;
    assert.equal(jobs.find(j=>j.id===activeId)?.state,"completed");assert.equal(jobs.find(j=>j.id===queuedId)?.state,"created");
  } finally {reply.resolve(response());await (shuttingDown??release().then(()=>stopBoss()));}
});
