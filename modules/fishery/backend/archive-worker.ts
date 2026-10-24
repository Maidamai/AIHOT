// Source-isolated, non-paid archive consumers on the existing pg-boss platform.
import {stat,readdir,readFile,rm,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {audit} from '@aihot/backend/audit';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PgBoss} from 'pg-boss';
import {z} from 'zod';
import {config} from '@aihot/backend/config';
import {sql,type Tx} from '@aihot/backend/db';
import {cancelColumnArchives,withColumnLease,currentColumnLease} from './column-lease.ts';
import {collectColumnRound,columnProgressCoordinator} from './column-progress.ts';
import {columnDbProgress,COLUMN_CURSOR_KEY} from './column-db-progress.ts';
import {importBatch} from './import-batch.ts';
import {readBatch,type ColumnFetcher} from './column-batches.ts';
export const ARCHIVE_COLUMNS=['moa','npfc','fujian','fujian-notices','jfa-press','itf-fisheries','fao-tuna','mpa-port'] as const;
export type ArchiveColumn=typeof ARCHIVE_COLUMNS[number];
export const ARCHIVE_KEY='fishery.archive.moa',ARCHIVE_TICK='fishery.archive.moa.tick',ARCHIVE_QUEUE='fishery.archive.moa';
const stateSchema=z.object({enabled:z.boolean(),revision:z.uuid(),mode:z.enum(['hourly','six_hourly','validation']),runId:z.string().regex(/^[a-zA-Z0-9-]{1,40}$/),intervalSeconds:z.number().int().min(10).max(21600),claimed:z.number().int().nonnegative(),pausedReason:z.string().nullable(),nextAt:z.iso.datetime().nullable(),
  current:z.object({id:z.string(),stage:z.enum(['queued','collecting','importing']),jobId:z.string().nullable()}).nullable(),lastRound:z.string().nullable(),heartbeatAt:z.iso.datetime().nullable()});
