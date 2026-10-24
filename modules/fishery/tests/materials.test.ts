import { loadReport } from "@aihot/backend/publication/reports";
import {nativeArticlePermit,assignNativeDocumentPurpose,migrateOrdinaryDocumentPurpose,reviewOnlyPolicyDocument,initializeReviewOnlyPurpose} from "../backend/native-permit.ts";
import { recallFacts } from "@aihot/backend/events/recall";
import { reportText } from "@aihot/backend/events/relate";
import { loadPool } from "@aihot/backend/publication/pool";
import { publicationQueue } from "../backend/publication-queue.ts";
import {noticeFixture} from './fixtures.ts';

// Several independently verified PDF captures/replays launch the real local parser; keep a bounded per-case allowance.
test('Fujian required attachment updates invalidate approval, but unavailable unchanged dependencies do not',{timeout:180000},async()=>{
 const f=noticeFixture(),pdf=pdfFixture(false,false,'NPFC synthetic complete regulatory reference; not a current application.');
 const capture=(id:string,mode:'original'|'duplicate'|'404'|'scan'|'page-change')=>collectColumns({id,dataDir:config.dataDir,columns:['fujian-notices'],limit:1,wait:async()=>{},fetch:async url=>{
  const robots=url.endsWith('robots.txt'),list=url===COLUMNS['fujian-notices'].url,attachment=url===f.pdfUrl;
  return {url,status:robots||attachment&&mode==='404'||attachment&&mode==='page-change'?404:200,headers:{get:()=>null},body:robots?Buffer.from('missing'):list?Buffer.from(f.listing):attachment?mode==='scan'?pdfFixture(true):mode==='404'||mode==='page-change'?Buffer.from('missing'):pdf:Buffer.from(mode==='page-change'?f.landing().replaceAll(f.title,'变更后的远洋资金政策资料'):f.landing())};
 }});
 const initial=await capture('notice-db-original','original');assert.equal(initial.items[0].state,'ready',initial.items[0].error??'');
 const first=await importBatch(initial.id,'tester'),id=first.rows[0].id;
 const [s]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-fujian-notices'`;await approve(id,1,s.revision);
 const duplicate=await capture('notice-db-duplicate','duplicate');await importBatch(duplicate.id,'tester');assert.equal((await documentHistory(id)).observations.length,1);assert.equal((await materialDetail(id)).state,'approved');
 const missing=await capture('notice-db-missing','404');await importBatch(missing.id,'tester');assert.equal((await documentHistory(id)).observations.length,1);assert.equal((await materialDetail(id)).state,'approved');
 const changed=await capture('notice-db-scan','scan');assert.equal(changed.items[0].state,'failed');const update=await importBatch(changed.id,'tester');assert.equal(update.rows.length,0);assert.equal(update.evidenceUpdates.length,1);
 const history=await documentHistory(id);assert.equal(history.observations.length,2);assert.equal(history.observations[1].payload.sourceCapture.parseStatus,'unverified');assert.equal(history.reviews.length,1);assert.notEqual((await materialDetail(id)).state,'approved');
 const oldUnavailable=await importBatch(missing.id,'tester');assert.equal(oldUnavailable.evidenceUpdates.length,0);assert.equal((await documentHistory(id)).observations.length,2,'A previously ignored dependency capture remains a no-op after newer evidence');
 await importBatch(changed.id,'tester');assert.equal((await documentHistory(id)).observations.length,2,'Identical failed attachment evidence is idempotent');
 const pageChange=await capture('notice-db-page-change','page-change');await importBatch(pageChange.id,'tester');assert.equal((await documentHistory(id)).observations.length,3,'Changed verified landing body is evidence even with a 404 attachment');
 await importBatch(changed.id,'tester');assert.equal((await documentHistory(id)).observations.length,3,'Replaying an older required-attachment change never restores its superseded evidence');
 assert.equal((await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${id}`).length,0,'Pending source material never starts a paid flow');
 const [source]=await sql`SELECT enabled,participation_mode FROM sources WHERE id='fishery-column-fujian-notices'`;assert.equal(source.enabled,false);assert.equal(source.participation_mode,'editorial');
});

test('second-score provider refusal keeps its own stage and never starts article generation',async()=>{
 const d=await selectionFixture(71),sent:string[]=[],base=selectionMock(d.body,sent);
 const result=await runFlow(d.task.id,async(q:any)=>{
  if(q.purpose==='score_article'&&q.subject.includes(':score-2:'))throw new ProviderRejectedError('Synthetic contentFilter 1301',400,false);
  return base(q);
 });
 assert.equal(result.status,'needs_evidence');assert.equal(result.stage,'score-2');assert.equal(result.selection.outcome.label,'REFUSED');assert.deepEqual(sent,['prefilter','score-1']);assert.equal(result.internalArticle,null);
});


test('selection regeneration preserves prior receipts and can reconcile a later zero-request interruption',async()=>{
 await getBoss({schedule:false,supervise:false});
 const d=await selectionFixture(70),sends:string[]=[];let fail=true;
 const invoke=selectionMock(d.body,sends,{failSecond:()=>fail});
 assert.equal((await runFlow(d.task.id,invoke)).stage,'score-2');
 await retryFlow(d.task.id,{note:'Synthetic explicit second-stage regeneration',mode:'regenerate',acknowledgeNewCharge:true},'tester');fail=false;
 await sql.unsafe(`CREATE FUNCTION selection_regen_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${d.task.id}' AND NEW.stage_requests ? 'generation:1' THEN RAISE EXCEPTION 'Synthetic request intent not saved'; END IF; RETURN NEW; END $$`);
 await sql.unsafe('CREATE TRIGGER selection_regen_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION selection_regen_fault()');
 const [previousLedger]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
 try{
  const stopped=await runFlow(d.task.id,invoke);assert.equal(stopped.stage,'generation');assert.equal(stopped.selection.attempts['score-2'],2);
  assert.ok(stopped.stage_requests['score-2:1']);assert.ok(stopped.stage_requests['score-2:2']);
  await sql.unsafe('DROP TRIGGER selection_regen_fault ON fishery_flow_tasks');
  await sql`INSERT INTO settings(key,value) VALUES(${authorizationKey},${sql.json({id:TRIAL.id,entries:[],maxRequests:null,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny})}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  await sql`UPDATE fishery_flow_tasks SET status='running',error=NULL WHERE id=${d.task.id}`;
  const interrupted=await flowDetail(d.task.id);assert.equal(interrupted.reconciliation.eligible,true,JSON.stringify(interrupted.reconciliation.reasons));assert.equal(interrupted.reconciliation.newCallsOnResume,2);
  await reconcileFlow(d.task.id,{snapshotHash:interrupted.snapshotHash,executionFingerprint:interrupted.reconciliation.executionFingerprint,expectedStatus:'running',acknowledgeRunnerStopped:true,reason:'Synthetic old direct runner stopped and generation intent never committed'},'tester');
  await retryFlow(d.task.id,{note:'Explicitly resume the missing generation and review',acknowledgeNewCharge:true},'tester');
  assert.equal((await runFlow(d.task.id,invoke)).status,'needs_human_review');assert.deepEqual(sends,['prefilter','score-1','score-2','generation','review']);
 }finally{
  await sql.unsafe('DROP TRIGGER IF EXISTS selection_regen_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION selection_regen_fault()');
  if(previousLedger)await sql`UPDATE settings SET value=${sql.json(previousLedger.value)} WHERE key=${authorizationKey}`;else await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
 }
});


test('selection keeps a saved outcome across a generation-request interruption; changed version stops subsequent calls',async()=>{
 const d=await selectionFixture(68),sends:string[]=[],invoke=selectionMock(d.body,sends);
 await sql.unsafe(`CREATE FUNCTION selection_generation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${d.task.id}' AND NEW.stage_requests ? 'generation:1' THEN RAISE EXCEPTION 'Synthetic before generation request'; END IF; RETURN NEW; END $$`);
 await sql.unsafe('CREATE TRIGGER selection_generation_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION selection_generation_fault()');
 try{
  const interrupted=await runFlow(d.task.id,invoke);assert.equal(interrupted.status,'failed');assert.equal(interrupted.stage,'generation');
  assert.equal(interrupted.selection.outcome.label,'SCORED');assert.deepEqual(sends,['prefilter','score-1','score-2']);
  await sql.unsafe('DROP TRIGGER selection_generation_fault ON fishery_flow_tasks');
  await retryFlow(d.task.id,{note:'Resume durable selection outcome without repaying scores'},'tester');
  assert.equal((await runFlow(d.task.id,invoke)).status,'needs_human_review');assert.deepEqual(sends,['prefilter','score-1','score-2','generation','review']);
 }finally{await sql.unsafe('DROP TRIGGER IF EXISTS selection_generation_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION selection_generation_fault()');}
 const changed=await selectionFixture(69),sent:string[]=[];
 const blocked=await runFlow(changed.task.id,selectionMock(changed.body,sent,{after:async stage=>{
  if(stage==='prefilter')await observe(changed.id,{...observationFixture,expectedRevision:1,summaryZh:'Synthetic changed metadata',language:'zh',sourceCapture:{adapter:'moa',sourceUrl:'https://example.org/version-test',capturedAt:'2026-10-21T08:01:00Z',httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(changed.body),parser:'synthetic/v1',parseStatus:'parsed',attachmentSha256:null,conflicts:[]}},'tester');
 }}));
 assert.equal(blocked.status,'failed');assert.equal(blocked.stale,true);assert.deepEqual(sent,['prefilter']);
});
function selectionMock(body:string,sends:string[],options:{label?:string;failSecond?:()=>boolean;after?:(stage:string)=>Promise<void>;missingEvidence?:boolean;score?:number}={}){
 return async(q:any)=>{
  const stage=q.purpose==='prefilter_article'?'prefilter':q.purpose==='score_article'?q.subject.includes(':score-1:')?'score-1':'score-2':q.purpose==='fishery_draft'?'generation':q.purpose==='structure_article'?'structure':'review';
  if(stage==='score-2'&&options.failSecond?.())throw new Error('Synthetic second score before response');
  const e=['p1s1'],u={date:{precision:'unknown',value:null},evidence:[]};
  const data=stage==='prefilter'?{label:options.label??'PASS',reason:'Synthetic relevant original'}:stage.startsWith('score-')?{attentionScore:options.score??95}:stage==='generation'?{
   relevance:{decision:'relevant',reason:'Synthetic original',evidence:e},summaryZh:[{sentence:options.missingEvidence?'原文没有这个数字9999。':body,evidence:e}],
   dates:{published:u,event:u,adopted:u,effective:u,objectionDeadline:u},entryIntoForce:{value:'unknown',evidence:[]},eventStatus:{value:'unknown',evidence:[]},validityStatus:'unknown',locations:[],organizations:[],uncertainties:[]
  }:stage==='structure'?{scope:'single',category:'policy',tags:['政策'],subjects:[],fact:{title:'测试机构发布远洋船队申报安排',subject:'测试机构',action:'发布',object:'远洋船队申报安排',occurredAt:null,evidence:body,conditions:[]}}:{decision:'supported',coverage:'complete_input',findings:JSON.parse(q.user).claims.map((claim:any)=>({field:claim.id,verdict:'supported',reason:'Synthetic bound source',evidence:claim.evidenceIds}))};
  const r=await paidRequest({service:'selection-local-mock',model:'mock',purpose:q.purpose,subject:q.subject,identity:{promptVersion:q.promptVersion,system:q.system,user:q.user},attemptTag:q.attemptTag},async()=>{
   sends.push(stage);await options.after?.(stage);return {response:data};
  });
  return {data:q.schema.parse(r.response),receiptId:r.receiptId,reused:r.reused,model:'mock',usage:null};
 };
}
async function selectionFixture(number:number,publishedAt?:string){
 const d=await automaticFixture(number),[v]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 if(publishedAt){const h=await documentHistory(d.id),p=h.observations.at(-1)!.payload;await observe(d.id,{...p,expectedRevision:1,dates:{...p.dates,published:{precision:'day',value:publishedAt.slice(0,10)}},sourceCapture:{...p.sourceCapture,publishedAt}},'tester');}
 await approve(d.id,publishedAt?2:1,v.revision);return {...d,task:await createFlow(d.id,{identity:'selection-'+number,selection:true},'tester')};
}
test('selection persists three independent receipts, needs final fact approval and keeps historical material historical',async()=>{
 const d=await selectionFixture(61,'2020-09-30T12:36:00.000Z'),sends:string[]=[],invoke=selectionMock(d.body,sends);
 assert.equal(await flowRequiredCalls(d.task.id),5);
 const result=await runFlow(d.task.id,async q=>{if(q.purpose==='score_article')assert.match(String(q.user),/2020-09-30T20:36/,'Verified original instant must survive the selection input');return invoke(q);});
 assert.equal(result.status,'needs_human_review',JSON.stringify(result.error));assert.deepEqual(sends,['prefilter','score-1','score-2','generation','review']);
 assert.equal(new Set(Object.values(result.selection.results).map((r:any)=>r.receiptId)).size,3);
 assert.notEqual(result.stage_requests['score-1:1'].subject,result.stage_requests['score-2:1'].subject);
 assert.notEqual(result.stage_requests['score-1:1'].attemptTag,result.stage_requests['score-2:1'].attemptTag);
 assert.equal(result.selection.outcome.attentionCandidate,true);assert.equal(result.selection.outcome.calibrated,false);assert.equal(result.selection.outcome.factApproval,false);
 assert.equal(result.internalArticle,null);assert.equal(result.timeline.historical,true);assert.equal(await flowRequiredCalls(d.task.id),0);
 await decideFlow(d.task.id,{decision:'qualified',publication:'publish',snapshotHash:result.snapshotHash,note:'Synthetic separate final evidence approval'},'authorized-agent:test');
 assert.ok((await flowDetail(d.task.id)).internalArticle);
 await assert.rejects(createFlow(d.id,{identity:'not-a-legacy-backfill'},'tester'),/different selection mode/);
});
test('second score interruption resumes only missing work and never repays prefilter or first score',async()=>{
 const d=await selectionFixture(62),sends:string[]=[];let failed=true;const invoke=selectionMock(d.body,sends,{failSecond:()=>failed});
 const first=await runFlow(d.task.id,invoke);assert.equal(first.status,'failed');assert.equal(first.stage,'score-2');assert.deepEqual(sends,['prefilter','score-1']);
 assert.equal(await flowRequiredCalls(d.task.id),3);
 await retryFlow(d.task.id,{note:'Synthetic explicit second score recovery'},'tester');failed=false;
 const resumed=await runFlow(d.task.id,invoke);assert.equal(resumed.status,'needs_human_review',JSON.stringify(resumed.error));
 assert.deepEqual(sends,['prefilter','score-1','score-2','generation','review']);
});
test('received second score with failed persistence reuses receipt; unknown blocks every recovery mode',async()=>{
 const d=await selectionFixture(63),sends:string[]=[],invoke=selectionMock(d.body,sends);
 await sql.unsafe(`CREATE FUNCTION selection_save_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${d.task.id}' AND NEW.selection->'results' ? 'score-2' AND OLD.stage='score-2' THEN RAISE EXCEPTION 'Synthetic second score save outage'; END IF; RETURN NEW; END $$`);
 await sql.unsafe('CREATE TRIGGER selection_save_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION selection_save_fault()');
 try{
  const failed=await runFlow(d.task.id,invoke);assert.equal(failed.status,'failed');assert.equal(failed.stage,'score-2');assert.equal(failed.error.phase,'persist');assert.deepEqual(sends,['prefilter','score-1','score-2']);
  await sql.unsafe('DROP TRIGGER selection_save_fault ON fishery_flow_tasks');
  const [r]=await sql`SELECT id FROM receipts WHERE subject=${failed.stage_requests['score-2:1'].subject}`;
  await sql`UPDATE receipts SET status='unknown' WHERE id=${r.id}`;
  await assert.rejects(retryFlow(d.task.id,{note:'Unknown must not resend'},'tester'),/pending\/unknown/);
  await assert.rejects(retryFlow(d.task.id,{note:'Unknown must not regenerate',mode:'regenerate',acknowledgeNewCharge:true},'tester'),/pending\/unknown/);
  assert.equal(sends.length,3);await sql`UPDATE receipts SET status='received' WHERE id=${r.id}`;
  await assert.rejects(retryFlow(d.task.id,{note:'Keep received response',mode:'regenerate',acknowledgeNewCharge:true},'tester'),/resume same attempt/);
  await retryFlow(d.task.id,{note:'Resume existing second score receipt'},'tester');
  const done=await runFlow(d.task.id,invoke);assert.equal(done.status,'needs_human_review',JSON.stringify(done.error));assert.deepEqual(sends,['prefilter','score-1','score-2','generation','review']);
  assert.equal(done.selection.outcome.label,'SCORED','Outcome was persisted in the score-2 transaction');
 }finally{await sql.unsafe('DROP TRIGGER IF EXISTS selection_save_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION selection_save_fault()');}
});
test('selection BLOCK and UNKNOWN stop scores; high score cannot bless a fact without evidence; isolation stops the next call',async()=>{
 for(const [n,label] of [[64,'BLOCK'],[65,'UNKNOWN']] as const){
  const d=await selectionFixture(n),sends:string[]=[],result=await runFlow(d.task.id,selectionMock(d.body,sends,{label}));
  assert.equal(result.status,'needs_evidence');assert.deepEqual(sends,['prefilter']);assert.equal(result.selection.outcome.label,label);assert.equal(result.internalArticle,null);assert.equal(await flowRequiredCalls(d.task.id),0);
 }
 const low=await selectionFixture(969),lowSends:string[]=[],lowResult=await runFlow(low.task.id,selectionMock(low.body,lowSends,{score:10}));
 assert.equal(lowResult.status,'needs_evidence');assert.deepEqual(lowSends,['prefilter','score-1','score-2']);assert.equal(lowResult.draft,null);assert.match(lowResult.error.reason,/BELOW_VALUE_THRESHOLD/);assert.equal(await flowRequiredCalls(low.task.id),0);
 const bad=await selectionFixture(66),paid:string[]=[],result=await runFlow(bad.task.id,selectionMock(bad.body,paid,{missingEvidence:true}));
 assert.equal(result.status,'failed');assert.equal(result.stage,'generation');assert.equal(result.selection.outcome.attentionCandidate,true);assert.equal(result.internalArticle,null);
 await assert.rejects(decideFlow(bad.task.id,{decision:'qualified',publication:'publish',snapshotHash:result.snapshotHash,note:'High scores do not prove facts'},'tester'),/相关性|Review|review/);
 const isolated=await selectionFixture(67),sent:string[]=[];
 try{
  const blocked=await runFlow(isolated.task.id,selectionMock(isolated.body,sent,{after:async stage=>{if(stage==='prefilter')await sql`UPDATE sources SET participation_mode='isolated' WHERE id='fishery-column-moa'`;}}));
  assert.equal(blocked.status,'failed');assert.deepEqual(sent,['prefilter']);assert.match(blocked.error.reason,/isolated/);
 }finally{await sql`UPDATE sources SET participation_mode='editorial' WHERE id='fishery-column-moa'`;}
});

import {AUTOMATIC_FLOW_KEY,configureAutomaticFlows,upgradeAutomaticFlowSources,dispatchAutomaticDocuments,automaticFlowPermit} from '../backend/automatic-flows.ts';
import {nominateProcessing,processingEligibility,revokeProcessing} from '../backend/processing-eligibility.ts';
import { syncFisheryPublications } from "../backend/publication-bridge.ts";
import { loadItemDetail, exportMarkdown } from "@aihot/backend/publication/detail";
import {v1Items} from "@aihot/backend/publication/v1";
import {itemFeed} from "@aihot/backend/publication/feeds";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { marked } from "marked";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { setVisibility } from "@aihot/backend/admin/content";
import { listSources, sourceDetail, fetchNow, updateSource } from "@aihot/backend/admin/sources";
import { republishKey } from "@aihot/backend/jobs/publication";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { getBoss, stopBoss, enqueueOn, QUEUES } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import fishery from "../server.ts";
import { exportMaterial, materialMarkdown } from "../backend/export.ts";
import { createDocument, documentHistory, hash, importCapturedMaterial, storeCapturedNews, observe, registerSource, review, sourceHealth, withdraw } from "../backend/store.ts";
import { sourceFixture, observationFixture, npfcRobotsFixture, pdfFixture } from "./fixtures.ts";
import { materialDetail } from "../backend/workbench.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { workbench } from "../backend/workbench.ts";
import { collectColumns,readCapturedText } from "../backend/column-batches.ts";
import { importBatch } from "../backend/import-batch.ts";
import { COLUMNS } from "../backend/official-columns.ts";

import { paidRequest, completeReceipt,ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { reconcileFlow, revisionContext, createHumanRevision, createFlow, flowDetail, runFlow, retryFlow, decideFlow, flowRequiredCalls, flowQueue, runQueuedFlows } from "../backend/flow.ts";

import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { authorizationKey, upgradeExistingTrialToAmountOnly, assertFisheryCapacity } from "../backend/authorization.ts";
import { prepareFisheryDraft, buildFisheryDraftRequest } from "../backend/ai-draft.ts";
import { acquireProcessingLease } from "../backend/processing-lease.ts";
import { TRIAL, amountOnlyPolicy, trialBudget, trialCapacity } from "../backend/trial-transport.ts";

import { readerPage, readerItem } from "../backend/reader.ts";

installModules([fishery]);
const app = await buildApp();
let count = 0;
const now = new Date("2026-10-20T00:00:00Z");
before(() => { config.devAdmin = null; });
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

test("isolated source blocks existing and new processing before any paid request", async () => {
  const f=await fixture({unknownRights:true}),body="合成远洋渔业原文，仅用于停用信源回归。";
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic source",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const task=await createFlow(f.id,{identity:"before-source-isolation"},"tester");
  const [before]=await sql`SELECT count(*)::int AS n FROM receipts`;let sends=0;
  await sql`UPDATE sources SET participation_mode='isolated' WHERE id=${f.sourceId}`;
  try {
    await assert.rejects(createFlow(f.id,{identity:"after-source-isolation"},"tester"),/Source is isolated/);
    const blocked=await runFlow(task.id,async()=>{sends++;throw new Error("Must not send");});
    assert.equal(blocked.status,"failed");assert.match(blocked.error.reason,/isolated/);
    assert.equal(sends,0);assert.equal((await flowDetail(task.id)).stale,true);assert.equal((await flowDetail(task.id)).internalArticle,null);
    const [after]=await sql`SELECT count(*)::int AS n FROM receipts`;assert.equal(after!.n,before!.n);
    assert.equal((await documentHistory(f.id)).observations.length,2,"Original evidence is retained");
  } finally {await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${f.sourceId}`;}
});

test("isolated registered IOTC cannot acquire or reimport and sync never revives it",async()=>{
  await sql`INSERT INTO sources(id,name,kind,enabled,participation_mode) VALUES('fishery-column-iotc','Synthetic retired IOTC','external',false,'editorial') ON CONFLICT(id) DO NOTHING`;
  const [old]=await sql`SELECT participation_mode,cursor FROM sources WHERE id='fishery-column-iotc'`;
  await sql`UPDATE sources SET participation_mode='isolated' WHERE id='fishery-column-iotc'`;
  const [before]=await sql`SELECT count(*)::int AS n FROM fishery_documents WHERE source_id='fishery-column-iotc'`;let gets=0;
  try {
    await assert.rejects(collectColumnRound({id:"retired-iotc-round",dataDir:config.dataDir,columns:["iotc"],limit:1,maxPages:1,storage:"db",store:columnDbProgress,fetch:async()=>{gets++;throw new Error("Must not fetch");}}),/isolated/);
    await assert.rejects(importCapturedMaterial({id:"iotc",...COLUMNS.iotc},"https://iotc.org/cmm/synthetic-retired",observationFixture,"tester"),/Source is isolated/);
    const [current]=await sql`SELECT enabled,participation_mode,cursor FROM sources WHERE id='fishery-column-iotc'`;
    const [after]=await sql`SELECT count(*)::int AS n FROM fishery_documents WHERE source_id='fishery-column-iotc'`;
    assert.equal(gets,0);assert.equal(current!.enabled,false);assert.equal(current!.participation_mode,"isolated");assert.deepEqual(current!.cursor,old!.cursor);assert.equal(after!.n,before!.n);
  } finally {await sql`UPDATE sources SET participation_mode=${old!.participation_mode} WHERE id='fishery-column-iotc'`;}
});
async function fixture(options: { unknownRights?: boolean; articleId?: string; sourceId?: string } = {}) {
  const sourceId = options.sourceId ?? `fishery-${++count}`;
  if (!options.sourceId) await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Fixture', 'external', false, '2100-01-01')`;
  await registerSource(sourceId, options.unknownRights ? { expectedRevision: 0 } : sourceFixture, "tester");
  const doc = await createDocument({ sourceId, articleId: options.articleId ?? null, issuer: "Fixture issuer", documentNumber: "CMM-fixture-01", canonicalUrl: `https://example.org/${sourceId}` }, "tester");
  await observe(doc.id, observationFixture, "tester");
  return { id: String(doc.id), sourceId };
}
const approve = (id: string, revision = 1, sourceRevision = 1) => review(id, { revision, sourceRevision, decision: "approved", applicabilityReviewed: false, note: "Manual fixture review" }, "reviewer");

async function automaticFixture(number:number,body='合成公海远洋渔业事实，仅供自动派发离线测试。',column:'moa'|'fujian'='moa'){
  const url=`https://yyj.moa.gov.cn/gzdt/202610/t20261021_auto${number}.htm`;
  const doc=await importCapturedMaterial({id:column,...COLUMNS[column]},url,{...observationFixture,language:'zh',sourceCapture:{adapter:column,sourceUrl:url,capturedAt:'2026-10-21T08:00:00Z',httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:'synthetic/v1',parseStatus:'parsed',attachmentSha256:null,conflicts:[]}},'tester');
  await upsertMaterial({sourceId:`fishery-column-${column}`,url:`https://example.org/auto-body-${number}`,title:'Synthetic automatic source',publishedAt:new Date(),bodyText:body,bodyStatus:'ok',via:'fishery-mock',raw:{fisheryDocumentId:doc.id}});
  return {...doc,body};
}
const autoPolicy=(documentIds?:string[])=>({enabled:true,sourceIds:['fishery-column-moa'],createdAfter:'2026-10-21T00:00:00Z',...documentIds?{documentIds}:{}});
test('bounded business review admits an old approved version without changing history and revocation stops spending',async()=>{
 const d=await automaticFixture(940),[source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 const archiveId='synthetic-business_1234567890abcdef',dir=path.join(config.dataDir,'fishery-batches','synthetic-business','body');
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,`${archiveId}.txt`),d.body);
 await observe(d.id,{...observationFixture,expectedRevision:1,language:'zh',sourceCapture:{adapter:'moa',sourceUrl:'https://example.org/synthetic-business',capturedAt:'2026-10-21T08:00:00Z',httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(d.body),archiveId,parser:'synthetic/v1',parseStatus:'parsed',attachmentSha256:null,conflicts:[]}},'tester');
 await sql`UPDATE fishery_documents SET created_at='2020-01-01' WHERE id=${d.id}`;
 await sql`UPDATE articles SET backfill=true,publication_time='2020-01-01' WHERE raw->>'fisheryDocumentId'=${d.id}`;
 const [original]=await sql`SELECT publication_time,backfill,discovered_at FROM articles WHERE raw->>'fisheryDocumentId'=${d.id}`;
 const before=await sql`SELECT count(*)::int AS n FROM receipts`;
 const nomination={revision:2,sourceRevision:source.revision,kind:'policy',evidenceQuote:d.body,reason:'Synthetic business relevance review; no assertion of current legal validity',expiresAt:new Date(Date.now()+86400000).toISOString()};
 await configureAutomaticFlows(autoPolicy([d.id]),'tester','Synthetic bounded historical business review');
 try{
  assert.equal((await dispatchAutomaticDocuments()).rows.length,0);
  await assert.rejects(nominateProcessing(d.id,nomination,'tester'),/当前版本素材审核/);
  await approve(d.id,2,source.revision);
  await assert.rejects(nominateProcessing(d.id,{...nomination,evidenceQuote:'Synthetic quotation not present in the source'},'tester'),/逐字引用/);
  const granted=await nominateProcessing(d.id,nomination,'tester');assert.equal(granted.eligible,true);
  assert.equal((await nominateProcessing(d.id,nomination,'tester')).nomination!.id,granted.nomination!.id);
  const dispatched=await dispatchAutomaticDocuments();assert.equal(dispatched.rows[0].state,'enqueued');
  assert.equal((await dispatchAutomaticDocuments()).rows.length,0);
  const binding=await automaticFlowPermit(dispatched.rows[0].taskId!);assert.equal(binding.processingEligibilityId,granted.nomination!.id);
  await revokeProcessing(d.id,{reason:'Synthetic explicit review withdrawal before any paid request'},'tester');
  await assert.rejects(automaticFlowPermit(dispatched.rows[0].taskId!,binding),/bounded business-review nomination/);
  assert.equal((await processingEligibility(d.id)).nomination!.status,'revoked');
  await nominateProcessing(d.id,nomination,'tester');await review(d.id,{revision:2,sourceRevision:source.revision,decision:'rejected',applicabilityReviewed:false,note:'Synthetic evidence rejection'},'tester');
  assert.equal((await processingEligibility(d.id)).nomination!.status,'stale');
  assert.deepEqual((await sql`SELECT publication_time,backfill,discovered_at FROM articles WHERE raw->>'fisheryDocumentId'=${d.id}`)[0],original);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`,before);
  const boss=await getBoss({schedule:false,supervise:false});await boss.cancel(flowQueue.name,dispatched.rows[0].jobId!);
 }finally{await sql`DELETE FROM settings WHERE key=${AUTOMATIC_FLOW_KEY}`;}
});
test('captured news reverts and date corrections remain bound to current evidence without duplicate analysis',async()=>{
 const url='https://yyj.moa.gov.cn/gzdt/202610/t20261023_revert.htm',before=await sql`SELECT count(*)::int AS n FROM receipts`;
 const capture=async(body:string,publishedAt='2026-10-23T01:00:00Z')=>{
  const payload={...observationFixture,rawSha256:sha256(body+publishedAt),language:'zh',sourceCapture:{adapter:'moa' as const,sourceUrl:url,capturedAt:'2026-10-23T12:00:00Z',publishedAt,httpStatus:200,rawSha256:sha256(body+publishedAt),bodySha256:sha256(body),parser:'synthetic/v1',parseStatus:'parsed' as const,attachmentSha256:null,conflicts:[]}};
  const doc=await importCapturedMaterial({id:'moa',...COLUMNS.moa},url,payload,'tester');
  await sql`UPDATE fishery_documents SET created_at='2026-10-23T12:00:00Z' WHERE id=${doc.id}`;
  const material=await storeCapturedNews('moa',doc.id,body,'tester');assert.ok('articleId' in material&&material.articleId);
  const [a]=await sql`SELECT id,revision,body_text,published_at,publication_time,backfill,discovered_at FROM articles WHERE id=${material.articleId}`;
  return {doc,material,a};
 };
 const a=await capture('Synthetic original A。'),b=await capture('Synthetic corrected B。'),again=await capture('Synthetic original A。');
 assert.equal(a.a.id,b.a.id);assert.equal(b.a.id,again.a.id);assert.equal(again.a.body_text,'Synthetic original A。');assert.equal(again.a.revision,a.a.revision+2);
 const unchanged=await capture('Synthetic original A。');assert.equal(unchanged.a.revision,again.a.revision);assert.equal((await documentHistory(a.doc.id)).observations.length,3);
 const dated=await capture('Synthetic original A。','2020-01-01T00:00:00Z');assert.equal(dated.a.revision,again.a.revision+1);assert.equal(dated.a.publication_time,'2020-01-01T00:00:00Z');assert.equal(dated.a.backfill,true);assert.equal(dated.a.discovered_at.toISOString(),'2026-10-23T12:00:00.000Z');
 assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`,before);
});
test('ordinary captures never create the retired review pipeline even when raw material was approved',async()=>{
 const d=await automaticFixture(910),[source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 await configureAutomaticFlows(autoPolicy([d.id]),'tester','Synthetic ordinary news must stay on native processing');
 try {
  assert.equal((await dispatchAutomaticDocuments()).rows.length,0);
  await approve(d.id,1,source.revision);
  assert.equal((await dispatchAutomaticDocuments()).rows.length,0);
  assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE document_id=${d.id}`).length,0);
 }finally{await sql`DELETE FROM settings WHERE key=${AUTOMATIC_FLOW_KEY}`;}
});

test("archived batch imports through the guarded route and displays only its version-bound body",async()=>{
  const url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_1.htm",body="合成远洋渔业与公海履约原文，仅用于隔离测试，不是真实资讯。".repeat(4);
  await collectColumns({id:"synthetic-route-batch",dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request.endsWith("robots.txt")?404:200,headers:{get:()=>"text/html"},body:Buffer.from(request.endsWith("robots.txt")?"missing":request===COLUMNS.moa.url?`<ul class="sj_e_tonzhi_list"><li><a href="${url}">合成公海材料</a></li></ul>`:`<meta name="ArticleTitle" content="合成公海材料"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor"><p>${body}</p></div></div>`)})});
  config.devAdmin={displayName:"ISOLATED TEST IMPORT ONLY"};
  try {
    const response=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-route-batch/import",headers:{"x-csrf-token":"dev"},payload:{}});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.headers["cache-control"],"no-store");
    const id=response.json().rows[0].id,detail=await materialDetail(id);
    const [acquisition]=await sql`SELECT after FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'='synthetic-route-batch'`;
    assert.equal(acquisition.after.outcome,"ready");assert.equal(acquisition.after.reason,"Verified source body; awaiting material review");
    assert.equal(detail.state,"pending");assert.equal(detail.reviews.length,0);assert.equal(detail.text?.body,body);assert.equal(detail.text?.hashMatches,true);
    assert.equal(detail.source.profile.rightsStatus,"unknown");assert.equal(detail.source.enabled,false);
    const [source]=await sql`SELECT tier,first_party FROM sources WHERE id='fishery-column-moa'`;
    assert.equal(source!.tier,'T1');assert.equal(source!.first_party,true);
    await sql`UPDATE sources SET tier='T1_5',first_party=false WHERE id='fishery-column-moa'`;
    const again=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-route-batch/import",headers:{"x-csrf-token":"dev"},payload:{}});
    assert.equal(again.statusCode,200,again.body);assert.equal(again.json().rows[0].unchanged,true);
    const [preserved]=await sql`SELECT tier,first_party FROM sources WHERE id='fishery-column-moa'`;
    assert.equal(preserved!.tier,'T1_5');assert.equal(preserved!.first_party,false,'Replay preserves operator classification');
    await sql`UPDATE sources SET tier='T1',first_party=true WHERE id='fishery-column-moa'`;
    assert.equal((await documentHistory(id)).observations.length,1);
  } finally {config.devAdmin=null;}
});

async function frozenCapture(id:string,url:string,version:string){
  const body=`远洋渔业公海履约资料版本${version}。本材料仅用于离线归档重放回归，全部内容均为合成测试数据。`.repeat(3);
  return collectColumns({id,dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request.endsWith("robots.txt")?404:200,headers:{get:()=>"text/html"},body:Buffer.from(request.endsWith("robots.txt")?"missing":request===COLUMNS.moa.url?`<ul class="sj_e_tonzhi_list"><li><a href="${url}">远洋渔业归档测试</a></li></ul>`:`<meta name="ArticleTitle" content="远洋渔业归档测试"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor"><p>${body}</p></div></div>`)})});
}
test("frozen archive replay preserves approved B, including an earlier no-op capture; a new A capture is revision 3",async()=>{
  const url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_99701.htm";
  const a=await frozenCapture("frozen-replay-a",url,"A"),first=await importBatch(a.id,"tester"),id=first.rows[0].id;
  const duplicate=await frozenCapture("frozen-replay-a-duplicate",url,"A");
  assert.equal((await importBatch(duplicate.id,"tester")).rows[0].unchanged,true);
  const legacyDuplicate=await frozenCapture("frozen-replay-a-legacy-duplicate",url,"A");await importBatch(legacyDuplicate.id,"tester");
  await sql`DELETE FROM audit_log WHERE action='fishery.capture_import' AND subject=${`fishery-capture:${legacyDuplicate.items[0].archiveId}`}`;
  const b=await frozenCapture("frozen-replay-b",url,"B");assert.equal((await importBatch(b.id,"tester")).rows[0].revision,2);
  const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
  await approve(id,2,source.revision);
  const current=(await materialDetail(id)).text?.body;
  for(const batch of [a,duplicate]){
    const replay=await importBatch(batch.id,"tester");assert.equal(replay.rows[0].unchanged,true);assert.equal(replay.rows[0].revision,2);
    assert.equal((await materialDetail(id)).state,"approved");assert.equal((await materialDetail(id)).text?.body,current);
  }
  const concurrent=await withColumnLease("moa",()=>Promise.all([importBatch(a.id,"tester"),importBatch(duplicate.id,"tester")]));
  assert.ok(concurrent.every(result=>result.rows[0].unchanged&&result.rows[0].revision===2));
  assert.equal((await documentHistory(id)).observations.length,2);
  await assert.rejects(importBatch(legacyDuplicate.id,"tester"),/incomplete source proof; explicit recovery required/);
  assert.equal((await materialDetail(id)).state,"approved");
  const old=(await documentHistory(id)).observations[0].payload;
  await assert.rejects(importCapturedMaterial({id:"moa",...COLUMNS.moa},url,{...old,expectedRevision:0,sourceCapture:{...old.sourceCapture,bodySha256:"f".repeat(64)}},"tester"),/conflicting source proof/);
  assert.equal((await documentHistory(id)).observations.length,2);
  const fresh=await frozenCapture("frozen-replay-a-new",url,"A"),changed=await importBatch(fresh.id,"tester");
  assert.equal(changed.rows[0].revision,3);assert.equal(changed.rows[0].unchanged,false);assert.notEqual((await materialDetail(id)).state,"approved");
});
test("concurrent frozen archive replays commit one import receipt and never append old A after B",async()=>{
  const column={id:"synthetic-frozen-replay",name:"Synthetic replay",issuer:"Synthetic attribution"},url="https://example.org/frozen-concurrent";
  const input=(batchId:string,bodyHash:string)=>({...observationFixture,sourceCapture:{adapter:"moa",sourceUrl:url,capturedAt:"2026-10-20T00:00:00Z",archiveId:`${batchId}_${sha256(column.id+url).slice(0,16)}`,httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:bodyHash,parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}});
  const a=input("frozen-concurrent-a","a".repeat(64)),b=input("frozen-concurrent-b","b".repeat(64));
  const imported=await Promise.all(Array.from({length:4},()=>importCapturedMaterial(column,url,a,"tester")));
  const id=imported[0].id;assert.equal(imported.filter(row=>!row.unchanged).length,1);
  await importCapturedMaterial(column,url,b,"tester");await approve(id,2,1);
  const replays=await Promise.all(Array.from({length:4},()=>importCapturedMaterial(column,url,a,"tester")));
  assert.ok(replays.every(row=>row.unchanged&&row.revision===2));assert.equal((await materialDetail(id)).state,"approved");
  assert.equal((await documentHistory(id)).observations.length,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='fishery.capture_import' AND subject=${`fishery-capture:${a.sourceCapture.archiveId}`}`)[0].n,1);
});
test("frozen archive receipt survives an acquisition-audit crash and recovers legacy observation proof",async()=>{
  for(const legacy of [false,true]){
    const suffix=legacy?"legacy":"current",url=`https://yyj.moa.gov.cn/gzdt/202610/t20261020_${legacy?99703:99702}.htm`;
    const a=await frozenCapture(`frozen-crash-${suffix}-a`,url,"A");
    await sql.unsafe("CREATE FUNCTION frozen_acquisition_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='fishery.acquisition' THEN RAISE EXCEPTION 'Synthetic acquisition audit outage'; END IF; RETURN NEW; END $$");
    await sql.unsafe("CREATE TRIGGER frozen_acquisition_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION frozen_acquisition_fault()");
    try{await assert.rejects(importBatch(a.id,"tester"),/Synthetic acquisition audit outage/);}
    finally{await sql.unsafe("DROP TRIGGER frozen_acquisition_fault ON audit_log");await sql.unsafe("DROP FUNCTION frozen_acquisition_fault()");}
    const [doc]=await sql`SELECT id FROM fishery_documents WHERE canonical_url=${url}`;
    assert.equal((await documentHistory(doc.id)).observations.length,1);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='fishery.capture_import' AND subject=${`fishery-capture:${a.items[0].archiveId}`}`).length,1);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='fishery.acquisition' AND subject=${`fishery:${doc.id}`}`).length,0);
    if(legacy)await sql`DELETE FROM audit_log WHERE action='fishery.capture_import' AND subject=${`fishery-capture:${a.items[0].archiveId}`}`;
    const b=await frozenCapture(`frozen-crash-${suffix}-b`,url,"B");await importBatch(b.id,"tester");
    const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;await approve(doc.id,2,source.revision);
    assert.equal((await importBatch(a.id,"tester")).rows[0].unchanged,true);
    assert.equal((await documentHistory(doc.id)).observations.length,2);assert.equal((await materialDetail(doc.id)).state,"approved");
  }
});

test("captured imports are unreviewed, unchanged captures deduplicate and A→B→A invalidates review",async()=>{
  const column={id:"synthetic-import",name:"Synthetic column",issuer:"Synthetic official issuer"};
  const a={...observationFixture,sourceCapture:{adapter:"moa",sourceUrl:"https://example.org/import",capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:"a".repeat(64),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}};
  const first=await importCapturedMaterial(column,"https://example.org/import",a,"tester");
  assert.equal(first.revision,1);assert.equal((await materialDetail(first.id)).state,"pending");
  const sources=await sql`SELECT s.enabled,s.site_fulltext,f.profile FROM sources s JOIN fishery_sources f ON f.source_id=s.id WHERE s.id='fishery-column-synthetic-import'`;
  assert.equal(sources[0]!.enabled,false);assert.equal(sources[0]!.site_fulltext,false);assert.equal(sources[0]!.profile.rightsStatus,"unknown");
  await approve(first.id);
  const duplicate=await importCapturedMaterial(column,"https://example.org/import",{...a,sourceCapture:{...a.sourceCapture,capturedAt:"2026-10-21T00:00:00Z"}},"tester");
  assert.equal(duplicate.unchanged,true);assert.equal((await materialDetail(first.id)).state,"approved");
  const changed=await importCapturedMaterial(column,"https://example.org/import",{...a,sourceCapture:{...a.sourceCapture,bodySha256:"b".repeat(64)}},"tester");
  assert.equal(changed.revision,2);assert.equal((await materialDetail(first.id)).state,"stale");
  const back=await importCapturedMaterial(column,"https://example.org/import",a,"tester");
  assert.equal(back.revision,3);assert.equal(back.unchanged,false);
  assert.equal((await documentHistory(first.id)).reviews.length,1);
  for(let i=0;i<28;i++) await importCapturedMaterial(column,`https://example.org/page-${i}`,{...a,title:`Unique pagination fixture ${i}`},"tester");
  const page1=await workbench({q:"Unique pagination fixture",scope:"all",page:1}),page2=await workbench({q:"Unique pagination fixture",scope:"all",page:2});
  assert.equal(page1.total,28);assert.equal(page1.rows.length,25);assert.equal(page2.rows.length,3);
  assert.equal(new Set([...page1.rows,...page2.rows].map(r=>r.id)).size,28);
  config.devAdmin=null;
  assert.equal((await app.inject("/api/admin/fishery/batches")).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic/import",payload:{}})).statusCode,401);
  config.devAdmin={displayName:"Synthetic CSRF tester"};
  assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic/import",payload:{}})).statusCode,403);
  config.devAdmin=null;
});

test("PDF reacquisition times preserve imported approval and qualified flow while evidence changes invalidate them",async()=>{
  const column={id:"synthetic-pdf-capture-time",name:"Synthetic PDF column",issuer:"Synthetic source attribution"};
  const fact="合成公海远洋渔业事实。",body=`--- Page 1 ---\n${fact}`;
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p2s1"];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==="fishery_draft"?{
    relevance:{decision:"relevant",reason:"Synthetic source evidence",evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[],
  }:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic original sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevance evidence",evidence}]}),receiptId:999999,model:"mock",reused:false,usage:null});
  const variants=["times","html","pdf","body","parser"] as const;
  for(const variant of variants) {
    const url=`https://example.org/pdf-capture-${variant}`,initial={...observationFixture,rawSha256:sha256("original HTML"),sourceCapture:{acquisitionMode:"live_capture",adapter:"iotc",sourceUrl:url,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:sha256("original HTML"),bodySha256:sha256(body),parser:"synthetic-pdf/v1",parseStatus:"parsed",attachmentSha256:sha256("original PDF"),attachmentUrl:"https://example.org/measure.pdf",attachmentHttpStatus:200,attachmentCapturedAt:"2026-10-20T00:00:01Z",attachmentPages:1,conflicts:[]}};
    const imported=await importCapturedMaterial(column,url,initial,"tester");
    await upsertMaterial({sourceId:`fishery-column-${column.id}`,url,title:"Synthetic PDF source",bodyText:body,bodyStatus:"ok",via:"offline-fixture",raw:{fisheryDocumentId:imported.id}});
    await approve(imported.id);
    const task=await createFlow(imported.id,{identity:`capture-time-${variant}`},"tester"),checked=await runFlow(task.id,invoke);
    assert.equal(checked.status,"needs_human_review");
    await decideFlow(task.id,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Synthetic snapshot qualification"},"reviewer");
    assert.ok((await flowDetail(task.id)).internalArticle);
    const recaptured={...initial,sourceCapture:{...initial.sourceCapture,capturedAt:"2026-10-21T00:00:00Z",attachmentCapturedAt:"2026-10-21T00:00:01Z"}};
    const duplicate=await importCapturedMaterial(column,url,recaptured,"tester");
    assert.equal(duplicate.unchanged,true,variant);assert.equal(duplicate.revision,1,variant);
    assert.equal((await materialDetail(imported.id)).state,"approved");
    const stillQualified=await flowDetail(task.id);assert.equal(stillQualified.stale,false);assert.equal(stillQualified.status,"qualified");assert.ok(stillQualified.internalArticle);
    const history=await documentHistory(imported.id);assert.equal(history.observations.length,1);assert.equal(history.observations[0]!.payload.sourceCapture.capturedAt,initial.sourceCapture.capturedAt);assert.equal(history.observations[0]!.payload.sourceCapture.attachmentCapturedAt,initial.sourceCapture.attachmentCapturedAt);
    assert.equal(recaptured.sourceCapture.attachmentCapturedAt,"2026-10-21T00:00:01Z","The new acquisition record is not rewritten");
    if(variant==="times") continue;
    const changed=structuredClone(recaptured);
    if(variant==="html") changed.rawSha256=changed.sourceCapture.rawSha256=sha256("changed HTML");
    if(variant==="pdf") changed.sourceCapture.attachmentSha256=sha256("changed PDF");
    if(variant==="body") changed.sourceCapture.bodySha256=sha256(`--- Page 1 ---\n${fact}原文变化。`);
    if(variant==="parser") changed.sourceCapture.parser="synthetic-pdf/v2";
    const updated=await importCapturedMaterial(column,url,changed,"tester");
    assert.equal(updated.unchanged,false,variant);assert.equal(updated.revision,2,variant);assert.equal((await materialDetail(imported.id)).state,"stale");
    const stale=await flowDetail(task.id);assert.equal(stale.stale,true,variant);assert.equal(stale.internalArticle,null,variant);
  }
});

test("column attribution never becomes a page publisher or policy issuer in main records and exports", async () => {
  // Offline counterexample: column owner, page source and joint policy issuers are distinct roles.
  const column = { id: "synthetic-attribution", name: "渔业渔政管理局栏目", issuer: "农业农村部渔业渔政管理局" };
  const url = "https://yyj.moa.gov.cn/gzdt/202609/t20260930_6488348.htm";
  const imported = await importCapturedMaterial(column, url, {
    ...observationFixture, originalTitle: "合成政策报道", title: "合成政策报道",
    summaryZh: "离线角色反例：网页来源为新闻办公室；正文提到农业农村部、财政部联合印发通知。",
  }, "tester");
  const sourceId = `fishery-column-${column.id}`;
  const history = await documentHistory(imported.id);
  assert.equal(history.document.issuer, column.issuer, "preserve legacy user data");
  assert.equal(history.document.sourceAttribution, column.issuer);
  assert.equal(history.document.legacyIssuerMeaning, "source_attribution_only");
  config.devAdmin = { displayName: "ISOLATED TEST ATTRIBUTION ONLY" };
  try {
    const response = await app.inject(`/api/admin/fishery/documents/${imported.id}/detail`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().sourceAttribution, column.issuer);
    assert.equal(response.json().legacyIssuerMeaning, "source_attribution_only");
    const list = await app.inject("/api/admin/fishery/workbench?scope=all&q=合成政策报道");
    assert.equal(list.json().rows.find((r: { id: string }) => r.id === imported.id).sourceAttribution, column.issuer);
  } finally { config.devAdmin = null; }
  await approve(imported.id);
  await assert.rejects(exportMaterial(imported.id, 1, "tester", now), /rights/);
  // Explicit isolated permission fixture is required; no real source rights are changed.
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  await approve(imported.id, 1, 2);
  const bundle = await exportMaterial(imported.id, 1, "tester", now);
  assert.equal(bundle.source.sourceAttribution, column.issuer);
  assert.equal(bundle.source.issuer, column.issuer);
  assert.equal(bundle.source.legacyIssuerMeaning, "source_attribution_only");
  assert.equal(bundle.source.pagePublisher, null, "column owner and mentioned source do not verify a page publisher");
  assert.equal(bundle.policy.issuers, null, "mentioning a notice does not verify its issuers in main-record metadata");
  const markdown = materialMarkdown(bundle);
  assert.match(markdown, /来源归属：农业农村部渔业渔政管理局/);
  assert.match(markdown, /网页发布机构：未知/);
  assert.match(markdown, /政策发文机关：未知/);
});

test("isolated test exports keep the test-review warning in JSON, Markdown and their content hash", async () => {
  const environment = config.environmentName;
  config.environmentName = "test";
  try {
    const { id } = await fixture();
    await approve(id);
    const bundle = await exportMaterial(id, 1, "ISOLATED TEST ONLY", now);
    assert.equal(bundle.editorial.confidence, "isolated_test_workflow_not_business_approval");
    assert.ok(materialMarkdown(bundle).includes("不代表人工业务批准或真实转载授权"));
    const { contentHash, ...payload } = bundle;
    assert.equal(contentHash, hash(payload));
  } finally { config.environmentName = environment; }
});

test("private workbench explains the same gates as export, separates explicit test clones and shows only matching archived text", async () => {
  config.devAdmin = null;
  assert.equal((await app.inject("/api/admin/fishery/workbench")).statusCode, 401);
  const { id, sourceId } = await fixture({ unknownRights: true });
  assert.equal((await app.inject(`/api/admin/fishery/documents/${id}/detail`)).statusCode, 401);
  const body = "Synthetic archived plain text <script>not executable</script>";
  const capture = { acquisitionMode: "live_capture", adapter: "jinjiang", sourceUrl: `https://example.org/${sourceId}`, capturedAt: "2026-10-20T00:00:00Z", httpStatus: 200,
    rawSha256: observationFixture.rawSha256, bodySha256: sha256(body), parser: "Synthetic UI parser/v1", parseStatus: "parsed", attachmentSha256: null, conflicts: [] };
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: capture }, "tester");
  await upsertMaterial({ sourceId, url: `https://example.org/${sourceId}`, title: "Synthetic archive", bodyText: body, bodyStatus: "ok", via: "unit-test", raw: { fisheryDocumentId: id, mode: "live_capture", htmlBase64: "do not expose raw JSON" } });
  config.devAdmin = { displayName: "Synthetic workbench reviewer" };
  const response = await app.inject(`/api/admin/fishery/documents/${id}/detail`);
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().text.hashMatches, true); assert.equal(response.json().text.body, body);
  assert.equal(response.body.includes("htmlBase64"), false); assert.equal(response.json().testOnly, false);
  assert.deepEqual(response.json().blockers.map((b: { code: string }) => b.code), ["rights", "review"]);
  await approve(id, 2);
  assert.deepEqual((await materialDetail(id)).blockers.map(b => b.code), ["rights"]);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  assert.equal((await materialDetail(id)).state, "stale");
  await approve(id, 2, 2); assert.equal((await materialDetail(id)).blockers.length, 0);
  await exportMaterial(id, 2, "tester", now);
  const testDoc = await createDocument({ sourceId, issuer: "ISOLATED TEST workbench clone", canonicalUrl: `https://example.org/test-${count}` }, "tester");
  await observe(testDoc.id, observationFixture, "tester");
  assert.equal((await materialDetail(testDoc.id)).testOnly, true);
  await observe(id, { ...observationFixture, expectedRevision: 2, sourceCapture: { ...capture, parser: "Synthetic UI parser/v2" } }, "tester");
  assert.equal((await materialDetail(id)).state, "stale");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await withdraw(id, { expectedRevision: 3, reason: "Synthetic workbench withdrawal" }, "tester");
  assert.equal((await materialDetail(id)).state, "withdrawn");
  assert.ok((await materialDetail(id)).blockers.some(b => b.code === "withdrawn"));
  const list = await app.inject("/api/admin/fishery/workbench");
  assert.equal(list.statusCode, 200, list.body); assert.equal(list.headers["cache-control"], "no-store");
  assert.ok(list.json().rows.some((r: { id: string; state: string }) => r.id === id && r.state === "withdrawn"));
  config.devAdmin = null;
});

test("A→B→A and attachment-only replacements remain separate observations and invalidate approval", async () => {
  const { id } = await fixture();
  await approve(id);
  const first = await exportMaterial(id, 1, "tester", now);
  assert.equal(first.policy.documentNumber, "CMM-fixture-01");
  assert.equal(first.source.originalUrl.startsWith("https://example.org/"), true);
  assert.equal(first.policy.effectiveDateState, "future");
  const boundary = await exportMaterial(id, 1, "tester", new Date("2028-01-01T00:30:00+09:00"));
  assert.deepEqual(boundary.policy.dateComparisonReference, { date: "2027-12-31", timezone: "UTC" });
  assert.equal(boundary.policy.effectiveDateState, "future", "UTC date progress does not assert local legal commencement");
  assert.equal(first.dates.effectiveFrom.value, "2028-01-01");
  assert.equal(first.policy.applicabilityReviewed, false);
  assert.equal(first.rights.fulltextExport, false);
  assert.equal(first.rights.translationExport, false);
  assert.equal(first.observation.hashAssurance, "admin_declared_not_fetched");
  const { contentHash, ...payload } = first;
  assert.equal(contentHash, hash(payload));
  await observe(id, { ...observationFixture, expectedRevision: 1, rawSha256: "c".repeat(64) }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /latest observation/);
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await assert.rejects(approve(id, 1), /changed/);
  await observe(id, { ...observationFixture, expectedRevision: 2 }, "tester");
  const history = await documentHistory(id);
  assert.equal(history.observations.length, 3);
  assert.equal(history.observations[0].content_hash, history.observations[2].content_hash);
  assert.notEqual(history.observations[0].content_hash, history.observations[1].content_hash);
  await observe(id, { ...observationFixture, expectedRevision: 3, evidence: [{ ...observationFixture.evidence[0], sha256: "d".repeat(64) }] }, "tester");
  const changed = await documentHistory(id);
  assert.equal(changed.observations[2].payload.rawSha256, changed.observations[3].payload.rawSha256);
  assert.notEqual(changed.observations[2].content_hash, changed.observations[3].content_hash);
  await approve(id, 4);
  const last = await exportMaterial(id, 4, "tester", now);
  assert.equal(last.evidence[0].sha256, "d".repeat(64));
  assert.equal(last.dates.adopted.value, null);
  assert.ok(materialMarkdown(last).includes("unknown"));
  assert.ok(materialMarkdown(last).includes("尚未经系统抓取字节验证"));
});

test("parser-only revisions invalidate prior approval despite identical original and body hashes", async () => {
  const { id } = await fixture();
  const capture = { adapter: "jinjiang", sourceUrl: "https://example.org/synthetic", capturedAt: "2026-10-20T00:00:00Z", httpStatus: 200,
    rawSha256: observationFixture.rawSha256, bodySha256: "c".repeat(64), parser: "Synthetic parser/v1", parseStatus: "parsed",
    attachmentSha256: null, conflicts: [] };
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: capture }, "tester");
  await approve(id, 2); await exportMaterial(id, 2, "tester", now);
  await observe(id, { ...observationFixture, expectedRevision: 2, sourceCapture: { ...capture, parser: "Synthetic parser/v2" } }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await assert.rejects(exportMaterial(id, 3, "tester", now), /latest observation/);
  const history = await documentHistory(id);
  assert.equal(history.observations[1].payload.sourceCapture.bodySha256, history.observations[2].payload.sourceCapture.bodySha256);
  assert.notEqual(history.observations[1].content_hash, history.observations[2].content_hash);
  await approve(id, 3); await exportMaterial(id, 3, "tester", now);
});

test("current source rights and review deadlines apply to old and current revisions", async () => {
  const unknown = await fixture({ unknownRights: true });
  await approve(unknown.id);
  await assert.rejects(exportMaterial(unknown.id, 1, "tester", now), /rights/);
  const { id, sourceId } = await fixture();
  await assert.rejects(exportMaterial(id, 1, "tester", now), /approved/);
  await approve(id);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /current rights/);
  await approve(id, 1, 2);
  await exportMaterial(id, 1, "tester", now);
  await registerSource(sourceId, { expectedRevision: 2, rightsStatus: "revoked" }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 3, reviewDueAt: "2026-10-19T00:00:00Z" }, "tester");
  await approve(id, 1, 4);
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 4, rightsCheckedAt: "2026-10-21T00:00:00Z" }, "tester");
  await approve(id, 1, 5);
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  assert.ok((await sourceHealth(now.getTime())).some((line) => line.includes(sourceId)));
});

