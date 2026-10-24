// Ordinary news uses the engine's original analysis, publication, grouping and edition stores.
// This adapter owns only the site's bounded purpose/amount authorization and worker ownership.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, type Db } from '@aihot/backend/db';
import { audit, Conflict } from '@aihot/backend/audit';
import { type ModelRequestContext, type ModelWireRequest } from '@aihot/backend/modules';
import { queueProcessing, registerContentJobs, registerExtractionJobs, sweepUnprocessed } from '@aihot/backend/jobs/content';
import { registerEventJobs, sweepUngrouped } from '@aihot/backend/jobs/events';
import { runSourceRepublish } from '@aihot/backend/jobs/publication';
import { getBoss, stopBoss, work, QUEUES, recordRun } from '@aihot/backend/jobs/queue';
import { withReceiptPolicy, markStalePendingReceipts, ReceiptBusyError } from '@aihot/backend/providers/receipts';
import { embeddingsAvailable } from '@aihot/backend/providers/embeddings';
import { computeHotRanking, snapshotHeat } from '@aihot/backend/events/hot';
import { linkRelatedStories } from '@aihot/backend/events/consolidate';
import { composeDueReports } from '@aihot/backend/reports/compose';
import { digestReports } from '@aihot/backend/publication/story-evidence';
import { periodEntries } from '@aihot/backend/reports/edition';
import { isoWeekRange, monthRange } from '@aihot/contracts/time';
import { COLUMNS, isNewsColumn, type ColumnId } from './official-columns.ts';
import { acquireProcessingLease, assertProcessingLease } from './processing-lease.ts';
import { authorizationKey, assertFisheryCapacity, fisheryAuthorizationActive, fisheryAuthorizationReport } from './authorization.ts';
import { flowQueue, type FlowJob } from './flow.ts';
import { publicationQueue, type PublicationJob } from './publication-queue.ts';
import { AUTOMATIC_FLOW_KEY, dispatchAutomaticDocuments } from './automatic-flows.ts';
import { nativeArticlePermit } from './native-permit.ts';
import { TRIAL, validateTrialLedger, trialBudget, trialCapacity, trialUsage } from './trial-transport.ts';

