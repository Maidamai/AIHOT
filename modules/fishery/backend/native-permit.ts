// One current document policy for native processing, paid continuations and public reads.
import type postgres from 'postgres';
import {sql,type Db} from '@aihot/backend/db';
import {audit,Conflict} from '@aihot/backend/audit';
import {hash,lockDocument} from './store.ts';

export const reviewOnlyPolicyDocument='5f67141e-47ee-4521-bd66-7e842936c02f';
// Original summaries retain the site's existing unknown-rights preview behavior; this is not
// a redistribution or full-text licence. An explicit refusal or expired permission fails closed.
function sourceSummaryCondition(profile:postgres.PendingQuery<postgres.Row[]>) {
 return sql`(${profile}->>'rightsStatus' NOT IN ('restricted','revoked')
   AND (${profile}->>'rightsStatus'<>'permitted' OR ${profile}->>'allowedSummary'='true' AND ${profile}->>'allowedPublication'='true'
     AND ${profile}->>'rightsCheckedAt' IS NOT NULL AND (${profile}->>'rightsCheckedAt')::timestamptz<=now()
     AND ${profile}->>'reviewDueAt' IS NOT NULL AND (${profile}->>'reviewDueAt')::timestamptz>now()))`;
}

export function nativeArticleCondition(article:postgres.PendingQuery<postgres.Row[]>) {
 return sql`EXISTS (SELECT 1 FROM articles native_a JOIN fishery_documents native_d
   ON native_d.id=native_a.raw->>'fisheryDocumentId' AND native_d.source_id=native_a.source_id AND native_d.canonical_url=native_a.url
   JOIN sources native_s ON native_s.id=native_d.source_id
   JOIN fishery_sources native_f ON native_f.source_id=native_s.id
   JOIN fishery_document_purposes purpose ON purpose.document_id=native_d.id
   JOIN LATERAL(SELECT revision,payload FROM fishery_observations WHERE document_id=native_d.id ORDER BY revision DESC LIMIT 1) native_o ON true
   WHERE native_a.id=${article} AND native_a.body_status='ok' AND native_a.raw->>'mode'='verified-news-candidate'
     AND purpose.purpose='native' AND native_d.id<>${reviewOnlyPolicyDocument} AND native_d.withdrawn_reason IS NULL AND native_s.participation_mode='editorial'
     AND purpose.source_policy=(native_f.profile-ARRAY['attribution','healthNote'])
     AND ${sourceSummaryCondition(sql`native_f.profile`)} AND purpose.observation_revision=native_o.revision
     AND purpose.body_sha256=native_o.payload->'sourceCapture'->>'bodySha256'
     AND purpose.body_sha256=encode(sha256(convert_to(native_a.body_text,'UTF8')),'hex')
     AND native_o.payload->'sourceCapture'->>'parseStatus'='parsed' AND native_o.payload->'sourceCapture'->>'httpStatus'='200'
     AND native_o.payload->'sourceCapture'->'conflicts'='[]'::jsonb
     AND NOT EXISTS (SELECT 1 FROM fishery_reviews rv WHERE rv.document_id=native_d.id AND rv.decision='rejected'
       AND NOT EXISTS (SELECT 1 FROM fishery_reviews later WHERE later.document_id=rv.document_id AND later.id>rv.id AND later.decision='approved'))
     AND NOT EXISTS (SELECT 1 FROM fishery_flow_tasks rejected WHERE rejected.document_id=native_d.id AND rejected.human_decision->>'decision'='rejected'))`;
}
export async function nativeArticlePermit(articleId:string,db:Db=sql):Promise<boolean> {
 const [row]=await db`SELECT (NOT EXISTS(SELECT 1 FROM fishery_sources f WHERE f.source_id=a.source_id) AND NOT EXISTS(SELECT 1 FROM fishery_documents d WHERE d.id=a.raw->>'fisheryDocumentId') AND NOT EXISTS(SELECT 1 FROM fishery_publication_bindings b WHERE b.article_id=a.id))
   OR ${nativeArticleCondition(sql`a.id`)} AS allowed FROM articles a WHERE a.id=${articleId}`;
 return row?.allowed===true;
}