test("latest rejection, terminal withdrawal and stale concurrent edits fail closed", async () => {
  const { id } = await fixture();
  await approve(id);
  await review(id, { revision: 1, sourceRevision: 1, decision: "rejected", applicabilityReviewed: false, note: "Evidence conflict" }, "reviewer");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /approved/);
  const attempts = await Promise.allSettled([observe(id, { ...observationFixture, expectedRevision: 1 }, "first"), observe(id, { ...observationFixture, expectedRevision: 1 }, "second")]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  await approve(id, 2);
  await withdraw(id, { expectedRevision: 2, reason: "Rights withdrawn" }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /withdrawal/);
  await assert.rejects(observe(id, { ...observationFixture, expectedRevision: 2 }, "tester"), /withdrawn/);
  assert.equal((await documentHistory(id)).observations.length, 2);
});

test("linked articles remain governed by publication withdrawal", async () => {
  const sourceId = `fishery-${++count}`;
  await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Fixture', 'external', false, '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.org/article-${count}`, title: "Fixture", bodyText: "Fixture", bodyHtml: "<p>Fixture</p>", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await publishArticle(articleId);
  const { id } = await fixture({ sourceId, articleId });
  await approve(id);
  await exportMaterial(id, 1, "tester", now);
  await setVisibility(articleId, { visibility: "summary-only", version: 0, reason: "fixture summary" }, "tester");
  const summaryOnly = await exportMaterial(id, 1, "tester", now);
  assert.equal(summaryOnly.rights.fulltextExport, false);
  await setVisibility(articleId, { visibility: "withdrawn", version: 1, reason: "fixture withdrawn" }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /publicly available/);
});

test("real module routes enforce admin and CSRF before reading or mutating evidence", async () => {
  config.devAdmin = null;
  const routes = ["sources", "documents", "documents/missing", "flows/missing/revision"];
  for (const path of routes) {
    const res = await app.inject(`/api/admin/fishery/${path}`);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.includes("rawSha256"), false);
  }
  assert.equal((await app.inject("/api/fishery/v1/materials/snapshot")).statusCode, 404);
  config.devAdmin = { displayName: "Fixture admin" };
  for(const csrf of [undefined,"wrong"]) assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/flows/missing/revision",headers:csrf?{"x-csrf-token":csrf}:{},payload:{}})).statusCode,403);
  const { id } = await fixture();
  const request = (path: string, payload: Record<string, unknown>, csrf?: string) => app.inject({ method: "POST", url: `/api/admin/fishery/documents/${id}/${path}`, headers: csrf ? { "x-csrf-token": csrf } : {}, payload });
  for (const csrf of [undefined, "wrong"]) assert.equal((await request("observations", { ...observationFixture, expectedRevision: 1 }, csrf)).statusCode, 403);
  assert.equal((await documentHistory(id)).observations.length, 1);
  assert.equal((await request("reviews", { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Route fixture review" }, "dev")).statusCode, 201);
  for (const format of ["json", "markdown"]) {
    const res = await request("export", { revision: 1, format }, "dev");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(res.headers["content-disposition"]?.includes(format === "json" ? ".json" : ".md"));
    assert.equal(res.body.includes("仅审核摘要与元数据"), true);
  }
  const bad = await request("observations", { ...observationFixture, expectedRevision: 1, dates: { ...observationFixture.dates, published: { precision: "day", value: "2026-02-30" } } }, "dev");
  assert.equal(bad.statusCode, 400);
  assert.equal((await app.inject("/api/admin/fishery/documents/missing")).statusCode, 404);
  const [audit] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  assert.equal(Number(audit.n), 2);
  config.devAdmin = null;
});


test("administrator can register, observe, review and export a complete offline fixture over HTTP", async () => {
  config.devAdmin = { displayName: "Fixture operator" };
  const sourceId = `fishery-${++count}`;
  await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Offline HTTP fixture', 'external', false, '2100-01-01')`;
  const headers = { "x-csrf-token": "dev" };
  const put = await app.inject({ method: "PUT", url: `/api/admin/fishery/sources/${sourceId}`, headers, payload: sourceFixture });
  assert.equal(put.statusCode, 200, put.body);
  const made = await app.inject({ method: "POST", url: "/api/admin/fishery/documents", headers,
    payload: { sourceId, issuer: "Offline fixture", canonicalUrl: `https://example.org/manual-${count}` } });
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().id;
  const base = `/api/admin/fishery/documents/${id}`;
  const observed = await app.inject({ method: "POST", url: `${base}/observations`, headers,
    payload: { ...observationFixture, dates: { ...observationFixture.dates, published: { precision: "unknown", value: null }, effectiveFrom: { precision: "month", value: "2026-10" } } } });
  assert.equal(observed.statusCode, 201, observed.body);
  const detail = await app.inject(base);
  assert.equal(detail.json().observations.length, 1);
  const duplicate = await app.inject({ method: "POST", url: "/api/admin/fishery/documents", headers,
    payload: { sourceId, issuer: "Offline fixture", canonicalUrl: `https://example.org/manual-${count}` } });
  assert.equal(duplicate.statusCode, 409);
  const reviewed = await app.inject({ method: "POST", url: `${base}/reviews`, headers,
    payload: { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic offline fixture reviewed" } });
  assert.equal(reviewed.statusCode, 201, reviewed.body);
  const exported = await app.inject({ method: "POST", url: `${base}/export`, headers, payload: { revision: 1 } });
  assert.equal(exported.statusCode, 200, exported.body);
  const bundle = exported.json();
  assert.equal(bundle.policy.documentNumber, null);
  assert.deepEqual(bundle.dates.published, { precision: "unknown", value: null });
  assert.deepEqual(bundle.dates.effectiveFrom, { precision: "month", value: "2026-10" });
  assert.equal(bundle.policy.effectiveDateState, "unknown");
  assert.equal(JSON.stringify(bundle).includes("body_html"), false);
  config.devAdmin = null;
});

test("material size limits and Markdown escaping prevent unsafe or oversized manual attachments", async () => {
  const { id } = await fixture();
  await observe(id, { ...observationFixture, expectedRevision: 1, title: "<img src=x onerror=alert(1)>", summaryZh: "[unsafe](javascript:alert(1))" }, "tester");
  await approve(id, 2);
  const markdown = materialMarkdown(await exportMaterial(id, 2, "tester", now));
  const html = await marked.parse(markdown);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.ok(html.includes("&lt;img"));
  assert.ok(markdown.includes("\n\n"));
  const evidence = Array.from({ length: 20 }, () => ({ ...observationFixture.evidence[0], url: `https://example.org/${"x".repeat(1900)}`, section: "长".repeat(200) }));
  await observe(id, { ...observationFixture, expectedRevision: 2, evidence }, "tester");
  await approve(id, 3);
  assert.ok(JSON.stringify(evidence).length < 48 * 1024, "fixture character count fits but multibyte bytes do not");
  const [before] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  await assert.rejects(exportMaterial(id, 3, "tester", now), /48 KiB/);
  const [after] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  assert.equal(Number(after.n), Number(before.n), "failed oversized export must not record success");
});


test("an approved observation cannot export a failed source capture", async () => {
  const { id } = await fixture();
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: {
    adapter: "fuzhou", sourceUrl: "https://hyj.fuzhou.gov.cn/fixture.htm", capturedAt: "2026-10-20T00:00:00Z",
    httpStatus: 404, rawSha256: observationFixture.rawSha256, bodySha256: null, parser: "none", parseStatus: "failed",
    attachmentSha256: null, conflicts: [],
  } }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /approved/);
  await approve(id, 2);
  await assert.rejects(exportMaterial(id, 2, "tester", now), /prevent export/);
});


test("persistent fishery flow reuses successful stages, requires human snapshot decision and invalidates versions",async()=>{
  const body="合成公海远洋渔业证据材料。",url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_2.htm";
  await collectColumns({id:"synthetic-flow",dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request.endsWith("robots.txt")?404:200,headers:{get:()=>"text/html"},body:Buffer.from(request.endsWith("robots.txt")?"missing":request===COLUMNS.moa.url?`<ul class="sj_e_tonzhi_list"><li><a href="${url}">合成公海材料</a></li></ul>`:`<meta name="ArticleTitle" content="合成公海材料"><div class="sj_arc_body"><div class="TRS_Editor">${Array.from({length:5},()=>`<p>${body}</p>`).join("")}</div></div>`)})});
  config.devAdmin={displayName:"ISOLATED TEST FLOW"};
  let id:string;
  try {
    assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",payload:{identity:"test"}})).statusCode,403);
    const created=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"test"}});
    assert.equal(created.statusCode,200,created.body);assert.equal(created.json().modelCalls,0);id=created.json().tasks[0].id;
    const again=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"test"}});assert.equal(again.json().tasks[0].id,id);
    const otherIdentity=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"different-click-same-evidence"}});assert.equal(otherIdentity.json().tasks[0].id,id);
  } finally {config.devAdmin=null;}
  assert.equal((await app.inject(`/api/admin/fishery/flows/${id!}`)).statusCode,401);
  let generated=0,reviewed=0,failReview=true;
  const invoke=async(options:any)=>{
    let data:any;
    const evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};
    if(options.purpose==="fishery_draft") {generated++;data={relevance:{decision:"relevant",reason:"test",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};}
    else {reviewed++;if(failReview) throw new Error("Synthetic review failure");data={decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"原句一致",evidence},{field:"relevance",verdict:"supported",reason:"原句明确公海远洋",evidence}]};}
    return {data:options.schema.parse(data),receiptId:999999,model:"mock",reused:false,usage:null};
  };
  const failed=await runFlow(id!,invoke);assert.equal(failed.status,"failed");assert.equal(failed.stage,"review");assert.ok(failed.draft);assert.equal(generated,1);
  await assert.rejects(runFlow(id!,invoke),/not queued/);
  await retryFlow(id!,{note:"Explicit reconciled mock failure"},"tester");failReview=false;
  const checked=await runFlow(id!,invoke);assert.equal(checked.status,"needs_human_review");assert.equal(generated,1);assert.equal(reviewed,2);assert.equal(checked.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:"a".repeat(64),note:"wrong snapshot"},"reviewer"),/snapshot changed/);
  await assert.rejects(decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"AI support cannot approve raw material"},"reviewer"),/must be approved/);
  await approve(checked.document_id,checked.snapshot.observationRevision,checked.snapshot.sourceRevision);
  await decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Synthetic internal decision only"},"reviewer");
  const qualified=await flowDetail(id!);assert.equal(qualified.status,"qualified");assert.ok(qualified.internalArticle);assert.equal(qualified.published,false);
  await decideFlow(id!,{decision:"rejected",snapshotHash:checked.snapshotHash,note:"Retract synthetic qualification"},"reviewer");assert.equal((await flowDetail(id!)).internalArticle,null);
  await decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Synthetic review again"},"reviewer");
  // A preexisting/newer pending or rejected task is authoritative; never fall back to old qualified.
  await sql`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) SELECT 'superseding-'||id,document_id,'superseding-'||identity,snapshot,'queued','generation',actor FROM fishery_flow_tasks WHERE id=${id!}`;
  const historical=await flowDetail(id!);assert.equal(historical.authoritative,false);assert.equal(historical.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Cannot revive old article"},"reviewer"),/newer authoritative/);
  const newer=await flowDetail("superseding-"+id!);await decideFlow(newer.id,{decision:"rejected",snapshotHash:newer.snapshotHash,note:"Reject latest task; older qualified must stay hidden"},"reviewer");assert.equal((await flowDetail(id!)).internalArticle,null);
  const document=await documentHistory(checked.document_id),sourceId=document.document.source_id;
  await registerSource(sourceId,{expectedRevision:1,healthNote:"Changed source rights metadata"},"tester");
  const stale=await flowDetail(id!);assert.equal(stale.stale,true);assert.equal(stale.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Old snapshot"},"reviewer"),/snapshot changed|newer authoritative/);
  await assert.rejects(createFlow(checked.document_id,{identity:"test"},"tester"),/old evidence/);
  const next=await createFlow(checked.document_id,{identity:"new-version"},"tester");assert.notEqual(next.id,id!);
  const rechecked=await runFlow(next.id,invoke);assert.equal(rechecked.status,"needs_human_review");assert.equal(rechecked.materialApproved,false);
  await assert.rejects(decideFlow(next.id,{decision:"qualified",publication:"publish",snapshotHash:rechecked.snapshotHash,note:"Old source approval cannot approve a new source version"},"reviewer"),/must be approved/);
  await approve(checked.document_id,rechecked.snapshot.observationRevision,rechecked.snapshot.sourceRevision);
  await decideFlow(next.id,{decision:"qualified",publication:"publish",snapshotHash:rechecked.snapshotHash,note:"Current source and observation approved"},"reviewer");assert.ok((await flowDetail(next.id)).internalArticle);
  await observe(checked.document_id,{...document.observations[0]!.payload,expectedRevision:1,originalTitle:"合成新原标题，未经核查",title:"合成标题变更"},"tester");
  assert.equal((await flowDetail(next.id)).materialApproved,false);assert.equal((await flowDetail(next.id)).internalArticle,null);
  await assert.rejects(decideFlow(next.id,{decision:"qualified",publication:"publish",snapshotHash:rechecked.snapshotHash,note:"Old raw approval cannot approve a new observation title"},"reviewer"),/must be approved/);
  await withdraw(checked.document_id,{expectedRevision:2,reason:"Synthetic withdrawal"},"tester");assert.equal((await flowDetail(next.id)).stale,true);assert.equal((await flowDetail(id!)).internalArticle,null);
});


