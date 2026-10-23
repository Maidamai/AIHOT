// The existing flow table is the durable continuation of captured documents. No paid retry loop.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,type Db} from '@aihot/backend/db';
import {audit,Conflict} from '@aihot/backend/audit';
import {getBoss,enqueueOn} from '@aihot/backend/jobs/queue';
import {createFlow,flowDetail,flowQueue} from './flow.ts';
import {fisheryConfigurationVersion} from './ai-review.ts';
import {hash,lockDocument,NotFound} from './store.ts';
import {activeProcessingCandidates,processingEligibility} from './processing-eligibility.ts';

export const AUTOMATIC_FLOW_KEY='fishery.flow.dispatch';
const sourceId=z.enum(['fishery-column-moa','fishery-column-fujian','fishery-column-fujian-notices','fishery-column-jfa-press','fishery-column-npfc']);
const policy=z.strictObject({enabled:z.boolean(),sourceIds:z.array(sourceId).min(1).max(5).refine(ids=>new Set(ids).size===ids.length,'Duplicate source').transform(ids=>ids.sort()),createdAfter:z.iso.datetime(),documentIds:z.array(z.uuid()).min(1).max(20).optional()});
const stored=policy.extend({revision:z.uuid()});
// Explicit one-row operational upgrade, outside online schema migrations. It preserves scope,
// revision, timestamps and paid authorization; it never enables another source.
export async function upgradeAutomaticFlowSources(actor:string){
  return sql.begin(async tx=>{
    const [r]=await tx`SELECT value FROM settings WHERE key=${AUTOMATIC_FLOW_KEY} FOR UPDATE`;
    if(!r)return null;if(!('sourceId' in r.value))return stored.parse(r.value);
    const {sourceId:id,...old}=policy.omit({sourceIds:true}).extend({sourceId,revision:z.uuid()}).parse(r.value);
    const next=stored.parse({...old,sourceIds:[id]});
    await tx`UPDATE settings SET value=${tx.json(next)} WHERE key=${AUTOMATIC_FLOW_KEY}`;
    await audit(actor,'fishery.flow.dispatch.upgrade',AUTOMATIC_FLOW_KEY,'Same authorized source represented as a set; no scope or budget change',r.value,next,{db:tx});return next;
  });
}
export interface AutomaticFlowBinding {revision:string;snapshotHash:string;materialReviewId:number;processingEligibilityId?:number;}
interface DispatchRow {documentId:string;taskId?:string;state:string;jobId?:string;reason?:string;}
async function lockAutomaticDocument(db:Db,documentId:string){
  // Imports own sources before documents; every producer follows that order.
  await db`SELECT s.id FROM sources s JOIN fishery_documents d ON d.source_id=s.id WHERE d.id=${documentId} FOR SHARE OF s`;
  await db`SELECT f.source_id FROM fishery_sources f JOIN fishery_documents d ON d.source_id=f.source_id WHERE d.id=${documentId} FOR SHARE OF f`;
  return lockDocument(db,documentId);
}
async function supersedeUnstarted(documentId:string,id:string,expected:{source_revision:number;revision:number;content_hash:string},rulesHash:string){
  return sql.begin(async tx=>{
    await lockAutomaticDocument(tx,documentId);
    const [version]=await tx`SELECT f.revision AS source_revision,o.revision,o.content_hash FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id
      JOIN LATERAL(SELECT revision,content_hash FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true WHERE d.id=${documentId}`;
    if(!version||version.source_revision!==expected.source_revision||version.revision!==expected.revision||version.content_hash!==expected.content_hash||hash({execution:fisheryConfigurationVersion(),discovery:'core-news/v1'})!==rulesHash)
      throw new Conflict('Automatic dispatch read an older evidence version; keep the newer task unchanged');
    const [old]=await tx`SELECT id,identity,status,snapshot,draft,stage_requests FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    if(!old?.identity.startsWith('auto-')||old.status!=='queued'||old.draft||Object.keys(old.stage_requests).length)return;
    if(old.snapshot.sourceRevision===version.source_revision&&old.snapshot.observationRevision===version.revision&&old.snapshot.executionConfig===fisheryConfigurationVersion())return;
    const decision={decision:'rejected',snapshotHash:hash(old.snapshot),actor:'automatic-dispatch',at:new Date().toISOString(),note:'Unstarted automatic placeholder superseded by new source evidence; no paid result was rejected.',internalOnly:true};
    await tx`UPDATE fishery_flow_tasks SET status='rejected',human_decision=${tx.json(decision)},updated_at=now() WHERE id=${id}`;
    await audit('automatic-dispatch','fishery.flow.auto_superseded',`fishery:${documentId}`,decision.note,null,{id,...decision},{db:tx});
  });
}
async function configuration(db:Db=sql,lock=false){const [r]=await db`SELECT value FROM settings WHERE key=${AUTOMATIC_FLOW_KEY} ${lock?db`FOR SHARE`:db``}`;return r?stored.parse(r.value):null;}
export async function configureAutomaticFlows(input:unknown,actor:string,reason:string){
  const value=policy.parse(input);if(!actor.trim()||reason.trim().length<12)throw new Error('Explicit operator and reason required');
  return sql.begin(async tx=>{const old=await configuration(tx);if(old&&hash({...old,revision:undefined})===hash(value))return old;
    const next={...value,revision:randomUUID()};await tx`INSERT INTO settings(key,value,updated_by) VALUES(${AUTOMATIC_FLOW_KEY},${tx.json(next)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    await audit(actor,'fishery.flow.dispatch.configure',AUTOMATIC_FLOW_KEY,reason,old,next,{db:tx});return next;});
}
export async function automaticFlowPermit(id:string,binding?:AutomaticFlowBinding,db:Db=sql){
  const c=await configuration(db,true);if(!c?.enabled)throw new Conflict('Automatic flow dispatch is disabled');
  if(binding&&binding.revision!==c.revision)throw new Conflict('Automatic dispatch configuration changed');
  const [r]=await db`SELECT t.id,t.document_id,t.status,t.snapshot,d.source_id,d.created_at,d.withdrawn_reason,s.participation_mode,
    o.revision AS observation_revision,f.revision AS source_revision,rv.id AS review_id,rv.decision,rv.revision AS review_revision,rv.source_revision AS review_source_revision
    FROM fishery_flow_tasks t JOIN fishery_documents d ON d.id=t.document_id JOIN sources s ON s.id=d.source_id JOIN fishery_sources f ON f.source_id=s.id
    JOIN LATERAL(SELECT revision FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true
    LEFT JOIN LATERAL(SELECT id,decision,revision,source_revision FROM fishery_reviews WHERE document_id=d.id ORDER BY id DESC LIMIT 1)rv ON true
    WHERE t.id=${id} FOR SHARE OF s,f`;
  if(!r||!c.sourceIds.includes(r.source_id)||c.documentIds&&!c.documentIds.includes(r.document_id))throw new Conflict('Document is outside automatic dispatch scope');
  const [core]=await db`SELECT backfill,body_status,encode(sha256(convert_to(body_text,'UTF8')),'hex') AS body_hash FROM articles WHERE source_id=${r.source_id} AND raw->>'fisheryDocumentId'=${r.document_id} LIMIT 1`;
  const ordinary=new Date(r.created_at)>=new Date(c.createdAfter)&&core&&!core.backfill&&core.body_status==='ok';
  const eligibility=ordinary?null:await processingEligibility(r.document_id,db);
  if(!ordinary&&!eligibility?.eligible)throw new Conflict('Historical or undated reference requires a current bounded business-review nomination');
  if(core&&core.body_hash!==r.snapshot.bodySha256)
    throw new Conflict('Core news body differs from current evidence; recapture before any model request');
  if(r.withdrawn_reason||r.participation_mode!=='editorial')throw new Conflict('Source isolated or document withdrawn');
  if(r.decision!=='approved'||r.review_revision!==r.observation_revision||r.review_source_revision!==r.source_revision)throw new Conflict('Waiting for current material approval; no automatic model request');
  const detail=await flowDetail(id);if(detail.stale||!detail.authoritative||!['queued','running'].includes(r.status))throw new Conflict('Current queued/running evidence-bound flow required');
  const current={revision:c.revision,snapshotHash:detail.snapshotHash,materialReviewId:Number(r.review_id),...eligibility?.eligible?{processingEligibilityId:eligibility.nomination!.id}:{}};
  if(binding&&hash(binding)!==hash(current))throw new Conflict('Automatic material approval or snapshot changed');
  return current;
}
export async function dispatchAutomaticDocuments(ids?:string[],options:{assertHeld?:()=>Promise<void>}={}){
  const c=await configuration();if(!c?.enabled)return {enabled:false,rows:[]};
  // Ordinary discovery stays date-bounded. Individually nominated current evidence is a separate
  // review scope; it never changes backfill, publication date, selection or final approval.
  const nominated=(await activeProcessingCandidates()).map(a=>a.subject.slice('fishery:'.length));
  const rulesHash=hash({execution:fisheryConfigurationVersion(),discovery:'core-news/v1'});
  const docs=await sql`SELECT d.id,d.source_id,f.revision AS source_revision,o.revision,o.content_hash,s.participation_mode,rv.id AS review_id,coalesce(news.revision,0) AS core_revision,eligibility.id AS eligibility_id
    FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id JOIN sources s ON s.id=d.source_id
    JOIN LATERAL(SELECT revision,content_hash FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true
    LEFT JOIN LATERAL(SELECT id FROM fishery_reviews WHERE document_id=d.id ORDER BY id DESC LIMIT 1)rv ON true
    LEFT JOIN LATERAL(SELECT a.revision,a.backfill FROM articles a WHERE a.source_id=d.source_id AND a.raw->>'fisheryDocumentId'=d.id AND a.body_status='ok' LIMIT 1)news ON true
    LEFT JOIN LATERAL(SELECT id FROM audit_log WHERE subject='fishery:'||d.id AND action IN ('fishery.flow.eligibility.grant','fishery.flow.eligibility.revoke') ORDER BY id DESC LIMIT 1)eligibility ON true
    WHERE d.source_id IN ${sql(c.sourceIds)} AND ((d.created_at>=${new Date(c.createdAfter)} AND NOT news.backfill) OR d.id IN ${sql(nominated.length?nominated:['00000000-0000-0000-0000-000000000000'])})
      ${c.documentIds?sql`AND d.id IN ${sql(c.documentIds)}`:sql``} ${ids?sql`AND d.id IN ${sql(ids.length?ids:['00000000-0000-0000-0000-000000000000'])}`:sql``}
      AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.subject='fishery:'||d.id AND a.action='fishery.flow.auto_checked'
        AND a.after->>'configurationRevision'=${c.revision} AND a.after->>'sourceRevision'=f.revision::text
        AND a.after->>'observationRevision'=o.revision::text AND a.after->>'materialReviewId'=coalesce(rv.id::text,'none')
        AND a.after->>'sourceMode'=s.participation_mode AND a.after->>'rulesHash'=${rulesHash} AND a.after->>'coreRevision'=coalesce(news.revision,0)::text
        AND coalesce(a.after->>'processingEligibilityId','none')=coalesce(eligibility.id::text,'none'))
    ORDER BY d.created_at,d.id LIMIT 5`;
  const rows:DispatchRow[]=[];
  for(const d of docs){
    await options.assertHeld?.();
    try{
      const identity=`auto-${hash({source:d.source_id,sourceRevision:d.source_revision,observation:d.revision,content:d.content_hash,rules:rulesHash}).slice(0,48)}`;
      // A changed body may supersede only a pristine, never-sent automatic placeholder. Running,
      // failed and receipt-bearing tasks keep their ordinary explicit reconciliation requirements.
      const [old]=await sql`SELECT id,identity,status,snapshot,draft,stage_requests FROM fishery_flow_tasks WHERE document_id=${d.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if(old?.identity.startsWith('auto-')&&old.identity!==identity&&old.status==='queued'&&!old.draft&&!Object.keys(old.stage_requests).length)
        await supersedeUnstarted(d.id,old.id,d as never,rulesHash);
      const task=await createFlow(d.id,{identity,selection:true},'automatic-dispatch');
      if(!task.identity.startsWith('auto-')||task.status!=='queued'){rows.push({documentId:d.id,taskId:task.id,state:task.status});}
      else {
      await getBoss({schedule:false,supervise:false});
      const result=await sql.begin(async tx=>{
        await lockAutomaticDocument(tx,d.id);await options.assertHeld?.();
        const automatic=await automaticFlowPermit(task.id,undefined,tx),dispatchKey=hash({id:task.id,...automatic});
        if((await tx`SELECT 1 FROM audit_log WHERE action='fishery.flow.auto_enqueued' AND subject=${`fishery:${d.id}`} AND after->>'dispatchKey'=${dispatchKey} LIMIT 1`).length)return {state:'already_dispatched'};
        const jobId=await enqueueOn(flowQueue,{id:task.id,automatic},{singletonKey:`automatic:${task.id}`},tx);
        if(!jobId)return {state:'already_queued'};
        await audit('automatic-dispatch','fishery.flow.auto_enqueued',`fishery:${d.id}`,'Current material approval permits the existing evidence-generation flow; final approval remains separate',null,{id:task.id,jobId,dispatchKey,automatic},{db:tx});
        return {state:'enqueued',jobId};
      });
      rows.push({documentId:d.id,taskId:task.id,...result});
      }
    }catch(error){
      // A DB/queue outage is not an evidence decision. Leave no checked marker, so the existing
      // maintenance pass can recover a committed import/task whose enqueue never committed.
      if(!(error instanceof Conflict||error instanceof NotFound))throw error;
      rows.push({documentId:d.id,state:'blocked',reason:String((error as Error).message).slice(0,300)});
    }
    await options.assertHeld?.();
    await audit('automatic-dispatch','fishery.flow.auto_checked',`fishery:${d.id}`,'Bounded automatic continuation checked this exact evidence/approval version',null,
      {configurationRevision:c.revision,sourceRevision:d.source_revision,observationRevision:d.revision,materialReviewId:String(d.review_id??'none'),sourceMode:d.participation_mode,coreRevision:d.core_revision,...d.eligibility_id?{processingEligibilityId:String(d.eligibility_id)}:{},rulesHash,result:rows.at(-1)},{db:sql});
  }
  return {enabled:true,revision:c.revision,rows};
}