/** Only the capture transaction calls this for a truly new ordinary document or an existing native revision. */
export async function assignNativeDocumentPurpose(documentId:string,db:Db=sql) {
 return db`INSERT INTO fishery_document_purposes(document_id,purpose,source_revision,source_policy,observation_revision,body_sha256,reason)
   SELECT d.id,'native',f.revision,f.profile-ARRAY['attribution','healthNote'],o.revision,o.payload->'sourceCapture'->>'bodySha256','New captured ordinary news; native editorial processing'
   FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id
   JOIN LATERAL(SELECT revision,payload FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true
   WHERE d.id=${documentId} AND d.id<>${reviewOnlyPolicyDocument} AND d.withdrawn_reason IS NULL
     AND o.payload->'sourceCapture'->>'parseStatus'='parsed' AND o.payload->'sourceCapture'->>'bodySha256' IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM fishery_flow_tasks WHERE document_id=d.id)
     AND NOT EXISTS(SELECT 1 FROM fishery_reviews WHERE document_id=d.id)
     AND NOT EXISTS(SELECT 1 FROM fishery_publication_bindings WHERE document_id=d.id)
   ON CONFLICT(document_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,source_policy=EXCLUDED.source_policy,observation_revision=EXCLUDED.observation_revision,
     body_sha256=EXCLUDED.body_sha256,updated_at=now() WHERE fishery_document_purposes.purpose='native' RETURNING document_id`;
}

export async function documentPublicationAllowed(documentId:string,db:Db=sql) {
 const [row]=await db`SELECT d.withdrawn_reason,p.purpose,s.participation_mode,${sourceSummaryCondition(sql`f.profile`)} AS source_allowed FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id JOIN sources s ON s.id=d.source_id LEFT JOIN fishery_document_purposes p ON p.document_id=d.id WHERE d.id=${documentId}`;
 return !!row&&!row.withdrawn_reason&&row.participation_mode==='editorial'&&row.source_allowed&&documentId!==reviewOnlyPolicyDocument&&row.purpose!=='review_only';
}