test("stage persistence failures resume the same received receipt; only explicit regeneration creates a new paid identity",async()=>{
  const body="合成公海远洋渔业事实。",date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  const output={relevance:{decision:"relevant",reason:"test",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic source",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const sends={generation:0,review:0};let badReview=false;
  const invoke=async(options:any)=>{
    const generation=options.purpose==="fishery_draft";
    const receipt=await paidRequest({service:"flow-local-mock",model:"mock",purpose:options.purpose,subject:options.subject,identity:{promptVersion:options.promptVersion,system:options.system,user:options.user},attemptTag:options.attemptTag},async()=>{
      if(generation)sends.generation++;else sends.review++;
      const data=generation?output:{decision:badReview?"needs_evidence":"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:badReview?"not_found":"supported",reason:"Synthetic mock claim check",evidence:badReview?[]:evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevant original",evidence}]};
      return {response:data};
    });
    return {data:options.schema.parse(receipt.response),receiptId:receipt.receiptId,reused:receipt.reused,model:"mock",usage:null};
  };
  await sql.unsafe(`CREATE FUNCTION fishery_test_persist_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (NEW.draft IS NOT NULL AND OLD.draft IS NULL AND EXISTS (SELECT 1 FROM settings WHERE key='flow-test-fault' AND value='"generation"'::jsonb))
      OR (NEW.quality_review IS NOT NULL AND EXISTS (SELECT 1 FROM settings WHERE key='flow-test-fault' AND value='"review"'::jsonb))
    THEN RAISE EXCEPTION 'Synthetic stage transaction failure'; END IF; RETURN NEW; END $$`);
  await sql.unsafe(`CREATE TRIGGER fishery_test_persist_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION fishery_test_persist_fault()`);
  try {
    const g=await task("persist-generation");
    await sql`INSERT INTO settings(key,value) VALUES ('flow-test-fault','"generation"'::jsonb)`;
    const failed=await runFlow(g.id,invoke);assert.equal(failed.status,"failed");assert.equal(failed.error.phase,"persist");assert.equal(failed.draft,null);assert.equal(sends.generation,1);
    await assert.rejects(retryFlow(g.id,{note:"Do not pay for a received output again",mode:"regenerate",acknowledgeNewCharge:true},"tester"),/resume same attempt/);
    await sql`DELETE FROM settings WHERE key='flow-test-fault'`;
    const resumed=await retryFlow(g.id,{note:"Resume durable received generation"},"tester");assert.equal(resumed.attempt,1);assert.equal(await flowRequiredCalls(g.id),1);
    const saved=await runFlow(g.id,invoke);assert.equal(saved.status,"needs_human_review");assert.equal(sends.generation,1);assert.equal(sends.review,1);
    const r=await task("persist-review");
    await sql`INSERT INTO settings(key,value) VALUES ('flow-test-fault','"review"'::jsonb)`;
    const reviewFailed=await runFlow(r.id,invoke);assert.equal(reviewFailed.status,"failed");assert.equal(reviewFailed.error.phase,"persist");assert.ok(reviewFailed.draft);assert.equal(reviewFailed.quality_review,null);
    await sql`DELETE FROM settings WHERE key='flow-test-fault'`;
    // Simulate a crash after receiving the answer: a running row can only resume a reusable receipt.
    await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${r.id}`;
    await sql`UPDATE receipts SET status='unknown' WHERE id=${reviewFailed.error.receiptId}`;
    await assert.rejects(retryFlow(r.id,{note:"Unknown outcome must block"},"tester"),/pending\/unknown/);
    await assert.rejects(retryFlow(r.id,{note:"Unknown cannot regenerate",mode:"regenerate",acknowledgeNewCharge:true},"tester"),/pending\/unknown/);
    await sql`UPDATE receipts SET status='received' WHERE id=${reviewFailed.error.receiptId}`;
    const before={...sends};await retryFlow(r.id,{note:"Reconciled interrupted received review"},"tester");assert.equal(await flowRequiredCalls(r.id),0);
    assert.equal((await runFlow(r.id,invoke)).status,"needs_human_review");assert.deepEqual(sends,before);
    const bad=await task("semantic-negative");badReview=true;
    const first=await runFlow(bad.id,invoke);assert.equal(first.status,"needs_evidence");const sent=sends.review;
    await retryFlow(bad.id,{note:"Resume returns existing negative review"},"tester");assert.equal((await runFlow(bad.id,invoke)).status,"needs_evidence");assert.equal(sends.review,sent);
    await assert.rejects(retryFlow(bad.id,{note:"Missing charge acknowledgement",mode:"regenerate"},"tester"),/acknowledgement/);
    await retryFlow(bad.id,{note:"Reconciled prior negative; explicitly request another paid check",mode:"regenerate",acknowledgeNewCharge:true},"tester");
    assert.equal((await runFlow(bad.id,invoke)).review_attempt,2);assert.equal(sends.review,sent+1);
    const rejected=await flowDetail(bad.id);await decideFlow(bad.id,{decision:"rejected",snapshotHash:rejected.snapshotHash,note:"Reject unsupported facts"},"reviewer");assert.equal((await flowDetail(bad.id)).status,"rejected");
    await withdraw(saved.document_id,{expectedRevision:2,reason:"Synthetic source withdrawal"},"tester");
    await decideFlow(g.id,{decision:"rejected",snapshotHash:saved.snapshotHash,note:"Reject stale withdrawn material, retain old snapshot"},"reviewer");assert.equal((await flowDetail(g.id)).status,"rejected");
  } finally {await sql.unsafe('DROP TRIGGER fishery_test_persist_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION fishery_test_persist_fault()');await sql`DELETE FROM settings WHERE key='flow-test-fault'`;}
});

test("manual flow API starts producer-only queues, reuses that mode and refuses a default-mode instance",async t=>{
  const body="合成公海远洋渔业生产者门禁材料。",jobs:string[]=[];
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Producer-only API must not send external requests");});
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic producer evidence",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const previousAdmin=config.devAdmin;
  config.devAdmin={displayName:"ISOLATED TEST MANUAL PRODUCER"};
  try {
    for(const identity of ["producer-first","producer-again"]) {
      const flow=await task(identity),response=await app.inject({method:"POST",url:`/api/admin/fishery/flows/${flow.id}/run`,headers:{"x-csrf-token":"dev"},payload:{}});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,"queued");assert.ok(response.json().jobId,response.body);jobs.push(response.json().jobId);
      const boss=await getBoss({schedule:false,supervise:false});
      assert.equal((await boss.getJobById(flowQueue.name,jobs.at(-1)!))?.state,"created");
      await assert.rejects(getBoss({schedule:true}),/schedule mode differs/);
      await assert.rejects(getBoss({supervise:true}),/supervise mode differs/);
      assert.equal((await flowDetail(flow.id)).status,"queued");
      // Free the existing short-policy pending slot without starting a business consumer.
      await boss.cancel(flowQueue.name,jobs.at(-1)!);
    }
    assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.schedule`)[0]!.n,0);
    const conflict=await task("producer-existing-default");
    // A fresh process models an API whose shared instance already uses framework defaults;
    // leave the parent queue and its process-wide shutdown signal untouched.
    await promisify(execFile)(process.execPath,["--input-type=module","-e",`
      import assert from "node:assert/strict";
      import {getBoss,stopBoss} from "@aihot/backend/jobs/queue";
      import {closeDb} from "@aihot/backend/db";
      import {enqueueFlow,flowDetail,flowQueue} from "./modules/fishery/backend/flow.ts";
      globalThis.fetch=async()=>{throw new Error("Mode conflict must not send external requests");};
      try {
        const boss=await getBoss();
        assert.equal(await getBoss({schedule:true,supervise:true}),boss);
        const before=(await boss.findJobs(flowQueue.name)).length;
        await assert.rejects(enqueueFlow(process.argv[1]),/schedule mode differs/);
        assert.equal((await boss.findJobs(flowQueue.name)).length,before);
        assert.equal((await flowDetail(process.argv[1])).status,"queued");
      } finally {await stopBoss();await closeDb();}
    `,conflict.id],{env:process.env,timeout:30000});
  } finally {
    config.devAdmin=previousAdmin;
    if(jobs.length) await (await getBoss({schedule:false,supervise:false})).cancel(flowQueue.name,jobs);
  }
});

test("manual processor only consumes explicit flows, persists blocks and failures, and never resends duplicate tasks",async()=>{
  const boss=await getBoss({schedule:false,supervise:false});
  await assert.rejects(getBoss({schedule:true}),/mode differs/);
  const body="合成公海远洋渔业事实。",date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic source",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const envKeys=["LLM_MODEL","LLM_BASE_URL","LLM_REASONING_TOKENS","LLM_EXTRA_JSON"] as const;
  const oldEnv=envKeys.map(k=>process.env[k]),enabled=config.modelCallsEnabled;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("Unexpected external request in manual processor test");};
  process.env.LLM_MODEL=TRIAL.model;process.env.LLM_BASE_URL="https://api.deepseek.com";process.env.LLM_REASONING_TOKENS="0";process.env.LLM_EXTRA_JSON='{"thinking":{"type":"disabled"}}';
  const ledger={id:TRIAL.id,entries:[],maxRequests:TRIAL.maxRequests,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny};
  const setLedger=async(entries:{state:string;reservedMicroCny:number}[])=>{await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({...ledger,entries:entries.map((e,i)=>({...e,id:i+1}))})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;};
  let calls=0,fail=false,ineligible=false,emptySummary=false,hold:Promise<void>|undefined,releaseHold:(()=>void)|undefined;
  const invoke=async(options:any)=>{
    calls++;if(hold) await hold;if(fail) throw new Error("Synthetic model failure");
    const data=options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"test",evidence},summaryZh:emptySummary?[]:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]}:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic original sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevant original",evidence}]};
    if(ineligible&&options.purpose==="fishery_draft") data.relevance={decision:"unknown",reason:"Synthetic relevance unknown",evidence:[]};
    return {data:options.schema.parse(data),receiptId:999999,model:"mock",reused:false,usage:null};
  };
  let release:(()=>Promise<void>)|undefined;
  const settled=async(jobId:string|null)=>{
    const until=Date.now()+15000;
    while(Date.now()<until) {
      const job=await boss.getJobById(flowQueue.name,jobId!);
      if(job&&["failed","completed"].includes(job.state)) return job;
      await new Promise(r=>setTimeout(r,25));
    }
    throw new Error(`Queue job ${jobId} did not settle`);
  };
  try {
    await boss.createQueue(flowQueue.name,flowQueue.options);
    await boss.updateQueue(flowQueue.name,{retryLimit:1});
    await assert.rejects(registerManualFlowConsumer(boss),/reconcile deployed queue/);
    await boss.updateQueue(flowQueue.name,{retryLimit:0,expireInSeconds:600});
    release=await registerManualFlowConsumer(boss,jobs=>runQueuedFlows(jobs,invoke));
    await assert.rejects(registerManualFlowConsumer(boss),/already running/);
    assert.deepEqual(boss.getWipData().map(w=>w.name).sort(),[flowQueue.name,publicationQueue.name,QUEUES.republishSource].sort());
    assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.schedule`)[0]!.n,0);
    assert.equal(calls,0,"idle startup performs no model calls");
    config.modelCallsEnabled=false;
    const closed=await task("manual-closed"),closedJob=await enqueueOn(flowQueue,{id:closed.id});
    assert.equal((await settled(closedJob)).state,"failed");
    const closedTask=await flowDetail(closed.id);assert.equal(closedTask.status,"failed");assert.equal(closedTask.error.phase,"authorization");assert.match(closedTask.error.reason,/MODEL_CALLS_ENABLED/);assert.equal(calls,0);
    config.modelCallsEnabled=true;
    await setLedger(Array.from({length:25},()=>({state:"received",reservedMicroCny:400000})));
    const full=await task("manual-capacity"),fullJob=await enqueueOn(flowQueue,{id:full.id});
    assert.equal((await settled(fullJob)).state,"failed");assert.match((await flowDetail(full.id)).error.reason,/hard amount/);assert.equal(calls,0);
    await setLedger([]);
    process.env.LLM_MODEL="refused-model";
    const refused=await task("manual-authorization"),refusedJob=await enqueueOn(flowQueue,{id:refused.id});
    assert.equal((await settled(refusedJob)).state,"failed");assert.match((await flowDetail(refused.id)).error.reason,/configuration refused/);assert.equal(calls,0);
    process.env.LLM_MODEL=TRIAL.model;
    fail=true;
    const bad=await task("manual-failed"),badJob=await enqueueOn(flowQueue,{id:bad.id});
    const failedJob=await settled(badJob);assert.equal(failedJob.state,"failed");assert.match(JSON.stringify(failedJob.output),new RegExp(bad.id));assert.equal((await flowDetail(bad.id)).status,"failed");assert.equal(calls,1);
    fail=false;hold=new Promise<void>(resolve=>{releaseHold=resolve;});
    const good=await task("manual-good"),goodJob=await enqueueOn(flowQueue,{id:good.id});
    const until=Date.now()+15000;
    while((await flowDetail(good.id)).status!=="running"&&Date.now()<until) await new Promise(r=>setTimeout(r,25));
    await assert.rejects(runQueuedFlows([{id:good.id}],invoke),/not queued/);
    assert.equal((await flowDetail(good.id)).status,"running");
    releaseHold!();hold=undefined;
    assert.equal((await settled(goodJob)).state,"completed");assert.equal((await flowDetail(good.id)).status,"needs_human_review");assert.equal(calls,3);
    const duplicate=await enqueueOn(flowQueue,{id:good.id});
    assert.equal((await settled(duplicate)).state,"failed");assert.equal((await flowDetail(good.id)).status,"needs_human_review");assert.equal(calls,3);
    const goodTask=await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"));
    assert.deepEqual(goodTask.timeline.sourcePublished,{precision:"day",value:"2026-04-17"});
    assert.equal(goodTask.timeline.originalAgeDays,186);assert.equal(goodTask.timeline.historical,true);assert.equal(goodTask.timeline.isOriginalDay,false);
    assert.equal(goodTask.timeline.candidateEvent.precision,"unknown");assert.equal(goodTask.timeline.sourceEvent.precision,"unknown");
    assert.ok(goodTask.timeline.generatedAt);assert.ok(goodTask.timeline.checkedAt);assert.equal(goodTask.timeline.sourceCapturedAt,"2026-10-20T00:00:00Z");
    await approve(goodTask.document_id,goodTask.snapshot.observationRevision,goodTask.snapshot.sourceRevision);
    await decideFlow(good.id,{decision:"qualified",publication:"publish",snapshotHash:goodTask.snapshotHash,note:"Synthetic historical internal article"},"reviewer");
    const article=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).internalArticle;
    assert.equal(article.timeline.historical,true);assert.equal(article.timeline.originalAgeDays,186);assert.equal(article.timeline.candidateEvent.precision,"unknown");
    const [goodObservation]=await sql`SELECT payload FROM fishery_observations WHERE document_id=${goodTask.document_id} AND revision=2`;
    for(const published of [{precision:"month",value:"2026-04"},{precision:"year",value:"2025"},{precision:"unknown",value:null}]) {
      const payload={...goodObservation!.payload,dates:{...goodObservation!.payload.dates,published}};
      await sql`UPDATE fishery_observations SET payload=${sql.json(payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
      const timeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
      assert.deepEqual(timeline.sourcePublished,published);assert.equal(timeline.originalAgeDays,null);assert.equal(timeline.isOriginalDay,null);
      assert.equal(timeline.historical,published.precision!=="unknown");
      if(published.precision==="unknown") assert.match(timeline.label,/发布日期未知/);
    }
    for(const [value,age,historical] of [["2026-10-20",0,false],["2026-10-19",1,false],["2026-10-13",7,true]] as const) {
      const payload={...goodObservation!.payload,dates:{...goodObservation!.payload.dates,published:{precision:"day",value}}};
      await sql`UPDATE fishery_observations SET payload=${sql.json(payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
      const timeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
      assert.equal(timeline.originalAgeDays,age);assert.equal(timeline.isOriginalDay,age===0);assert.equal(timeline.historical,historical);
      if(age===1) assert.equal(timeline.label,"非当日原文");
    }
    await sql`UPDATE fishery_observations SET payload=${sql.json(goodObservation!.payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
    await observe(goodTask.document_id,{...observationFixture,expectedRevision:2,dates:{...observationFixture.dates,published:{precision:"day",value:"2026-10-20"}}},"tester");
    const oldTimeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
    assert.deepEqual(oldTimeline.sourcePublished,{precision:"day",value:"2026-04-17"},"a later observation cannot rewrite the article's original publication date");
    assert.equal(oldTimeline.generatedAt,goodTask.timeline.generatedAt,"human qualification and newer metadata do not rewrite generation time");
    const interrupted=await task("manual-interrupted");await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${interrupted.id}`;
    const interruptedJob=await enqueueOn(flowQueue,{id:interrupted.id});assert.equal((await settled(interruptedJob)).state,"failed");assert.equal((await flowDetail(interrupted.id)).status,"running");assert.equal(calls,3);
    ineligible=true;
    const unknown=await task("manual-unknown"),unknownJob=await enqueueOn(flowQueue,{id:unknown.id});
    assert.equal((await settled(unknownJob)).state,"completed");const unknownTask=await flowDetail(unknown.id);assert.equal(unknownTask.status,"needs_evidence");assert.equal(unknownTask.error.code,"FISHERY_ARTICLE_INELIGIBLE");assert.equal(calls,4,"unknown relevance skips paid review");
    await approve(unknownTask.document_id,unknownTask.snapshot.observationRevision,unknownTask.snapshot.sourceRevision);
    await assert.rejects(decideFlow(unknown.id,{decision:"qualified",publication:"publish",snapshotHash:unknownTask.snapshotHash,note:"Unknown cannot qualify"},"reviewer"),/relevant/);
    await sql`UPDATE fishery_flow_tasks SET status='qualified',quality_review=${sql.json({status:"needs_human_review",receiptId:999999,review:{decision:"supported",coverage:"complete_input",findings:[]},missingFields:[]})},human_decision=${sql.json({actor:"legacy-reviewer",decision:"qualified"})} WHERE id=${unknown.id}`;
    assert.equal((await flowDetail(unknown.id)).internalArticle,null,"legacy unknown qualified tasks have no internal article preview even with a formerly passing review");
    await assert.rejects(decideFlow(unknown.id,{decision:"qualified",publication:"publish",snapshotHash:unknownTask.snapshotHash,note:"Legacy passing review cannot qualify unknown relevance"},"reviewer"),/relevant/);
    await sql`UPDATE fishery_flow_tasks SET status='needs_evidence',quality_review=NULL,human_decision=NULL WHERE id=${unknown.id}`;
    ineligible=false;
    await retryFlow(unknown.id,{note:"Explicit regeneration of unknown draft",mode:"regenerate",acknowledgeNewCharge:true},"tester");
    assert.equal(await flowRequiredCalls(unknown.id),2);
    assert.equal((await settled(await enqueueOn(flowQueue,{id:unknown.id}))).state,"completed");assert.equal((await flowDetail(unknown.id)).status,"needs_human_review");assert.equal(calls,6);
    emptySummary=true;
    const empty=await task("manual-empty"),emptyJob=await enqueueOn(flowQueue,{id:empty.id});assert.equal((await settled(emptyJob)).state,"completed");const emptyTask=await flowDetail(empty.id);assert.equal(emptyTask.status,"needs_evidence");assert.equal(calls,7,"empty summary skips paid review");
    await approve(emptyTask.document_id,emptyTask.snapshot.observationRevision,emptyTask.snapshot.sourceRevision);
    await assert.rejects(decideFlow(empty.id,{decision:"qualified",publication:"publish",snapshotHash:emptyTask.snapshotHash,note:"Empty article cannot qualify"},"reviewer"),/非空/);
  } finally {
    releaseHold?.();
    await boss.offWork(flowQueue.name);await release?.();
    config.modelCallsEnabled=enabled;envKeys.forEach((k,i)=>{if(oldEnv[i]===undefined) delete process.env[k];else process.env[k]=oldEnv[i];});globalThis.fetch=previousFetch;
    await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
  }
});


test("private reader projects only the current real qualified set and never exposes audit data or charges on reads",async()=>{
  const baseline=(await readerPage({},now)).total;
  const f=await fixture({unknownRights:true}),quote="合成验收：仅在2026年10月20日且安全条件满足时，远洋研究资料用于接口门禁测试。",body=quote+"\nRAW_BODY_SENTINEL_NOT_FOR_READER";
  await observe(f.id,{...observationFixture,expectedRevision:1,originalTitle:"配额增100%（合成未核查原标题）",title:"配额增100%（合成未核查原标题）",sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-reader/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  const material=await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-reader-${f.id}`,title:"SYNTHETIC FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const task=await createFlow(f.id,{identity:"reader-synthetic-contract"},"fixture-admin"),evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};let calls=0;
  const invoke=async(options:any)=>{calls++;const output=options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"公海远洋政策合成样例",evidence},summaryZh:[{sentence:quote,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",uncertainties:[]}: {decision:"supported",coverage:"complete_input",findings:JSON.parse(options.user).claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic contract verification only",evidence:c.evidenceIds}))};return {data:options.schema.parse(output),receiptId:999999,model:"mock",reused:false,usage:null};};
  const checked=await runFlow(task.id,invoke);assert.equal(checked.status,"needs_human_review",JSON.stringify(checked.error));
  assert.equal(checked.materialApproved,false);
  await assert.rejects(decideFlow(task.id,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Must not bypass raw material approval"},"fixture-admin"),/must be approved/);
  await sql`UPDATE fishery_flow_tasks SET status='qualified',human_decision=${sql.json({actor:"synthetic-legacy",decision:"qualified",snapshotHash:checked.snapshotHash})} WHERE id=${task.id}`;
  assert.equal((await flowDetail(task.id)).internalArticle,null);await assert.rejects(readerItem(f.id,now),/No current/);
  await sql`UPDATE fishery_flow_tasks SET status='needs_human_review',human_decision=NULL WHERE id=${task.id}`;
  await approve(f.id,2,1);assert.equal((await flowDetail(task.id)).materialApproved,true);
  await decideFlow(task.id,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"INTERNAL_AUDIT_SENTINEL_DO_NOT_PROJECT"},"PRIVATE_REVIEWER_SENTINEL");
  const [original]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`;
  const one=await readerItem(f.id,now),page=await readerPage({},now);assert.equal(page.total,baseline+1);assert.equal(one.category.id,"reference");assert.equal(one.dates.published.value,"2026-04-17");assert.equal(one.age.historical,true);
  assert.equal(page.categories.reduce((n,c)=>n+c.count,0),page.total);assert.ok(page.categories.every(c=>c.count>0));assert.ok((await readerPage({category:"reference"},now)).rows.some(r=>r.id===f.id));
  assert.equal(one.verification.label,"摘要已完成内部核对");assert.equal(one.title,quote);assert.equal(one.source.originalTitle,"配额增100%（合成未核查原标题）");assert.ok(!one.title.includes("100%"));
  const automatic=await registerManualFlowConsumer(await getBoss({schedule:false,supervise:false}),async()=>{});
  let articleId:string|undefined;
  try {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      const [binding]=await sql`SELECT article_id FROM fishery_publication_bindings WHERE kind='article' AND item_id=${f.id}`;
      if(binding) {articleId=String(binding.article_id);break;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(articleId,"Normal article final qualification automatically reaches original publication through its durable job");
    const [source]=await sql`SELECT updated_at FROM sources WHERE id=${f.sourceId}`;
    await updateSource(f.sourceId,{patch:{tier:'T1'},version:new Date(source!.updated_at).toISOString(),reason:'Synthetic verified official source correction'},'fixture-admin');
    let completed=false;
    const sourceDeadline=Date.now()+15000;
    while(Date.now()<sourceDeadline){
      const [progress]=await sql`SELECT value FROM settings WHERE key=${republishKey(f.sourceId)}`;
      if(progress?.value.status==='done'){completed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(completed,'Normal source edits reach the original projection consumer');
    const [projection]=await sql`SELECT first_party FROM publications WHERE article_id=${articleId}`;
    assert.equal(projection!.first_party,true);assert.equal(calls,2,'Reprojection uses stored decisions without buying new model calls');
  } finally {await automatic();}
  const bridged={articleId:articleId!};
  assert.equal((await loadItemDetail(bridged.articleId)).kind,"found");
  assert.equal((await readerItem(f.id,now)).title,quote,"Summary bridge never shadows the private source-body fallback");
  const categoriesBefore=page.categories;
  await review(f.id,{revision:2,sourceRevision:1,decision:"rejected",applicabilityReviewed:false,note:"Synthetic current-version material rejection"},"fixture-admin");
  assert.equal((await flowDetail(task.id)).materialRejected,true);assert.equal((await flowDetail(task.id)).internalArticle,null);
  assert.equal((await loadItemDetail(bridged.articleId)).kind,"not_found");
  await assert.rejects(readerItem(f.id,now),/No current/);assert.equal((await readerPage({},now)).total,baseline);
  assert.equal((await readerPage({},now)).categories.reduce((n,c)=>n+c.count,0),baseline);
  await assert.rejects(decideFlow(task.id,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Cannot bypass current material rejection"},"fixture-admin"),/must be approved/);
  await review(f.id,{revision:2,sourceRevision:1,decision:"approved",applicabilityReviewed:false,note:"Synthetic latest current review replaces rejection"},"fixture-admin");
  assert.deepEqual((await readerPage({},now)).categories,categoriesBefore);
  // A historic-version rejection is not a rejection of the current observation.
  await sql`INSERT INTO fishery_reviews(document_id,revision,source_revision,decision,applicability_reviewed,note,actor) VALUES (${f.id},1,1,'rejected',false,'Synthetic historic review','fixture-admin')`;
  assert.equal((await flowDetail(task.id)).materialRejected,false);assert.equal((await readerItem(f.id,now)).id,f.id);
  const serialized=JSON.stringify(one);for(const secret of ["INTERNAL_AUDIT_SENTINEL","PRIVATE_REVIEWER_SENTINEL","RAW_BODY_SENTINEL","promptVersion","receiptId","cost","rawSha256"]) assert.ok(!serialized.includes(secret));
  const receiptCount=(await sql`SELECT count(*)::integer AS n FROM receipts`)[0]!.n;
  config.devAdmin=null;assert.equal((await app.inject("/api/admin/fishery/reader")).statusCode,401);assert.equal((await app.inject(`/api/admin/fishery/reader/${f.id}`)).statusCode,401);
  config.devAdmin={displayName:"Synthetic reader gate tester"};
  try {const response=await app.inject("/api/admin/fishery/reader");assert.equal(response.statusCode,200,response.body);assert.match(response.headers["cache-control"]!,/no-store/);assert.equal((await app.inject(`/api/admin/fishery/reader/${f.id}`)).statusCode,200);}finally{config.devAdmin=null;}
  assert.equal(calls,2);assert.equal((await sql`SELECT count(*)::integer AS n FROM receipts`)[0]!.n,receiptCount);
  async function absent(){assert.equal((await readerPage({},now)).rows.some(r=>r.id===f.id),false);await assert.rejects(readerItem(f.id,now),/No current/);}
  for(const decision of ["unknown","irrelevant"]) {const draft=structuredClone(original.draft);draft.draft.relevance.decision=decision;await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(draft)} WHERE id=${task.id}`;await absent();}
  const empty=structuredClone(original.draft);empty.draft.summaryZh=[];await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(empty)} WHERE id=${task.id}`;await absent();
  await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(original.draft)} WHERE id=${task.id}`;
  const [source]=await sql`SELECT profile FROM fishery_sources WHERE source_id=${f.sourceId}`,testProfile={...source.profile,attribution:"ISOLATED TEST FIXTURE reader clone"},testSnapshot={...original.snapshot,sourceProfileHash:hash(testProfile)},testHuman={...original.human_decision,snapshotHash:hash(testSnapshot)};
  await sql`UPDATE fishery_sources SET profile=${sql.json(testProfile)} WHERE source_id=${f.sourceId}`;await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(testSnapshot)},human_decision=${sql.json(testHuman)} WHERE id=${task.id}`;assert.equal((await flowDetail(task.id)).stale,false);await absent();
  await sql`UPDATE fishery_sources SET profile=${sql.json(source.profile)} WHERE source_id=${f.sourceId}`;await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(original.snapshot)},human_decision=${sql.json(original.human_decision)} WHERE id=${task.id}`;
  await sql`UPDATE fishery_documents SET article_id=${material.articleId} WHERE id=${f.id}`;await absent();await sql`UPDATE fishery_documents SET article_id=NULL WHERE id=${f.id}`;
  await sql`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) VALUES (${task.id+"-newer"},${f.id},'newer-reader-pending',${sql.json(original.snapshot)},'queued','generation','fixture-admin')`;await absent();
  await sql`UPDATE fishery_flow_tasks SET status='rejected' WHERE id=${task.id+"-newer"}`;await absent();
  await registerSource(f.sourceId,{...source.profile,expectedRevision:1},"fixture-admin");
  assert.equal((await flowDetail(task.id)).materialApproved,false);await absent();
  await observe(f.id,{...observationFixture,expectedRevision:2,originalTitle:"合成新原标题增200%",title:"合成新版本，旧稿失效"},"fixture-admin");assert.equal((await flowDetail(task.id)).materialApproved,false);await absent();
  await withdraw(f.id,{expectedRevision:3,reason:"Synthetic withdrawal"},"fixture-admin");await absent();
});


