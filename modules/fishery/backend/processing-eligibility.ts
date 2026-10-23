// A bounded, version-bound invitation to review business usefulness, never a validity or publication decision.
import {z} from 'zod';
import {sql,type Db} from '@aihot/backend/db';
import {audit,Conflict} from '@aihot/backend/audit';
import {lockDocument,NotFound} from './store.ts';
import {readSourceBody} from './source-body.ts';
import {sha256} from './source-adapters.ts';

const grant='fishery.flow.eligibility.grant',revoke='fishery.flow.eligibility.revoke';
const input=z.strictObject({revision:z.number().int().positive(),sourceRevision:z.number().int().positive(),kind:z.enum(['policy','open_window','regulation_change']),evidenceQuote:z.string().trim().min(12).max(1500),reason:z.string().trim().min(12).max(2000),expiresAt:z.iso.datetime()});
const supported=['fishery-column-moa','fishery-column-fujian','fishery-column-fujian-notices','fishery-column-jfa-press','fishery-column-npfc'];
async function current(id:string,db:Db){
 const [r]=await db`SELECT d.id,d.source_id,d.withdrawn_reason,s.participation_mode,f.revision AS source_revision,o.revision,o.payload,
   rv.id AS review_id,rv.decision,rv.revision AS review_revision,rv.source_revision AS review_source_revision
   FROM fishery_documents d JOIN sources s ON s.id=d.source_id JOIN fishery_sources f ON f.source_id=s.id
   JOIN LATERAL(SELECT revision,payload FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1)o ON true
   LEFT JOIN LATERAL(SELECT id,decision,revision,source_revision FROM fishery_reviews WHERE document_id=d.id ORDER BY id DESC LIMIT 1)rv ON true
   WHERE d.id=${id}`;
 if(!r)throw new NotFound('Observed material required');return r;
}
function approved(r:Record<string,any>){const c=r.payload.sourceCapture;return !r.withdrawn_reason&&r.participation_mode==='editorial'&&supported.includes(r.source_id)&&r.decision==='approved'&&r.review_revision===r.revision&&r.review_source_revision===r.source_revision&&c?.parseStatus==='parsed'&&c.httpStatus===200&&c.bodySha256&&!c.conflicts.length;}
export async function processingEligibility(id:string,db:Db=sql){
 const [a]=await db`SELECT id,action,after FROM audit_log WHERE subject=${`fishery:${id}`} AND action IN (${grant},${revoke}) ORDER BY id DESC LIMIT 1`;
 if(!a)return {eligible:false,reason:'尚未提名业务审核；历史展示不等于已拒绝。',nomination:null};
 const n=a.after;let status:'current'|'stale'|'expired'|'revoked'='current';
 if(a.action===revoke)status='revoked';
 else if(Date.parse(n.expiresAt)<=Date.now())status='expired';
 else {const r=await current(id,db);if(!approved(r)||r.revision!==n.revision||r.source_revision!==n.sourceRevision||String(r.review_id)!==String(n.materialReviewId)||r.payload.sourceCapture?.bodySha256!==n.bodySha256)status='stale';}
 return {eligible:status==='current',reason:({current:'当前证据版本已获准进入业务审核；不证明现行有效或允许发布。',stale:'正文、来源或素材审核已变化，需重新核对后提名。',expired:'业务审核处理期已到；不等于政策失效。',revoked:'业务审核资格已撤销。'})[status],nomination:{...n,id:Number(a.id),status}};
}
export async function activeProcessingCandidates(db:Db=sql){
 return db`SELECT subject,after,id FROM (SELECT DISTINCT ON(subject) subject,action,after,id FROM audit_log WHERE action IN (${grant},${revoke}) ORDER BY subject,id DESC)a WHERE action=${grant} AND after->>'expiresAt'>${new Date().toISOString()} ORDER BY id LIMIT 20`;
}
export async function nominateProcessing(id:string,raw:unknown,actor:string){
 const data=input.parse(raw),expiry=Date.parse(data.expiresAt),now=Date.now();
 if(expiry<=now||expiry>now+30*86400000)throw new Conflict('审核处理期须在未来30天内；不代表政策有效期');
 return sql.begin(async tx=>{
  // The shared cap prevents separate administrators from opening an unbounded historical queue.
  await tx`SELECT pg_advisory_xact_lock(hashtextextended('fishery.processing-eligibility',0))`;
  await lockDocument(tx,id);const r=await current(id,tx);
  if(!approved(r)||data.revision!==r.revision||data.sourceRevision!==r.source_revision)throw new Conflict('先核验完整正文并通过当前版本素材审核；旧版审核、被拒或提取失败不能提名');
  const body=await readSourceBody(r.payload.sourceCapture);
  if(!body||sha256(body)!==r.payload.sourceCapture.bodySha256||!body.includes(data.evidenceQuote))throw new Conflict('业务依据须逐字引用当前已归档的完整正文');
  const active=await activeProcessingCandidates(tx);
  if(active.length>=20&&!active.some(a=>a.subject===`fishery:${id}`))throw new Conflict('已有20条有界业务候选，请先处理或撤销后再增加');
  const prior=await processingEligibility(id,tx),value={...data,bodySha256:r.payload.sourceCapture.bodySha256,materialReviewId:Number(r.review_id)};
  if(prior.eligible&&Object.entries(value).every(([k,v])=>prior.nomination?.[k]===v))return prior;
  await audit(actor,grant,`fishery:${id}`,data.reason,null,value,{db:tx});
  return processingEligibility(id,tx);
 });
}
export async function revokeProcessing(id:string,raw:unknown,actor:string){
 const {reason}=z.strictObject({reason:z.string().trim().min(12).max(2000)}).parse(raw);
 return sql.begin(async tx=>{await lockDocument(tx,id);const prior=await processingEligibility(id,tx);if(!prior.nomination)return prior;
  await audit(actor,revoke,`fishery:${id}`,reason,prior.nomination,{...prior.nomination,reason},{db:tx});return processingEligibility(id,tx);
 });
}
