import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, stopBoss, enqueueOn, shutdownSignal } from "@aihot/backend/jobs/queue";
import { acquireProcessingLease, assertProcessingLease, type ProcessingLease } from "../backend/processing-lease.ts";
import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { authorizationKey, assertFisheryCapacity, withFisheryAuthorization } from "../backend/authorization.ts";
import { TRIAL, amountOnlyPolicy } from "../backend/trial-transport.ts";
import { flowQueue } from "../backend/flow.ts";

after(async()=>{await stopBoss();await closeDb();});
const wire={method:"POST",body:JSON.stringify({model:TRIAL.model,messages:[{role:"system",content:"Synthetic lease test"},{role:"user",content:"Synthetic body"}],temperature:0,max_tokens:2048,response_format:{type:"json_object"},thinking:{type:"disabled"}})};
const response=()=>new Response(JSON.stringify({model:"mock",usage:{prompt_tokens:10,completion_tokens:2}}),{status:200});
async function seedTestLedger() {
  assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/,"never initialize/reset a real authorization ledger");
  await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({id:TRIAL.id,entries:[],maxRequests:null,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
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


test("active HTTP lease loss drains consumer release and shutdown until the deferred response settles",async t=>{
  configure(t);assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/);
  if(!(await sql`SELECT 1 FROM settings WHERE key=${authorizationKey}`).length) await seedTestLedger();
  const before=await entries(),boss=await getBoss({schedule:false,supervise:false});
  assert.ok(before.every(e=>e.state==="received"));assert.equal(shutdownSignal.signal.aborted,false);
  const sent=Promise.withResolvers<void>(),reply=Promise.withResolvers<Response>(),lost=Promise.withResolvers<void>();
  let sends=0,claims=0,aborted=false,releaseReturned=false,shuttingDown:Promise<void>|undefined;
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
  },{watchIntervalMs:20,onLeaseLost:()=>{
    lost.resolve();
    shuttingDown=(async()=>{await release();releaseReturned=true;await stopBoss();})();
  }});
  try {
    const activeId=await enqueueOn(flowQueue,{id:"active-http-deferred"});assert.ok(activeId);
    await Promise.race([sent.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Mock HTTP was not sent")),5000))]);
    const sessions=await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='fishery-processing-lease'`;
    assert.equal(sessions.length,1);await terminateOwnLease({backendPid:sessions[0]!.pid});
    await Promise.race([lost.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Active lease loss was not detected")),5000))]);
    const queuedId=await enqueueOn(flowQueue,{id:"after-loss-must-stay-queued"});assert.ok(queuedId);
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(releaseReturned,false);assert.equal(aborted,false);assert.equal(shutdownSignal.signal.aborted,false);
    assert.equal((await entries()).at(-1)!.state,"pending");
    reply.resolve(response());await shuttingDown;
    assert.equal(releaseReturned,true);assert.equal(aborted,false);assert.equal(shutdownSignal.signal.aborted,true);assert.equal(sends,1);assert.equal(claims,1);
    const after=await entries();assert.equal(after.length,before.length+1);assert.deepEqual(after.slice(0,-1),before);assert.equal(after.at(-1)!.state,"received");
    const jobs=await sql`SELECT id,state FROM pgboss.job WHERE id IN (${activeId},${queuedId})`;
    assert.equal(jobs.find(j=>j.id===activeId)?.state,"completed");assert.equal(jobs.find(j=>j.id===queuedId)?.state,"created");
  } finally {reply.resolve(response());await (shuttingDown??release().then(()=>stopBoss()));}
});