test("human revision preserves received provenance, saves without calls and only reviews the hash-bound current candidate",async()=>{
  const f=await fixture({unknownRights:true}),body="合成远洋渔业资料，仅用于人工修订测试。合成资料第二句。合成资料第三句。合成资料第四句。合成资料第五句。";
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1","p1s2","p1s3","p1s4","p1s5"];
  const wire={relevance:{decision:"relevant",reason:"合成远洋渔业资料",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",uncertainties:[]};
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-revision/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/revision-${f.id}`,title:"SYNTHETIC FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const original=await createFlow(f.id,{identity:"revision-original"},"fixture-admin");
  const received=await paidRequest({service:"revision-local-mock",model:"mock",purpose:"fishery_draft",subject:original.id,identity:{original:original.id}},async()=>({response:{choices:[{message:{content:JSON.stringify(wire)}}]}}));
  await sql`UPDATE fishery_flow_tasks SET status='failed',stage_requests=${sql.json({'generation:1':{subject:original.id,purpose:'fishery_draft'}})},error=${sql.json({receiptId:received.receiptId,phase:"validate",reason:"synthetic invalid original"})} WHERE id=${original.id}`;
  const [receiptBefore]=await sql`SELECT * FROM receipts WHERE id=${received.receiptId}`,[taskBefore]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${original.id}`;
  await sql`UPDATE receipts SET status='unknown' WHERE id=${received.receiptId}`;
  await assert.rejects(revisionContext(original.id),/pending\/unknown|reconciled/);
  await sql`UPDATE receipts SET status=${receiptBefore.status},purpose='fishery_quality_review' WHERE id=${received.receiptId}`;
  await assert.rejects(revisionContext(original.id),/generation stage/);
  await sql`UPDATE receipts SET purpose=${receiptBefore.purpose} WHERE id=${received.receiptId}`;
  const context=await revisionContext(original.id),request={identity:"revision-candidate",snapshotHash:context.snapshotHash,evidenceHash:context.evidenceCatalog.hash,reason:"PRIVATE_REVISION_REASON",candidate:wire};
  await assert.rejects(createHumanRevision(original.id,{...request,candidate:{...wire,summaryZh:[{sentence:body,evidence:["wrong-id"]}]}},"PRIVATE_REVISION_ACTOR"),/Invalid/);
  await assert.rejects(createHumanRevision(original.id,{...request,snapshotHash:"0".repeat(64)},"fixture-admin"),/snapshot/);
  const beforeCalls=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  const revised=await createHumanRevision(original.id,request,"PRIVATE_REVISION_ACTOR");
  assert.notEqual(revised.id,original.id);assert.equal(revised.stage,"review");assert.equal(revised.status,"queued");
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,beforeCalls);
  assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${received.receiptId}`)[0],receiptBefore);
  assert.deepEqual((await sql`SELECT * FROM fishery_flow_tasks WHERE id=${original.id}`)[0],taskBefore);
  assert.equal((await flowDetail(revised.id)).internalArticle,null);
  assert.equal((await createHumanRevision(original.id,request,"PRIVATE_REVISION_ACTOR")).id,revised.id);
  assert.equal((await createHumanRevision(original.id,{...request,identity:"duplicate-revision"},"PRIVATE_REVISION_ACTOR")).id,revised.id);
  await assert.rejects(createHumanRevision(original.id,{...request,identity:"queued-bypass",candidate:{...wire,uncertainties:["Different queued candidate"]}},"fixture-admin"),/queued/);
  let locked!:()=>void,unlock!:()=>void;
  const lockReady=new Promise<void>(resolve=>{locked=resolve;}),lockRelease=new Promise<void>(resolve=>{unlock=resolve;});
  const editing=sql.begin(async tx=>{await tx`SELECT id FROM fishery_documents WHERE id=${f.id} FOR UPDATE`;locked();await lockRelease;});
  await lockReady;
  let calls=0,entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=runFlow(revised.id,async(options:any)=>{
    entered();await hold;calls++;assert.equal(options.purpose,"fishery_quality_review");assert.ok(options.attemptTag.includes(revised.draft.provenance.candidateHash));
    assert.ok(!JSON.stringify(options).includes("PRIVATE_REVISION"));
    const claims=JSON.parse(options.user).claims;
    return {data:options.schema.parse({decision:"supported",coverage:"complete_input",findings:claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic verification",evidence:c.evidenceIds}))}),receiptId:999999,model:"mock",reused:false,usage:null};
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal((await flowDetail(revised.id)).status,"queued","model claim waits for the document editing boundary");
  unlock();await editing;await started;
  await assert.rejects(createHumanRevision(original.id,{...request,identity:"running-bypass",candidate:{...wire,uncertainties:["Different running candidate"]}},"fixture-admin"),/running/);
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/running/);
  release();const result=await running;
  assert.equal(calls,1);assert.equal(result.status,"needs_human_review",JSON.stringify(result.error));
  await approve(f.id,2,1);
  await decideFlow(revised.id,{decision:"qualified",publication:"publish",snapshotHash:result.snapshotHash,note:"synthetic qualification"},"fixture-admin");
  assert.ok((await flowDetail(revised.id)).internalArticle);
  assert.equal((await readerItem(f.id,now)).verification.label,"人工修订候选，经模型辅助核查与人工审核");
  await sql`UPDATE fishery_flow_tasks SET draft=jsonb_set(draft,'{provenance,candidateHash}',${sql.json("0".repeat(64))}) WHERE id=${revised.id}`;
  assert.equal((await flowDetail(revised.id)).internalArticle,null);
  await assert.rejects(decideFlow(revised.id,{decision:"qualified",publication:"publish",snapshotHash:result.snapshotHash,note:"tampered hash"},"fixture-admin"),/candidate hash/);
  await assert.rejects(readerItem(f.id,now),/No current/);
  await sql`UPDATE fishery_flow_tasks SET draft=jsonb_set(draft,'{provenance,candidateHash}',${sql.json(result.draft.provenance.candidateHash)}) WHERE id=${revised.id}`;
  await decideFlow(revised.id,{decision:"rejected",snapshotHash:result.snapshotHash,note:"synthetic follow-up correction"},"fixture-admin");
  const nextContext=await revisionContext(revised.id);
  assert.deepEqual((nextContext.candidate as any).summaryZh[0].evidence,evidence);
  const next=await createHumanRevision(revised.id,{...request,identity:"revision-follow-up",candidate:{...wire,uncertainties:["合成修订记录"]}},"fixture-admin");
  assert.equal(next.draft.provenance.directParentTaskId,revised.id);assert.equal(next.draft.provenance.originalGenerationTaskId,original.id);
  assert.equal(next.draft.provenance.receiptId,received.receiptId);assert.equal(next.stage,"review");
  const uncertain=await paidRequest({service:"revision-local-mock",model:"mock",purpose:"fishery_quality_review",subject:next.id,identity:{next:next.id}},async()=>({response:{synthetic:"received at provider, receipt not durably settled"}}));
  await sql`UPDATE receipts SET status='pending' WHERE id=${uncertain.receiptId}`;
  await sql`UPDATE fishery_flow_tasks SET status='failed',stage_requests=${sql.json({'review:1':{subject:next.id,purpose:'fishery_quality_review'}})} WHERE id=${next.id}`;
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/pending\/unknown/);
  await sql`UPDATE fishery_flow_tasks SET status='rejected' WHERE id=${next.id}`;
  await observe(f.id,{...observationFixture,expectedRevision:2,title:"SYNTHETIC changed current observation",sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-revision/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/pending\/unknown/);
  await assert.rejects(revisionContext(original.id),/pending\/unknown/);
  await sql`UPDATE receipts SET status='unknown' WHERE id=${uncertain.receiptId}`;
  await assert.rejects(revisionContext(original.id),/pending\/unknown/);
  await sql`UPDATE receipts SET status='received' WHERE id=${uncertain.receiptId}`;
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/snapshot/i);
  const fresh=await revisionContext(original.id);assert.deepEqual((fresh.candidate as any).summaryZh,[],"new observation never auto-migrates old IDs");
  const freshTask=await createHumanRevision(original.id,{...request,identity:"fresh-observation-revision",snapshotHash:fresh.snapshotHash,evidenceHash:fresh.evidenceCatalog.hash},"fixture-admin");
  assert.equal(freshTask.snapshot.observationRevision,3);assert.equal(freshTask.stage,"review");
});


test("verified body changes invalidate old approval; keyword absence still enters prefilter and outages retain evidence",async()=>{
  const url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_99821.htm",newUrl=url.replace("99821","99822"),fact="远洋渔业公海履约管理措施已经公布。";
  const relevant=`<p>${fact}</p><p>本材料用于离线采集回归，全部请求由本地合成数据提供，第二段保留完整上下文供审核。</p>`,nearshore="近海养殖场开展池塘设备维护培训。参加人员学习饲料管理、车间清洁和水质监测。本地课程安排另行公布。";
  const capture=async(id:string,target:string,mode:"relevant"|"irrelevant"|"404"|"timeout")=>collectColumns({id,dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>{
    if(request===target&&mode==="timeout") throw new Error("Synthetic acquisition timeout");
    const robots=request.endsWith("robots.txt"),listing=request===COLUMNS.moa.url;
    return {url:request,status:robots||request===target&&mode==="404"?404:200,headers:{get:()=>"text/html"},body:Buffer.from(robots?"missing":listing?`<ul class="sj_e_tonzhi_list"><li><a href="${target}">远洋渔业素材更新</a></li></ul>`:mode==="404"?"<h1>404</h1>":`<meta name="ArticleTitle" content="离线正文变更材料"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor">${mode==="relevant"?relevant:`<p>${nearshore}</p>`}</div></div>`)};
  }});
  const ready=await capture("recapture-current-ready",url,"relevant"),first=await importBatch(ready.id,"tester"),id=first.rows[0]!.id;
  const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
  await approve(id,1,source!.revision);
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"Synthetic public-sea source evidence",evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",organizations:[],locations:[],uncertainties:[]}:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic source sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevance",evidence}]}),receiptId:999999,model:"mock",reused:false,usage:null});
  const task=await createFlow(id,{identity:"before-irrelevant-recapture"},"tester"),checked=await runFlow(task.id,invoke);
  assert.equal(checked.status,"needs_human_review",JSON.stringify(checked.error));await decideFlow(task.id,{decision:"qualified",publication:"publish",snapshotHash:checked.snapshotHash,note:"Synthetic original snapshot approved"},"reviewer");
  await syncFisheryPublications("tester");
  const [coreBefore]=await sql`SELECT id,revision FROM articles WHERE source_id='fishery-column-moa' AND url=${url} AND raw->>'mode'='verified-news-candidate'`;
  assert.equal((await readerItem(id)).id,id);
  const original=await documentHistory(id),oldCapture=original.observations[0]!.payload.sourceCapture,oldBody=await readCapturedText(config.dataDir,oldCapture.archiveId,oldCapture.bodySha256);
  for(const mode of ["404","timeout"] as const) {
    const unavailable=await capture(`recapture-current-${mode}`,url,mode);assert.equal(unavailable.items[0]!.state,"failed");
    await importBatch(unavailable.id,"tester");
    assert.equal((await documentHistory(id)).observations.length,1);assert.equal((await flowDetail(task.id)).stale,false);assert.equal((await readerItem(id)).id,id);
    const [audit]=await sql`SELECT after,reason FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${unavailable.id}`;
    assert.equal(audit!.after.outcome,"unavailable");assert.match(audit!.reason,/no confirmed source-body change/);
    assert.doesNotMatch(audit!.after.reason,/awaiting material review/);
    if(mode==="timeout") assert.match(audit!.after.reason,/timeout/);
  }
  const recaptured=await capture("recapture-current-irrelevant",url,"irrelevant");assert.equal(recaptured.items[0]!.state,"ready");
  const update=await importBatch(recaptured.id,"tester");
  assert.equal(update.rows[0]!.id,id,"Verified body changes reuse the same document");
  const [coreAfter]=await sql`SELECT id,revision,body_text FROM articles WHERE id=${coreBefore.id}`;assert.ok(coreAfter.revision>coreBefore.revision);assert.equal(coreAfter.body_text,nearshore);
  const history=await documentHistory(id);assert.equal(history.observations.length,2);assert.equal(history.observations[1]!.revision,2);assert.equal(history.reviews.length,1);
  const latest=history.observations[1]!.payload;assert.match(latest.summaryZh,/待人工核对原文/);assert.equal(await readCapturedText(config.dataDir,latest.sourceCapture.archiveId,latest.sourceCapture.bodySha256),nearshore);
  assert.equal(await readCapturedText(config.dataDir,oldCapture.archiveId,oldCapture.bodySha256),oldBody,"The previous source archive is retained");
  const stale=await flowDetail(task.id);assert.equal(stale.stale,true);assert.equal(stale.internalArticle,null);await assert.rejects(readerItem(id),/No current/);
  const [trace]=await sql`SELECT after FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${recaptured.id}`;
  assert.equal(trace!.after.outcome,"ready");assert.equal(trace!.after.relevance.decision,"not_proven");
  assert.match(trace!.after.reason,/No explicit DWF retrieval cue/);assert.doesNotMatch(trace!.after.reason,/No verified source body/);
  await importBatch(recaptured.id,"tester");assert.equal((await documentHistory(id)).observations.length,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${recaptured.id}`)[0]!.n,1,"Reimporting the same archive does not fabricate another acquisition");
  const newIrrelevant=await capture("recapture-new-irrelevant",newUrl,"irrelevant");await importBatch(newIrrelevant.id,"tester");
  assert.equal((await sql`SELECT id FROM fishery_documents WHERE canonical_url=${newUrl}`).length,1,"Complete bodies await relevance review; keywords never approve or reject them");
});

test("synthetic interrupted-before-request reconciliation is leased, fingerprinted, zero-call and preserves saved generation",async()=>{
  const boss=await getBoss({schedule:false,supervise:false});await boss.createQueue(flowQueue.name,flowQueue.options);
  const ledger={id:TRIAL.id,entries:[] as {id:number;state:string;reservedMicroCny:number}[],maxRequests:TRIAL.maxRequests,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny};
  const setLedger=async()=>sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json(ledger)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  await setLedger();
  const body="合成远洋渔业中断恢复测试原文。",evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};
  const wire={relevance:{decision:"relevant",reason:"Synthetic source",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-reconcile/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/reconcile-${f.id}`,title:"SYNTHETIC RECONCILIATION FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    await approve(f.id,2,1);
    return createFlow(f.id,{identity},"fixture-admin");
  }
  const request=(state:any)=>({snapshotHash:state.snapshotHash,executionFingerprint:state.executionFingerprint,expectedStatus:"running",acknowledgeRunnerStopped:true,reason:"Synthetic operator verified all old runners stopped",...state.activeJobId?{cancelActiveJobId:state.activeJobId}:{}});
  const zero=await task("synthetic-zero-request");
  // Local fault injection: claim commits, the authorization callback stands in for a process that never reaches its stage request.
  await runFlow(zero.id,async()=>{throw new Error("No synthetic request is allowed");},async()=>{});
  let detail=await flowDetail(zero.id);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  const oldRunner=await acquireProcessingLease();
  try {await assert.rejects(reconcileFlow(zero.id,request(detail.reconciliation),"fixture-admin"),/lease unavailable/);}finally{await oldRunner.release();}
  assert.equal((await flowDetail(zero.id)).status,"running");
  const stale=request(detail.reconciliation);await sql`UPDATE fishery_flow_tasks SET review_attempt=2,updated_at=now() WHERE id=${zero.id}`;
  await assert.rejects(reconcileFlow(zero.id,stale,"fixture-admin"),/fingerprint changed/);
  detail=await flowDetail(zero.id);
  const receiptCount=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,ledgerBefore=(await sql`SELECT value FROM settings WHERE key=${authorizationKey}`)[0]!.value,reviewBefore=(await documentHistory(zero.document_id)).reviews;
  config.devAdmin=null;assert.equal((await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,payload:request(detail.reconciliation)})).statusCode,401);
  config.devAdmin={displayName:"Synthetic recovery operator"};
  try {
    assert.equal((await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,payload:request(detail.reconciliation)})).statusCode,403);
    const recovered=await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,headers:{"x-csrf-token":"dev"},payload:request(detail.reconciliation)});
    assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().modelCalls,0);assert.equal(recovered.json().status,"failed");
  }finally{config.devAdmin=null;}
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receiptCount);assert.deepEqual((await sql`SELECT value FROM settings WHERE key=${authorizationKey}`)[0]!.value,ledgerBefore);assert.deepEqual((await documentHistory(zero.document_id)).reviews,reviewBefore);
  await assert.rejects(reconcileFlow(zero.id,request(detail.reconciliation),"fixture-admin"),/fingerprint changed/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='fishery.flow.reconcile' AND after->>'id'=${zero.id}`)[0]!.n,1);
  await assert.rejects(retryFlow(zero.id,{note:"No hidden first call acknowledgement"},"fixture-admin"),/acknowledge new stage charges/);
  await retryFlow(zero.id,{note:"Explicitly accept future first-stage calls",acknowledgeNewCharge:true},"fixture-admin");
  await decideFlow(zero.id,{decision:"rejected",snapshotHash:detail.snapshotHash,note:"Synthetic cleanup, no business qualification"},"fixture-admin");

  const saved=await task("synthetic-generation-saved"),input={documentId:saved.document_id,observationRevision:2,body,bodySha256:sha256(body),language:"en"};let generationCalls=0,reviewCalls=0;
  const generationRequest=buildFisheryDraftRequest(input,"default"),subject=generationRequest.subject+`:snapshot:${hash(saved.snapshot)}:generation:1`,attemptTag=`fishery-flow:${hash(saved.snapshot)}:generation:1`;
  const draft=await prepareFisheryDraft(input,"default",async options=>{
    const response=await paidRequest({service:"reconcile-local-mock",model:"mock",purpose:options.purpose,subject,identity:{input:options.user},attemptTag},async()=>{generationCalls++;return {response:wire};});
    return {data:options.schema.parse(response.response),receiptId:response.receiptId,reused:response.reused,model:"mock",usage:null};
  });
  await completeReceipt(sql,draft.receiptId);ledger.entries=[{id:1,state:"received",reservedMicroCny:TRIAL.reserveMicroCny}];await setLedger();
  // Local DB fault fixture: the generation transaction is durable, but the process dies before recording its first review request.
  await sql`UPDATE fishery_flow_tasks SET status='running',stage='review',draft=${sql.json(draft)},stage_requests=${sql.json({'generation:1':{subject,purpose:'fishery_draft',attemptTag,promptVersion:generationRequest.promptVersion}})} WHERE id=${saved.id}`;
  const [originalReceipt]=await sql`SELECT * FROM receipts WHERE id=${draft.receiptId}`;
  detail=await flowDetail(saved.id);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));assert.equal(detail.reconciliation.reusableGenerationReceiptId,draft.receiptId);
  for(const state of ["pending","unknown","refused"]) {ledger.entries[0]!.state=state;await setLedger();const blocked=await flowDetail(saved.id);assert.equal(blocked.reconciliation.eligible,false);await assert.rejects(reconcileFlow(saved.id,request(blocked.reconciliation),"fixture-admin"),/pending\/unknown\/refused/);}
  ledger.entries[0]!.state="received";await setLedger();
  await sql`UPDATE receipts SET response=NULL WHERE id=${draft.receiptId}`;detail=await flowDetail(saved.id);await assert.rejects(reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin"),/response missing|Generation receipt/);
  await sql`UPDATE receipts SET response=${sql.json(wire)} WHERE id=${draft.receiptId}`;
  detail=await flowDetail(saved.id);await reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin");
  await assert.rejects(retryFlow(saved.id,{note:"Resume must not silently send the first review"},"fixture-admin"),/acknowledge new stage charges/);
  const resumed=await retryFlow(saved.id,{note:"Explicit first review charge acknowledgement",acknowledgeNewCharge:true},"fixture-admin");assert.equal(resumed.stage,"review");assert.equal(resumed.attempt,1);
  const invoke=async(options:any)=>{
    assert.equal(options.purpose,"fishery_quality_review");
    const received=await paidRequest({service:"reconcile-local-mock",model:"mock",purpose:options.purpose,subject:options.subject,identity:{user:options.user},attemptTag:options.attemptTag},async()=>{reviewCalls++;return {response:{decision:"supported",coverage:"complete_input",findings:JSON.parse(options.user).claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic review only",evidence:c.evidenceIds}))}};});
    return {data:options.schema.parse(received.response),receiptId:received.receiptId,reused:received.reused,model:"mock",usage:null};
  };
  assert.equal((await runFlow(saved.id,invoke)).status,"needs_human_review");assert.equal(generationCalls,1);assert.equal(reviewCalls,1);
  await assert.rejects(runFlow(saved.id,invoke),/not queued/);assert.equal(reviewCalls,1);assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${draft.receiptId}`)[0],originalReceipt);
  await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${saved.id}`;
  detail=await flowDetail(saved.id);await assert.rejects(reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin"),/durable request|already has a receipt/);
  await retryFlow(saved.id,{note:"Original completed review receipt resumes without another charge"},"fixture-admin");assert.equal((await runFlow(saved.id,invoke)).status,"needs_human_review");assert.equal(reviewCalls,1);

  const intent=await task("synthetic-intent-no-receipt");await sql`UPDATE fishery_flow_tasks SET status='running',stage_requests=${sql.json({'generation:1':{subject:`fishery:${intent.document_id}:missing`,purpose:'fishery_draft'}})} WHERE id=${intent.id}`;
  detail=await flowDetail(intent.id);await assert.rejects(reconcileFlow(intent.id,request(detail.reconciliation),"fixture-admin"),/durable request|prior stage request/);
  await decideFlow(intent.id,{decision:"rejected",snapshotHash:detail.snapshotHash,note:"Cannot decide running task"},"fixture-admin").then(()=>assert.fail("running decision must reject"),error=>assert.match(error.message,/Running/));

  const duplicate=await task("synthetic-duplicate-jobs");await runFlow(duplicate.id,async()=>{throw new Error("No request");},async()=>{});
  const activeId=await boss.send(flowQueue.name,{id:duplicate.id});await boss.fetch(flowQueue.name);const queuedId=await boss.send(flowQueue.name,{id:duplicate.id});
  detail=await flowDetail(duplicate.id);assert.equal(detail.reconciliation.eligible,false);await assert.rejects(reconcileFlow(duplicate.id,request(detail.reconciliation),"fixture-admin"),/Queued\/retry|duplicate/);
  await boss.cancel(flowQueue.name,[activeId!,queuedId!]);
  const sole=await boss.send(flowQueue.name,{id:duplicate.id});await boss.fetch(flowQueue.name);detail=await flowDetail(duplicate.id);assert.equal(detail.reconciliation.activeJobId,sole);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  await assert.rejects(reconcileFlow(duplicate.id,{...request(detail.reconciliation),cancelActiveJobId:undefined},"fixture-admin"),/exact old active job/);
  await reconcileFlow(duplicate.id,request(detail.reconciliation),"fixture-admin");assert.equal((await boss.getJobById(flowQueue.name,sole!))?.state,"cancelled");
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='fishery.flow.reconcile.cancel_job' AND after->>'taskId'=${duplicate.id}`)[0]!.n,1);
  const oldSnapshot=await task("synthetic-stale-pre-request");await runFlow(oldSnapshot.id,async()=>{throw new Error("No request");},async()=>{});
  const history=await documentHistory(oldSnapshot.document_id);
  await observe(oldSnapshot.document_id,{...history.observations.find(o=>o.revision===2)!.payload,expectedRevision:2,title:"Synthetic current observation after interrupted old task"},"fixture-admin");await approve(oldSnapshot.document_id,3,1);
  detail=await flowDetail(oldSnapshot.id);assert.equal(detail.stale,true);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  await reconcileFlow(oldSnapshot.id,request(detail.reconciliation),"fixture-admin");assert.equal((await flowDetail(oldSnapshot.id)).status,"failed");
  await assert.rejects(retryFlow(oldSnapshot.id,{note:"Never resume a stale task",acknowledgeNewCharge:true},"fixture-admin"),/changed|superseded/);
  await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
});