type ArchiveConfig=z.infer<typeof stateSchema>;
type ArchiveJob={revision:string;roundId:string;column?:ArchiveColumn};
export interface ArchiveStatus {lastListingSuccessAt?:string|null;lastBodySuccessAt?:string|null;bodyFailures?:number;registered?:boolean;adapted?:boolean;normalCycleVerified?:boolean;latestPending?:number|null;historyDeferred?:number|null;revisionChecks?:number|null;enabled:boolean;coreSourceEnabled:boolean|null;sourceId?:string;sourceName?:string;mode:'hourly'|'six_hourly'|'validation'|null;runId:string|null;heartbeatAt:string|null;lastSuccessAt:string|null;lastFailureAt:string|null;lastError:string|null;currentRound:string|null;lastRound:string|null;pendingCandidates:number|null;cursorUrl:string|null;coverage:string|null;maxPages:1;maxArticles:1|5;nextRunAt:string|null;consecutiveFailures:number;pausedReason:string|null;validationClaimed:number|null;validationLimit:2|null;}
import {isBusinessSource} from './business-capture.ts';
import {COLUMNS} from './official-columns.ts';
export async function assertArchiveSchedules(boss:PgBoss){const allowed=ARCHIVE_COLUMNS.map(c=>`fishery.archive.${c}.tick`),foreign=(await boss.getSchedules()).filter(s=>!allowed.includes(s.name));if(foreign.length)throw new Error(`Archive profile refuses foreign schedules (preserved): ${foreign.map(s=>s.name).join(', ')}`);}
export function createArchiveController(column:ArchiveColumn){
 if(!ARCHIVE_COLUMNS.includes(column))throw new Error('Unsupported archive source');
 const ARCHIVE_KEY=`fishery.archive.${column}`,ARCHIVE_TICK=`${ARCHIVE_KEY}.tick`,ARCHIVE_QUEUE=ARCHIVE_KEY,sourceId=`fishery-column-${column}`,leaseKey=`fishery.column-archive.${column}`;
 const normalMode=column==='npfc'?'six_hourly':'hourly',normalInterval=column==='npfc'?21600:3600,maxArticles=column==='npfc'||isBusinessSource(column)?1:5;
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
async function read(db:Tx|typeof sql=sql):Promise<ArchiveConfig|null>{const [r]=await db`SELECT value FROM settings WHERE key=${ARCHIVE_KEY}`;if(!r)return null;const state=stateSchema.parse(r.value);if(state.mode!=='validation'&&(state.mode!==normalMode||state.intervalSeconds!==normalInterval))throw new Error('Archive source cadence is invalid');return state;}
async function save(tx:Tx,value:ArchiveConfig){await tx`INSERT INTO settings(key,value,updated_by) VALUES (${ARCHIVE_KEY},${tx.json(value)},'fishery-archive') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;}
async function source(tx:Tx|typeof sql=sql){const [s]=await tx`SELECT * FROM sources WHERE id=${sourceId}`;if(!s||s.kind!=='external'||s.enabled||s.participation_mode==='isolated')throw new Error('Official archive requires existing external disabled core source');return s;}
async function archiveStatus():Promise<ArchiveStatus>{
  const state=await read();const [s]=await sql`SELECT kind,participation_mode,enabled,health,fail_count,last_ok_at,last_fetch_at,last_error,next_fetch_at,cursor FROM sources WHERE id=${sourceId}`;
  const [owner]=await sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid=((hashtextextended(${leaseKey},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${leaseKey},0)&4294967295)::oid) AS held`;
  const unresolved=state?.current&&state.current.stage!=='queued'&&!owner.held?'Unresolved archive round without source lease; explicit reconciliation required':null;
  const binding=!s||s.kind!=='external'||s.enabled||s.participation_mode==='isolated'?'Source binding unavailable or isolated; archive cannot run':null;
  const [normal]=state&&state.mode!=='validation'?await sql`SELECT id FROM job_runs WHERE job=${ARCHIVE_QUEUE} AND status='ok' AND detail->>'revision'=${state.revision} ORDER BY id DESC LIMIT 1`:[];
  const p=s?.cursor?.[COLUMN_CURSOR_KEY];const pause=unresolved??state?.pausedReason??binding??(Number(s?.fail_count??0)>=3?'Three consecutive source failures; inspect before explicit reauthorization':null);
  return {lastListingSuccessAt:p?.health?.listingSucceededAt??null,lastBodySuccessAt:p?.health?.lastBodySuccessAt??null,bodyFailures:p?.health?.bodyFailures??0,registered:!!s,adapted:true,normalCycleVerified:!!normal,latestPending:p?.health?.latestPending??null,historyDeferred:p?.health?.historyDeferred??null,revisionChecks:p?.health?.revisionChecks??null,sourceId,sourceName:COLUMNS[column].name,enabled:!!state?.enabled&&!pause,coreSourceEnabled:s?.enabled??null,mode:state?.mode??null,runId:state?.runId??null,heartbeatAt:state?.heartbeatAt??null,lastSuccessAt:iso(s?.last_ok_at),lastFailureAt:s?.last_error?iso(s.last_fetch_at):null,lastError:s?.last_error??null,currentRound:state?.current?.id??null,lastRound:state?.lastRound??null,pendingCandidates:p?.pendingUrls?.length??null,cursorUrl:p?.cursorUrl??null,coverage:p?.health?.coverage??null,maxPages:1,maxArticles,nextRunAt:state?.enabled&&!pause?(s?.last_error&&s?.next_fetch_at&&(!state.nextAt||new Date(s.next_fetch_at).getTime()>Date.parse(state.nextAt))?iso(s.next_fetch_at):state.nextAt):null,consecutiveFailures:Number(s?.fail_count??0),pausedReason:pause,validationClaimed:state?.mode==='validation'?state.claimed:null,validationLimit:state?.mode==='validation'?2:null};
}
async function configureArchive(input:{enabled:boolean;mode:'hourly'|'six_hourly'|'validation';runId:string;intervalSeconds?:number}) {
  return withColumnLease(column,lease=>lease.transaction(async tx=>{
    if(input.mode!=='validation'&&input.mode!==normalMode)throw new Error('Normal mode does not match this source');
    const old=await read(tx);
    if(!input.enabled&&old){const disabled={...old,enabled:false,revision:randomUUID(),pausedReason:old.pausedReason??'Disabled by operator; evidence retained'};await save(tx,disabled);await audit('fishery-archive-cli','fishery.archive.configure',ARCHIVE_KEY,'Disable without discarding unresolved evidence',old,disabled,{db:tx});return disabled;}
    const s=await source(tx);
    const intervalSeconds=input.mode!=='validation'?normalInterval:z.number().int().min(10).max(300).parse(input.intervalSeconds??60);
    if(old&&old.runId===input.runId){
      if(old.mode!==input.mode||old.intervalSeconds!==intervalSeconds)throw new Error('Reused run ID cannot change archive configuration');
      if(!old.enabled&&input.enabled){if(Number(s.fail_count)>=3)throw new Error('Three consecutive failures require source inspection');const resumed={...old,enabled:true,revision:randomUUID(),pausedReason:old.current?'Explicit stopped-runner reconciliation required':old.mode==='validation'&&old.claimed>=2?'Validation two-round bound reached':null};await save(tx,resumed);await audit('fishery-archive-cli','fishery.archive.configure',ARCHIVE_KEY,'Re-enable existing budget without resetting claims',old,resumed,{db:tx});return resumed;}
      return old;
    }
    if(old?.current)throw new Error(`Unresolved archive round ${old.current.id}; reconcile before changing configuration`);
    if(input.enabled&&Number(s.fail_count)>=3)throw new Error('Three consecutive source failures; preserve source health and investigate before resuming');
    if(input.mode==='validation'&&(await tx`SELECT id FROM audit_log WHERE action='fishery.archive.configure' AND subject=${ARCHIVE_KEY} AND after->>'runId'=${input.runId} AND after->>'mode'='validation' LIMIT 1`).length)throw new Error('Validation run ID already authorized; preserve its two-round bound, use status or a new explicit run ID');
    const next=stateSchema.parse({enabled:input.enabled,revision:randomUUID(),mode:input.mode,runId:input.runId,intervalSeconds,claimed:0,pausedReason:null,nextAt:new Date(input.mode!=='validation'?Math.max(Date.now(),s.last_fetch_at?new Date(s.last_fetch_at).getTime()+normalInterval*1000:0):Date.now()).toISOString(),current:null,lastRound:old?.lastRound??null,heartbeatAt:old?.heartbeatAt??null});
    await save(tx,next);await audit('fishery-archive-cli','fishery.archive.configure',ARCHIVE_KEY,'Explicit dedicated archive authorization',old,next,{db:tx});return next;
  }));
}
function queueDb(tx:Tx){return {executeSql:async(text:string,values?:unknown[])=>({rows:await tx.unsafe(text,(values??[]) as never[])})};}
async function archiveTick(boss:PgBoss,revision:string){
  return withColumnLease(column,lease=>lease.transaction(async tx=>{
    const state=await read(tx);
    if(!state||state.revision!==revision||!state.enabled)return {skipped:'disabled or stale configuration'};
    const s=await source(tx);
    state.heartbeatAt=new Date().toISOString();
    if(Number(s.fail_count)>=3)state.pausedReason='Three consecutive source failures; inspect source and explicitly reconcile';
    if(state.pausedReason||state.current){await save(tx,state);return {skipped:state.pausedReason??`Unresolved round ${state.current!.id}`};}
    if(state.mode==='validation'&&state.claimed>=2){state.pausedReason='Validation two-round bound reached';await save(tx,state);return {skipped:state.pausedReason};}
    if(state.nextAt&&Date.parse(state.nextAt)>Date.now()){await save(tx,state);return {skipped:'not due'};}
    // Successful core interval can differ from this specialized archive's cadence. Failure backoff remains core-owned.
    if(s.last_error&&s.next_fetch_at&&new Date(s.next_fetch_at).getTime()>Date.now()){state.nextAt=iso(s.next_fetch_at);await save(tx,state);return {skipped:'core failure backoff'};}
    const unfinished=await tx`SELECT id FROM fetch_runs WHERE source_id=${sourceId} AND finished_at IS NULL AND detail ? 'fisheryColumnRound' LIMIT 1`;
    if(unfinished.length){state.pausedReason='Unfinished source fetch run; explicit stopped-runner reconciliation required';await save(tx,state);return {skipped:state.pausedReason};}
    const roundId=`${column[0]}-${randomUUID()}`;state.claimed++;state.current={id:roundId,stage:'queued',jobId:null};
    const jobId=await boss.send(ARCHIVE_QUEUE,{revision:state.revision,roundId,column},{singletonKey:sourceId,retryLimit:0,db:queueDb(tx)});
    if(!jobId)throw new Error('Source queue already owns a job; no validation claim committed');
    state.current.jobId=jobId;await save(tx,state);return {roundId,jobId};
  }));
}
async function setStage(revision:string,id:string,stage:'collecting'|'importing'){
  const lease=currentColumnLease(column)!;
  return lease.transaction(async tx=>{await source(tx);const state=await read(tx);if(!state||!state.enabled||state.revision!==revision||state.current?.id!==id)throw new Error('Stale archive authorization/round');state.current.stage=stage;state.heartbeatAt=new Date().toISOString();await save(tx,state);});
}
async function finishRound(revision:string,id:string,settlement?:{runId?:number|string;outcome:string|null;imports:unknown[];reason?:string;retainedInterrupted?:string[]}){
  return currentColumnLease(column)!.transaction(async tx=>{
    const state=await read(tx),s=await source(tx);if(!state||state.revision!==revision||state.current?.id!==id)throw new Error('Archive state changed before settlement');
    state.current=null;state.lastRound=id;state.heartbeatAt=new Date().toISOString();
    // Start spacing at completion, so even slow GETs never shorten the hourly bound.
    state.nextAt=new Date(Date.now()+state.intervalSeconds*1000).toISOString();
    if(settlement?.reason)state.pausedReason=null;
    if(Number(s.fail_count)>=3)state.pausedReason='Three consecutive source failures; inspect before explicit reauthorization';
    else if(state.mode==='validation'&&state.claimed>=2)state.pausedReason='Validation two-round bound reached';
    if(settlement){
      const detail={outcome:settlement.outcome,imports:settlement.imports,modelCalls:0,published:false,...(settlement.reason?{reconciledAt:new Date().toISOString(),recoveryReason:settlement.reason,retainedInterrupted:settlement.retainedInterrupted}:{} )};
      if(settlement.runId!==undefined)await tx`UPDATE job_runs SET status=${settlement.outcome==='success'?'ok':'failed'},finished_at=now(),detail=detail || ${tx.json(detail as never)} WHERE id=${settlement.runId}`;
      else await tx`UPDATE job_runs SET status=${settlement.outcome==='success'?'ok':'failed'},finished_at=now(),detail=detail || ${tx.json(detail as never)},error=coalesce(error,${settlement.outcome==='success'?null:'Explicit stopped-runner reconciliation finalized failed archive'}) WHERE job=${ARCHIVE_QUEUE} AND status='running' AND detail->>'roundId'=${id}`;
      if(settlement.reason)await audit('fishery-archive-cli','fishery.archive.reconcile',ARCHIVE_KEY,settlement.reason,null,{roundId:id,...detail},{db:tx});
    }
    await save(tx,state);
  });
}
async function runArchiveJob(data:ArchiveJob,options:{fetch?:ColumnFetcher;wait?:(ms:number)=>Promise<unknown>}={}) {
  if(data.column&&data.column!==column)throw new Error('Archive job source mismatch');
  return withColumnLease(column,async lease=>{
    const state=await read();
    if(!state||!state.enabled||state.revision!==data.revision)return {skipped:'disabled or stale job'};
    if(state.lastRound===data.roundId)return {skipped:'finished round replay'};
    if(state.pausedReason||state.current?.id!==data.roundId)return {skipped:state.pausedReason??'round is not authorized'};
    if(state.current.stage!=='queued')throw new Error('Unresolved started round; explicit stopped-runner reconciliation required');
    const blocked=await lease.transaction(async tx=>{const value=await read(tx);let s;try{s=await source(tx);}catch(error){value!.pausedReason=String(error);await save(tx,value!);return value!.pausedReason;}if(Number(s.fail_count)>=3){value!.pausedReason='Three consecutive source failures before job execution';await save(tx,value!);return value!.pausedReason;}if(s.last_error&&s.next_fetch_at&&new Date(s.next_fetch_at).getTime()>Date.now()){value!.current=null;value!.nextAt=iso(s.next_fetch_at);await save(tx,value!);return 'core failure backoff before execution';}return null;});
    if(blocked)return {skipped:blocked};
    const run=await lease.transaction(async tx=>{const [r]=await tx`INSERT INTO job_runs(job,detail) VALUES (${ARCHIVE_QUEUE},${tx.json({roundId:data.roundId,revision:data.revision,archiveOnly:true})}) RETURNING id`;return r;});
    try {
      await setStage(data.revision,data.roundId,'collecting');
      const round=await collectColumnRound({id:data.roundId,dataDir:config.dataDir,columns:[column],limit:maxArticles,maxPages:1,storage:'db',store:columnDbProgress,...options});
      await setStage(data.revision,data.roundId,'importing');
      const imports:Awaited<ReturnType<typeof importBatch>>[]=[];for(const batch of round.sources[0].batches)imports.push(await importBatch(batch,'fishery-archive:unreviewed'));
      await finishRound(data.revision,data.roundId,{runId:run.id,outcome:round.outcome,imports});
      return {roundId:data.roundId,outcome:round.outcome,imports,modelCalls:0,published:false};
    } catch(error) {
      // A lost lease may not update any state; its persisted current round blocks its successor.
      await lease.transaction(async tx=>{await tx`UPDATE job_runs SET status='failed',finished_at=now(),error=${String(error).slice(0,1000)} WHERE id=${run.id}`;const value=await read(tx);if(value?.current?.id===data.roundId){value.pausedReason='Interrupted archive/import; explicit reconciliation required';await save(tx,value);}}).catch(()=>{});
      throw error;
    }
  });
}
async function reconcileArchive(reason:string,options:{fetch?:ColumnFetcher;wait?:(ms:number)=>Promise<unknown>}={}){
  z.string().trim().min(12).max(1000).parse(reason);
  return withColumnLease(column,async()=>{
    const state=await read();if(!state?.current)throw new Error('No unfinished archive round');if(!state.enabled)throw new Error('Archive disabled; re-enable the same run ID without resetting its budget before explicit reconciliation');await source();
    const file=path.join(config.dataDir,'fishery-column-progress','rounds',state.current.id,'manifest.json');
    const hasManifest=await stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(!hasManifest){
      const intents=await sql`SELECT id FROM fetch_runs WHERE source_id=${sourceId} AND detail->'fisheryColumnRound'->>'roundId'=${state.current.id}`;
      const batchDir=path.join(config.dataDir,'fishery-batches');
      const archives=await readdir(batchDir).catch(error=>{if(error.code==='ENOENT')return [] as string[];throw error;});
      const roundDir=path.dirname(file),entries=await readdir(roundDir).catch(error=>{if(error.code==='ENOENT')return [] as string[];throw error;});
      if(intents.length||archives.some(name=>name.startsWith(state.current!.id+'-'))||entries.length)throw new Error('Missing journal with existing intent/archive; unknown acquisition must be inspected, never replaced');
      // Source-bound intent always follows a durable round journal. Its proven absence plus no
      // archive permits the same authorized ID to start after an explicit stopped-runner assertion.
      await currentColumnLease(column)!.transaction(tx=>audit('fishery-archive-cli','fishery.archive.reconcile',ARCHIVE_KEY,reason,null,{roundId:state.current!.id,proof:'no manifest, no source fetch intent, no child archive',action:'start same authorized round'},{db:tx}));
      const coordinator=await columnProgressCoordinator(config.dataDir,[column],'db',state.current.id,true,true),lockDir=coordinator.lock;
      const owner=await readFile(path.join(lockDir,'owner.json'),'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
      if(owner&&owner.roundId!==state.current.id)throw new Error('Another preserved round owns the archive lock');
      await currentColumnLease(column)!.assertHeld();if(owner)await rm(lockDir,{recursive:true});
      const active=await readFile(coordinator.activeFile,'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
      if(active){if(active.roundId!==state.current.id)throw new Error('Another preserved round owns the archive coordinator');await currentColumnLease(column)!.assertHeld();await rm(coordinator.activeFile);}
      await rmdir(roundDir).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
    const round=await collectColumnRound({id:state.current.id,dataDir:config.dataDir,columns:[column],limit:maxArticles,maxPages:1,storage:'db',store:columnDbProgress,...(hasManifest?{resume:{acknowledgeStopped:true as const,reason}}:{}),...options});
    const imports:Awaited<ReturnType<typeof importBatch>>[]=[],retainedInterrupted:string[]=[];for(const batch of round.sources[0].batches){if(round.sources[0].retainedChildren?.some(child=>child.id===batch)){retainedInterrupted.push(batch);continue;}const child=await readBatch(config.dataDir,batch);if(child.status==='complete')imports.push(await importBatch(batch,'fishery-archive:explicit-reconciliation'));else retainedInterrupted.push(batch);}
    await finishRound(state.revision,state.current.id,{outcome:round.outcome,imports,reason,retainedInterrupted});return {round,imports,retainedInterrupted,modelCalls:0};
  });
}
async function registerArchiveWorker(boss:PgBoss,options:{cron?:string;fetch?:ColumnFetcher;wait?:(ms:number)=>Promise<unknown>;pollingIntervalSeconds?:number;consume?:boolean}={}){
  await assertArchiveSchedules(boss);const state=await read();if(!state?.enabled)throw new Error('Dedicated source archive permission is disabled');await source();
  await boss.createQueue(ARCHIVE_TICK,{policy:'singleton',retryLimit:0,expireInSeconds:120});
  await boss.createQueue(ARCHIVE_QUEUE,{policy:'short',retryLimit:0,expireInSeconds:600});
  // Existing queue options also must remain non-retrying after a prior release.
  await boss.updateQueue(ARCHIVE_TICK,{retryLimit:0});await boss.updateQueue(ARCHIVE_QUEUE,{retryLimit:0});
  await boss.schedule(ARCHIVE_TICK,options.cron??'* * * * *',{revision:state.revision},{tz:'UTC',missed:'skip'});
  if(options.consume===false)return state.revision;
  const work={pollingIntervalSeconds:options.pollingIntervalSeconds??5};
  await boss.work<{revision:string}>(ARCHIVE_TICK,work,async([job])=>{
    if(!job)return;
    try{return await archiveTick(boss,job.data.revision);}catch(error){if(String(error)===`Error: Column ${column} archive lease unavailable`)return {skipped:'source already owned; no new claim or request'};throw error;}
  });
  await boss.work<ArchiveJob>(ARCHIVE_QUEUE,work,async([job])=>{
    if(!job)return;
    // A ready queue row can be observed just before the dispatcher's retained session
    // releases its advisory lock. Wait only for initial ownership, never replay a started GET.
    for(let attempt=0;;attempt++){
      try{return await runArchiveJob(job.data,options);}catch(error){
        if(String(error)!==`Error: Column ${column} archive lease unavailable`||attempt>=19)throw error;
        await delay(250);
      }
    }
  });
  return state.revision;
}

return {column,key:ARCHIVE_KEY,tick:ARCHIVE_TICK,queue:ARCHIVE_QUEUE,read,archiveStatus,configureArchive,archiveTick,runArchiveJob,reconcileArchive,registerArchiveWorker,heartbeat:async()=>withColumnLease(column,lease=>lease.transaction(async tx=>{await source(tx);const state=await read(tx);if(state){state.heartbeatAt=new Date().toISOString();await save(tx,state);}}))};
}

const controllers=ARCHIVE_COLUMNS.map(createArchiveController);
export const {archiveStatus,configureArchive,archiveTick,runArchiveJob,reconcileArchive,registerArchiveWorker}=controllers[0];
export const npfcArchive=controllers[1];
export async function archiveSourceStatuses():Promise<ArchiveStatus[]>{return Promise.all(controllers.map(async c=>{try{return await c.archiveStatus();}catch{return {sourceId:`fishery-column-${c.column}`,sourceName:COLUMNS[c.column].name,enabled:false,coreSourceEnabled:null,mode:null,runId:null,heartbeatAt:null,lastSuccessAt:null,lastFailureAt:null,lastError:'Source archive configuration unavailable',currentRound:null,lastRound:null,pendingCandidates:null,cursorUrl:null,coverage:null,maxPages:1 as const,maxArticles:c.column==='npfc'||isBusinessSource(c.column)?1 as const:5 as const,nextRunAt:null,consecutiveFailures:0,pausedReason:'Source configuration unavailable; inspect without resetting state',validationClaimed:null,validationLimit:null};}}));}
export async function startArchiveProfile():Promise<()=>Promise<void>>{
 if(process.env.MODEL_CALLS_ENABLED==='true'||process.env.COLLECT_ENABLED==='true')throw new Error('Archive profile requires core collection and model valves disabled');
 const settings={connectionString:config.databaseUrl,schema:'pgboss',max:4,supervise:false};
 const errors=new Map<string,string>();
 const isolated=async(c:typeof controllers[number],action:()=>Promise<unknown>)=>{try{await action();errors.delete(c.column);}catch(error){const message=String(error).slice(0,1000);if(errors.get(c.column)!==message){errors.set(c.column,message);console.error(`[archive ${c.column}]`,message);await sql`INSERT INTO job_runs(job,status,finished_at,error) VALUES (${c.queue+'.worker'},'failed',now(),${message})`.catch(()=>{});}}};
 const preflight=new PgBoss({...settings,schedule:false});preflight.on('error',error=>console.error('[archive preflight]',String(error)));
 try{await preflight.start();await assertArchiveSchedules(preflight);for(const c of controllers)await isolated(c,async()=>{if((await c.read())?.enabled)await c.registerArchiveWorker(preflight,{consume:false});});}finally{await preflight.stop({graceful:false});}
 const boss=new PgBoss({...settings,schedule:true});boss.on('error',error=>console.error('[archive worker]',String(error)));await boss.start();
 const revisions=new Map<string,string>();
 const refresh=async(c:typeof controllers[number])=>{
  const state=await c.read();if(!state?.enabled)return;
  if(!revisions.has(c.column)){await boss.supervise(c.tick);await boss.supervise(c.queue);revisions.set(c.column,await c.registerArchiveWorker(boss));}
  else if(state.revision!==revisions.get(c.column)){await boss.schedule(c.tick,'* * * * *',{revision:state.revision},{tz:'UTC',missed:'skip'});revisions.set(c.column,state.revision);}
  await boss.supervise(c.tick);await boss.supervise(c.queue);
  // An active acquisition owns this same source lease; it supplies its own stage heartbeats.
  try{await c.heartbeat();}catch(error){if(String(error)!==`Error: Column ${c.column} archive lease unavailable`)throw error;}
 };
 for(const c of controllers)await isolated(c,()=>refresh(c));
 let stopped=false,busy=false;
 const stop=async()=>{if(stopped)return;stopped=true;clearInterval(heartbeat);cancelColumnArchives();await boss.stop({graceful:true,timeout:30_000});};
 const heartbeat=setInterval(()=>{if(busy)return;busy=true;void(async()=>{await assertArchiveSchedules(boss);for(const c of controllers)await isolated(c,()=>refresh(c));})().catch(error=>{console.error('[archive global invariant]',String(error));void stop();}).finally(()=>{busy=false;});},15_000);heartbeat.unref();return stop;
}

/** Read-only administration projection; it never changes the core source enable switch. */
export async function archiveSourceRuntimes() {
  return Object.fromEntries((await archiveSourceStatuses()).filter(s => s.sourceId).map(s => [s.sourceId!, {
    registered:s.registered,adapted:s.adapted,normalCycleVerified:s.normalCycleVerified,latestPending:s.latestPending,historyDeferred:s.historyDeferred,revisionChecks:s.revisionChecks,
    enabled:s.enabled, health:s.coreSourceEnabled===null || !s.mode ? 'unknown' : s.consecutiveFailures>=3 ? 'failing' : s.lastError ? 'degraded' : s.enabled ? 'ok' : 'paused',
    intervalMinutes:s.mode==='hourly'?60:s.mode==='six_hourly'?360:null,
    nextRunAt:s.nextRunAt,lastSuccessAt:s.lastSuccessAt,heartbeatAt:s.heartbeatAt,lastError:s.lastError??s.pausedReason,
    label:'受控采集',detailPath:'/admin/fishery/collect',
  }]));
}