export const NATIVE_PROCESSING_KEY='fishery.native.processing';
export const NATIVE_SOURCES=(Object.keys(COLUMNS) as ColumnId[]).filter(isNewsColumn).map(id=>`fishery-column-${id}`);
const policy=z.strictObject({enabled:z.boolean(),sourceIds:z.array(z.enum(NATIVE_SOURCES)).min(1).max(NATIVE_SOURCES.length).refine(ids=>new Set(ids).size===ids.length,'Duplicate source'),createdAfter:z.iso.datetime()});
const stored=policy.extend({revision:z.uuid()});
export async function nativeProcessingConfiguration(db:Db=sql){const [r]=await db`SELECT value FROM settings WHERE key=${NATIVE_PROCESSING_KEY}`;return r?stored.parse(r.value):null;}
export async function configureNativeProcessing(input:unknown,actor:string,reason:string){
  const value=policy.parse(input);if(!actor.trim()||reason.trim().length<12)throw new Error('Explicit actor and reason required');
  const lease=value.enabled?await acquireProcessingLease():null;
  try{return await sql.begin(async tx=>{
    const old=await nativeProcessingConfiguration(tx);
    const next={...value,revision:randomUUID()};
    await tx`INSERT INTO settings(key,value,updated_by) VALUES(${NATIVE_PROCESSING_KEY},${tx.json(next)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    await audit(actor,'fishery.native.configure',NATIVE_PROCESSING_KEY,reason,old,next,{db:tx});return next;
  });}finally{await lease?.release();}
}
async function managedArticle(articleId:string,db:Db=sql){
  const [row]=await db`SELECT (a.source_id LIKE 'fishery-%' OR a.raw ? 'fisheryDocumentId'
    OR EXISTS(SELECT 1 FROM fishery_sources f WHERE f.source_id=a.source_id)
    OR EXISTS(SELECT 1 FROM fishery_publication_bindings b WHERE b.article_id=a.id)) AS managed FROM articles a WHERE a.id=${articleId}`;
  return row?.managed===true;
}
async function nativeEligibility(articleId:string,db:Db=sql){
  const scope=await nativeProcessingConfiguration(db);
  if(!scope?.enabled)return {eligible:false,blockedReason:'scope_disabled'};
  const [a]=await db`SELECT a.source_id,a.backfill,a.discovered_at,
    (a.raw->>'mode'='verified-news-candidate' AND EXISTS(SELECT 1 FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id
      WHERE d.id=a.raw->>'fisheryDocumentId' AND d.source_id=a.source_id AND d.canonical_url=a.url)) AS captured
    FROM articles a WHERE a.id=${articleId}`;
  if(!a)return {eligible:false,blockedReason:'article_missing'};
  if(!scope.sourceIds.includes(a.source_id))return {eligible:false,blockedReason:'source_out_of_scope'};
  if(a.backfill)return {eligible:false,blockedReason:'historical'};
  if(new Date(a.discovered_at)<new Date(scope.createdAfter))return {eligible:false,blockedReason:'before_created_after'};
  if(!a.captured||!await nativeArticlePermit(articleId,db))return {eligible:false,blockedReason:'purpose_or_evidence_restricted'};
  return {eligible:true,blockedReason:null};
}
export async function nativeProcessingPermit(articleId:string,db:Db=sql,phase:"queue"|"consume"="queue"){
  // Installing the industry module must not change another source's original engine behavior.
  if(!await managedArticle(articleId,db))return !execution.getStore();
  if(phase==="consume"&&!execution.getStore())throw new ReceiptBusyError("Managed news requires the native execution owner; retain the job for its authorized consumer");
  return (await nativeEligibility(articleId,db)).eligible;
}
export async function dispatchNativeDocuments(ids?:string[]){
  const scope=await nativeProcessingConfiguration();if(!scope?.enabled)return {enabled:false,rows:[]};
  await getBoss({schedule:false,supervise:false});
  const rows=await sql`SELECT a.id,a.raw->>'fisheryDocumentId' AS document_id FROM articles a
    WHERE a.source_id IN ${sql(scope.sourceIds)} AND a.processing_state='new' AND NOT a.backfill
      AND a.discovered_at>=${new Date(scope.createdAfter)}
      ${ids?sql`AND a.raw->>'fisheryDocumentId' IN ${sql(ids.length?ids:['00000000-0000-0000-0000-000000000000'])}`:sql``}
      AND (a.processing_retry_at IS NULL OR a.processing_retry_at<=now())
      AND (a.processing_queued_at IS NULL OR a.processing_queued_at<now()-interval '30 minutes')
    ORDER BY a.discovered_at DESC LIMIT 100`;
  const result=[];
  for(const row of rows){
    if(!await nativeProcessingPermit(row.id)){result.push({articleId:row.id,documentId:row.document_id,state:'restricted'});continue;}
    const jobId=await queueProcessing(row.id);result.push({articleId:row.id,documentId:row.document_id,state:jobId?'enqueued':'already_queued',jobId});
  }
  return {enabled:true,revision:scope.revision,rows:result};
}
export interface NativeArticleStatus {
  id:string;documentId:string|null;processingState:string;processingError:string|null;groupingStatus:string;publicationVisibility:string|null;purpose:"native"|"manual"|"review_only"|null;
}
export async function nativeProcessingStatus(){
  const rows=await sql<NativeArticleStatus[]>`SELECT a.id,a.raw->>'fisheryDocumentId' AS "documentId",a.processing_state AS "processingState",a.processing_error AS "processingError",a.grouping_status AS "groupingStatus",p.visibility AS "publicationVisibility",purpose.purpose
    FROM articles a LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN fishery_document_purposes purpose ON purpose.document_id=a.raw->>'fisheryDocumentId' WHERE a.source_id IN ${sql([...NATIVE_SOURCES])} ORDER BY a.discovered_at DESC LIMIT 50`;
  const articles=[];for(const row of rows)articles.push({...row,...await nativeEligibility(row.id)});
  return {config:await nativeProcessingConfiguration(),authorization:await fisheryAuthorizationReport(),articles};
}

const ARTICLE_PURPOSES=new Set(['prefilter_article','score_article','structure_article','understand_article','summarize_article','mend_wording','group_article','group_review','translate_body']);
const STORY_PURPOSES=new Set(['story_digest','group_story','group_story_review']);
export const NATIVE_MODEL_PURPOSES=[...ARTICLE_PURPOSES,...STORY_PURPOSES,'report_weekly','report_monthly'];
const execution=new AsyncLocalStorage<{assertAuthorized:()=>Promise<void>}>();
async function controlledModelRequest(request:ModelRequestContext){
  const article=/^article:([^@:#]+)/.exec(request.subject)?.[1];
  if(article)return managedArticle(article);
  const story=/^story:(\d+)(?::(\d+))?/.exec(request.subject);
  if(story){for(const id of story.slice(1).filter(Boolean).map(Number))for(const report of await digestReports(sql,[id]))if(await managedArticle(report.id))return true;return false;}
  const report=/^report:(weekly|monthly):(.+)$/.exec(request.subject);
  if(report){const range=report[1]==='weekly'?isoWeekRange(report[2]!):monthRange(report[2]!);if(range)for(const entry of (await periodEntries(range.start,range.end)).entries)if(await managedArticle(entry.itemId))return true;}
  return false;
}
let wireSerial:Promise<unknown>=Promise.resolve();
async function assertModelPurpose(request:ModelRequestContext){
  await assertProcessingLease();
  const ctx=execution.getStore();if(!ctx)throw new Error('Native processing execution required; no paid request permitted');
  await ctx.assertAuthorized();
  if(ARTICLE_PURPOSES.has(request.purpose)){
    const id=/^article:([^@:#]+)/.exec(request.subject)?.[1];
    if(!id||!(await nativeEligibility(id)).eligible)throw new Conflict('Native article purpose/evidence/scope changed; no model request');
    return;
  }
  if(STORY_PURPOSES.has(request.purpose)){
    const ids=/^story:(\d+)(?::(\d+))?/.exec(request.subject)?.slice(1).filter(Boolean).map(Number);
    if(!ids?.length)throw new Conflict('Current native story evidence required');
    for(const id of ids){const reports=await digestReports(sql,[id]);if(!reports.length)throw new Conflict('Story has no currently readable evidence');for(const report of reports)if(!(await nativeEligibility(report.id)).eligible)throw new Conflict('Story includes material outside native authorization');}
    return;
  }
  if((request.purpose==='report_weekly'||request.purpose==='report_monthly')&&/^report:(weekly|monthly):/.test(request.subject)){
    const match=/^report:(weekly|monthly):(.+)$/.exec(request.subject)!;
    const range=match[1]==='weekly'?isoWeekRange(match[2]!):monthRange(match[2]!);
    if(!range)throw new Conflict('Invalid native report period');
    const {entries}=await periodEntries(range.start,range.end);
    if(!entries.length)throw new Conflict('Period overview requires current public native evidence');
    for(const entry of entries)if(!(await nativeEligibility(entry.itemId)).eligible)throw new Conflict('Period overview includes material outside native authorization');
    return;
  }
  throw new Conflict(`Model purpose outside native authorization: ${request.purpose}`);
}
export async function allowNativeAutomaticRecovery(receipt:{purpose:string;subject:string|null;authorization:string|null}){
  if(receipt.authorization===authorizationKey)return false;
  return !await controlledModelRequest({purpose:receipt.purpose,subject:receipt.subject??'',model:'',maxTokens:0});
}
export async function requiredNativeWorkerProfile(){return (await nativeProcessingConfiguration())?.enabled?'fishery-native':null;}
export async function acquireFullWorkerLease(options:{onLeaseLost?:(error:Error)=>void;watchIntervalMs?:number}={}){
  const lease=await acquireProcessingLease();
  const stopWatch=lease.watch(error=>{if(options.onLeaseLost)options.onLeaseLost(error);else {process.exitCode=1;void stopBoss();}},options.watchIntervalMs);
  return async()=>{stopWatch();await lease.release();};
}
export async function prepareNativeModelRequest(request:ModelRequestContext){
  if(fisheryAuthorizationActive()||!execution.getStore()&&!await controlledModelRequest(request))return {};
  await assertModelPurpose(request);
  // The original writer asks for 16384 tokens and period overviews for 2500. The retained
  // authorization permits at most 2048; this explicit site limit is part of receipt identity.
  // Unusable/truncated answers still fail the engine's schema and grounded-copy checks.
  return {maxTokens:Math.min(request.maxTokens,TRIAL.maxOutputTokens),rejectTruncated:true};
}
export function validateNativeWire(request:ModelWireRequest){
  const options=request.options;
  if(request.url!==TRIAL.endpoint||options.method!=='POST'||typeof options.body!=='string'||Buffer.byteLength(options.body)>TRIAL.maxWireBytes)throw new Error('Native model destination/method/size refused');
  const body=JSON.parse(options.body),allowed=['model','messages','temperature','max_tokens','response_format','thinking'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||body.model!==TRIAL.model||!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>TRIAL.maxOutputTokens||body.thinking?.type!=='disabled'||Object.keys(body.thinking).length!==1)throw new Error('Native model parameters exceed retained authorization');
  if(body.response_format!==undefined&&(body.response_format.type!=='json_object'||Object.keys(body.response_format).length!==1))throw new Error('Native response format refused');
  const messages=body.messages;
  if(!Array.isArray(messages)||messages.length<1||messages.length>2||messages.at(-1)?.role!=='user'||messages.length===2&&messages[0]?.role!=='system'||messages.some((m:Record<string,unknown>)=>typeof m.content!=='string'||Object.keys(m).some(k=>!['role','content'].includes(k))))throw new Error('Only native plain-text news messages are authorized');
  if(options.redirect!=='error')throw new Error('Native model redirects refused');
  return {wireBytes:Buffer.byteLength(options.body)};
}
export async function sendNativeModelRequest(request:ModelWireRequest,send:()=>Promise<Response>){
  // Existing specialized work keeps its original, stricter two-message transport and ledger.
  if(fisheryAuthorizationActive()||!execution.getStore()&&!await controlledModelRequest(request))return send();
  const ctx=execution.getStore();if(!ctx)throw new Error('Native processing execution required');
  const run=async()=>{
    await assertModelPurpose(request);const checked=validateNativeWire(request);
    const id=await sql.begin(async tx=>{
      const [row]=await tx`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
      validateTrialLedger(row?.value);await assertModelPurpose(request);trialCapacity(row.value.entries);
      const id=row.value.entries.length+1;
      row.value.entries.push({id,state:'pending',wireBytes:checked.wireBytes,reservedMicroCny:TRIAL.reserveMicroCny,purpose:request.purpose,subject:request.subject});
      await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;return id;
    });
    // Lost ownership after reservation remains pending and cannot automatically be spent again.
    await assertModelPurpose(request);
    const settle=async(state:'received'|'refused'|'unknown',usage:ReturnType<typeof trialUsage>|null,responseModel?:string)=>sql.begin(async tx=>{
      const [row]=await tx`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
      const entry=row?.value.entries.find((entry:{id:number})=>entry.id===id);if(!entry||entry.state!=='pending')throw new Error('Native cumulative reservation mismatch');
      if(usage)trialBudget([{...entry,state:'received',usage}]);
      entry.state=state;entry.usage=usage;entry.responseModel=responseModel??null;
      await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;
    });
    let settled=false;
    try{
      const response=await send();
      if(!response.ok){await settle('refused',null);settled=true;return response;}
      const data=await response.clone().json() as {usage?:unknown;model?:unknown};
      const usage=trialUsage(data.usage);await settle('received',usage,typeof data.model==='string'?data.model.slice(0,200):undefined);settled=true;
      return response;
    }catch(error){if(!settled)await settle('unknown',null);throw error;}
  };
  // runAnalysis's independent score/structure promises retain their semantics. Only actual
  // sends serialize, so every reservation uses the same pre-existing unresolved-outcome guard.
  const next=wireSerial.then(()=>execution.run(ctx,run));wireSerial=next.catch(()=>{});return next;
}
export async function withNativeProcessing<T>(run:()=>Promise<T>){
  const assertAuthorized=async()=>{await assertProcessingLease();const scope=await nativeProcessingConfiguration();if(!scope?.enabled)throw new Conflict('Native processing disabled');};
  await assertAuthorized();return execution.run({assertAuthorized},()=>withReceiptPolicy({retryFailed:false,assertAuthorized,services:['llm','deepseek'],authorization:authorizationKey},run));
}

/** Migration preflight only; the explicit CLI owns retirement and preserves historical jobs. */
export async function assertLegacyNewsRetired(db:Db=sql){
  const [row]=await db`SELECT id,state FROM pgboss.job WHERE name='fishery.news' AND state IN ('active','created','retry') LIMIT 1`;
  if(row)throw new Conflict('Legacy fishery.news has unfinished work; drain/reconcile active work and run scripts/fishery-native.ts retire-legacy before native startup');
}

/** A separate process from the archive collector; no generic collection, embeddings or delivery. */
export async function startNativeProfile():Promise<()=>Promise<void>>{
  if(process.env.COLLECT_ENABLED==='true')throw new Error('Native profile requires core collection disabled; archive collectors own these sources');
  if(embeddingsAvailable())throw new Error('Embeddings are outside the retained native authorization');
  if(!(await nativeProcessingConfiguration())?.enabled)throw new Error('Configure and explicitly enable the bounded native scope before starting its consumer');
  await assertFisheryCapacity(0);
  const lease=await acquireProcessingLease();let serial:Promise<unknown>=Promise.resolve(),stopping=false;
  const execute=<T>(run:()=>Promise<T>):Promise<T>=>{const next=serial.then(async()=>{if(stopping)throw new Error('Native processor stopping');return lease.run(()=>withNativeProcessing(run));});serial=next.catch(()=>{});return next;};
  let stopWatch=()=>{};
  let boss:Awaited<ReturnType<typeof getBoss>>;
  try{boss=await getBoss({schedule:false,supervise:false});}catch(error){await lease.release();throw error;}
  const timers:ReturnType<typeof setInterval>[]=[];
  const queues=[QUEUES.analyze,QUEUES.extractBody,QUEUES.group,QUEUES.digest,QUEUES.republishSource,flowQueue.name,publicationQueue.name];
  const stop=async()=>{if(stopping)return;stopping=true;timers.forEach(clearInterval);stopWatch();await Promise.all(queues.map(name=>boss.offWork(name,{wait:true})));await serial;await lease.release();await stopBoss();};
  try{
    await assertLegacyNewsRetired();
    await boss.createQueue(flowQueue.name,flowQueue.options);
    const actualFlow=await boss.getQueue(flowQueue.name);
    if(!actualFlow||actualFlow.retryLimit!==0||Number(actualFlow.expireInSeconds)<600)throw new Error('fishery.flow must retain retryLimit=0 and expireInSeconds>=600 before native startup');
    await boss.createQueue(publicationQueue.name,publicationQueue.options);
    const actualPublication=await boss.getQueue(publicationQueue.name);
    if(!actualPublication||actualPublication.retryLimit!==2||actualPublication.expireInSeconds!==300)throw new Error('fishery.publication must retain its non-paid bounded retry policy');
    await boss.work<FlowJob>(flowQueue.name,{batchSize:1,localConcurrency:1},jobs=>execute(()=>flowQueue.run(jobs.map(job=>job.data))));
    await boss.work<PublicationJob>(publicationQueue.name,{batchSize:1,localConcurrency:1},jobs=>execute(()=>publicationQueue.run(jobs.map(job=>job.data))));
    await registerContentJobs(boss,execute);await registerExtractionJobs(boss,execute);await registerEventJobs(boss,execute);
    await work(boss,QUEUES.republishSource,{localConcurrency:1,pollingIntervalSeconds:2},data=>execute(()=>runSourceRepublish(data)));
    // Original engine cadence, wall-clock boundaries are handled by the original composition
    // functions. Every run is visible in job_runs; the archive process owns its own schedules.
    const tasks:Array<{name:string;every:number;run:()=>Promise<unknown>}>=[
      {name:'content.sweep',every:5*60000,run:async()=>({native:await dispatchNativeDocuments(),special:await dispatchAutomaticDocuments(),sweep:await sweepUnprocessed()})},
      {name:'hot.rank',every:5*60000,run:()=>computeHotRanking()},
      {name:'hot.snapshot',every:3600000,run:()=>snapshotHeat()},
      {name:'stories.links',every:3600000,run:linkRelatedStories},
      {name:'reports.compose',every:30*60000,run:()=>composeDueReports()},
      // Unlike the generic ops.recover, do not release unknown paid requests without billing reconciliation.
      {name:'ops.recover',every:10*60000,run:async()=>({receipts:await markStalePendingReceipts(),grouping:await sweepUngrouped()})},
    ];
    for(const task of tasks){
      let pending=false;
      const tick=()=>{if(stopping||pending)return;pending=true;void execute(()=>recordRun(task.name,task.run)).catch(()=>{console.error(JSON.stringify({level:'error',msg:'native scheduled task failed',job:task.name}));}).finally(()=>{pending=false;});};
      const timer=setInterval(tick,task.every);timer.unref();timers.push(timer);tick();
    }
    const maintenance=setInterval(()=>{void Promise.all(queues.map(name=>boss.supervise(name))).catch(()=>{});},10000);maintenance.unref();timers.push(maintenance);
    stopWatch=lease.watch(()=>{void stop();});return stop;
  }catch(error){await stop();throw error;}
}

/** Retire the removed ordinary-news continuation, preserving completed jobs and every paid receipt. */
export async function retireLegacyNews(actor:string,reason:string,options:{execute?:boolean}={}){
  if(!actor.trim()||reason.trim().length<12)throw new Conflict('Explicit retirement actor and reason required');
  const inspect=async(db:Db)=>{
    const jobs=await db`SELECT id,state,data->>'articleId' AS article_id FROM pgboss.job WHERE name='fishery.news' ORDER BY created_on`;
    const automaticPlaceholders=await db`SELECT id,document_id,status FROM fishery_flow_tasks WHERE identity LIKE 'auto-%' AND status='queued' AND draft IS NULL AND stage_requests='{}'::jsonb ORDER BY created_at`;
    const [scope]=await db`SELECT value FROM settings WHERE key=${AUTOMATIC_FLOW_KEY}`;
    return {jobs,automaticPlaceholders,retainedSpecializedScope:scope?.value??null,modelCalls:0};
  };
  if(!options.execute)return {dryRun:true,...await inspect(sql)};
  const lease=await acquireProcessingLease();
  try{
    const boss=await getBoss({schedule:false,supervise:false});
    return await lease.run(()=>sql.begin(async tx=>{
      const active=await tx`SELECT id,name FROM pgboss.job WHERE name IN ('fishery.news','fishery.flow') AND state='active' FOR UPDATE`;
      if(active.length)throw new Conflict('Old active work has an uncertain outcome; drain/reconcile before retirement');
      const before=await inspect(tx),ids=before.jobs.filter(job=>['created','retry'].includes(job.state)).map(job=>String(job.id));
      await lease.assertHeld();
      if(ids.length)await boss.cancel('fishery.news',ids,{db:{executeSql:async(text,values)=>({rows:await tx.unsafe(text,(values??[]) as never[])})}});
      const result={cancelledNewsJobs:ids.length,preservedCompletedJobs:before.jobs.length-ids.length,remainingAutomaticPlaceholders:before.automaticPlaceholders.length,modelCalls:0};
      await audit(actor,'fishery.native.retire_news','queue:fishery.news',reason,before,result,{db:tx});return result;
    }));
  }finally{await lease.release();}
}