test("synthetic old lease owner cannot claim after waiting for a document lock",async()=>{
  const f=await fixture({unknownRights:true}),body="合成远洋渔业租约领取故障测试。";
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-claim-lease/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/claim-${f.id}`,title:"SYNTHETIC LEASE CLAIM FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const task=await createFlow(f.id,{identity:"synthetic-lease-claim"},"fixture-admin");
  const [before]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`,ledgerBefore=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`,receiptCount=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  let releaseDocument!:()=>void,documentLocked!:()=>void;
  const gate=new Promise<void>(resolve=>{releaseDocument=resolve;}),locked=new Promise<void>(resolve=>{documentLocked=resolve;});
  const editing=sql.begin(async tx=>{await tx`SELECT id FROM fishery_documents WHERE id=${f.id} FOR UPDATE`;documentLocked();await gate;});await locked;
  const ownerA=await acquireProcessingLease();let ownerB:Awaited<ReturnType<typeof acquireProcessingLease>>|undefined,calls=0;
  try {
    const abandoned=ownerA.run(()=>runFlow(task.id,async()=>{calls++;throw new Error("Lost owner must not send");},undefined,{requireProcessingLease:true})).then(value=>({value,error:null}),error=>({value:null,error}));
    const until=Date.now()+5000;let waiting=false;
    while(Date.now()<until) {const [row]=await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM fishery_documents%'`;if(row!.n){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(waiting,true,"old production claim reached the held document lock");
    // Kill only this test's own retained lease session, never PostgreSQL or another application's session.
    await sql`SELECT pg_terminate_backend(${ownerA.backendPid})`;ownerB=await acquireProcessingLease();
    releaseDocument();await editing;
    const stopped=await abandoned;assert.ok(stopped.error);assert.match(stopped.error.message,/lease/);assert.equal(calls,0);
    assert.deepEqual((await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`)[0],before);
    assert.deepEqual(await sql`SELECT value FROM settings WHERE key=${authorizationKey}`,ledgerBefore);assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receiptCount);
    await ownerB.assertHeld();
  }finally{releaseDocument();await editing;await ownerB?.release();await ownerA.release();}
});


async function flowExecutionFixture(identity:string) {
  const f=await fixture({unknownRights:true}),body="合成远洋渔业执行归属故障测试。";
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-execution/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/execution-${f.id}`,title:"SYNTHETIC EXECUTION FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  await approve(f.id,2,1);
  return {...f,body,task:await createFlow(f.id,{identity},"fixture-admin")};
}
async function terminateFlowTestLease(lease:{backendPid:number}) {
  assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/);
  const [row]=await sql`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=${lease.backendPid} AND datname=current_database() AND application_name='fishery-processing-lease'`;
  assert.equal(row?.terminated,true,"terminate only this isolated test database's own processing lease");
}
async function flowExecutionState(id:string) {
  const [row]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;
  const audits=await sql`SELECT * FROM audit_log WHERE after->>'id'=${id} ORDER BY id`;
  const receipts=await sql`SELECT r.* FROM receipts r WHERE EXISTS (SELECT 1 FROM fishery_flow_tasks t CROSS JOIN LATERAL jsonb_each(t.stage_requests) b WHERE t.id=${id} AND r.subject=b.value->>'subject' AND r.purpose=b.value->>'purpose') ORDER BY r.id`;
  return {row,audits:[...audits],receipts:[...receipts]};
}
test("flow execution fencing preserves a replacement claim against a late authorization failure after zero-request reconciliation",async()=>{
  for(const leased of [true,false]) {
    const f=await flowExecutionFixture("execution-zero-request-"+leased),boss=await getBoss({schedule:false,supervise:false});await boss.createQueue(flowQueue.name,flowQueue.options);
    const [priorLedger]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
    await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({id:TRIAL.id,entries:[],maxRequests:null,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
    const ownerA=leased?await acquireProcessingLease():undefined,arrived=Promise.withResolvers<void>(),late=Promise.withResolvers<void>(),replacement=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
    let ownerB:Awaited<ReturnType<typeof acquireProcessingLease>>|undefined,old:Promise<any>|undefined,next:Promise<any>|undefined;
    const sends:string[]=[];
    try {
      const run=()=>runFlow(f.task.id,selectionMock(f.body,sends),async()=>{arrived.resolve();await late.promise;throw new Error("Synthetic late authorization failure");},{requireProcessingLease:leased});
      old=ownerA?ownerA.run(run):run();
      await arrived.promise;const before=await flowExecutionState(f.task.id);assert.ok(before.row.execution_token);
      // The token participates in recovery's fingerprint even when timestamps and other task fields do not change.
      const fingerprint=(await flowDetail(f.task.id)).reconciliation.executionFingerprint;
      await sql`UPDATE fishery_flow_tasks SET execution_token=${"00000000-0000-4000-8000-000000000001"} WHERE id=${f.task.id}`;
      assert.notEqual((await flowDetail(f.task.id)).reconciliation.executionFingerprint,fingerprint);
      await sql`UPDATE fishery_flow_tasks SET execution_token=${before.row.execution_token} WHERE id=${f.task.id}`;
      if(ownerA)await terminateFlowTestLease(ownerA);
      const state=(await flowDetail(f.task.id)).reconciliation;assert.equal(state.eligible,true,state.reasons.join("; "));
      await reconcileFlow(f.task.id,{snapshotHash:state.snapshotHash,executionFingerprint:state.executionFingerprint,expectedStatus:"running",acknowledgeRunnerStopped:true,reason:"Synthetic old test runner stopped at authorization"},"fixture-admin");
      assert.equal((await flowExecutionState(f.task.id)).row.execution_token,null);
      await retryFlow(f.task.id,{note:"Synthetic explicit recovery",acknowledgeNewCharge:true},"fixture-admin");
      assert.equal((await flowExecutionState(f.task.id)).row.execution_token,null);
      ownerB=await acquireProcessingLease();
      next=ownerB.run(()=>runFlow(f.task.id,selectionMock(f.body,sends),async run=>{replacement.resolve();await finish.promise;await run();},{requireProcessingLease:true}));
      await replacement.promise;const replacementState=await flowExecutionState(f.task.id);
      assert.equal(replacementState.row.status,"running");assert.notEqual(replacementState.row.execution_token,before.row.execution_token);
      late.resolve();await old;
      assert.deepEqual(await flowExecutionState(f.task.id),replacementState,"late A catch cannot change B's row, audits or receipts");assert.deepEqual(sends,[]);
      finish.resolve();assert.equal((await next).status,"needs_human_review");assert.deepEqual(sends,["generation","review"]);
    } finally {
      late.resolve();finish.resolve();await old;await next;await ownerB?.release();await ownerA?.release();
      if(priorLedger)await sql`UPDATE settings SET value=${sql.json(priorLedger.value)} WHERE key=${authorizationKey}`;else await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
    }
  }
});
test("flow execution fencing reuses received generation and preserves replacement results against late success and failure",async()=>{
  for(const variant of ["leased-success","leased-failure","fake-success"] as const) {
    const f=await flowExecutionFixture("execution-received-"+variant),sends:string[]=[],invoke=selectionMock(f.body,sends),arrived=Promise.withResolvers<void>(),late=Promise.withResolvers<void>();
    const leased=variant!=="fake-success",ownerA=leased?await acquireProcessingLease():undefined;
    let old:Promise<any>|undefined;
    try {
      const run=()=>runFlow(f.task.id,async options=>{
        const result=await invoke(options);assert.equal(options.purpose,"fishery_draft");arrived.resolve();await late.promise;
        if(variant==="leased-failure")throw new Error("Synthetic late generation failure");
        return result;
      },undefined,{requireProcessingLease:leased});
      old=ownerA?ownerA.run(run):run();
      await arrived.promise;const received=await flowExecutionState(f.task.id);
      assert.equal(received.row.draft,null);assert.equal(received.receipts.length,1);assert.equal(received.receipts[0].status,"received");
      if(ownerA)await terminateFlowTestLease(ownerA);
      await retryFlow(f.task.id,{note:"Synthetic reuse of original received generation"},"fixture-admin");
      assert.equal((await flowExecutionState(f.task.id)).row.execution_token,null);
      const done=await runFlow(f.task.id,invoke);assert.equal(done.status,"needs_human_review",JSON.stringify(done.error));
      const replacementState=await flowExecutionState(f.task.id);
      assert.notEqual(replacementState.row.execution_token,received.row.execution_token);
      assert.equal(done.draft.receiptId,received.receipts[0].id);assert.deepEqual(sends,["generation","review"]);
      late.resolve();await old;
      assert.deepEqual(await flowExecutionState(f.task.id),replacementState,"old execution cannot change the replacement row, audits or completed receipts");
      assert.deepEqual(sends,["generation","review"],"generation sent once, with unchanged provider identity across executions");
    } finally {late.resolve();await old;await ownerA?.release();}
  }
});
test("flow execution fencing leaves a received response reusable when its lease is lost before replacement",async()=>{
  const f=await flowExecutionFixture("execution-lease-before-replacement"),sends:string[]=[],invoke=selectionMock(f.body,sends),arrived=Promise.withResolvers<void>(),late=Promise.withResolvers<void>(),owner=await acquireProcessingLease();
  let old:Promise<any>|undefined;
  try {
    old=owner.run(()=>runFlow(f.task.id,async options=>{const answer=await invoke(options);arrived.resolve();await late.promise;return answer;},undefined,{requireProcessingLease:true}));
    await arrived.promise;const received=await flowExecutionState(f.task.id);
    await terminateFlowTestLease(owner);late.resolve();await old;
    assert.deepEqual(await flowExecutionState(f.task.id),received,"lost lease cannot complete receipts, audit or persist even without a replacement claim");
    await retryFlow(f.task.id,{note:"Synthetic explicit received response recovery"},"fixture-admin");
    assert.equal((await runFlow(f.task.id,invoke)).status,"needs_human_review");assert.deepEqual(sends,["generation","review"]);
  } finally {late.resolve();await old;await owner.release();}
});

test("explicit amount-only upgrade retains cumulative history and audits the original ledger",async()=>{
  const entries=Array.from({length:18},(_,i)=>({id:i+1,state:"received",wireBytes:100,reservedMicroCny:400_000,usage:{promptTokens:i===17?9847:7000,completionTokens:0,estimatedMicroCny:i===17?19694:14000}}));
  const old={id:TRIAL.id,maxRequests:20,maxReservedMicroCny:10_000_000,entries};
  await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json(old)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  await assert.rejects(assertFisheryCapacity(),/explicit amount-only/);
  const result=await upgradeExistingTrialToAmountOnly("tester","User explicitly cancelled count cap; retain cumulative ten yuan");
  assert.equal(result.entryCount,18);assert.equal(result.spentMicroCny,257694);assert.equal(result.modelCalls,0);
  const [stored]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
  assert.deepEqual(stored!.value.entries,entries);assert.equal(stored!.value.maxRequests,null);
  await assertFisheryCapacity(2);
  const [record]=await sql`SELECT before,after FROM audit_log WHERE subject=${authorizationKey} AND action='fishery.authorization.amount_only' ORDER BY id DESC LIMIT 1`;
  assert.match(record!.before.ledgerHash,/^[a-f0-9]{64}$/);assert.equal(record!.after.previousLedgerHash,record!.before.ledgerHash);
  await assert.rejects(upgradeExistingTrialToAmountOnly("tester","repeat"),/upgrade refused/);
});

test("cumulative amount budget uses validated received usage and reserves every unresolved cost",()=>{
  const usage={promptTokens:100,completionTokens:10,estimatedMicroCny:280};
  const entries=Array.from({length:30},()=>({state:"received",reservedMicroCny:400_000,usage}));
  assert.doesNotThrow(()=>trialCapacity(entries,2));assert.equal(trialBudget(entries).occupiedMicroCny,8400);
  assert.equal(trialBudget([{state:"received",reservedMicroCny:400_000}]).occupiedMicroCny,400_000);
  for(const state of ["pending","unknown","refused"]) {
    assert.equal(trialBudget([{state,reservedMicroCny:400_000,usage}]).occupiedMicroCny,400_000);
    assert.throws(()=>trialCapacity([{state,reservedMicroCny:400_000,usage}]),/reconciliation/);
  }
  assert.throws(()=>trialCapacity(Array.from({length:25},()=>({state:"received",reservedMicroCny:400_000}))),/hard amount/);
  assert.throws(()=>trialBudget([{state:"received",reservedMicroCny:200,usage}]),/exceeds reservation/);
  assert.throws(()=>trialBudget([{state:"received",reservedMicroCny:400_000,usage:{...usage,promptTokens:0.5}}]),/usage/);
});

// The bounded archive adapter uses the original source/fetch ledger, without importing materials.
import { columnDbProgress, migrateColumnDbProgress, COLUMN_CURSOR_KEY } from '../backend/column-db-progress.ts';
import { collectColumnRound, initialColumnProgress, columnProgressCoordinator } from '../backend/column-progress.ts';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const bridgeSource='fishery-column-moa';
import { afterEach } from 'node:test';
let bridgeSnapshot:Record<string,any>|null|undefined;
afterEach(async()=>{
  if(bridgeSnapshot===undefined) return;
  // Preserve earlier import tests' source entity, profiles, documents and unrelated run evidence.
  await sql`DELETE FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId' LIKE 'bridge-%'`;
  if(bridgeSnapshot) {
    const s=bridgeSnapshot;
    await sql`UPDATE sources SET kind=${s.kind},config=${sql.json(s.config)},cursor=${s.cursor===null?null:sql.json(s.cursor)},
      enabled=${s.enabled},health=${s.health},fail_count=${s.fail_count},last_ok_at=${s.last_ok_at},last_fetch_at=${s.last_fetch_at},
      next_fetch_at=${s.next_fetch_at},last_error=${s.last_error},updated_at=${s.updated_at} WHERE id=${bridgeSource}`;
  } else await sql`DELETE FROM sources WHERE id=${bridgeSource}`;
  bridgeSnapshot=undefined;
});
async function bridgeFixture() {
  if(bridgeSnapshot===undefined) bridgeSnapshot=(await sql`SELECT * FROM sources WHERE id=${bridgeSource}`)[0]??null;
  await sql`DELETE FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId' LIKE 'bridge-%'`;
  const cursor={unrelated:{etag:'keep',nested:[1,2]},[COLUMN_CURSOR_KEY]:initialColumnProgress('moa')};
  await sql`INSERT INTO sources (id,name,kind,enabled,cursor,last_ok_at) VALUES (${bridgeSource},'archive bridge synthetic','external',false,${sql.json(cursor)},'2026-10-01T00:00:00Z')
    ON CONFLICT(id) DO UPDATE SET kind='external',config='{}',enabled=false,cursor=EXCLUDED.cursor,last_ok_at=EXCLUDED.last_ok_at,
      fail_count=0,health='unknown',last_fetch_at=NULL,last_error=NULL,next_fetch_at=NULL`;
  return cursor;
}
function bridgeAfter(outcome:'success'|'failure'|'partial') {
  const after=initialColumnProgress('moa');after.revision=1;after.pendingUrls=['https://yyj.moa.gov.cn/gzdt/202610/t20261020_99001.htm'];
  after.health={outcome,lastAttemptAt:'2026-10-21T00:00:00Z',lastSuccessAt:null,lastCaptureAt:null,reason:outcome==='success'?null:'synthetic failed acquisition',pending:1,nextPageUrl:after.cursorUrl,coverage:'blocked'};
  return after;
}
test('source bridge failure and partial preserve complete successful cursor and use core backoff once',async()=>{
  for(const outcome of ['failure','partial'] as const) {
    const cursor=await bridgeFixture(),before=initialColumnProgress('moa'),after=bridgeAfter(outcome),id=`bridge-${outcome}`;
    const [original]=await sql`SELECT cursor::text AS bytes FROM sources WHERE id=${bridgeSource}`;
    await columnDbProgress.intent('moa',id,before);
    await columnDbProgress.intent('moa',id,before);
    await columnDbProgress.finish('moa',id,before,after,[],2);
    const [first]=await sql`SELECT cursor::text AS bytes,last_ok_at,fail_count,health,next_fetch_at FROM sources WHERE id=${bridgeSource}`;
    assert.equal(first!.bytes,original!.bytes);assert.deepEqual(JSON.parse(first!.bytes),cursor);assert.equal(first!.last_ok_at.toISOString(),'2026-10-01T00:00:00.000Z');assert.equal(first!.fail_count,1);assert.equal(first!.health,'degraded');assert.ok(first!.next_fetch_at);
    await columnDbProgress.finish('moa',id,before,after,[],2);
    const [replay]=await sql`SELECT cursor::text AS bytes,last_ok_at,fail_count,next_fetch_at FROM sources WHERE id=${bridgeSource}`;
    assert.equal(replay!.bytes,first!.bytes);assert.equal(replay!.fail_count,1);assert.equal(replay!.next_fetch_at.toISOString(),first!.next_fetch_at.toISOString());
    const runs=await sql`SELECT status,found_count,new_count,detail FROM fetch_runs WHERE source_id=${bridgeSource} AND detail->'fisheryColumnRound'->>'roundId'=${id}`;
    assert.equal(runs.length,1);assert.equal(runs[0]!.status,'failed');assert.equal(runs[0]!.new_count,0);assert.equal(runs[0]!.found_count,2);assert.equal(runs[0]!.detail.outcome,outcome);assert.deepEqual(runs[0]!.detail.fisheryColumnRound.after.pendingUrls,after.pendingUrls);
  }
});
test('source bridge commits trusted partial progress without turning bad article bodies into source failures',async()=>{
  await bridgeFixture();let before=initialColumnProgress('moa');
  for(let i=1;i<=4;i++) {
    const after={...before,revision:i,completedUrls:[`https://yyj.moa.gov.cn/gzdt/202610/t20261020_${99000+i}.htm`],firstSeen:{'https://yyj.moa.gov.cn/gzdt/202610/t20261020_99001.htm':{at:'2026-10-21T00:00:00Z',batchId:'bridge-proof'}}};
    after.health={...bridgeAfter('partial').health!,listingSucceededAt:'2026-10-21T00:00:00Z',bodyFailures:1};
    const id=`bridge-partial-body-${i}`;
    await columnDbProgress.intent('moa',id,before);await columnDbProgress.finish('moa',id,before,after,[],2);
    const [source]=await sql`SELECT cursor,fail_count,last_ok_at,last_error,health FROM sources WHERE id=${bridgeSource}`;
    assert.deepEqual(source.cursor[COLUMN_CURSOR_KEY],after);assert.equal(source.fail_count,0);assert.equal(source.last_error,null);assert.equal(source.health,'ok');
    const [run]=await sql`SELECT status,detail FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId'=${id}`;
    assert.equal(run.status,'ok');assert.equal(run.detail.outcome,'partial');assert.equal(run.detail.fisheryColumnRound.after.health.bodyFailures,1);
    before=after;
  }
});
test('source bridge explicit legacy recovery retains old identities and earliest archived discovery',async()=>{
  await bridgeFixture();
  const urls=[991,992].map(n=>`${COLUMNS.moa.url}202610/t20261023_${n}.htm`),id='bridge-recover-legacy',batchId=id+'-moa-p0';
  const listing=`<ul class="sj_e_tonzhi_list">${urls.map(url=>`<li><a href="${url}">合成归档恢复</a></li>`).join('')}</ul>`;
  const batch=await collectColumns({id:batchId,dataDir:config.dataDir,columns:['moa'],limit:2,page:{url:COLUMNS.moa.url,completedUrls:[]},wait:async()=>{},fetch:async url=>({url,status:url.endsWith('robots.txt')||url===urls[0]?404:200,headers:{get:()=>null},body:Buffer.from(url.endsWith('robots.txt')?'missing':url===COLUMNS.moa.url?listing:`<meta name="ArticleTitle" content="合成归档恢复"><meta name="PubDate" content="2026-10-23"><div class="sj_arc_body"><div class="TRS_Editor">${'公海远洋渔业的完整合成正文，只用于本地测试。'.repeat(5)}</div></div>`)})});
  const before={...initialColumnProgress('moa'),profileHash:'b'.repeat(64),pendingUrls:urls,history:{pausedAt:'2026-10-20T00:00:00Z',cursorUrl:COLUMNS.moa.url+'index_1.htm',completedUrls:[],pendingUrls:['https://yyj.moa.gov.cn/gzdt/202001/t20200101_80001.htm']}};
  await sql`UPDATE sources SET cursor=jsonb_set(cursor,'{fisheryColumnProgress}',${sql.json(before)}),fail_count=3,health='degraded',last_error='legacy body failure' WHERE id=${bridgeSource}`;
  const binding=JSON.stringify({id:bridgeSource,kind:'external',config:{}});
  await sql`INSERT INTO fetch_runs(source_id,status,finished_at,detail) VALUES(${bridgeSource},'failed',now(),${sql.json({fisheryColumnRound:{roundId:id,column:'moa',before,after:bridgeAfter('partial'),batches:[batchId],sourceBinding:binding}})})`;
  const [original]=await sql`SELECT cursor FROM sources WHERE id=${bridgeSource}`;
  await assert.rejects(migrateColumnDbProgress('moa',{expectedProfileHash:'c'.repeat(64),reason:'Synthetic explicit legacy archive reconciliation',recoverRoundId:id},'tester'),/expected profile differs/);
  assert.deepEqual((await sql`SELECT cursor FROM sources WHERE id=${bridgeSource}`)[0].cursor,original.cursor);
  const migrated=await migrateColumnDbProgress('moa',{expectedProfileHash:before.profileHash,reason:'Synthetic explicit legacy archive reconciliation',recoverRoundId:id},'tester');
  assert.deepEqual(migrated.after.completedUrls,[urls[1]]);assert.deepEqual(migrated.after.pendingUrls,[urls[0]]);
  assert.deepEqual(migrated.after.history!.pendingUrls,before.history.pendingUrls);
  assert.equal(migrated.after.firstSeen![urls[0]].at,batch.sources[0].listingSucceededAt);assert.equal(migrated.after.health!.outcome,'partial');
  const [source]=await sql`SELECT cursor,fail_count,enabled FROM sources WHERE id=${bridgeSource}`;
  assert.equal(source.fail_count,0);assert.equal(source.enabled,false);assert.equal(source.cursor.unrelated.etag,'keep');
  assert.equal((await sql`SELECT count(*)::int AS n FROM fishery_documents WHERE canonical_url IN ${sql(urls)}`)[0].n,0,'Migration does not import or dispatch');
});

test('first archived list time enters articles once even when import waits three days',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-23T12:00:00Z')});
  const urls=[701,702].map(n=>`${COLUMNS.moa.url}202610/t20261023_${n}.htm`),listing=`<ul class="sj_e_tonzhi_list">${urls.map(url=>`<li><a href="${url}">合成首次发现</a></li>`).join('')}</ul>`;
  const fetch=async(url:string)=>({url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=>null},body:Buffer.from(url.endsWith('robots.txt')?'missing':url===COLUMNS.moa.url?listing:`<meta name="ArticleTitle" content="合成首次发现"><meta name="PubDate" content="2026-10-23 10:00"><div class="sj_arc_body"><div class="TRS_Editor">${'公海远洋渔业的完整合成正文，只用于本地测试。'.repeat(5)}</div></div>`) });
  const first=await collectColumns({id:'first-list-before-wait',dataDir:config.dataDir,columns:['moa'],limit:1,page:{url:COLUMNS.moa.url,completedUrls:[]},fetch,wait:async()=>{}});
  t.mock.timers.tick(3*86400000);
  const later=await collectColumns({id:'first-list-after-wait',dataDir:config.dataDir,columns:['moa'],limit:1,page:{url:COLUMNS.moa.url,completedUrls:[urls[0]],revision:1,firstSeen:first.sources[0].firstSeen},fetch,wait:async()=>{}});
  assert.equal(later.items[0].url,urls[1]);
  const result=await importBatch(later.id,'tester'),documentId=result.rows[0].id;
  const [article]=await sql`SELECT id,discovered_at,backfill,published_at FROM articles WHERE raw->>'fisheryDocumentId'=${documentId}`;
  assert.equal(article.discovered_at.toISOString(),'2026-10-23T12:00:00.000Z');assert.equal(article.backfill,false);assert.equal(article.published_at.toISOString(),'2026-10-23T02:00:00.000Z');
  assert.equal((await sql`SELECT purpose FROM fishery_document_purposes WHERE document_id=${documentId}`)[0].purpose,'native');
  assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE document_id=${documentId}`).length,0);
  await importBatch(later.id,'tester');
  assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${article.id}`)[0].discovered_at.toISOString(),'2026-10-23T12:00:00.000Z');
});
test('source bridge success merges latest unrelated cursor fields and finalized replay never overwrites newer progress',async()=>{
  await bridgeFixture();const before=initialColumnProgress('moa'),after=bridgeAfter('success');
  await columnDbProgress.intent('moa','bridge-success',before);
  await sql`UPDATE sources SET cursor=cursor || '{"concurrentCoreField":{"value":"preserved"}}'::jsonb WHERE id=${bridgeSource}`;
  await columnDbProgress.finish('moa','bridge-success',before,after,[],3);
  const [source]=await sql`SELECT cursor,fail_count FROM sources WHERE id=${bridgeSource}`;
  assert.equal(source!.cursor.concurrentCoreField.value,'preserved');assert.equal(source!.cursor.unrelated.etag,'keep');assert.deepEqual(source!.cursor[COLUMN_CURSOR_KEY],after);assert.equal(source!.fail_count,0);
  const newer={...after,revision:2};await sql`UPDATE sources SET cursor=jsonb_set(cursor,'{fisheryColumnProgress}',${sql.json(newer)}) WHERE id=${bridgeSource}`;
  await columnDbProgress.finish('moa','bridge-success',before,after,[],3);
  assert.deepEqual(await columnDbProgress.load('moa'),newer);
  await assert.rejects(columnDbProgress.finish('moa','bridge-success',before,{...after,revision:55},[],3),/Finalized run evidence differs/);
});
test('source bridge rejects source config/profile changes, cursor CAS conflicts and run-source mismatch',async()=>{
  await bridgeFixture();const before=initialColumnProgress('moa'),after=bridgeAfter('success');
  await columnDbProgress.intent('moa','bridge-guards',before);
  await sql`UPDATE sources SET config='{"changed":true}' WHERE id=${bridgeSource}`;
  await assert.rejects(columnDbProgress.finish('moa','bridge-guards',before,after,[],1),/binding mismatch/);
  await sql`UPDATE sources SET config='{}',cursor=jsonb_set(cursor,'{fisheryColumnProgress,revision}','9') WHERE id=${bridgeSource}`;
  await assert.rejects(columnDbProgress.finish('moa','bridge-guards',before,after,[],1),/cursor changed/);
  await sql`UPDATE sources SET cursor=jsonb_set(cursor,'{fisheryColumnProgress}',${sql.json(before)}) WHERE id=${bridgeSource}`;
  await sql`INSERT INTO sources (id,name,kind,enabled) VALUES ('bridge-wrong-source','synthetic','external',false) ON CONFLICT DO NOTHING`;
  await sql`UPDATE fetch_runs SET source_id='bridge-wrong-source' WHERE detail->'fisheryColumnRound'->>'roundId'='bridge-guards'`;
  await assert.rejects(columnDbProgress.finish('moa','bridge-guards',before,after,[],1),/binding mismatch/);
  await sql`UPDATE sources SET cursor=jsonb_set(cursor,'{fisheryColumnProgress,profileHash}',${sql.json('0'.repeat(64))}) WHERE id=${bridgeSource}`;
  await assert.rejects(columnDbProgress.load('moa'),/profile\/source binding changed/);
});
test('source bridge journal reconciliation after core commit does no GET and does not increment failure twice',async()=>{
  await bridgeFixture();const dataDir=await mkdtemp(path.join(tmpdir(),'source-bridge-'));let requests=0,intentVerified=false;
  const options={storage:'db' as const,store:columnDbProgress,id:'bridge-crash',dataDir,columns:['moa' as const],limit:1,maxPages:1,wait:async()=>{},fetch:async()=>{
    requests++;
    const journal=JSON.parse(await readFile(path.join(dataDir,'fishery-column-progress/rounds/bridge-crash/manifest.json'),'utf8'));
    assert.equal(journal.sources[0].sourceId,bridgeSource);
    const [intent]=await sql`SELECT status FROM fetch_runs WHERE source_id=${bridgeSource} AND detail->'fisheryColumnRound'->>'roundId'='bridge-crash'`;
    assert.equal(intent!.status,'running');
    await sql.begin(async tx=>{await tx`SELECT id FROM sources WHERE id=${bridgeSource} FOR UPDATE NOWAIT`;});
    intentVerified=true;throw new Error('synthetic connection failure');
  }};
  try {
    await assert.rejects(collectColumnRound({...options,checkpoint:async stage=>{if(stage==='after-source-commit') throw new Error('synthetic stopped runner');}}),/stopped runner/);
    assert.equal(intentVerified,true);
    const journal=JSON.parse(await readFile(path.join(dataDir,'fishery-column-progress/rounds/bridge-crash/manifest.json'),'utf8'));
    assert.equal(journal.sources[0].sourceId,bridgeSource);assert.equal(journal.sources[0].status,'ready_to_commit');
    const originalRequests=requests;
    await collectColumnRound({...options,resume:{acknowledgeStopped:true,reason:'synthetic previous runner has stopped'}});
    assert.equal(requests,originalRequests);
    const [source]=await sql`SELECT fail_count,cursor FROM sources WHERE id=${bridgeSource}`;assert.equal(source!.fail_count,1);assert.deepEqual(source!.cursor[COLUMN_CURSOR_KEY],initialColumnProgress('moa'));
  } finally {await rm(dataDir,{recursive:true,force:true});}
});
test('source bridge DB failure never falls back to the offline file cursor or issues GET',async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'source-bridge-'));let requested=false;
  try {
    await mkdir(path.join(dataDir,'fishery-column-progress'));await writeFile(path.join(dataDir,'fishery-column-progress/moa.json'),JSON.stringify(initialColumnProgress('moa')));
    await assert.rejects(collectColumnRound({storage:'db',store:{...columnDbProgress,load:async()=>{throw new Error('synthetic DB unavailable');}},id:'bridge-unavailable',dataDir,columns:['moa'],limit:1,maxPages:1,fetch:async()=>{requested=true;throw new Error('unexpected GET');}}),/DB unavailable/);
    assert.equal(requested,false);assert.equal(JSON.parse(await readFile(path.join(dataDir,'fishery-column-progress/moa.json'),'utf8')).revision,0);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});
