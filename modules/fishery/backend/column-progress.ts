// Explicit bounded rounds only. No timer, model, approval or publication.
import { currentColumnLease, assertColumnLeases, withColumnLeases } from "./column-lease.ts";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { batchIdSchema, batchRoot, collectColumns, readBatch, type ColumnBatch, type ColumnFetcher } from "./column-batches.ts";
import { COLUMNS, isNewsColumn, columnIdSchema, columnPageIndex, type ColumnId } from "./official-columns.ts";
import { linkSchema } from "../contracts.ts";
import { sha256 } from "./source-adapters.ts";

const hash=z.string().regex(/^[a-f0-9]{64}$/),stamp=z.iso.datetime({offset:true}),outcome=z.enum(["success","partial","failure"]);
const healthSchema=z.strictObject({outcome,lastAttemptAt:stamp,lastSuccessAt:stamp.nullable(),lastCaptureAt:stamp.nullable(),reason:z.string().nullable(),pending:z.int().nonnegative(),nextPageUrl:linkSchema,coverage:z.enum(["more_pages","cycle_complete","pagination_unverified","current_page_only","blocked"])});
const stateSchema=z.strictObject({version:z.literal("fishery-column-progress/1"),column:columnIdSchema,profileHash:hash,revision:z.int().nonnegative(),cycle:z.int().nonnegative(),cursorUrl:linkSchema,completedUrls:z.array(linkSchema).max(4096),pendingUrls:z.array(linkSchema).max(4096),health:healthSchema.nullable()});
export type ColumnProgress=z.infer<typeof stateSchema>;
export function parseColumnProgress(column:ColumnId,input:unknown):ColumnProgress {
  const value=stateSchema.parse(input);columnPageIndex(column,value.cursorUrl);
  if(value.column!==column||value.profileHash!==profile(column)) throw new Error("Column profile/source binding changed; inspect cursor");
  return value;
}
export interface ColumnProgressStore {
  load(column:ColumnId):Promise<ColumnProgress>;
  intent(column:ColumnId,roundId:string,before:ColumnProgress):Promise<void>;
  finish(column:ColumnId,roundId:string,before:ColumnProgress,after:ColumnProgress,batches:string[],found:number):Promise<void>;
}
interface RoundSource { retainedChildren?:{id:string;reason:"missing_manifest"}[]; sourceId?:string; column:ColumnId; status:"running"|"ready_to_commit"|"finished"; before:ColumnProgress; after:ColumnProgress|null; batches:string[]; health:z.infer<typeof healthSchema>|null; }
export interface ColumnRound { storage?:"file"|"db"; version:"fishery-column-round/1"; id:string; columns:ColumnId[]; limit:number; maxPages:number; startedAt:string; finishedAt:string|null; status:"running"|"finished"; outcome:"success"|"partial"|"failure"|null; sources:RoundSource[]; recoveries:{at:string;reason:string}[]; }
const root=(dataDir:string)=>path.resolve(dataDir,"fishery-column-progress");
const stateFile=(dataDir:string,column:ColumnId)=>path.join(root(dataDir),`${column}.json`);
const equal=isDeepStrictEqual;
const serial=(value:unknown)=>JSON.stringify(value,null,2)+"\n";
const profile=(column:ColumnId)=>sha256(JSON.stringify({column:COLUMNS[column],selection:isNewsColumn(column)?"official-current-list-body/v2":"official-dwf-title-and-body/v1",pagination:isNewsColumn(column)?"latest-list-incremental/v2":"inspected-pagination/v1"}));
export const initialColumnProgress=(column:ColumnId):ColumnProgress=>({version:"fishery-column-progress/1",column,profileHash:profile(column),revision:0,cycle:0,cursorUrl:COLUMNS[column].url,completedUrls:[],pendingUrls:[],health:null});
async function exists(file:string) {try {await stat(file);return true;} catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT") return false;throw error;}}
async function atomic(file:string,value:unknown,guard?:()=>Promise<void>,beforeRename?:()=>Promise<void>) {
  await guard?.();
  const temporary=path.join(path.dirname(file),`.checkpoint-${randomUUID()}.tmp`),handle=await open(temporary,"wx",0o600);
  try {await handle.writeFile(serial(value));await handle.close();await beforeRename?.();await guard?.();await rename(temporary,file);} finally {await handle.close().catch(()=>{});await rm(temporary,{force:true});}
}
async function loadState(dataDir:string,column:ColumnId) {
  const file=stateFile(dataDir,column);if(!await exists(file)) return initialColumnProgress(column);
  if((await stat(file)).size>2*1024*1024) throw new Error("Column progress exceeds bound; do not reset evidence");
  const value=stateSchema.parse(JSON.parse(await readFile(file,"utf8")));columnPageIndex(column,value.cursorUrl);
  if(value.column!==column||value.profileHash!==profile(column)) throw new Error("Column profile changed; inspect existing cursor before a new run");
  return value;
}
export async function listColumnProgress(dataDir:string,store?:ColumnProgressStore) {
  return await Promise.all(columnIdSchema.options.map(async column=>{
    try {return {column,status:"readable" as const,state:await (store?store.load(column):loadState(dataDir,column))};}
    catch(error) {return {column,status:"unreadable" as const,error:String((error as Error).message).slice(0,500)};}
  }));
}
export async function listColumnRounds(dataDir:string) {
  const directory=path.join(root(dataDir),"rounds");if(!await exists(directory)) return [];
  const ids=(await readdir(directory)).filter(id=>batchIdSchema.safeParse(id).success).sort().reverse().slice(0,40);
  return await Promise.all(ids.map(async id=>{try{return await readRound(path.join(directory,id,"manifest.json"),id);}catch(error){return {id,status:"unreadable" as const,error:String((error as Error).message).slice(0,500)};}}));
}
function advance(current:ColumnProgress,batch:ColumnBatch):ColumnProgress {
  const source=batch.sources[0];
  if(batch.status!=="complete"||!batch.finishedAt||batch.sources.length!==1||source?.id!==current.column) throw new Error("A complete single-column page batch is required");
  const next=structuredClone(current),succeeded=batch.items.filter(i=>i.state!=="failed"),failed=batch.items.filter(i=>i.state==="failed");
  next.completedUrls=[...new Set([...next.completedUrls,...succeeded.map(i=>i.url)])];
  if(next.completedUrls.length>4096) throw new Error("Cycle identity bound reached; preserve state for operator inspection");
  // An old pending identity disappearing from the new list is unavailable, never a confirmed withdrawal.
  const unresolvedOld=isNewsColumn(current.column)?[]:current.pendingUrls.filter(url=>!next.completedUrls.includes(url)&&!source.remaining?.includes(url)&&!batch.items.some(i=>i.url===url));
  next.pendingUrls=[...new Set([...(source.remaining??current.pendingUrls),...unresolvedOld])];
  const error=source.error??(unresolvedOld.length?"Pending identities disappeared from the observed list; inspect without declaring withdrawal":null);
  let coverage:z.infer<typeof healthSchema>["coverage"]="blocked";
  if(!error&&!failed.length&&source.pagination) {
    if(isNewsColumn(current.column)) {
      next.cursorUrl=COLUMNS[current.column].url;
      coverage="current_page_only";
    }
    else if(next.pendingUrls.length) coverage=source.pagination.scope==='verified_pagination'?"more_pages":source.pagination.scope;
    else if(source.pagination.nextUrl) {next.cursorUrl=source.pagination.nextUrl;coverage="more_pages";}
    else {
      coverage=source.pagination.scope==="verified_pagination"?"cycle_complete":source.pagination.scope;
      next.cursorUrl=COLUMNS[current.column].url;next.completedUrls=[];next.pendingUrls=[];next.cycle++;
    }
  }
  const failedRound=!!error||failed.length>0;
  const status=failedRound?(succeeded.length?"partial":"failure"):"success";
  const captures=succeeded.flatMap(i=>i.prepared?.sourceCapture.capturedAt?[i.prepared.sourceCapture.capturedAt]:[]).sort();
  next.health={outcome:status,lastAttemptAt:batch.finishedAt,lastSuccessAt:status==="success"?batch.finishedAt:current.health?.lastSuccessAt??null,lastCaptureAt:captures.at(-1)??current.health?.lastCaptureAt??null,
    reason:error??(failed.length?`${failed.length} article acquisition/parse failure(s); cursor not advanced`:null),pending:next.pendingUrls.length,nextPageUrl:next.cursorUrl,coverage};
  return next;
}
const roundSchema=z.object({storage:z.enum(["file","db"]).optional(),version:z.literal("fishery-column-round/1"),id:batchIdSchema,columns:z.array(columnIdSchema).min(1).max(3),limit:z.int().min(1).max(5),maxPages:z.int().min(1).max(3),startedAt:stamp,finishedAt:stamp.nullable(),status:z.enum(["running","finished"]),outcome:outcome.nullable(),recoveries:z.array(z.strictObject({at:stamp,reason:z.string().min(1).max(1000)})).max(20),sources:z.array(z.object({retainedChildren:z.array(z.strictObject({id:batchIdSchema,reason:z.literal("missing_manifest")})).max(3).optional(),sourceId:z.string().optional(),column:columnIdSchema,status:z.enum(["running","ready_to_commit","finished"]),before:stateSchema,after:stateSchema.nullable(),batches:z.array(batchIdSchema).max(3),health:healthSchema.nullable()})).max(3)});
async function readRound(file:string,id:string):Promise<ColumnRound> {
  if((await stat(file)).size>4*1024*1024) throw new Error("Round checkpoint too large");
  const r=roundSchema.parse(JSON.parse(await readFile(file,"utf8")));
  if(r.id!==id||new Set(r.columns).size!==r.columns.length||new Set(r.sources.map(s=>s.column)).size!==r.sources.length) throw new Error("Round identity mismatch");
  for(const s of r.sources) {
    if(r.storage==="db"&&s.sourceId!==`fishery-column-${s.column}`) throw new Error("Round source intent mismatch");
    if(!r.columns.includes(s.column)||s.before.column!==s.column||s.after&&s.after.column!==s.column) throw new Error("Round source binding mismatch");
    columnPageIndex(s.column,s.before.cursorUrl);if(s.after) columnPageIndex(s.column,s.after.cursorUrl);
    if(s.retainedChildren?.some(child=>!s.batches.includes(child.id))) throw new Error("Retained child identity mismatch");
    if(s.batches.some((b,i)=>b!==`${id}-${s.column}-p${i}`)) throw new Error("Round page identity mismatch");
  }
  return r;
}

// Preserve legacy evidence while isolating new DB single-source coordinators. Unknown ownership
// is never guessed from a PID, elapsed time or round-name prefix.
export async function columnProgressCoordinator(dataDir:string,columns:ColumnId[],storage:'file'|'db',id:string,resume=false,allowMissingOriginal=false){
  const directory=root(dataDir),sourceDir=(column:ColumnId)=>path.join(directory,'sources',column);
  const target=storage==='db'&&columns.length===1?sourceDir(columns[0]):directory;
  if(storage==='file')return {directory:target,lock:path.join(target,'lock'),activeFile:path.join(target,'active-round.json')};
  const locations=[directory,...columns.map(sourceDir)],chosen=new Set<string>();
  for(const location of locations){
    const refs=[path.join(location,'lock','owner.json'),path.join(location,'active-round.json')];
    if(await exists(path.join(location,'lock'))&&!await exists(refs[0]))throw new Error('Archive lock ownership missing; preserve unknown evidence');
    for(const reference of refs){
      if(!await exists(reference))continue;
      if((await stat(reference)).size>16*1024)throw new Error('Archive coordinator metadata exceeds bound');
      const owner=z.object({roundId:batchIdSchema}).parse(JSON.parse(await readFile(reference,'utf8'))),file=path.join(directory,'rounds',owner.roundId,'manifest.json');
      if(!await exists(file)){
        if(resume&&allowMissingOriginal&&owner.roundId===id){chosen.add(location);continue;}
        throw new Error(`Unknown archive coordinator ${owner.roundId}; preserve evidence for explicit reconciliation`);
      }
      const prior=await readRound(file,owner.roundId);
      if(resume&&prior.id===id){if(serial(prior.columns)!==serial(columns))throw new Error('Preserved round source options differ');chosen.add(location);continue;}
      if(prior.status!=='finished'&&prior.columns.some(c=>columns.includes(c)))throw new Error(`Unfinished round ${prior.id}; reconcile its original identity before this source`);
    }
  }
  if(chosen.size>1)throw new Error('Original round has conflicting archive coordinators');
  const selected=[...chosen][0]??target;return {directory:selected,lock:path.join(selected,'lock'),activeFile:path.join(selected,'active-round.json')};
}

export async function collectColumnRound(options:{id:string;dataDir:string;columns:ColumnId[];limit:number;maxPages:number;storage?:"file"|"db";store?:ColumnProgressStore;resume?:{acknowledgeStopped:true;reason:string};fetch?:ColumnFetcher;wait?:(ms:number)=>Promise<unknown>;checkpoint?:(stage:"child-persisted"|"before-source-commit"|"after-source-commit"|"before-journal-rename")=>Promise<void>}):Promise<ColumnRound> {
  if(options.storage==="db"&&options.columns.some(column=>!currentColumnLease(column)))return withColumnLeases(options.columns,()=>collectColumnRound(options));
  const guard=options.storage==="db"?assertColumnLeases:async()=>{};
  const id=z.string().regex(/^[a-zA-Z0-9-]{1,40}$/).parse(options.id),columns=[...new Set(options.columns.map(c=>columnIdSchema.parse(c)))];
  const limit=z.int().min(1).max(5).parse(options.limit),maxPages=z.int().min(1).max(3).parse(options.maxPages);
  if(!columns.length) throw new Error("At least one column is required");
  const load=(column:ColumnId)=>options.store?options.store.load(column):loadState(options.dataDir,column);
  const directory=root(options.dataDir),roundDir=path.join(directory,"rounds",id),file=path.join(roundDir,"manifest.json");
  await mkdir(path.join(directory,"rounds"),{recursive:true,mode:0o700});
  const previous=await exists(file)?await readRound(file,id):null;
  if((options.storage==="db")!==!!options.store) throw new Error("DB storage requires explicit DB store; no fallback");
  if(previous&&(previous.storage??"file")!==(options.storage??"file")) throw new Error("Round storage backend mismatch");
  if(previous&&!options.resume) throw new Error("Round exists; use explicit stopped-runner reconciliation, never overwrite it");
  if(!previous&&options.resume) throw new Error("No original round to resume");
  if(options.resume)z.string().trim().min(12).max(1000).parse(options.resume.reason);
  if(previous&&(serial(previous.columns)!==serial(columns)||previous.limit!==limit||previous.maxPages!==maxPages)) throw new Error("Resume options must match the preserved round");
  if(previous?.status==="finished"&&!options.resume) return previous; // Ordinary finished replays remain read-only.
  const coordinator=await columnProgressCoordinator(options.dataDir,columns,options.storage??'file',id,!!options.resume),{lock,activeFile}=coordinator;
  await mkdir(coordinator.directory,{recursive:true,mode:0o700});
  if(previous?.status==='finished'){
    // Explicit stopped-runner reconciliation can finish cleanup after a committed journal.
    if(await exists(lock)){const owner=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));if(owner.roundId!==id)throw new Error('Another round owns collection');await guard();await rm(lock,{recursive:true});}
    if(await exists(activeFile)){const active=JSON.parse(await readFile(activeFile,'utf8'));if(active.roundId===id){await guard();await rm(activeFile);}}
    return previous;
  }
  if(options.resume) {
    if(await exists(lock)) {
      const owner=JSON.parse(await readFile(path.join(lock,"owner.json"),"utf8"));
      if(owner.roundId!==id) throw new Error("Another round owns collection; stop and reconcile its actual identity");
      // Explicit operator assertion, not PID/age-based automatic stealing across containers.
      await rm(lock,{recursive:true});
    }
  }
  try {await mkdir(lock,{mode:0o700});} catch(error) {if((error as NodeJS.ErrnoException).code==="EEXIST") throw new Error("Collection lock held; no automatic stale-lock recovery");throw error;}
  const owner={roundId:id,instanceId:randomUUID()};await atomic(path.join(lock,"owner.json"),owner,guard);
  try {
    if(await exists(activeFile)) {
      const active=z.strictObject({roundId:batchIdSchema}).parse(JSON.parse(await readFile(activeFile,"utf8")));
      if(active.roundId!==id) {
        const prior=await readRound(path.join(directory,"rounds",active.roundId,"manifest.json"),active.roundId);
        if(prior.status!=="finished") throw new Error(`Unfinished round ${active.roundId}; reconcile it before starting another identity`);
      }
    }
    await atomic(activeFile,{roundId:id},guard);
    const round:ColumnRound=previous??{storage:options.storage??"file",version:"fishery-column-round/1",id,columns,limit,maxPages,startedAt:new Date().toISOString(),finishedAt:null,status:"running",outcome:null,sources:[],recoveries:[]};
    if(!previous) await mkdir(roundDir,{mode:0o700});
    if(options.resume) round.recoveries.push({at:new Date().toISOString(),reason:options.resume.reason});
    const save=async()=>{await guard();return atomic(file,round,guard,options.storage==="db"?()=>options.checkpoint?.("before-journal-rename")??Promise.resolve():undefined);};await save();
    for(const column of columns) {
      let entry=round.sources.find(s=>s.column===column);
      if(entry?.status==="finished") continue;
      if(!entry) {
        let before:ColumnProgress;
        try {before=await load(column);} catch(error) {
          if(options.store) throw error;
          const health:z.infer<typeof healthSchema>={outcome:"failure",lastAttemptAt:new Date().toISOString(),lastSuccessAt:null,lastCaptureAt:null,reason:String((error as Error).message).slice(0,500),pending:0,nextPageUrl:COLUMNS[column].url,coverage:"blocked"};
          round.sources.push({column,status:"finished",before:initialColumnProgress(column),after:null,batches:[],health});await save();continue;
        }
        entry={...(options.store?{sourceId:`fishery-column-${column}`} : {}),column,status:"running",before,after:null,batches:[],health:null};round.sources.push(entry);await save();
      }
      // Journal intent is durable before the database intent and before any GET.
      await options.store?.intent(column,id,entry.before);
      const actual=entry.status==="ready_to_commit"&&options.store?entry.before:await load(column);
      if(entry.before.profileHash!==profile(column)||!equal(actual,entry.before)&&(!entry.after||!equal(actual,entry.after))) throw new Error("Column state/profile changed; reject stale resume before any request");
      if(entry.status==="running") {
        let working=structuredClone(entry.before),attempted=0,anyFailure=false,lastCapture=working.health?.lastCaptureAt??null,lastSuccessful=working.health?.lastSuccessAt??null;
        for(let index=0;index<maxPages;index++) {
          if(attempted>=limit) break;
          const batchId=`${id}-${column}-p${index}`;let batch:ColumnBatch;
          if(!entry.batches.includes(batchId)) {entry.batches.push(batchId);await save();}
          const captured=path.join(batchRoot(options.dataDir),batchId,"manifest.json");
          if(!await exists(captured)&&await exists(path.dirname(captured))) {
            if(!options.resume)throw new Error(`Interrupted child ${batchId} has no manifest; stopped-runner reconciliation required`);
            // Directory creation precedes the first child manifest. Never rebuild this unknown
            // archive in place or infer zero requests from the absent manifest.
            entry.retainedChildren=[...(entry.retainedChildren??[]).filter(child=>child.id!==batchId),{id:batchId,reason:"missing_manifest"}];
            working.health={outcome:"failure",lastAttemptAt:new Date().toISOString(),lastSuccessAt:entry.before.health?.lastSuccessAt??null,lastCaptureAt:lastCapture,
              reason:`Interrupted child ${batchId} retained without manifest; no HTTP or import during reconciliation; start a new bounded round for unfinished work`,pending:working.pendingUrls.length,nextPageUrl:working.cursorUrl,coverage:"blocked"};
            anyFailure=true;break;
          }
          if(await exists(captured)) {
            batch=await readBatch(options.dataDir,batchId);
            if(batch.status!=="complete") {
              if(!options.resume) throw new Error(`Interrupted child ${batchId} requires stopped-runner reconciliation`);
              // Do not complete or overwrite an unknown GET archive. Close this round as failed,
              // preserving its cursor; a later explicit round can recapture under a new archive id.
              working.health={outcome:"failure",lastAttemptAt:new Date().toISOString(),lastSuccessAt:entry.before.health?.lastSuccessAt??null,lastCaptureAt:lastCapture,
                reason:`Interrupted child ${batchId} retained unchanged; no HTTP during reconciliation; start a new bounded round for unfinished work`,pending:working.pendingUrls.length,nextPageUrl:working.cursorUrl,coverage:"blocked"};
              anyFailure=true;break;
            }
          } else batch=await collectColumns({id:batchId,dataDir:options.dataDir,columns:[column],limit:limit-attempted,page:{url:working.cursorUrl,completedUrls:working.completedUrls},fetch:options.fetch,wait:options.wait,guard,signal:currentColumnLease(column)?.signal});
          if(batch.items.some(i=>i.column!==column)||(batch.sources[0]?.pagination&&batch.sources[0].pagination.pageUrl!==working.cursorUrl)) throw new Error("Saved page batch/cursor binding differs");
          await options.checkpoint?.("child-persisted");
          const beforeCursor=working.cursorUrl,beforeCycle=working.cycle;working=advance(working,batch);attempted+=batch.items.length;
          anyFailure ||= working.health!.outcome!=="success";lastCapture=working.health!.lastCaptureAt??lastCapture;
          if(!anyFailure) lastSuccessful=working.health!.lastSuccessAt;
          if(working.health!.outcome!=="success"||working.pendingUrls.length||working.cycle!==beforeCycle||working.cursorUrl===beforeCursor) break;
        }
        if(!working.health) throw new Error("No page result was persisted");
        if(anyFailure) working.health={...working.health,outcome:attempted>0&&entry.batches.some(b=>b!==entry!.batches.at(-1))?"partial":working.health.outcome,lastSuccessAt:entry.before.health?.lastSuccessAt??null};
        else working.health.lastSuccessAt=lastSuccessful;
        working.health.lastCaptureAt=lastCapture;working.revision=entry.before.revision+1;
        entry.after=working;entry.health=working.health;entry.status="ready_to_commit";await save();
      }
      if(!entry.after) throw new Error("Missing committed progress candidate");
      const current=options.store?entry.before:await load(column);
      if(!equal(current,entry.before)&&!equal(current,entry.after)) throw new Error("Column state changed outside this preserved round; reconciliation required");
      await guard();
      await options.checkpoint?.("before-source-commit");
      if(options.store) await options.store.finish(column,id,entry.before,entry.after,entry.batches,(await Promise.all(entry.batches.map(async id=>entry.retainedChildren?.some(child=>child.id===id)?0:(await readBatch(options.dataDir,id)).items.length))).reduce((a,b)=>a+b,0));
      else if(!equal(current,entry.after)) await atomic(stateFile(options.dataDir,column),entry.after);
      await options.checkpoint?.("after-source-commit");
      entry.status="finished";await save();
    }
    const outcomes=round.sources.map(s=>s.health!.outcome);
    round.outcome=outcomes.every(s=>s==="success")?"success":outcomes.every(s=>s==="failure")?"failure":"partial";
    round.finishedAt=new Date().toISOString();round.status="finished";await save();await guard();await rm(activeFile);return round;
  } finally {
    const current=JSON.parse(await readFile(path.join(lock,"owner.json"),"utf8"));
    if(current.instanceId===owner.instanceId) {try{await guard();}catch(error){throw error;}await rm(lock,{recursive:true});}
  }
}