/** Explicit, bounded handover; never dispatched by a sweep and never reuses paid work. */
export async function migrateOrdinaryDocumentPurpose(documentId:string,actor:string,reason:string,options:{dryRun?:boolean}={}) {
 if(!reason.trim())throw new Conflict('Explicit handover reason required');
 return sql.begin(async tx=>{
  const document=await lockDocument(tx,documentId);
  const [purpose]=await tx`SELECT purpose FROM fishery_document_purposes WHERE document_id=${documentId}`;
  if(purpose)throw new Conflict('An existing document purpose cannot be replaced by handover');
  if(!await documentPublicationAllowed(documentId,tx))throw new Conflict('Document is withdrawn or review-only');
  const tasks=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${documentId} FOR UPDATE`;
  if(!tasks.length)throw new Conflict('Only pristine, unpaid automatic placeholders can be handed over');
  if((await tx`SELECT 1 FROM audit_log WHERE subject=${`fishery:${documentId}`} AND action='fishery.flow.decision' LIMIT 1`).length)throw new Conflict('An explicit editorial decision cannot be released by handover');
  const queued:string[]=[],superseded:{taskId:string;auditId:number}[]=[];
  const supersedeNote='Unstarted automatic placeholder superseded by new source evidence; no paid result was rejected.';
  for(const task of tasks){
   const selection=task.selection;
   if(task.snapshot.documentId!==documentId||task.snapshot.sourceId!==document.source_id||!task.identity.startsWith('auto-')||task.stage!==(selection?'prefilter':'generation')||task.draft||task.quality_review||task.execution_token||task.generation_attempt!==1||task.review_attempt!==1||Object.keys(task.stage_requests).length||selection&&(Object.keys(selection.results??{}).length||selection.structure?.result||selection.outcome))throw new Conflict('Only pristine, unpaid automatic placeholders can be handed over');
   if(task.status==='queued'&&!task.human_decision){queued.push(task.id);continue;}
   const decision=task.human_decision,snapshot=task.snapshot;
   if(task.status!=='rejected'||decision?.decision!=='rejected'||decision.actor!=='automatic-dispatch'||decision.internalOnly!==true||decision.note!==supersedeNote||decision.snapshotHash!==hash(snapshot)||snapshot.documentId!==documentId||!Number.isInteger(snapshot.sourceRevision)||snapshot.sourceRevision<1||!Number.isInteger(snapshot.observationRevision)||snapshot.observationRevision<1)throw new Conflict('Only proven unpaid system-superseded placeholders can accompany pristine queued work');
   // The old dispatcher wrote this exact decision and audit after checking an unstarted task.
   // Do not infer that proof from identity/actor/internalOnly alone, or erase a real decision.
   const [proof]=await tx`SELECT a.id FROM audit_log a JOIN fishery_documents d ON d.id=${documentId}
     JOIN fishery_sources f ON f.source_id=d.source_id
     JOIN fishery_observations o ON o.document_id=d.id AND o.revision=${snapshot.observationRevision}
     WHERE a.actor='automatic-dispatch' AND a.action='fishery.flow.auto_superseded' AND a.subject=${`fishery:${documentId}`}
       AND a.reason=${supersedeNote} AND a.before IS NULL AND a.after->>'id'=${task.id} AND a.after-'id'=${tx.json(decision)}
       AND d.source_id=${snapshot.sourceId} AND f.revision>=${snapshot.sourceRevision}
       AND o.content_hash=${snapshot.observationHash} AND o.payload->'sourceCapture'->>'bodySha256'=${snapshot.bodySha256}
       AND o.payload->'sourceCapture'->>'rawSha256'=${snapshot.rawSha256} LIMIT 1`;
   if(!proof)throw new Conflict('System supersede audit or source snapshot evidence is missing or changed');
   superseded.push({taskId:task.id,auditId:Number(proof.id)});
  }
  if(!queued.length)throw new Conflict('At least one current pristine queued placeholder is required');
  if((await tx`SELECT 1 FROM fishery_reviews WHERE document_id=${documentId} AND decision='rejected'`).length)throw new Conflict('A real material rejection cannot be released by handover');
  if((await tx`SELECT 1 FROM audit_log WHERE subject=${`fishery:${documentId}`} AND action='fishery.flow.eligibility.grant' LIMIT 1`).length)throw new Conflict('A specialized business-review nomination cannot be converted to ordinary automatic publication');
  if((await tx`SELECT 1 FROM fishery_publication_bindings WHERE document_id=${documentId}`).length)throw new Conflict('Existing public bindings retain their original evidence');
  if((await tx`SELECT 1 FROM receipts WHERE subject LIKE ${`%${documentId}%`} LIMIT 1`).length)throw new Conflict('Existing paid work requires individual compatibility review');
  const jobs=await tx`SELECT id,state FROM pgboss.job WHERE name='fishery.flow' AND data->>'id'=ANY(${tasks.map(t=>t.id)}::text[]) FOR UPDATE`;
  if(jobs.some(j=>j.state==='active'))throw new Conflict('Active old executor must settle before handover');
  // Approved raw material is audit history, not a prerequisite of the native editorial route.
  const [r]=await tx`SELECT d.id,d.source_id,f.revision AS source_revision,f.profile,f.profile-ARRAY['attribution','healthNote'] AS source_policy,o.revision,o.content_hash,o.payload FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id
    JOIN LATERAL(SELECT revision,content_hash,payload FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true WHERE d.id=${documentId}`;
  const capture=r?.payload.sourceCapture;
  if(!capture?.bodySha256||capture.parseStatus!=='parsed'||capture.httpStatus!==200||capture.conflicts.length)throw new Conflict('Verified current capture required');
  if(!tasks.some(task=>queued.includes(task.id)&&task.snapshot.documentId===documentId&&task.snapshot.sourceId===r.source_id&&task.snapshot.sourceRevision===r.source_revision&&task.snapshot.sourceProfileHash===hash(r.profile)&&task.snapshot.observationRevision===r.revision&&task.snapshot.observationHash===r.content_hash&&task.snapshot.bodySha256===capture.bodySha256&&task.snapshot.rawSha256===capture.rawSha256))throw new Conflict('A pristine queued placeholder must bind the current source and observation');
  const [article]=await tx`SELECT a.id,a.processing_state,a.backfill,encode(sha256(convert_to(a.body_text,'UTF8')),'hex') AS body_hash
    FROM articles a JOIN fishery_documents d ON d.id=a.raw->>'fisheryDocumentId' AND d.source_id=a.source_id AND d.canonical_url=a.url
    JOIN sources s ON s.id=a.source_id WHERE d.id=${documentId} AND a.raw->>'mode'='verified-news-candidate' AND s.participation_mode='editorial' FOR UPDATE OF a`;
  if(!article||article.backfill||article.processing_state!=='new'||article.body_hash!==capture.bodySha256)throw new Conflict('Current unprocessed ordinary news identity required; historical or changed material is not automatically released');
  if((await tx`SELECT 1 FROM analyses WHERE article_id=${article.id} LIMIT 1`).length||(await tx`SELECT 1 FROM receipts WHERE subject LIKE ${'article:'+article.id+'%'} LIMIT 1`).length)throw new Conflict('Existing native analysis or paid work requires individual compatibility review');
  if(options.dryRun)return {documentId,purpose:'native',wouldRemovePlaceholders:tasks.length,queuedTaskIds:queued,systemSuperseded:superseded,modelCalls:0,dryRun:true};
  await tx`DELETE FROM pgboss.job WHERE name='fishery.flow' AND data->>'id'=ANY(${tasks.map(t=>t.id)}::text[]) AND state IN ('created','retry')`;
  await tx`DELETE FROM fishery_flow_tasks WHERE id=ANY(${tasks.map(t=>t.id)}::text[])`;
  await tx`INSERT INTO fishery_document_purposes(document_id,purpose,source_revision,source_policy,observation_revision,body_sha256,reason)
    VALUES(${documentId},'native',${r.source_revision},${tx.json(r.source_policy)},${r.revision},${r.payload.sourceCapture.bodySha256},${reason})`;
  await audit(actor,'fishery.native.handover',`fishery:${documentId}`,reason,{tasks:tasks.map(t=>({id:t.id,identity:t.identity,status:t.status,decision:t.human_decision,snapshotHash:hash(t.snapshot),classification:queued.includes(t.id)?'pristine_queued':'system_superseded',supersededAuditId:superseded.find(p=>p.taskId===t.id)?.auditId??null}))},{purpose:'native',modelCalls:0},{db:tx});
  return {documentId,purpose:'native',removedPlaceholders:tasks.length,queuedTaskIds:queued,systemSuperseded:superseded,modelCalls:0};
 });
}

/** Explicit migration step: initialize the single documented review-only restriction without rewriting decisions or receipts. */
export async function initializeReviewOnlyPurpose(db:Db=sql) {
 return db`INSERT INTO fishery_document_purposes(document_id,purpose,reason)
   SELECT id,'review_only','Explicitly authorized for review only; existing receipts and decisions are preserved'
   FROM fishery_documents WHERE id=${reviewOnlyPolicyDocument}
   ON CONFLICT(document_id) DO UPDATE SET purpose='review_only',reason=EXCLUDED.reason,updated_at=now()
   RETURNING document_id`;
}