test('source bridge DB progress API reads core state rather than offline cursor',async()=>{
  await bridgeFixture();await mkdir(path.join(config.dataDir,'fishery-column-progress'),{recursive:true});
  const file=path.join(config.dataDir,'fishery-column-progress/moa.json');await writeFile(file,JSON.stringify({...initialColumnProgress('moa'),revision:99}));
  config.devAdmin={displayName:'Synthetic source bridge status reader'};
  try {
    const response=await app.inject({method:'GET',url:'/api/admin/fishery/batches'});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');
    const body=response.json();assert.equal(body.storage,'db');assert.equal(body.progress.find((row:{column:string})=>row.column==='moa').state.revision,0);assert.equal(body.sourceState.find((row:{id:string})=>row.id===bridgeSource).enabled,false);
    const offline=await app.inject({method:'GET',url:'/api/admin/fishery/batches?storage=file'});assert.equal(offline.json().storage,'file');assert.equal(offline.json().progress.find((row:{column:string})=>row.column==='moa').state.revision,99);
    const [saved]=await sql`SELECT value FROM settings WHERE key='fishery.archive.moa'`;
    await sql`INSERT INTO settings(key,value) VALUES('fishery.archive.moa','{"synthetic_invalid":true}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    try{const broken=await app.inject('/api/admin/fishery/batches');assert.equal(broken.statusCode,200,broken.body);const states=broken.json().archiveSources;assert.equal(states.length,ARCHIVE_COLUMNS.length);assert.match(states.find((s:{sourceId:string})=>s.sourceId===bridgeSource).pausedReason,/configuration unavailable/);assert.equal(states.find((s:{sourceId:string})=>s.sourceId==='fishery-column-npfc').sourceId,'fishery-column-npfc');}
    finally{if(saved)await sql`UPDATE settings SET value=${sql.json(saved.value)} WHERE key='fishery.archive.moa'`;else await sql`DELETE FROM settings WHERE key='fishery.archive.moa'`;}
  } finally {config.devAdmin=null;await rm(file,{force:true});}
});

import {PgBoss} from 'pg-boss';
import {ARCHIVE_COLUMNS,createArchiveController,ARCHIVE_KEY,ARCHIVE_TICK,ARCHIVE_QUEUE,archiveStatus,configureArchive,archiveTick,runArchiveJob,reconcileArchive,registerArchiveWorker,assertArchiveSchedules,npfcArchive,archiveSourceStatuses} from '../backend/archive-worker.ts';
import {acquireColumnLease,withColumnLease} from '../backend/column-lease.ts';
test('NPFC reuses source leases, core health and version invalidation without activating paid processing',async()=>{
 const id='fishery-column-npfc',url='https://www.npfc.int/cmm-2026-01-synthetic-integration';
 const beforeCounts=await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`;
 const capture={adapter:'npfc',sourceUrl:url,capturedAt:'2026-10-22T00:00:00Z',httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:'c'.repeat(64),parser:'synthetic/v1',parseStatus:'parsed',attachmentSha256:'d'.repeat(64),attachmentUrl:'https://www.npfc.int/system/files/test.pdf',attachmentHttpStatus:200,attachmentCapturedAt:'2026-10-22T00:00:00Z',attachmentPages:1,conflicts:[],regulatoryListing:{measureNumber:'2026-01',statedEffectiveDate:'23 July 2026',membership:'listed_current_only',applicableSea:'unknown',effectiveStatus:'unknown'}};
 const input={...observationFixture,policyStatus:'unknown',dates:{published:{precision:'unknown',value:null},adopted:{precision:'unknown',value:null},effectiveFrom:{precision:'unknown',value:null},effectiveUntil:{precision:'unknown',value:null}},sourceCapture:capture};
 const first=await withColumnLease('npfc',()=>importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,input,'tester'));
 assert.equal((await materialDetail(first.id)).state,'pending');assert.equal((await materialDetail(first.id)).source.enabled,false);
 await approve(first.id);const duplicate=await withColumnLease('npfc',()=>importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,input,'tester'));assert.equal(duplicate.unchanged,true);
 const revised=await withColumnLease('npfc',()=>importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,{...input,sourceCapture:{...capture,bodySha256:'e'.repeat(64)}},'tester'));assert.equal(revised.revision,2);assert.equal((await materialDetail(first.id)).state,'stale');
 const start=initialColumnProgress('npfc'),failed={...start,revision:1,health:{outcome:'failure' as const,lastAttemptAt:'2026-10-22T00:00:00Z',lastSuccessAt:null,lastCaptureAt:null,reason:'Synthetic full PDF unavailable',pending:0,nextPageUrl:start.cursorUrl,coverage:'blocked' as const}};
 await columnDbProgress.intent('npfc','npfc-health-failure',start);await columnDbProgress.finish('npfc','npfc-health-failure',start,failed,[],1);await columnDbProgress.finish('npfc','npfc-health-failure',start,failed,[],1);
 assert.deepEqual(await columnDbProgress.load('npfc'),start);assert.equal((await sql`SELECT fail_count FROM sources WHERE id=${id}`)[0].fail_count,1);
 const success={...start,revision:1,completedUrls:[url],health:{...failed.health,outcome:'success' as const,reason:null,lastSuccessAt:'2026-10-22T00:01:00Z',coverage:'current_page_only' as const}};
 await columnDbProgress.intent('npfc','npfc-health-recovery',start);await columnDbProgress.finish('npfc','npfc-health-recovery',start,success,[],1);await columnDbProgress.finish('npfc','npfc-health-recovery',start,success,[],1);assert.deepEqual(await columnDbProgress.load('npfc'),success);assert.equal((await sql`SELECT fail_count FROM sources WHERE id=${id}`)[0].fail_count,0);
 const lease=await acquireColumnLease('npfc');try{await assert.rejects(acquireColumnLease('npfc'),/lease unavailable/);}finally{await lease.release();}
 await sql`UPDATE sources SET participation_mode='isolated' WHERE id=${id}`;
 try{await assert.rejects(columnDbProgress.load('npfc'),/isolated/);await assert.rejects(withColumnLease('npfc',()=>importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,input,'tester')),/isolated/);}finally{await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${id}`;}
 assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`,beforeCounts);
});
const archiveUrl=(n:number)=>`https://yyj.moa.gov.cn/gzdt/202610/t20261021_${97000+n}.htm`;
const archiveListing=(ids:number[])=>Buffer.from(`<ul class="sj_e_tonzhi_list">${ids.map(n=>`<li><a href="${archiveUrl(n)}">远洋渔业隔离归档${n}</a></li>`).join('')}</ul>`);
const archiveBody=(n:number)=>Buffer.from(`<meta name="ArticleTitle" content="远洋渔业隔离归档${n}"><meta name="PubDate" content="2026-10-21"><div class="sj_arc_body"><div class="TRS_Editor"><p>ISOLATED TEST FIXTURE ${n} ${'远洋渔业公海履约完整合成上下文。'.repeat(12)}</p></div></div>`);
test('Fujian archive controllers stay disabled until configured and use hourly five-article bounds',async()=>{
 await archiveFixture();const b=await testArchiveBoss();
 const before=await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications,(SELECT count(*) FROM fishery_reviews) AS reviews`;
 try{
  for(const column of ['fujian','fujian-notices'] as const){
   const controller=createArchiveController(column),sourceId=`fishery-column-${column}`;
   await sql`DELETE FROM settings WHERE key=${controller.key}`;
   const sourcesBefore=await sql`SELECT count(*) AS n FROM sources`;
   const initial=(await archiveSourceStatuses()).find(s=>s.sourceId===sourceId)!;
   assert.equal(initial.enabled,false);assert.equal(initial.mode,null);assert.equal(initial.maxArticles,5);assert.equal(await controller.read(),null);assert.equal(initial.adapted,true);assert.equal(initial.normalCycleVerified,false);
   assert.deepEqual(await sql`SELECT count(*) AS n FROM sources`,sourcesBefore,'Status never registers a missing source');
   await sql`INSERT INTO sources(id,name,kind,enabled,cursor) VALUES(${sourceId},${'Synthetic '+column+' archive'},'external',false,'{}') ON CONFLICT(id) DO UPDATE SET kind='external',enabled=false,participation_mode='editorial',cursor='{}',fail_count=0,last_error=NULL,last_fetch_at=NULL,last_ok_at=NULL,next_fetch_at=NULL`;
   await sql`DELETE FROM fetch_runs WHERE source_id=${sourceId} AND detail ? 'fisheryColumnRound'`;
   await assert.rejects(controller.configureArchive({enabled:true,mode:'six_hourly',runId:'wrong-fujian-cadence'}),/does not match/);
   const c=await controller.configureArchive({enabled:true,mode:'hourly',runId:`synthetic-${column}`});assert.equal(c.intervalSeconds,3600);
   await controller.registerArchiveWorker(b,{consume:false});
   const claimed=await controller.archiveTick(b,c.revision);assert.ok(claimed.roundId);if(!claimed.roundId||!claimed.jobId)throw new Error('Expected authorized archive round');
   await b.fetch(controller.queue);await b.complete(controller.queue,claimed.jobId!);
   const urls=Array.from({length:6},(_,i)=>new URL(`202610/t20261023_${9988101+i}.htm`,COLUMNS[column].url).href),requests:string[]=[];
   const listing=Buffer.from(`<ul class="xw-list-1 gl_list">${urls.map((url,i)=>`<li><a href="${url}">远洋渔业隔离归档${i}</a></li>`).join('')}</ul>`);
   const result=await controller.runArchiveJob({revision:c.revision,roundId:claimed.roundId,column},{wait:async()=>{},fetch:async url=>{
    requests.push(url);assert.ok(url.endsWith('/robots.txt')||url===COLUMNS[column].url||urls.includes(url),'No external requests outside the local fixture');
    return {url,status:url.endsWith('/robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('/robots.txt')?Buffer.from('missing'):url===COLUMNS[column].url?listing:Buffer.from(`<meta name="ArticleTitle" content="合成远洋渔业隔离归档"><meta name="PubDate" content="2026-10-23 10:00"><div id="detailCont"><div class="TRS_Editor"><p>ISOLATED TEST FIXTURE ${'远洋渔业公海履约完整合成上下文。'.repeat(12)}</p></div></div>`)};
   }});
   assert.equal(result.outcome,'success');assert.equal(result.modelCalls,0);assert.equal(requests.filter(url=>urls.includes(url)).length,5);assert.ok(!requests.includes(urls[5]));
   const status=await controller.archiveStatus();assert.equal(status.registered,true);assert.equal(status.normalCycleVerified,true);assert.equal(status.latestPending,1);assert.equal(status.historyDeferred,0);assert.equal(status.mode,'hourly');assert.equal(status.maxArticles,5);assert.equal(status.pendingCandidates,1);assert.equal(status.coreSourceEnabled,false);assert.ok(Date.parse(status.nextRunAt!)>Date.now()+3500_000);
   const docs=await sql`SELECT d.id,r.id AS review FROM fishery_documents d LEFT JOIN fishery_reviews r ON r.document_id=d.id WHERE d.source_id=${sourceId} AND d.canonical_url=ANY(${urls}::text[])`;
   assert.equal(docs.length,5);assert.ok(docs.every(d=>d.review===null));assert.equal((await materialDetail(docs[0].id)).state,'pending');
   await controller.configureArchive({enabled:false,mode:'hourly',runId:c.runId});assert.equal((await controller.archiveStatus()).enabled,false);
  }
  for(const column of ARCHIVE_COLUMNS){await b.createQueue(`fishery.archive.${column}.tick`);await b.schedule(`fishery.archive.${column}.tick`,'* * * * *');}
  await assertArchiveSchedules(b);assert.throws(()=>createArchiveController('iotc' as never),/Unsupported/);
  assert.equal((await archiveSourceStatuses()).find(s=>s.sourceId==='fishery-column-npfc')!.maxArticles,1);
  assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications,(SELECT count(*) FROM fishery_reviews) AS reviews`,before);
 }finally{for(const column of ARCHIVE_COLUMNS)await b.unschedule(`fishery.archive.${column}.tick`);for(const column of ['fujian','fujian-notices'])await sql`DELETE FROM settings WHERE key=${'fishery.archive.'+column}`;await b.stop({graceful:false});}
});
test('NPFC and MARA archive jobs use independent coordinators, health and schedules without paid side effects',async()=>{
 await archiveFixture();const b=await testArchiveBoss();let release!:()=>void;
 const arrived=new Promise<void>(r=>release=r),key=npfcArchive.key,id='fishery-column-npfc';
 const before=await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`;
 try{
  await sql`DELETE FROM settings WHERE key=${key}`;
  await sql`INSERT INTO sources(id,name,kind,enabled,cursor) VALUES(${id},'Synthetic NPFC archive','external',false,'{}') ON CONFLICT(id) DO UPDATE SET enabled=false,kind='external',participation_mode='editorial',cursor='{}',fail_count=0,last_error=NULL,last_fetch_at=NULL,last_ok_at=NULL,next_fetch_at=NULL`;
  await sql`DELETE FROM fetch_runs WHERE source_id=${id} AND detail ? 'fisheryColumnRound'`;
  await b.createQueue(npfcArchive.queue,{policy:'short',retryLimit:0});
  const m=await configureArchive({enabled:true,mode:'validation',runId:'isolated-mara',intervalSeconds:10});
  const n=await npfcArchive.configureArchive({enabled:true,mode:'validation',runId:'isolated-npfc',intervalSeconds:10});
  await b.createQueue(ARCHIVE_TICK);await b.createQueue(npfcArchive.tick);
  await b.schedule(ARCHIVE_TICK,'* * * * *');await b.schedule(npfcArchive.tick,'0 */6 * * *');await assertArchiveSchedules(b);
  const mj=await claimArchive(b,m.revision),nj=await npfcArchive.archiveTick(b,n.revision);assert.ok('roundId' in nj);
  await b.fetch(npfcArchive.queue);await b.complete(npfcArchive.queue,(nj as {jobId:string}).jobId);
  const failed=npfcArchive.runArchiveJob({revision:n.revision,roundId:(nj as {roundId:string}).roundId},{wait:async()=>{},fetch:async()=>{release();return {url:'https://www.npfc.int/robots.txt',status:403,headers:{get:()=> 'text/plain'},body:Buffer.from('Synthetic blocked source')};}});
  await arrived;
  const success=runArchiveJob(mj,{wait:async()=>{},fetch:async url=>({url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([88]):archiveBody(88)})});
  assert.equal((await failed).outcome,'failure');assert.equal((await success).outcome,'success');
  const states=await archiveSourceStatuses(),ms=states.find(s=>s.sourceId===bridgeSource)!,ns=states.find(s=>s.sourceId===id)!;
  assert.equal(ms.consecutiveFailures,0);assert.ok(ms.lastSuccessAt);assert.equal(ns.consecutiveFailures,1);assert.equal(ns.lastSuccessAt,null);assert.equal(ns.maxArticles,1);assert.equal(ms.maxArticles,5);
  assert.equal((await materialDetail((await sql`SELECT id FROM fishery_documents WHERE canonical_url=${archiveUrl(88)}`)[0].id)).state,'pending');
  assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`,before);
  await npfcArchive.configureArchive({enabled:false,mode:'validation',runId:n.runId});
  await sql`UPDATE sources SET last_error=NULL,fail_count=0,last_fetch_at=now(),next_fetch_at=NULL WHERE id=${id}`;
  await assert.rejects(npfcArchive.configureArchive({enabled:true,mode:'hourly',runId:'wrong-cadence'}),/does not match/);
  const normal=await npfcArchive.configureArchive({enabled:true,mode:'six_hourly',runId:'npfc-six-hour'});assert.equal(normal.intervalSeconds,21600);assert.ok(Date.parse(normal.nextAt!)>Date.now()+21500_000);
  await sql`UPDATE sources SET participation_mode='isolated' WHERE id=${id}`;assert.equal((await npfcArchive.archiveStatus()).enabled,false);assert.match((await npfcArchive.archiveStatus()).pausedReason!,/isolated/);
 }finally{await sql`DELETE FROM settings WHERE key=${key}`;await b.unschedule(ARCHIVE_TICK);await b.unschedule(npfcArchive.tick);await b.stop({graceful:false});}
});
test('source coordinators retain legacy unfinished and unknown evidence without blocking a proven unrelated source',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'source-coordinator-')),root=path.join(dir,'fishery-column-progress'),id='legacy-npfc-original';
 await mkdir(path.join(root,'rounds',id),{recursive:true});await mkdir(path.join(root,'lock'));
 const manifest=path.join(root,'rounds',id,'manifest.json');
 await writeFile(manifest,JSON.stringify({storage:'db',version:'fishery-column-round/1',id,columns:['npfc'],limit:1,maxPages:1,startedAt:new Date().toISOString(),finishedAt:null,status:'running',outcome:null,sources:[],recoveries:[]}));
 await writeFile(path.join(root,'lock','owner.json'),JSON.stringify({roundId:id}));await writeFile(path.join(root,'active-round.json'),JSON.stringify({roundId:id}));
 const m=await columnProgressCoordinator(dir,['moa'],'db','new-mara');assert.equal(m.directory,path.join(root,'sources','moa'));
 await assert.rejects(columnProgressCoordinator(dir,['npfc'],'db','new-npfc'),/Unfinished round/);
 await assert.rejects(columnProgressCoordinator(dir,['moa','npfc'],'db','new-both'),/Unfinished round/);
 assert.equal((await columnProgressCoordinator(dir,['npfc'],'db',id,true)).directory,root);
 await rm(manifest);await assert.rejects(columnProgressCoordinator(dir,['moa'],'db','new-mara'),/Unknown archive coordinator/);
 assert.equal((await columnProgressCoordinator(dir,['npfc'],'db',id,true,true)).directory,root);
 const completed={storage:'db',version:'fishery-column-round/1',id,columns:['npfc'],limit:1,maxPages:1,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),status:'finished',outcome:'success',sources:[],recoveries:[]};
 await writeFile(manifest,JSON.stringify(completed));const owner=await readFile(path.join(root,'lock','owner.json'),'utf8');
 await assert.rejects(collectColumnRound({id,dataDir:dir,columns:['npfc'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,resume:{acknowledgeStopped:true,reason:'x'},fetch:async()=>{throw new Error('no GET');}}));
 assert.equal(await readFile(path.join(root,'lock','owner.json'),'utf8'),owner);
 const replay=await collectColumnRound({id,dataDir:dir,columns:['npfc'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,resume:{acknowledgeStopped:true,reason:'Synthetic stopped runner after completed journal'},fetch:async()=>{throw new Error('no GET');}});assert.equal(replay.status,'finished');await assert.rejects(readFile(path.join(root,'lock','owner.json')),{code:'ENOENT'});await assert.rejects(readFile(path.join(root,'active-round.json')),{code:'ENOENT'});
 await rm(dir,{recursive:true});
});
test('real scheduled NPFC validation rechecks the same PDF with 304 and never creates duplicate observations or paid work',{timeout:240000},async()=>{
 await archiveFixture();const id='fishery-column-npfc',url='https://www.npfc.int/cmm-2026-01-scheduled-fixture',pdfUrl='https://www.npfc.int/system/files/2026-04/scheduled-fixture.pdf',title='CMM 2026-01 Synthetic scheduled fixture',pdf=pdfFixture(false,false,'CMM 2026-01 Synthetic scheduled fixture.');
 await sql`DELETE FROM settings WHERE key=${npfcArchive.key}`;
 await sql`INSERT INTO sources(id,name,kind,enabled,cursor) VALUES(${id},'Synthetic scheduled NPFC','external',false,'{}') ON CONFLICT(id) DO UPDATE SET kind='external',enabled=false,participation_mode='editorial',cursor='{}',fail_count=0,last_error=NULL,last_fetch_at=NULL,last_ok_at=NULL,next_fetch_at=NULL`;
 await sql`DELETE FROM fetch_runs WHERE source_id=${id} AND detail ? 'fisheryColumnRound'`;
 const listing=Buffer.from(`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`),landing=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdfUrl}">PDF</a></span></div></div>`);
 const before=await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`;
 const b=new PgBoss({connectionString:process.env.DATABASE_URL,schema:'npfc_real_tick',schedule:true,supervise:false,cronMonitorIntervalSeconds:1}),statuses:number[]=[];b.on('error',()=>{});
 try{
  const c=await npfcArchive.configureArchive({enabled:true,mode:'validation',runId:'npfc-real-scheduler',intervalSeconds:10});
  await b.start();await npfcArchive.registerArchiveWorker(b,{cron:'* * * * * *',pollingIntervalSeconds:0.5,wait:async()=>{},fetch:async(input,options)=>{
   const status=input===pdfUrl&&options?.headers?.['if-none-match']?304:200;if(input===pdfUrl)statuses.push(status);
   return {url:input,status,headers:{get:name=>name==='etag'&&input===pdfUrl?'"synthetic-scheduled-v1"':null},body:status===304?Buffer.alloc(0):input.endsWith('/robots.txt')?npfcRobotsFixture:input===COLUMNS.npfc.url?listing:input===url?landing:pdf};
  }});
  // pg-boss intentionally throttles each cron identity to one occurrence per minute, even
  // with a seconds field; allow two real slots plus the complete PDF reparse/import.
  try{await untilArchive(async()=>{const s=await npfcArchive.archiveStatus();return s.validationClaimed===2&&s.currentRound===null&&!!s.pausedReason;},210000);}
  catch(error){throw new Error(JSON.stringify({message:String(error),statuses,status:await npfcArchive.archiveStatus(),jobs:await sql`SELECT name,state,output FROM npfc_real_tick.job`,runs:await sql`SELECT status,error,detail FROM job_runs WHERE job=${npfcArchive.queue}`}),{cause:error});}
  assert.deepEqual(statuses,[200,304]);const [d]=await sql`SELECT id FROM fishery_documents WHERE canonical_url=${url}`;assert.ok(d);
  const detail=await materialDetail(d.id);assert.equal(detail.state,'pending');assert.ok(detail.latest);assert.equal(detail.latest.revision,1);assert.equal(detail.observations.length,1);assert.equal(detail.reviews.length,0);
  assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows,(SELECT count(*) FROM publications) AS publications`,before);
  const again=await npfcArchive.configureArchive({enabled:true,mode:'validation',runId:c.runId,intervalSeconds:10});assert.equal(again.claimed,2);assert.equal(again.revision,c.revision);assert.ok('skipped' in await npfcArchive.archiveTick(b,c.revision));assert.deepEqual(statuses,[200,304]);
 }finally{await b.stop({graceful:false});await sql`DELETE FROM settings WHERE key=${npfcArchive.key}`;}
});
test('archive consumer waits for dispatch lease release without claiming again or retrying any started GET',async()=>{
 await archiveFixture();const c=await configureArchive({enabled:true,mode:'validation',runId:'dispatch-lease-race',intervalSeconds:10});
 await sql`UPDATE settings SET value=jsonb_set(value,'{nextAt}',${sql.json('2099-01-01T00:00:00Z')}) WHERE key=${ARCHIVE_KEY}`;
 const b=new PgBoss({connectionString:process.env.DATABASE_URL,schema:'archive_dispatch_race',schedule:false,supervise:false});b.on('error',()=>{});let gets=0;
 try{
  await b.start();await registerArchiveWorker(b,{pollingIntervalSeconds:0.5,wait:async()=>{},fetch:async url=>{gets++;return {url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([89]):archiveBody(89)};}});
  let roundId='';await withColumnLease('moa',async()=>{await dueArchive();const job=await archiveTick(b,c.revision);assert.ok('roundId' in job);roundId=(job as {roundId:string}).roundId;await new Promise(r=>setTimeout(r,1200));assert.equal(gets,0,'consumer cannot GET while dispatcher still owns the source lease');});
  await untilArchive(async()=>(await archiveStatus()).lastRound===roundId);assert.equal(gets,3);assert.equal((await archiveStatus()).validationClaimed,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM archive_dispatch_race.job WHERE name=${ARCHIVE_QUEUE}`)[0].n,1);
 }finally{await b.stop({graceful:false});}
});
let archivePreviousDataDir:string|undefined;
afterEach(()=>{if(archivePreviousDataDir){config.dataDir=archivePreviousDataDir;archivePreviousDataDir=undefined;}});
async function archiveFixture(){
  archivePreviousDataDir??=config.dataDir;config.dataDir=await mkdtemp(path.join(tmpdir(),"archive-worker-"));
  // All fixtures are in this test file's isolated database; reuse rather than remove referenced sources.
  await sql`DELETE FROM settings WHERE key=${ARCHIVE_KEY}`;
  await sql`DELETE FROM fetch_runs WHERE source_id=${bridgeSource} AND detail ? 'fisheryColumnRound'`;
  await sql`INSERT INTO sources(id,name,kind,enabled,cursor) VALUES (${bridgeSource},'archive fixture','external',false,'{}')
    ON CONFLICT(id) DO UPDATE SET kind='external',config='{}',enabled=false,cursor='{}',fail_count=0,last_error=NULL,last_fetch_at=NULL,last_ok_at=NULL,next_fetch_at=NULL`;
}
async function dueArchive(){await sql`UPDATE settings SET value=jsonb_set(value,'{nextAt}',${sql.json('2020-01-01T00:00:00.000Z')}) WHERE key=${ARCHIVE_KEY}`;await sql`UPDATE sources SET next_fetch_at='2020-01-01' WHERE id=${bridgeSource}`;}
async function testArchiveBoss(){const b=new PgBoss({connectionString:process.env.DATABASE_URL,schema:'archive_test_boss',schedule:false,supervise:false});b.on('error',()=>{});await b.start();await b.createQueue(ARCHIVE_QUEUE,{policy:'short',retryLimit:0});return b;}
async function claimArchive(b:PgBoss,revision:string){const claimed=await archiveTick(b,revision);assert.ok('roundId' in claimed);await b.fetch(ARCHIVE_QUEUE);await b.complete(ARCHIVE_QUEUE,(claimed as {jobId:string}).jobId);return {revision,roundId:(claimed as {roundId:string}).roundId};}
test('continuous news imports five then sixth into core material without approval, model or publication',async()=>{
  await archiveFixture();const b=await testArchiveBoss();let gets=0;
  const mock:import('../backend/column-batches.ts').ColumnFetcher=async url=>{gets++;return {url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([1,2,3,4,5,6]):archiveBody(Number(/_(\d+)\.htm/.exec(url)![1])-97000)};};
  const [before]=await sql`SELECT (SELECT count(*) FROM articles) AS articles,(SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_reviews) AS reviews,(SELECT count(*) FROM publications) AS publications,(SELECT count(*) FROM fishery_flow_tasks) AS flows`;
  try{
    const c=await configureArchive({enabled:true,mode:'validation',runId:'local-two-rounds',intervalSeconds:10});
    const j1=await claimArchive(b,c.revision);await runArchiveJob(j1,{fetch:mock,wait:async()=>{}});const n=gets;await runArchiveJob(j1,{fetch:mock});assert.equal(gets,n);
    let s=await archiveStatus();assert.equal(s.pendingCandidates,1);assert.equal(s.coreSourceEnabled,false);
    // Simulate a worker restart: another producer instance reads the same persisted state/claim bound.
    await dueArchive();const j2=await claimArchive(b,c.revision);await runArchiveJob(j2,{fetch:mock,wait:async()=>{}});
    s=await archiveStatus();assert.equal(s.validationClaimed,2);assert.match(s.pausedReason!,/two-round/);assert.equal(s.pendingCandidates,0);
    await dueArchive();assert.ok('skipped' in await archiveTick(b,c.revision));const secondGets=gets;assert.ok(secondGets>=n+3&&secondGets<=n+7,'one new article plus bounded revision checks');
    const docs=await sql`SELECT d.id,o.revision,r.id AS review FROM fishery_documents d JOIN fishery_observations o ON o.document_id=d.id LEFT JOIN fishery_reviews r ON r.document_id=d.id WHERE d.canonical_url=${archiveUrl(6)}`;assert.equal(docs.length,1);assert.equal(docs[0].revision,1);assert.equal(docs[0].review,null);
    const [after]=await sql`SELECT (SELECT count(*) FROM articles) AS articles,(SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_reviews) AS reviews,(SELECT count(*) FROM publications) AS publications,(SELECT count(*) FROM fishery_flow_tasks) AS flows`;assert.equal(after.articles,before.articles+6);assert.deepEqual({...after,articles:before.articles},before);
    const bad=await sql`SELECT name FROM archive_test_boss.job WHERE name ~ 'analyze|translate|report|flow|publication'`;assert.equal(bad.length,0);
    const hourly=await configureArchive({enabled:true,mode:'hourly',runId:'hourly-followup'});assert.ok(Date.parse(hourly.nextAt!)>Date.now()+3500_000);
    await runArchiveJob(j2,{fetch:mock});assert.equal(gets,secondGets);assert.ok('skipped' in await archiveTick(b,c.revision));
  }finally{await b.stop({graceful:false});}
});
test('continuous archive retains partial progress and discovers new news through recurring bad bodies',async()=>{
  await archiveFixture();const b=await testArchiveBoss();let gets=0;
  try{
    const c=await configureArchive({enabled:true,mode:'hourly',runId:'partial-body-isolation'});
    for(let i=0;i<4;i++){
      await dueArchive();const job=await claimArchive(b,c.revision),fresh=10+i;
      await runArchiveJob(job,{wait:async()=>{},fetch:async url=>{gets++;return {url,status:url.endsWith('robots.txt')?404:200,body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([fresh,99,...Array.from({length:i},(_,n)=>10+n)]):url===archiveUrl(99)?Buffer.from('<html>missing article body</html>'):archiveBody(Number(/_(\d+)\.htm/.exec(url)![1])-97000),headers:{get:()=> 'text/html'}};}});
      const [after]=await sql`SELECT cursor,last_ok_at,fail_count FROM sources WHERE id=${bridgeSource}`;
      assert.equal(after.fail_count,0);assert.ok(after.last_ok_at);assert.ok(after.cursor[COLUMN_CURSOR_KEY].completedUrls.includes(archiveUrl(fresh)));
      assert.ok(after.cursor[COLUMN_CURSOR_KEY].retryUrls.includes(archiveUrl(99)));
      assert.ok((await sql`SELECT id FROM fishery_documents WHERE canonical_url=${archiveUrl(fresh)}`).length);
      const count=gets;await runArchiveJob(job,{fetch:async()=>{throw new Error('duplicate job must not fetch');}});assert.equal(gets,count);
    }
    const status=await archiveStatus();assert.equal(status.enabled,true);assert.equal(status.consecutiveFailures,0);assert.equal(status.pausedReason,null);
    assert.equal(status.bodyFailures,1);assert.ok(status.lastBodySuccessAt);assert.ok(status.lastListingSuccessAt);
  }finally{await b.stop({graceful:false});}
});
test('continuous archive pauses after three actual listing failures and never retries the same job',async()=>{
  await archiveFixture();const b=await testArchiveBoss();let gets=0;
  try{
    const c=await configureArchive({enabled:true,mode:'hourly',runId:'three-listing-failures'});
    for(let i=0;i<3;i++){
      await dueArchive();const job=await claimArchive(b,c.revision);
      await runArchiveJob(job,{wait:async()=>{},fetch:async url=>{gets++;return {url,status:url.endsWith('robots.txt')?404:503,body:Buffer.from('Unavailable listing'),headers:{get:()=> 'text/html'}};}});
      const [after]=await sql`SELECT cursor,fail_count FROM sources WHERE id=${bridgeSource}`;assert.deepEqual(after.cursor,{});assert.equal(after.fail_count,i+1);
      const count=gets;await runArchiveJob(job,{fetch:async()=>{throw new Error('duplicate job must not fetch');}});assert.equal(gets,count);
    }
    const status=await archiveStatus();assert.equal(status.enabled,false);assert.equal(status.consecutiveFailures,3);assert.match(status.pausedReason!,/Three consecutive/);
    assert.ok('skipped' in await archiveTick(b,c.revision));
  }finally{await b.stop({graceful:false});}
});
test('all DB archive entry points share source lease and lost owner cannot archive response or commit source/import',async()=>{
  await archiveFixture();const lease=await acquireColumnLease('moa');
  try{await assert.rejects(acquireColumnLease('moa'),/lease unavailable/);await assert.rejects(collectColumnRound({id:'conflicting-cli',dataDir:config.dataDir,columns:['moa'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,fetch:async()=>{throw new Error('never GET');}}),/lease unavailable/);}finally{await lease.release();}
  let releaseResponse:()=>void=()=>{},entered:()=>void=()=>{};const waiting=new Promise<void>(r=>entered=r),response=new Promise<void>(r=>releaseResponse=r);let oldPid=0;
  const task=withColumnLease('moa',async owner=>{oldPid=owner.backendPid;return collectColumnRound({id:'lease-response-loss',dataDir:config.dataDir,columns:['moa'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,wait:async()=>{},fetch:async(url,options)=>{entered();await Promise.race([response,new Promise((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(options.signal!.reason),{once:true}))]);return {url,status:404,body:Buffer.from('must never persist after lease loss'),headers:{get:()=> 'text/html'}};}});});
  await waiting;await sql`SELECT pg_terminate_backend(${oldPid})`;releaseResponse();await assert.rejects(task,/lease|connection/i);
  const [s]=await sql`SELECT cursor,fail_count FROM sources WHERE id=${bridgeSource}`;assert.deepEqual(s.cursor,{});assert.equal(s.fail_count,0);
  const newOwner=await acquireColumnLease('moa');try{await newOwner.assertHeld();}finally{await newOwner.release();}
  await assert.rejects(collectColumnRound({id:'new-owner-round',dataDir:config.dataDir,columns:['moa'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,fetch:async()=>{throw new Error('no HTTP until reconciliation');}}),/Unfinished round|Collection lock held/);
});
test('archive profile refuses unknown schedules without deleting them',async()=>{
  const b=await testArchiveBoss();try{await b.createQueue('foreign.schedule');await b.schedule('foreign.schedule','0 * * * *');await assert.rejects(assertArchiveSchedules(b),/foreign.schedule/);assert.ok((await b.getSchedules()).some(s=>s.name==='foreign.schedule'));await b.unschedule('foreign.schedule');}finally{await b.stop({graceful:false});}
});
async function untilArchive(check:()=>Promise<boolean>,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Archive condition timed out');}
test('real pg-boss scheduled tick dispatches a single archive source consumer and persists a pending material',async()=>{
  await archiveFixture();await configureArchive({enabled:true,mode:'validation',runId:'actual-scheduler',intervalSeconds:10});
  const b=new PgBoss({connectionString:process.env.DATABASE_URL,schema:'archive_real_tick',schedule:true,supervise:false,cronMonitorIntervalSeconds:1});b.on('error',()=>{});let calls=0;
  try{await b.start();await registerArchiveWorker(b,{cron:'* * * * * *',pollingIntervalSeconds:0.5,wait:async()=>{},fetch:async url=>{calls++;return {url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([20]):archiveBody(20)};}});
    await untilArchive(async()=>!!(await archiveStatus()).lastRound);
    const schedules=await b.getSchedules();assert.equal(schedules.length,1);assert.equal(schedules[0].name,ARCHIVE_TICK);assert.equal(calls,3);
    const [material]=await sql`SELECT d.id,r.id AS review FROM fishery_documents d LEFT JOIN fishery_reviews r ON r.document_id=d.id WHERE d.canonical_url=${archiveUrl(20)}`;assert.ok(material.id);assert.equal(material.review,null);
    const jobs=await sql`SELECT name,state,retry_limit FROM archive_real_tick.job WHERE name IN (${ARCHIVE_TICK},${ARCHIVE_QUEUE})`;assert.ok(jobs.some(j=>j.name===ARCHIVE_TICK));assert.ok(jobs.some(j=>j.name===ARCHIVE_QUEUE));assert.ok(jobs.every(j=>j.retry_limit===0));
  }finally{await b.stop({graceful:false});}
});
test('explicit recovery handles queued and pre-manifest stopped rounds; disable preserves unresolved evidence and validation budget',async()=>{
  const b=await testArchiveBoss();
  try{for(const stage of ['queued','collecting']){
    await archiveFixture();const c=await configureArchive({enabled:true,mode:'validation',runId:`recover-${stage}`,intervalSeconds:10}),job=await claimArchive(b,c.revision);
    if(stage==='collecting')await sql`UPDATE settings SET value=jsonb_set(value,'{current,stage}','"collecting"') WHERE key=${ARCHIVE_KEY}`;
    const same=await configureArchive({enabled:true,mode:'validation',runId:`recover-${stage}`,intervalSeconds:10});assert.equal(same.revision,c.revision);assert.equal(same.claimed,1);
    const disabled=await configureArchive({enabled:false,mode:'validation',runId:`recover-${stage}`});assert.equal(disabled.current!.id,job.roundId);assert.equal(disabled.claimed,1);assert.equal((await archiveStatus()).enabled,false);
    await configureArchive({enabled:true,mode:'validation',runId:`recover-${stage}`,intervalSeconds:10});
    const coordinator=path.join(config.dataDir,'fishery-column-progress',...(stage==='queued'?['sources','moa']:[]));await mkdir(coordinator,{recursive:true});await writeFile(path.join(coordinator,'active-round.json'),JSON.stringify({roundId:job.roundId}));
    const result=await reconcileArchive('Synthetic stopped runner before its first journal/GET',{wait:async()=>{},fetch:async url=>({url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([stage==='queued'?30:31]):archiveBody(30)})});
    assert.equal(result.round.id,job.roundId);assert.equal(result.round.outcome,'success');assert.equal((await archiveStatus()).currentRound,null);assert.equal((await archiveStatus()).validationClaimed,1);assert.equal((await archiveStatus()).pausedReason,null);
  }}finally{await b.stop({graceful:false});}
});
test('interrupted child remains unchanged while explicit reconciliation closes failed round without importing running batch',async()=>{
  await archiveFixture();const b=await testArchiveBoss();let roundId='';
  try{const c=await configureArchive({enabled:true,mode:'validation',runId:'interrupted-child',intervalSeconds:10}),job=await claimArchive(b,c.revision);roundId=job.roundId;
    // The source transaction has not settled; a real running child is retained as recovery evidence.
    await assert.rejects(withColumnLease('moa',async lease=>{return runArchiveJob(job,{wait:async()=>{},fetch:async()=>{await sql`SELECT pg_terminate_backend(${lease.backendPid})`;throw new Error('synthetic killed lease during GET');}});}),/lease|connection/i);
    assert.match((await archiveStatus()).pausedReason!,/reconciliation/);
    const child=path.join(config.dataDir,'fishery-batches',`${roundId}-moa-p0`,'manifest.json'),before=await readFile(child,'utf8');
    const result=await reconcileArchive('Synthetic previous runner terminated and its child GET remains unknown',{fetch:async()=>{throw new Error('recovery may not GET');}});
    assert.equal(result.round.outcome,'failure');assert.deepEqual(result.retainedInterrupted,[`${roundId}-moa-p0`]);assert.equal(await readFile(child,'utf8'),before);assert.equal((await archiveStatus()).currentRound,null);
    assert.equal((await sql`SELECT id FROM job_runs WHERE job=${ARCHIVE_QUEUE} AND status='running' AND detail->>'roundId'=${roundId}`).length,0);
  }finally{await b.stop({graceful:false});}
});
import {spawn} from 'node:child_process';
test('actual worker main archive profile starts and restarts without full consumers or foreign cron cleanup',async()=>{
  await archiveFixture();const c=await configureArchive({enabled:true,mode:'hourly',runId:'entry-profile-test'});
  await sql`INSERT INTO settings(key,value) VALUES(${npfcArchive.key},'{"synthetic_invalid":true}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  await sql`UPDATE settings SET value=jsonb_set(value,'{nextAt}',${sql.json('2099-01-01T00:00:00.000Z')}) WHERE key=${ARCHIVE_KEY}`;
  const b=new PgBoss({connectionString:process.env.DATABASE_URL,schema:'pgboss',schedule:false,supervise:false});b.on('error',()=>{});await b.start();
  const names=['content.analyze','content.translate','reports.compose','cron.ops.recover'];const ids:string[]=[];
  for(const name of names){await b.createQueue(name,{retryLimit:0});ids.push((await b.send(name,{articleId:'must-stay-unconsumed'}))!);}
  const entry=path.resolve('apps/worker/src/main.ts'),children=new Set<ReturnType<typeof spawn>>();
  const launch=async()=>{let output='';const child=spawn(process.execPath,[entry],{cwd:path.resolve('.'),env:{...process.env,WORKER_PROFILE:'fishery-archive',MODEL_CALLS_ENABLED:'false',COLLECT_ENABLED:'false',AIHOT_DATA_DIR:config.dataDir,AIHOT_CREDENTIALS_DIR:'/nonexistent-test-credentials'},stdio:['ignore','pipe','pipe']});children.add(child);child.once('exit',()=>children.delete(child));child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);await untilArchive(async()=>{if(child.exitCode!==null)throw new Error(output);return output.includes('worker started');});return child;};
  try{for(let i=0;i<2;i++){const child=await launch();await new Promise(r=>setTimeout(r,600));const jobs=await sql`SELECT name,state FROM pgboss.job WHERE id IN ${sql(ids)}`;assert.equal(jobs.length,4);assert.ok(jobs.every(j=>j.state==='created'));assert.deepEqual((await b.getSchedules()).map(s=>s.name),[ARCHIVE_TICK]);assert.ok((await sql`SELECT key FROM settings WHERE key='heartbeat.worker.fishery-archive'`).length);if(i===0){
      const abandoned=await b.send(ARCHIVE_TICK,{revision:c.revision},{retryLimit:0});const held=await b.fetch(ARCHIVE_TICK);assert.equal(held[0].id,abandoned);
      child.kill('SIGKILL');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));
      await sql`UPDATE pgboss.job SET started_on='2020-01-01',expire_seconds=1 WHERE id=${abandoned!}`;await sql`UPDATE pgboss.queue SET monitor_claim_on='2020-01-01' WHERE name=${ARCHIVE_TICK}`;
    }else{const expired=await sql`SELECT state FROM pgboss.job WHERE name=${ARCHIVE_TICK} AND started_on='2020-01-01'`;assert.ok(expired.every(j=>j.state==='failed'));
      await sql`UPDATE sources SET last_fetch_at=now() WHERE id=${bridgeSource}`;
      const switched=await configureArchive({enabled:true,mode:'hourly',runId:'entry-profile-switched'});
      await untilArchive(async()=>(await b.getSchedules()).some(s=>(s.data as {revision?:string}).revision===switched.revision),20000);
      child.kill('SIGTERM');await new Promise<void>((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error('archive child exit '+code)));});}}
    assert.equal((await archiveStatus()).validationClaimed,null);assert.equal((await archiveStatus()).runId,'entry-profile-switched');
    assert.ok((await sql`SELECT id FROM job_runs WHERE job=${npfcArchive.queue+'.worker'} AND status='failed'`).length,'NPFC configuration failure is visible without preventing MARA startup/restart');
  }finally{for(const child of children)child.kill('SIGKILL');await sql`DELETE FROM settings WHERE key=${npfcArchive.key}`;await b.stop({graceful:false});}
});
test('queued archive rechecks core source changes and failure pause before GET; disable remains available',async()=>{
  await archiveFixture();const b=await testArchiveBoss();try{const c=await configureArchive({enabled:true,mode:'validation',runId:'handler-source-guard',intervalSeconds:10}),job=await claimArchive(b,c.revision);
    await sql`UPDATE sources SET enabled=true WHERE id=${bridgeSource}`;let gets=0;const result=await runArchiveJob(job,{fetch:async()=>{gets++;throw new Error('no GET');}});assert.ok('skipped' in result);assert.equal(gets,0);assert.match((await archiveStatus()).pausedReason!,/disabled/);
    const stopped=await configureArchive({enabled:false,mode:'validation',runId:c.runId});assert.equal(stopped.enabled,false);assert.equal(stopped.current!.id,job.roundId);assert.equal(stopped.claimed,1);
    for(const condition of ['three-failures','backoff']){
      await archiveFixture();const next=await configureArchive({enabled:true,mode:'validation',runId:`handler-${condition}`,intervalSeconds:10}),queued=await claimArchive(b,next.revision);
      await sql`UPDATE sources SET fail_count=${condition==='three-failures'?3:1},last_error='synthetic between tick and consumer',next_fetch_at=now()+interval '1 hour' WHERE id=${bridgeSource}`;
      const blocked=await runArchiveJob(queued,{fetch:async()=>{gets++;throw new Error('no GET');}});assert.ok('skipped' in blocked);assert.equal(gets,0);
      if(condition==='three-failures')assert.match((await archiveStatus()).pausedReason!,/Three consecutive/);else assert.equal((await archiveStatus()).currentRound,null);
    }
  }finally{await sql`UPDATE sources SET enabled=false WHERE id=${bridgeSource}`;await b.stop({graceful:false});}
});
test('lease loss after journal temporary write blocks rename and preserves explicit recovery evidence',async()=>{
  await archiveFixture();const id='journal-rename-loss';let gets=0;
  await assert.rejects(withColumnLease('moa',async lease=>collectColumnRound({id,dataDir:config.dataDir,columns:['moa'],limit:1,maxPages:1,storage:'db',store:columnDbProgress,checkpoint:async stage=>{if(stage==='before-journal-rename')await sql`SELECT pg_terminate_backend(${lease.backendPid})`;},fetch:async()=>{gets++;throw new Error('no GET');}})),/lease|connection/i);
  assert.equal(gets,0);await assert.rejects(readFile(path.join(config.dataDir,'fishery-column-progress','rounds',id,'manifest.json'),'utf8'),{code:'ENOENT'});
  const [s]=await sql`SELECT cursor,fail_count FROM sources WHERE id=${bridgeSource}`;assert.deepEqual(s.cursor,{});assert.equal(s.fail_count,0);
  assert.ok(JSON.parse(await readFile(path.join(config.dataDir,'fishery-column-progress/sources/moa/lock/owner.json'),'utf8')).roundId===id);
});
test('child directory without first manifest is retained and settled once without GET or import; next round uses unchanged cursor',async()=>{
  await archiveFixture();const b=await testArchiveBoss();let gets=0;
  try{
    const c=await configureArchive({enabled:true,mode:'validation',runId:'child-before-manifest',intervalSeconds:10}),job=await claimArchive(b,c.revision);
    const childId=`${job.roundId}-moa-p0`,childDir=path.join(config.dataDir,'fishery-batches',childId),sentinel=Buffer.from('ISOLATED TEST FIXTURE partial raw evidence before first child manifest');
    const [before]=await sql`SELECT cursor::text AS bytes,last_ok_at FROM sources WHERE id=${bridgeSource}`;
    const [observed]=await sql`SELECT count(*) AS count FROM fishery_observations`;
    await sql`UPDATE settings SET value=jsonb_set(value,'{current,stage}','"collecting"') WHERE key=${ARCHIVE_KEY}`;
    await sql`INSERT INTO job_runs(job,detail) VALUES (${ARCHIVE_QUEUE},${sql.json({roundId:job.roundId,revision:c.revision})})`;
    let injected=false;
    await assert.rejects(collectColumnRound({id:job.roundId,dataDir:config.dataDir,columns:['moa'],limit:5,maxPages:1,storage:'db',store:columnDbProgress,fetch:async()=>{gets++;throw new Error('no initial GET');},checkpoint:async stage=>{
      if(stage!=='before-journal-rename'||injected)return;
      const intent=await sql`SELECT id FROM fetch_runs WHERE source_id=${bridgeSource} AND detail->'fisheryColumnRound'->>'roundId'=${job.roundId}`;
      if(!intent.length)return;
      injected=true;await mkdir(path.join(childDir,'raw'),{recursive:true});await mkdir(path.join(childDir,'body'));await writeFile(path.join(childDir,'raw','retained-partial.bin'),sentinel);
      throw new Error('Synthetic crash after child directories and before first manifest');
    }}),/before first manifest/);
    assert.equal(injected,true);assert.equal(gets,0);
    const result=await reconcileArchive('Synthetic previous worker stopped with a child directory but no child manifest',{fetch:async()=>{gets++;throw new Error('reconciliation must not GET');}});
    assert.equal(result.round.outcome,'failure');assert.deepEqual(result.retainedInterrupted,[childId]);assert.deepEqual(result.round.sources[0].retainedChildren,[{id:childId,reason:'missing_manifest'}]);assert.deepEqual(result.imports,[]);assert.equal(gets,0);
    await assert.rejects(readFile(path.join(childDir,'manifest.json')),{code:'ENOENT'});assert.deepEqual(await readFile(path.join(childDir,'raw','retained-partial.bin')),sentinel);
    const [after]=await sql`SELECT cursor::text AS bytes,last_ok_at,fail_count FROM sources WHERE id=${bridgeSource}`;assert.equal(after.bytes,before.bytes);assert.equal(after.last_ok_at,before.last_ok_at);assert.equal(after.fail_count,1);assert.equal((await sql`SELECT count(*) AS count FROM fishery_observations`)[0].count,observed.count);
    const [run]=await sql`SELECT status,found_count,new_count,detail FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId'=${job.roundId}`;assert.equal(run.status,'failed');assert.equal(run.found_count,0);assert.equal(run.new_count,0);assert.match(run.detail.fisheryColumnRound.after.health.reason,/without manifest/);
    assert.equal((await sql`SELECT id FROM job_runs WHERE job=${ARCHIVE_QUEUE} AND status='running' AND detail->>'roundId'=${job.roundId}`).length,0);
    await collectColumnRound({id:job.roundId,dataDir:config.dataDir,columns:['moa'],limit:5,maxPages:1,storage:'db',store:columnDbProgress,resume:{acknowledgeStopped:true,reason:'Synthetic finalized missing-manifest replay is read only'},fetch:async()=>{gets++;throw new Error('no replay GET');}});
    assert.equal(gets,0);assert.equal((await sql`SELECT fail_count FROM sources WHERE id=${bridgeSource}`)[0].fail_count,1);
    await dueArchive();const next=await claimArchive(b,c.revision);
    await runArchiveJob(next,{wait:async()=>{},fetch:async url=>{gets++;return {url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=> 'text/html'},body:url.endsWith('robots.txt')?Buffer.from('missing'):url===COLUMNS.moa.url?archiveListing([41]):archiveBody(41)};}});
    assert.equal(gets,3);assert.ok((await sql`SELECT id FROM fishery_documents WHERE canonical_url=${archiveUrl(41)}`).length);assert.deepEqual(await readFile(path.join(childDir,'raw','retained-partial.bin')),sentinel);
  }finally{await b.stop({graceful:false});}
});


test('NPFC verified new attachment bytes invalidate approved evidence when complete parsing fails',async()=>{
 const {prepareNpfc}=await import('../backend/npfc-columns.ts');
 const url='https://www.npfc.int/cmm-2026-09-changed-attachment-regression',pdfUrl='https://www.npfc.int/system/files/2026-10/changed-attachment.pdf',title='CMM 2026-09 Synthetic dependency regression',raw=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdfUrl}">PDF</a></span></div></div>`),oldPdf=Buffer.from('%PDF-synthetic-original-NPFC'),r={requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:sha256(raw)};
 const p=prepareNpfc({url,title,number:'2026-09',effectiveLiteral:null,listDate:null,priority:'direct'},r,raw,{bytes:oldPdf,receipt:{...r,requestedUrl:pdfUrl,finalUrl:pdfUrl,sha256:sha256(oldPdf)},parsed:{status:'parsed',rawSha256:sha256(oldPdf),parser:'synthetic-original/v1',pages:1,text:'--- Page 1 ---\nCMM 2026-09 Synthetic NPFC reference.'}});
 const first=await importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,{...observationFixture,originalTitle:title,title,rawSha256:p.sourceCapture.rawSha256,sourceCapture:p.sourceCapture,dates:p.dates},'tester');
 const [s]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-npfc'`;await approve(first.id,1,s.revision);
 const capture=(id:string,status:number)=>collectColumns({id,dataDir:config.dataDir,columns:['npfc'],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request===pdfUrl?status:200,headers:{get:()=>null},body:request.endsWith('/robots.txt')?npfcRobotsFixture:request===COLUMNS.npfc.url?Buffer.from(`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`):request===url?raw:status===200?pdfFixture(true):Buffer.from('not available')})});
 const missing=await capture('npfc-dependency-404',404);await importBatch(missing.id,'tester');assert.equal((await documentHistory(first.id)).observations.length,1);assert.equal((await materialDetail(first.id)).state,'approved','404 alone is not source withdrawal');
 const changed=await capture('npfc-dependency-new-scan',200);assert.equal(changed.items[0].state,'failed');const result=await importBatch(changed.id,'tester');assert.equal(result.rows.length,0);assert.equal(result.evidenceUpdates.length,1);
 const history=await documentHistory(first.id);assert.equal(history.observations.length,2);assert.equal(history.observations[1].payload.sourceCapture.parseStatus,'unverified');assert.notEqual((await materialDetail(first.id)).state,'approved');assert.equal(history.reviews.length,1);assert.equal(history.document.withdrawn_reason,null);
 await importBatch(changed.id,'tester');assert.equal((await documentHistory(first.id)).observations.length,2);
});


test('notice article flow keeps webpage and second attachment provenance through separate fake checks',async()=>{
 const {prepareNotice}=await import('../backend/fujian-notices.ts');
 const f=noticeFixture(),second=new URL('P0202507289999002.pdf',f.url).href;
 const raw=Buffer.from(f.landing().replace('</ul>','<li><a href="'+second+'">第二政策附件.pdf</a></li></ul>'));
 const receipt=(url:string,bytes:Buffer)=>({requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:sha256(bytes)});
 const attachments=[f.pdfUrl,second].map((url,i)=>{const bytes=Buffer.from('%PDF-offline-notice-'+i),text='--- Page 1 ---\n'+(i?'NPFC synthetic far fishing second attachment.':'NPFC synthetic first attachment.');return {receipt:receipt(url,bytes),bytes,parsed:{status:'parsed' as const,rawSha256:sha256(bytes),parser:'offline-fixture/v1',pages:1,text}};});
 const p=prepareNotice(receipt(f.url,raw),raw,attachments);assert.equal(p.readyForReview,true);
 const doc=await importCapturedMaterial({id:'fujian-notices',...COLUMNS['fujian-notices']},f.url,{...observationFixture,originalTitle:p.title,title:p.title,rawSha256:p.sourceCapture.rawSha256,sourceCapture:p.sourceCapture,dates:p.dates},'tester');
 await upsertMaterial({sourceId:'fishery-column-fujian-notices',url:f.url,title:f.title,bodyText:p.body!,bodyStatus:'ok',via:'offline-fixture',raw:{fisheryDocumentId:doc.id}});
 const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-fujian-notices'`;await approve(doc.id,doc.revision,source.revision);
 const task=await createFlow(doc.id,{identity:'notice-two-pdf-flow'},'tester');let sends=0;
 const result=await runFlow(task.id,async(q:any)=>{
  sends++;const source=JSON.parse(String(q.user)),catalog=(q.purpose==='fishery_draft'?source:source.source).evidenceCatalog;
  assert.equal(catalog.version,'fishery-spans-v3-sections');
  const span=catalog.spans.find((s:any)=>s.source?.id==='attachment-2');assert.equal(span.source.url,second);assert.equal(span.page,1);
  const e=[span.id],u={date:{precision:'unknown',value:null},evidence:[]};
  const wire=q.purpose==='fishery_draft'?{relevance:{decision:'relevant',reason:'Synthetic reference only',evidence:e},summaryZh:[{sentence:span.quote,evidence:e}],dates:{published:u,event:u,adopted:u,effective:u,objectionDeadline:u},entryIntoForce:{value:'unknown',evidence:[]},eventStatus:{value:'unknown',evidence:[]},validityStatus:'unknown',locations:[],organizations:[],uncertainties:[]}:{decision:'supported',coverage:'complete_input',findings:[{field:'summaryZh.0',verdict:'supported',reason:'Synthetic second attachment evidence',evidence:e},{field:'relevance',verdict:'supported',reason:'Synthetic relevance',evidence:e}]};
  return {data:q.schema.parse(wire),receiptId:999999,model:'offline-fake',usage:null,reused:false};
 });
 assert.equal(sends,2);assert.equal(result.status,'needs_human_review',JSON.stringify(result.error));
 assert.equal(result.draft.draft.summaryZh[0].evidence[0].source.url,second);assert.equal(result.internalArticle,null,'Separate final approval remains required');
 await decideFlow(task.id,{decision:'qualified',publication:'publish',snapshotHash:result.snapshotHash,note:'Synthetic final review of source-bound second attachment'},'authorized-agent:test');
 const readable=await readerItem(doc.id);assert.equal(readable.summary[0].evidence[0].url,second);assert.equal(readable.summary[0].evidence[0].page,1);assert.notEqual(readable.summary[0].evidence[0].url,f.pdfUrl,'Second attachment page1 cannot link the first PDF');
});

test('NPFC verified changed landing PDF URL invalidates old approval and qualified article even when PDF acquisition fails',async()=>{
 const {prepareNpfc}=await import('../backend/npfc-columns.ts');
 for(const failure of ['404','timeout','nonpdf'] as const){
  const title='CMM 2026-09 Synthetic URL dependency regression',url=`https://www.npfc.int/cmm-2026-09-url-${failure}`,pdfA=`https://www.npfc.int/system/files/url-${failure}-a.pdf`,pdfB=`https://www.npfc.int/system/files/url-${failure}-b.pdf`,bytes=Buffer.from('%PDF-synthetic-original-NPFC'),fact='合成公海远洋渔业事实。',body=`--- Page 1 ---\nCMM 2026-09\n${fact}`;
  const landing=(pdf:string)=>Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdf}">PDF</a></span></div></div>`),raw=landing(pdfA),r={requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:sha256(raw)};
  const p=prepareNpfc({url,title,number:'2026-09',effectiveLiteral:null,listDate:null,priority:'direct'},r,raw,{bytes,receipt:{...r,requestedUrl:pdfA,finalUrl:pdfA,sha256:sha256(bytes)},parsed:{status:'parsed',rawSha256:sha256(bytes),parser:'synthetic-original/v1',pages:1,text:body}});
  const first=await importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,{...observationFixture,originalTitle:title,title,rawSha256:p.sourceCapture.rawSha256,sourceCapture:p.sourceCapture,dates:p.dates},'tester');
  await upsertMaterial({sourceId:'fishery-column-npfc',url,title,bodyText:body,bodyStatus:'ok',via:'offline-fixture',raw:{fisheryDocumentId:first.id}});
  const [s]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-npfc'`;await approve(first.id,1,s.revision);
  const date={date:{precision:'unknown',value:null},evidence:[]},evidence=['p2s1'];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==='fishery_draft'?{relevance:{decision:'relevant',reason:'Synthetic source evidence',evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:'unknown',evidence:[]},eventStatus:{value:'unknown',evidence:[]},validityStatus:'unknown',locations:[],organizations:[],uncertainties:[]}:{decision:'supported',coverage:'complete_input',findings:[{field:'summaryZh.0',verdict:'supported',reason:'Synthetic original sentence',evidence},{field:'relevance',verdict:'supported',reason:'Synthetic relevance evidence',evidence}]}),receiptId:999999,model:'mock',reused:false,usage:null});
  const task=await createFlow(first.id,{identity:'npfc-url-'+failure},'tester'),checked=await runFlow(task.id,invoke);assert.equal(checked.status,'needs_human_review');
  await decideFlow(task.id,{decision:'qualified',publication:'publish',snapshotHash:checked.snapshotHash,note:'Synthetic previous PDF approval'},'tester');assert.ok((await flowDetail(task.id)).internalArticle);
  const capture=(id:string,pdf:string)=>collectColumns({id,dataDir:config.dataDir,columns:['npfc'],limit:1,wait:async()=>{},fetch:async request=>{
   if(request===pdf&&failure==='timeout')throw new Error('Synthetic PDF timeout');
   return {url:request,status:request===pdf?(failure==='404'?404:200):200,headers:{get:()=>null},body:request.endsWith('/robots.txt')?npfcRobotsFixture:request===COLUMNS.npfc.url?Buffer.from(`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`):request===url?landing(pdf):Buffer.from('unavailable')};
  }});
  const same=await capture('npfc-same-url-'+failure,pdfA),unavailable=await importBatch(same.id,'tester');assert.equal(unavailable.evidenceUpdates.length,0);assert.equal(unavailable.acquisitions[0].confirmedChange,false);assert.equal((await documentHistory(first.id)).observations.length,1);assert.equal((await materialDetail(first.id)).state,'approved');assert.ok((await flowDetail(task.id)).internalArticle);
  const changed=await capture('npfc-new-url-'+failure,pdfB),result=await importBatch(changed.id,'tester');assert.equal(result.rows.length,0);assert.equal(result.evidenceUpdates.length,1);assert.equal(result.acquisitions[0].outcome,'unavailable');assert.equal(result.acquisitions[0].confirmedChange,true);
  const history=await documentHistory(first.id),latest=history.observations[1].payload.sourceCapture;assert.equal(history.observations.length,2);assert.equal(latest.attachmentUrl,pdfB);assert.equal(latest.attachmentSha256,null);assert.equal(latest.bodySha256,null);assert.equal(latest.parseStatus,'unverified');assert.equal((await materialDetail(first.id)).state,'unverified');assert.equal(history.reviews.length,1);assert.equal(history.reviews[0].revision,1);assert.equal(history.document.withdrawn_reason,null);assert.equal((await flowDetail(task.id)).stale,true);assert.equal((await flowDetail(task.id)).internalArticle,null);
  await importBatch(changed.id,'tester');assert.equal((await documentHistory(first.id)).observations.length,2);
 }
});

test('NPFC verified changed PDF bytes invalidate approval despite semantic measure or effective-date conflicts',async()=>{
 const {prepareNpfc}=await import('../backend/npfc-columns.ts');
 for(const conflict of ['measure','effective-date','landing-title'] as const){
  const title='CMM 2026-09 Synthetic semantic dependency (Effective date: 23 July 2026)',url=`https://www.npfc.int/cmm-2026-09-semantic-${conflict}`,pdfUrl=`https://www.npfc.int/system/files/semantic-${conflict}.pdf`,oldBytes=conflict==='landing-title'?pdfFixture(false,false,'CMM 2026-09 Entered into force 23 July 2026. Synthetic changed content.'):Buffer.from('%PDF-original-semantic-fixture'),fact='合成公海远洋渔业事实。',body=`--- Page 1 ---\nCMM 2026-09 ${fact}`;
  const raw=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdfUrl}">PDF</a></span></div></div>`),r={requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:sha256(raw)};
  const p=prepareNpfc({url,title,number:'2026-09',effectiveLiteral:'23 July 2026',listDate:null,priority:'direct'},r,raw,{bytes:oldBytes,receipt:{...r,requestedUrl:pdfUrl,finalUrl:pdfUrl,sha256:sha256(oldBytes)},parsed:{status:'parsed',rawSha256:sha256(oldBytes),parser:'synthetic-original/v1',pages:1,text:body}});
  const first=await importCapturedMaterial({id:'npfc',...COLUMNS.npfc},url,{...observationFixture,originalTitle:title,title,rawSha256:p.sourceCapture.rawSha256,sourceCapture:p.sourceCapture,dates:p.dates},'tester');
  await upsertMaterial({sourceId:'fishery-column-npfc',url,title,bodyText:body,bodyStatus:'ok',via:'offline-fixture',raw:{fisheryDocumentId:first.id}});
  const [s]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-npfc'`;await approve(first.id,1,s.revision);
  const date={date:{precision:'unknown',value:null},evidence:[]},evidence=['p2s1'];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==='fishery_draft'?{relevance:{decision:'relevant',reason:'Synthetic source evidence',evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:'unknown',evidence:[]},eventStatus:{value:'unknown',evidence:[]},validityStatus:'unknown',locations:[],organizations:[],uncertainties:[]}:{decision:'supported',coverage:'complete_input',findings:[{field:'summaryZh.0',verdict:'supported',reason:'Synthetic original sentence',evidence},{field:'relevance',verdict:'supported',reason:'Synthetic relevance evidence',evidence}]}),receiptId:999999,model:'mock',reused:false,usage:null});
  const task=await createFlow(first.id,{identity:'npfc-semantic-'+conflict},'tester'),checked=await runFlow(task.id,invoke);assert.equal(checked.status,'needs_human_review');await decideFlow(task.id,{decision:'qualified',publication:'publish',snapshotHash:checked.snapshotHash,note:'Synthetic previous measure approval'},'tester');assert.ok((await flowDetail(task.id)).internalArticle);
  const text=conflict==='measure'?'CMM 2025-08 Synthetic changed wrong measure.':conflict==='effective-date'?'CMM 2026-09 Entered into force 24 July 2026. Synthetic changed effective date.':'CMM 2026-09 Entered into force 23 July 2026. Synthetic changed content.',pdf=pdfFixture(false,false,text),newPdfUrl=conflict==='landing-title'?pdfUrl.replace('.pdf','-new.pdf'):pdfUrl;
  const capture=(id:string)=>collectColumns({id,dataDir:config.dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:async bytes=>({status:'parsed',rawSha256:sha256(bytes),parser:'synthetic-semantic/v1',pages:1,text:'--- Page 1 ---\n'+text}),fetch:async request=>({url:request,status:200,headers:{get:()=>null},body:request.endsWith('/robots.txt')?npfcRobotsFixture:request===COLUMNS.npfc.url?Buffer.from(`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`):request===url?(conflict==='landing-title'?Buffer.from(raw.toString().replace(title,'CMM 2025-08 Conflicting landing title').replace(pdfUrl,newPdfUrl)):raw):pdf})});
  for(const invalid of ['pdf-request','pdf-final','landing-final','landing-hash'] as const){
   const forged=await capture('npfc-semantic-forged-'+conflict+'-'+invalid),receiptFile=path.join(config.dataDir,'fishery-batches',forged.id,'raw',forged.items[0].archiveId+(invalid.startsWith('pdf-')?'-pdf':'')+'.receipt.json'),receipt=JSON.parse(await readFile(receiptFile,'utf8'));
   if(invalid==='pdf-request')receipt.requestedUrl='https://www.npfc.int/system/files/forged.pdf';else if(invalid==='landing-hash')receipt.sha256='f'.repeat(64);else receipt.finalUrl='https://www.npfc.int/cmm-forged';await writeFile(receiptFile,JSON.stringify(receipt));
   const rejected=await importBatch(forged.id,'tester');assert.equal(rejected.evidenceUpdates.length,0);assert.equal(rejected.acquisitions[0].confirmedChange,false);assert.equal((await documentHistory(first.id)).observations.length,1);assert.equal((await materialDetail(first.id)).state,'approved');assert.ok((await flowDetail(task.id)).internalArticle);
  }
  const changed=await capture('npfc-semantic-valid-'+conflict);assert.equal(changed.items[0].state,'failed');const imported=await importBatch(changed.id,'tester');assert.equal(imported.rows.length,0);assert.equal(imported.evidenceUpdates.length,1);assert.equal(imported.acquisitions[0].confirmedChange,true);
  const history=await documentHistory(first.id),latest=history.observations[1].payload.sourceCapture;assert.equal(history.observations.length,2);assert.equal(latest.attachmentSha256,sha256(pdf));assert.equal(latest.attachmentUrl,newPdfUrl);if(conflict==='landing-title')assert.equal(sha256(pdf),sha256(oldBytes),'A verified new PDF URL invalidates the dependency even when bytes match');assert.equal(latest.bodySha256,null);assert.equal(latest.parseStatus,'unverified');assert.match(latest.conflicts.join(';'),conflict==='measure'?/measure version/:conflict==='effective-date'?/effective dates/:/listing and landing title/);assert.equal((await materialDetail(first.id)).state,'unverified');assert.equal(history.reviews[0].revision,1);assert.equal(history.document.withdrawn_reason,null);assert.equal((await flowDetail(task.id)).stale,true);assert.equal((await flowDetail(task.id)).internalArticle,null);
 }
});


test('news structure receipt survives persistence failure and fact edits invalidate its review',async()=>{
  const d=await automaticFixture(73,'测试机构发布远洋船队申报安排，仅供隔离测试，不是真实新闻。');
  await sql`UPDATE articles SET url=(SELECT canonical_url FROM fishery_documents WHERE id=${d.id}),raw=raw||'{"mode":"verified-news-candidate"}'::jsonb WHERE raw->>'fisheryDocumentId'=${d.id}`;
  const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;await approve(d.id,1,source.revision);
  const task=await createFlow(d.id,{identity:'structure-recovery',selection:true},'tester'),sent:string[]=[],invoke=selectionMock(d.body,sent);
  await sql.unsafe(`CREATE FUNCTION structure_save_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${task.id}' AND OLD.stage='structure' AND NEW.stage='review' THEN RAISE EXCEPTION 'Synthetic structure persistence interruption'; END IF; RETURN NEW; END $$`);
  await sql.unsafe('CREATE TRIGGER structure_save_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION structure_save_fault()');
  try{
    const failed=await runFlow(task.id,invoke);assert.equal(failed.status,'failed');assert.equal(failed.stage,'structure');assert.equal(failed.error.phase,'persist');assert.equal(sent.length,5);
    await sql.unsafe('DROP TRIGGER structure_save_fault ON fishery_flow_tasks');
    await assert.rejects(retryFlow(task.id,{note:'Synthetic forbidden regeneration',mode:'regenerate',acknowledgeNewCharge:true},'tester'),/resume same attempt/);
    await retryFlow(task.id,{note:'Synthetic resume saved structure receipt'},'tester');
    const done=await runFlow(task.id,invoke);assert.equal(done.status,'needs_human_review',JSON.stringify(done.error));assert.equal(sent.length,6);assert.equal(sent.filter(s=>s==='structure').length,1);
    await decideFlow(task.id,{decision:'qualified',publication:'publish',snapshotHash:done.snapshotHash,note:'Synthetic current news approval'},'tester');
    await syncFisheryPublications('synthetic recovery projection',new Date(),{target:{kind:'article',id:d.id}});
    const [binding]=await sql`SELECT article_id,projection_hash,material_revision FROM fishery_publication_bindings WHERE item_id=${d.id}`;
    await sql`UPDATE fishery_flow_tasks SET selection=jsonb_set(selection,'{structure,result,fact,subject}','"Changed unsupported subject"') WHERE id=${task.id}`;
    assert.equal((await flowDetail(task.id)).reviewBound,false);
    await assert.rejects(decideFlow(task.id,{decision:'qualified',publication:'publish',snapshotHash:done.snapshotHash,note:'Must not approve altered fact'},'tester'),/Structured news identity/);
  }finally{await sql.unsafe('DROP TRIGGER IF EXISTS structure_save_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION structure_save_fault()');}
});


test('managed source status uses real cadence, effective filters and guarded core controls', async()=>{
  await archiveFixture();
  await configureArchive({enabled:true,mode:'hourly',runId:'reader-runtime-moa'});
  await sql`INSERT INTO sources(id,name,kind,enabled,participation_mode) VALUES('fishery-column-npfc','Synthetic NPFC runtime','external',false,'editorial') ON CONFLICT(id) DO UPDATE SET enabled=false,kind='external',participation_mode='editorial',fail_count=0,last_error=NULL`;
  await sql`DELETE FROM settings WHERE key=${npfcArchive.key}`;
  await npfcArchive.configureArchive({enabled:true,mode:'six_hourly',runId:'reader-runtime-npfc'});
  const all=await listSources({q:'fishery-column',enabled:'true'});
  assert.equal(all.rows.find(s=>s.id===bridgeSource)?.runtime?.intervalMinutes,60);
  assert.equal(all.rows.find(s=>s.id==='fishery-column-npfc')?.runtime?.intervalMinutes,360);
  assert.equal(all.rows.find(s=>s.id===bridgeSource)?.enabled,false,'Underlying external source stays disabled');
  assert.ok(all.totals.enabled>=2);
  const detail=await sourceDetail(bridgeSource);assert.equal(detail?.source.runtime?.enabled,true);
  await assert.rejects(updateSource(bridgeSource,{patch:{interval_minutes:30},version:new Date(detail!.source.updated_at).toISOString()},'tester'),/受控采集/);
  await assert.rejects(fetchNow(bridgeSource,'tester'),/受控采集/);
  await configureArchive({enabled:false,mode:'hourly',runId:'reader-runtime-moa'});
  assert.ok((await listSources({health:'paused'})).rows.some(s=>s.id===bridgeSource));
  assert.equal((await listSources({enabled:'true'})).rows.some(s=>s.id===bridgeSource),false);
});

import {businessMpaFixture} from './fixtures.ts';
test('business capture imports preserve approved unchanged originals and invalidate replaced required PDFs',async()=>{
 const f=businessMpaFixture(),capture=(id:string,mode='ok')=>collectColumns({id,dataDir:config.dataDir,columns:['mpa-port'],limit:1,wait:async()=>{},fetch:async url=>({url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=>null},body:Buffer.from(url.endsWith('robots.txt')?'missing':url===COLUMNS['mpa-port'].url?f.listing:url===f.url?f.landing()+(mode==='chrome'?'<footer>New acquisition</footer>':''):mode==='changed'?'Unparseable changed PDF':f.pdf)})});
 const first=await capture('business-db-original');assert.equal(first.items[0].state,'ready',first.items[0].error??'');
 const imported=await importBatch(first.id,'tester'),id=imported.rows[0].id;assert.equal(imported.published,false);
 const [source]=await sql`SELECT revision,profile FROM fishery_sources WHERE source_id='fishery-column-mpa-port'`;assert.equal(source.profile.allowedPublication,false);await approve(id,1,source.revision);
 const initial=(await documentHistory(id)).observations[0],revisit=await capture('business-db-revisit','chrome');await importBatch(revisit.id,'tester');
 assert.equal((await documentHistory(id)).observations.length,1);assert.deepEqual((await documentHistory(id)).observations[0].payload,initial.payload);
 assert.equal((await materialDetail(id)).state,'approved');assert.equal((await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${id}`).length,0);
 const [core]=await sql`SELECT publication_time,published_at_claim FROM articles WHERE raw->>'fisheryDocumentId'=${id}`;assert.equal(core.publication_time,'2026-10-22');assert.equal(core.published_at_claim.toISOString(),'2026-10-21T16:00:00.000Z');
 const changed=await capture('business-db-changed','changed'),updated=await importBatch(changed.id,'tester');assert.equal(updated.evidenceUpdates.length,1);assert.equal(updated.rows.length,0);assert.equal((await documentHistory(id)).observations.length,2);assert.notEqual((await materialDetail(id)).state,'approved');
 await importBatch(first.id,'tester');assert.equal((await documentHistory(id)).observations.length,2,'Old archive replay cannot restore old approval');
});

test('native document policy permits new ordinary news without human records and rejects stale evidence, refusals and review-only use',async()=>{
 const d=await automaticFixture(961),[article]=await sql`UPDATE articles SET url=(SELECT canonical_url FROM fishery_documents WHERE id=${d.id}),raw=raw||'{"mode":"verified-news-candidate"}'::jsonb WHERE raw->>'fisheryDocumentId'=${d.id} RETURNING id`;
 assert.equal(await nativeArticlePermit(article.id),false,'Legacy unclassified documents are not silently authorized');
 await assignNativeDocumentPurpose(d.id);
 assert.equal(await nativeArticlePermit(article.id),true);
 assert.equal((await sql`SELECT 1 FROM fishery_reviews WHERE document_id=${d.id}`).length,0);
 assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE document_id=${d.id}`).length,0);
 const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 await sql`UPDATE fishery_sources SET revision=revision+1 WHERE source_id='fishery-column-moa'`;
 assert.equal(await nativeArticlePermit(article.id),true,'A revision counter or health note alone does not invalidate evidence');
 await sql`UPDATE fishery_sources SET profile=jsonb_set(profile,'{authRequired}','true') WHERE source_id='fishery-column-moa'`;
 assert.equal(await nativeArticlePermit(article.id),false,'Relevant source policy changes invalidate the bound permission');
 await sql`UPDATE fishery_sources SET profile=jsonb_set(profile,'{authRequired}','false') WHERE source_id='fishery-column-moa'`;
 await sql`UPDATE fishery_sources SET revision=${source.revision} WHERE source_id='fishery-column-moa'`;
 await sql`UPDATE articles SET body_text=body_text||'Changed evidence' WHERE id=${article.id}`;
 assert.equal(await nativeArticlePermit(article.id),false);
 await sql`UPDATE articles SET body_text=${d.body} WHERE id=${article.id}`;
 await sql`UPDATE fishery_documents SET withdrawn_reason='Synthetic real withdrawal' WHERE id=${d.id}`;
 assert.equal(await nativeArticlePermit(article.id),false);
 await sql`UPDATE fishery_documents SET withdrawn_reason=NULL WHERE id=${d.id}`;
 await review(d.id,{revision:1,sourceRevision:source.revision,decision:'rejected',applicabilityReviewed:false,note:'Synthetic explicit material refusal'},'tester');
 assert.equal(await nativeArticlePermit(article.id),false);
 await assignNativeDocumentPurpose(d.id);assert.equal(await nativeArticlePermit(article.id),false,'Capture replay cannot clear refusal');
 const second=await automaticFixture(962),[other]=await sql`UPDATE articles SET url=(SELECT canonical_url FROM fishery_documents WHERE id=${second.id}),raw=raw||'{"mode":"verified-news-candidate"}'::jsonb WHERE raw->>'fisheryDocumentId'=${second.id} RETURNING id`;
 await sql`INSERT INTO fishery_document_purposes(document_id,purpose,reason) VALUES(${second.id},'review_only','Synthetic explicit review-only authorization')`;
 await assignNativeDocumentPurpose(second.id);assert.equal(await nativeArticlePermit(other.id),false);
});

test('native low-scored news uses core publication and detail blocks current BLOCK, review-only and invalidated evidence',async()=>{
 const d=await automaticFixture(963),initialHistory=await documentHistory(d.id),initial=initialHistory.observations.at(-1)!.payload,publishedAt=new Date().toISOString();
 await observe(d.id,{...initial,expectedRevision:1,dates:{...initial.dates,published:{precision:'day',value:publishedAt.slice(0,10)}},sourceCapture:{...initial.sourceCapture,publishedAt}},'tester');
 const captured=await storeCapturedNews('moa',d.id,d.body,'tester');assert.ok('articleId' in captured);
 const [article]=await sql`SELECT id,revision FROM articles WHERE id=${captured.articleId!}`;
 await assignNativeDocumentPurpose(d.id);
 const addAnalysis=async(relevance:string)=>{
  const [a]=await sql`INSERT INTO analyses(article_id,input_revision,origin,model,prompt_version,receipt_ids,relevance,category,tags,subjects,title_zh,summary_zh,reason_zh,score,selected,output)
   VALUES(${article.id},${article.revision},'model','local-fixture','native-policy-behavior/v1','{}',${relevance},'policy','{}','{}','合成低分资讯','低分相关资讯仍应进入全部动态。',NULL,25,false,'{}'::jsonb) RETURNING id`;
  return a.id;
 };
 const [sourceProfile]=await sql`SELECT profile FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 assert.equal(sourceProfile.profile.rightsStatus,'unknown','Unknown redistribution rights do not invent a manual gate for original news summaries');
 await addAnalysis('pass');await publishArticle(article.id);
 const [publication]=await sql`SELECT eligible,selected,score FROM publications WHERE article_id=${article.id}`;
 assert.equal(publication.eligible,true);assert.equal(publication.selected,false);assert.equal(Number(publication.score),25);
 assert.equal((await loadItemDetail(article.id)).kind,'found');
 assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${article.id}`).length,0);
 assert.equal((await sql`SELECT 1 FROM fishery_publication_bindings WHERE article_id=${article.id}`).length,0);
 const absentEverywhere=async()=>{
  assert.equal((await loadItemDetail(article.id)).kind,'not_found');assert.equal(await exportMarkdown(article.id),null);
  assert.ok(!(await loadPool({channel:'all',category:null,tag:null})).items.some(i=>i.id===article.id));
  const api=await v1Items({mode:'all',window:'7d',by:'timeline',category:null,q:null,limit:100,cursor:null});assert.ok(!api.items.some(i=>i.id===article.id));
  assert.ok(!(await itemFeed('all',null)).includes(article.id));
 };
 await addAnalysis('block');await absentEverywhere();
 await addAnalysis('pass');await publishArticle(article.id);assert.equal((await loadItemDetail(article.id)).kind,'found');
 const permitted={...sourceProfile.profile,rightsStatus:'permitted',allowedSummary:true,allowedPublication:true,rightsCheckedAt:'2020-01-01T00:00:00Z',reviewDueAt:'2099-01-01T00:00:00Z',evidenceUrl:'https://example.org/summary-terms'};
 for(const denied of [{...sourceProfile.profile,rightsStatus:'revoked'},{...sourceProfile.profile,rightsStatus:'restricted'},{...permitted,allowedSummary:false},{...permitted,allowedPublication:false},{...permitted,rightsCheckedAt:'2098-01-01T00:00:00Z'},{...permitted,reviewDueAt:'2021-01-01T00:00:00Z'}]){
  await sql`UPDATE fishery_sources SET profile=${sql.json(denied)} WHERE source_id='fishery-column-moa'`;
  await assignNativeDocumentPurpose(d.id);assert.equal(await nativeArticlePermit(article.id),false,'Fresh evidence cannot override an explicit source-use restriction');
  assert.equal(await publishArticle(article.id),null);await absentEverywhere();
 }
 await sql`UPDATE fishery_sources SET profile=${sql.json(sourceProfile.profile)} WHERE source_id='fishery-column-moa'`;
 await assignNativeDocumentPurpose(d.id);
 await sql`UPDATE fishery_document_purposes SET purpose='review_only' WHERE document_id=${d.id}`;
 await absentEverywhere();
 await sql`UPDATE fishery_document_purposes SET purpose='native' WHERE document_id=${d.id}`;
 await sql`UPDATE articles SET body_text=body_text||'Synthetic changed body' WHERE id=${article.id}`;
 await absentEverywhere();
 const history=await documentHistory(d.id),payload=history.observations.at(-1)!.payload,changed=d.body+'新证据版本。';
 await observe(d.id,{...payload,expectedRevision:history.observations.at(-1)!.revision,sourceCapture:{...payload.sourceCapture,bodySha256:sha256(changed)}},'tester');
 const revised=await storeCapturedNews('moa',d.id,changed,'tester');assert.ok('articleId' in revised&&revised.articleId===article.id);
 await assignNativeDocumentPurpose(d.id);assert.equal(await nativeArticlePermit(article.id),true);
 await absentEverywhere();assert.equal(await publishArticle(article.id),null,'An old revision analysis cannot republish a new material revision');

});

test('qualified review-only decision does not enqueue or project publication; explicit publish does',async()=>{
 const d=await selectionFixture(964),result=await runFlow(d.task.id,selectionMock(d.body,[]));
 await getBoss({schedule:false,supervise:false});
 await decideFlow(d.task.id,{decision:'qualified',snapshotHash:result.snapshotHash,note:'Synthetic internal audit only'},'tester');
 const reviewed=await flowDetail(d.task.id);assert.equal(reviewed.human_decision.publication,'review_only');assert.equal(reviewed.publication.queued,false);assert.equal(reviewed.publication.executed,false);
 assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE name='fishery.publication' AND data->>'itemId'=${d.id}`).length,0);
 await syncFisheryPublications('Synthetic review-only replay',new Date(),{target:{kind:'article',id:d.id}});
 assert.equal((await sql`SELECT 1 FROM fishery_publication_bindings WHERE item_id=${d.id}`).length,0);
 await sql`INSERT INTO fishery_document_purposes(document_id,purpose,reason) VALUES(${d.id},'review_only','Synthetic hard review-only purpose')`;
 await assert.rejects(decideFlow(d.task.id,{decision:'qualified',publication:'publish',snapshotHash:result.snapshotHash,note:'Cannot expand review-only authorization'},'tester'),/review-only/);
 await sql`UPDATE fishery_document_purposes SET purpose='manual' WHERE document_id=${d.id}`;
 await decideFlow(d.task.id,{decision:'qualified',publication:'publish',snapshotHash:result.snapshotHash,note:'Synthetic explicit publication decision'},'tester');
 assert.equal((await flowDetail(d.task.id)).publication.queued,true);
});


test('explicit pristine handover has a read-only dry run and never releases paid or rejected work',async()=>{
 const d=await automaticFixture(965),[article]=await sql`UPDATE articles SET url=(SELECT canonical_url FROM fishery_documents WHERE id=${d.id}),raw=raw||'{"mode":"verified-news-candidate"}'::jsonb WHERE raw->>'fisheryDocumentId'=${d.id} RETURNING id`;
 const task=await createFlow(d.id,{identity:'auto-pristine-handover'},'tester');
 await getBoss({schedule:false,supervise:false});
 const original=(await sql`SELECT published_at,discovered_at,backfill FROM articles WHERE id=${article.id}`)[0];
 const dry=await migrateOrdinaryDocumentPurpose(d.id,'tester','Synthetic bounded migration dry run',{dryRun:true});assert.equal(dry.dryRun,true);
 assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE id=${task.id}`).length,1);
 assert.equal((await sql`SELECT 1 FROM fishery_document_purposes WHERE document_id=${d.id}`).length,0);
 assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='fishery.native.handover' AND subject=${'fishery:'+d.id}`).length,0);
 await migrateOrdinaryDocumentPurpose(d.id,'tester','Synthetic explicit no-cost handover');
 assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE id=${task.id}`).length,0);assert.equal(await nativeArticlePermit(article.id),true);
 assert.deepEqual((await sql`SELECT published_at,discovered_at,backfill FROM articles WHERE id=${article.id}`)[0],original);
 const old=await selectionFixture(966);await runFlow(old.task.id,selectionMock(old.body,[]));
 await assert.rejects(migrateOrdinaryDocumentPurpose(old.id,'tester','Cannot automatically migrate existing paid review',{dryRun:true}),/pristine/);
 const refused=await automaticFixture(967),placeholder=await createFlow(refused.id,{identity:'auto-rejected-handover'},'tester'),[source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
 await review(refused.id,{revision:1,sourceRevision:source.revision,decision:'rejected',applicabilityReviewed:false,note:'Synthetic real human refusal'},'tester');
 await assert.rejects(migrateOrdinaryDocumentPurpose(refused.id,'tester','Cannot release a human refusal',{dryRun:true}),/rejection/);
 assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE id=${placeholder.id}`).length,1);
});

async function supersededHandoverFixture(number:number){
 const d=await automaticFixture(number),[article]=await sql`UPDATE articles SET url=(SELECT canonical_url FROM fishery_documents WHERE id=${d.id}),raw=raw||'{"mode":"verified-news-candidate"}'::jsonb WHERE raw->>'fisheryDocumentId'=${d.id} RETURNING id`;
 const old=await createFlow(d.id,{identity:`auto-superseded-${number}`,selection:true},'automatic-dispatch');
 const snapshot={...old.snapshot,executionConfig:'0'.repeat(64)};
 const decision={decision:'rejected',snapshotHash:hash(snapshot),actor:'automatic-dispatch',at:new Date().toISOString(),note:'Unstarted automatic placeholder superseded by new source evidence; no paid result was rejected.',internalOnly:true};
 await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(snapshot)},status='rejected',human_decision=${sql.json(decision)} WHERE id=${old.id}`;
 const [proof]=await sql`INSERT INTO audit_log(actor,action,subject,reason,before,after) VALUES('automatic-dispatch','fishery.flow.auto_superseded',${'fishery:'+d.id},${decision.note},NULL,${sql.json({id:old.id,...decision})}) RETURNING id`;
 const current=await createFlow(d.id,{identity:`auto-current-${number}`,selection:true},'automatic-dispatch');
 return {...d,articleId:article.id,old,current,decision,snapshot,proofId:proof.id};
}

test('system-superseded handover requires exact zero-cost provenance and preserves audit, dates and the original ledger',async()=>{
 await getBoss({schedule:false,supervise:false});
 const d=await supersededHandoverFixture(969);
 const ledger={id:TRIAL.id,maxRequests:null,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny,entries:Array.from({length:53},(_,i)=>({id:i+1,state:'received',wireBytes:100,reservedMicroCny:TRIAL.reserveMicroCny,usage:{promptTokens:100,completionTokens:10,estimatedMicroCny:280}}))};
 const [priorLedger]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
 await sql`INSERT INTO settings(key,value) VALUES(${authorizationKey},${sql.json(ledger)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
 const [dates]=await sql`SELECT published_at,discovered_at,backfill FROM articles WHERE id=${d.articleId}`;
 const [proofBefore]=await sql`SELECT * FROM audit_log WHERE id=${d.proofId}`;
 const receiptCount=(await sql`SELECT count(*)::int AS n FROM receipts`)[0].n;
 try{
  const dry=await migrateOrdinaryDocumentPurpose(d.id,'fixture-operator','Synthetic proven zero-request migration',{dryRun:true});
  assert.deepEqual(dry.queuedTaskIds,[d.current.id]);assert.deepEqual(dry.systemSuperseded,[{taskId:d.old.id,auditId:Number(d.proofId)}]);
  assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE document_id=${d.id}`).length,2);
  assert.equal((await sql`SELECT 1 FROM fishery_document_purposes WHERE document_id=${d.id}`).length,0);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${'fishery:'+d.id} AND action='fishery.native.handover'`).length,0);
  const done=await migrateOrdinaryDocumentPurpose(d.id,'fixture-operator','Synthetic proven zero-request migration');
  assert.equal(done.removedPlaceholders,2);assert.equal(await nativeArticlePermit(d.articleId),true);
  assert.equal((await sql`SELECT 1 FROM fishery_flow_tasks WHERE document_id=${d.id}`).length,0);
  const [written]=await sql`SELECT before,after FROM audit_log WHERE subject=${'fishery:'+d.id} AND action='fishery.native.handover'`;
  assert.equal(written.before.tasks.find((t:any)=>t.id===d.old.id).classification,'system_superseded');
  assert.deepEqual(written.before.tasks.find((t:any)=>t.id===d.old.id).decision,d.decision);
  assert.equal(written.before.tasks.find((t:any)=>t.id===d.current.id).classification,'pristine_queued');
  assert.deepEqual(written.after,{purpose:'native',modelCalls:0});
  assert.deepEqual((await sql`SELECT * FROM audit_log WHERE id=${d.proofId}`)[0],proofBefore);
  assert.deepEqual((await sql`SELECT published_at,discovered_at,backfill FROM articles WHERE id=${d.articleId}`)[0],dates);
  assert.deepEqual((await sql`SELECT value FROM settings WHERE key=${authorizationKey}`)[0].value,ledger);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0].n,receiptCount);
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${d.articleId}`).length,0);
  assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=${d.articleId}`).length,0);
 }finally{if(priorLedger)await sql`UPDATE settings SET value=${sql.json(priorLedger.value)} WHERE key=${authorizationKey}`;else await sql`DELETE FROM settings WHERE key=${authorizationKey}`;}
});

test('system-superseded handover refuses forged markers, missing proof, started or paid work and explicit decisions',async t=>{
 const variants=['actor-only','internal-only','missing-audit','mismatched-audit','audit-task-mismatch','snapshot-mismatch','source-evidence-mismatch','stale-current-queued','stage-request','structure-result','selection-outcome','document-receipt','article-receipt','manual-rejected','decision-audit','no-current-queued'] as const;
 for(const [index,variant] of variants.entries())await t.test(variant,async()=>{
  const d=await supersededHandoverFixture(980+index);
  if(variant==='actor-only')await sql`UPDATE fishery_flow_tasks SET human_decision=${sql.json({...d.decision,internalOnly:false})} WHERE id=${d.old.id}`;
  if(variant==='internal-only')await sql`UPDATE fishery_flow_tasks SET human_decision=${sql.json({...d.decision,actor:'fixture-operator'})} WHERE id=${d.old.id}`;
  if(variant==='missing-audit')await sql`DELETE FROM audit_log WHERE id=${d.proofId}`;
  if(variant==='mismatched-audit')await sql`UPDATE audit_log SET after=jsonb_set(after,'{snapshotHash}',${sql.json('f'.repeat(64))}) WHERE id=${d.proofId}`;
  if(variant==='snapshot-mismatch')await sql`UPDATE fishery_flow_tasks SET snapshot=jsonb_set(snapshot,'{bodySha256}',${sql.json('e'.repeat(64))}) WHERE id=${d.old.id}`;
  if(variant==='audit-task-mismatch')await sql`UPDATE audit_log SET after=jsonb_set(after,'{id}',${sql.json(d.current.id)}) WHERE id=${d.proofId}`;
  if(variant==='source-evidence-mismatch'){
   const snapshot={...d.snapshot,observationHash:'f'.repeat(64)},decision={...d.decision,snapshotHash:hash(snapshot)};
   await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(snapshot)},human_decision=${sql.json(decision)} WHERE id=${d.old.id}`;
   await sql`UPDATE audit_log SET after=${sql.json({id:d.old.id,...decision})} WHERE id=${d.proofId}`;
  }
  if(variant==='stale-current-queued')await sql`UPDATE fishery_flow_tasks SET snapshot=jsonb_set(snapshot,'{observationHash}',${sql.json('d'.repeat(64))}) WHERE id=${d.current.id}`;
  if(variant==='stage-request')await sql`UPDATE fishery_flow_tasks SET stage_requests='{"prefilter:1":{"subject":"synthetic","purpose":"prefilter_article"}}'::jsonb WHERE id=${d.old.id}`;
  if(variant==='structure-result')await sql`UPDATE fishery_flow_tasks SET selection=jsonb_set(selection,'{structure,result}','{"receiptId":777}'::jsonb) WHERE id=${d.old.id}`;
  if(variant==='selection-outcome')await sql`UPDATE fishery_flow_tasks SET selection=jsonb_set(selection,'{outcome}','{"label":"SCORED"}'::jsonb) WHERE id=${d.old.id}`;
  if(variant==='document-receipt'||variant==='article-receipt')await sql`INSERT INTO receipts(logical_key,service,purpose,subject,status) VALUES(${`superseded-${d.id}`},'llm','prefilter_article',${variant==='document-receipt'?'fishery:'+d.id:'article:'+d.articleId+'@1'},'received')`;
  if(variant==='manual-rejected')await sql`UPDATE fishery_flow_tasks SET human_decision=${sql.json({...d.decision,actor:'authorized-agent:fixture-decision',note:'Explicitly rejected publication; preserve original results'})} WHERE id=${d.old.id}`;
  if(variant==='manual-rejected'||variant==='decision-audit')await sql`INSERT INTO audit_log(actor,action,subject,reason,after) VALUES('authorized-agent:fixture-decision','fishery.flow.decision',${'fishery:'+d.id},'Synthetic explicit editorial decision',${sql.json({id:d.old.id,...d.decision})})`;
  if(variant==='no-current-queued')await sql`DELETE FROM fishery_flow_tasks WHERE id=${d.current.id}`;
  const before=await sql`SELECT id,status,snapshot,human_decision,stage_requests,selection FROM fishery_flow_tasks WHERE document_id=${d.id} ORDER BY id`;
  await assert.rejects(migrateOrdinaryDocumentPurpose(d.id,'fixture-operator','Synthetic rejected migration must remain zero-request',{dryRun:true}));
  assert.deepEqual(await sql`SELECT id,status,snapshot,human_decision,stage_requests,selection FROM fishery_flow_tasks WHERE document_id=${d.id} ORDER BY id`,before);
  assert.equal((await sql`SELECT 1 FROM fishery_document_purposes WHERE document_id=${d.id}`).length,0);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${'fishery:'+d.id} AND action='fishery.native.handover'`).length,0);
 });
});

test('specified policy purpose is persisted explicitly without changing historical decisions or receipts',async()=>{
 const d=await automaticFixture(968),[document]=await sql`SELECT * FROM fishery_documents WHERE id=${d.id}`;
 await sql`INSERT INTO fishery_documents(id,source_id,issuer,canonical_url) VALUES(${reviewOnlyPolicyDocument},${document.source_id},'Synthetic policy purpose',${document.canonical_url+'-review-only'})`;
 const before=(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows`)[0];
 assert.equal((await initializeReviewOnlyPurpose()).length,1);
 const [purpose]=await sql`SELECT purpose FROM fishery_document_purposes WHERE document_id=${reviewOnlyPolicyDocument}`;assert.equal(purpose.purpose,'review_only');
 await assignNativeDocumentPurpose(reviewOnlyPolicyDocument);assert.equal((await sql`SELECT purpose FROM fishery_document_purposes WHERE document_id=${reviewOnlyPolicyDocument}`)[0].purpose,'review_only');
 await assert.rejects(migrateOrdinaryDocumentPurpose(reviewOnlyPolicyDocument,'tester','Specified policy cannot be converted to ordinary news',{dryRun:true}),/purpose|review-only/);
 assert.deepEqual((await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM fishery_flow_tasks) AS flows`)[0],before);
});
