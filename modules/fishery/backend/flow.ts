import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { config } from "@aihot/backend/config";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { chatJson, type ChatJsonOptions, type ChatJsonResult } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { itemAvailability } from "@aihot/backend/publication/availability";
import { hash, lockDocument, NotFound } from "./store.ts";
import { readCapturedText } from "./column-batches.ts";
import { prepareFisheryDraft, type DraftInput } from "./ai-draft.ts";
import { reviewFisheryDraft, assertFisheryPairFits, fisheryConfigurationVersion } from "./ai-review.ts";
import { sha256 } from "./source-adapters.ts";
import { withFisheryAuthorization, assertFisheryCapacity } from "./authorization.ts";

const identity=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const qualification=z.strictObject({decision:z.enum(["qualified","rejected"]),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().min(1).max(2000)});
export type FisheryInvoke=<S extends z.ZodType>(options:ChatJsonOptions<S>)=>Promise<ChatJsonResult<z.infer<S>>>;
async function snapshot(documentId:string) {
  const [row]=await sql`SELECT d.id,d.source_id,d.article_id,d.withdrawn_reason,s.revision AS source_revision,s.profile,
    o.revision,o.content_hash,o.payload FROM fishery_documents d JOIN fishery_sources s ON s.source_id=d.source_id
    JOIN LATERAL (SELECT * FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1) o ON true WHERE d.id=${documentId}`;
  if(!row) throw new NotFound("Document with observed evidence required");
  if(row.withdrawn_reason) throw new Conflict("Document withdrawn");
  const c=row.payload.sourceCapture;
  if(!c||c.httpStatus!==200||c.parseStatus!=="parsed"||!c.bodySha256||c.conflicts.length) throw new Conflict("Verified archived source body required");
  if(row.article_id) {const available=(await itemAvailability([row.article_id]))[row.article_id];if(!available||!["public","summary-only"].includes(available.status)) throw new Conflict("Linked source article unavailable");}
  const value={executionConfig:fisheryConfigurationVersion(),documentId,sourceId:row.source_id,sourceRevision:row.source_revision,sourceProfileHash:hash(row.profile),observationRevision:row.revision,observationHash:row.content_hash,bodySha256:c.bodySha256,rawSha256:c.rawSha256};
  return {value,hash:hash(value),payload:row.payload,articleId:row.article_id};
}
export function pdfPages(body:string,expected:number) {
  const markers=[...body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  if(!Number.isInteger(expected)||expected<1||markers.length!==expected||markers.some((m,i)=>Number(m[1])!==i+1)) throw new Conflict("PDF page coverage missing or incomplete; no full-document claim");
  return markers.map((m,i)=>({page:i+1,text:body.slice(m.index!+m[0].length,markers[i+1]?.index??body.length).trim()}));
}
async function inputFor(documentId:string,expectedHash:string):Promise<DraftInput> {
  const current=await snapshot(documentId);
  if(current.hash!==expectedHash) throw new Conflict("Source, metadata or rights version changed; create a new task");
  const c=current.payload.sourceCapture;let body:string|null=null;
  if(c.archiveId) body=await readCapturedText(config.dataDir,c.archiveId,c.bodySha256);
  else {
    const [stored]=await sql`SELECT body_text FROM articles WHERE source_id=${current.value.sourceId} AND (id=${current.articleId} OR raw->>'fisheryDocumentId'=${documentId}) ORDER BY created_at DESC LIMIT 1`;
    body=stored?.body_text??null;
  }
  if(!body||sha256(body)!==c.bodySha256||body.length>64000) throw new Conflict("Full bound body missing, changed or oversized; no silent truncation");
  const pages=c.attachmentPages?pdfPages(body,c.attachmentPages):undefined;
  return {pages,documentId,observationRevision:current.value.observationRevision,body,bodySha256:c.bodySha256,language:current.payload.language};
}
export async function createFlow(documentId:string,raw:unknown,actor:string) {
  const data=z.strictObject({identity}).parse(raw),current=await snapshot(documentId);
  return sql.begin(async tx=>{
    await lockDocument(tx,documentId);
    const [old]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${documentId} AND identity=${data.identity}`;
    if(old) {if(hash(old.snapshot)!==current.hash) throw new Conflict("Attempt identity belongs to old evidence");return old;}
    const [sameEvidence]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${documentId} AND snapshot=${tx.json(current.value)} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if(sameEvidence) return sameEvidence;
    const [row]=await tx`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) VALUES (${randomUUID()},${documentId},${data.identity},${tx.json(current.value)},'queued','generation',${actor}) RETURNING *`;
    await audit(actor,"fishery.flow.create",`fishery:${documentId}`,null,null,{id:row!.id,snapshotHash:current.hash},{db:tx});return row!;
  });
}
export async function flowDetail(id:string):Promise<Record<string,any>> {
  const [row]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;if(!row) throw new NotFound("Flow not found");
  let staleReason:string|null=null;try{await inputFor(row.document_id,hash(row.snapshot));}catch(error){staleReason=(error as Error).message;}
  const [latest]=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
  const authoritative=latest?.id===id;
  return {...row,authoritative,snapshotHash:hash(row.snapshot),stale:staleReason!==null,staleReason,internalOnly:true,published:false,
    internalArticle:row.status==="qualified"&&!staleReason&&authoritative?{summaryZh:row.draft?.draft.summaryZh??[],sourceDocumentId:row.document_id,qualifiedBy:row.human_decision?.actor}:null};
}
export async function listFlows(documentId:string) {const rows=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} ORDER BY created_at DESC LIMIT 50`;return Promise.all(rows.map(r=>flowDetail(r.id)));}
async function stageInvoke<S extends z.ZodType>(id:string,snapshotHash:string,stage:string,attempt:number,options:ChatJsonOptions<S>,invoke:FisheryInvoke) {
  options.attemptTag=`fishery-flow:${snapshotHash}:${stage}:${attempt}`;
  options.subject+=`:snapshot:${snapshotHash}:${stage}:${attempt}`;
  const fingerprint=hash({model:options.model,purpose:options.purpose,promptVersion:options.promptVersion,system:options.system,user:options.user,temperature:options.temperature,maxTokens:options.maxTokens,attemptTag:options.attemptTag});
  await sql.begin(async tx=>{
    const [row]=await tx`SELECT stage_requests FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    const key=`${stage}:${attempt}`,previous=row!.stage_requests[key];
    if(previous&&previous.fingerprint!==fingerprint) throw new Conflict("Stage request changed; resume cannot send a different prompt/model/input. Explicit regenerated attempt required");
    if(!previous) {
      row!.stage_requests[key]={fingerprint,subject:options.subject,purpose:options.purpose,promptVersion:options.promptVersion,attemptTag:options.attemptTag};
      await tx`UPDATE fishery_flow_tasks SET stage_requests=${tx.json(row!.stage_requests)},updated_at=now() WHERE id=${id}`;
    }
    // paidRequest reuses received/completed, but automatically retries failed. For this flow an
    // existing failed/pending/unknown receipt must never be resent by a mere resume operation.
    const [receipt]=await tx`SELECT id,status FROM receipts WHERE subject=${options.subject} AND purpose=${options.purpose} ORDER BY id DESC LIMIT 1`;
    if(receipt&&!["received","completed"].includes(receipt.status)) throw new Conflict(`Existing ${receipt.status} receipt ${receipt.id}; reconcile and explicitly regenerate, never blind resume`);
  });
  return invoke(options);
}
export async function runFlow(id:string,invoke:FisheryInvoke) {
  if(!(await flowDetail(id)).authoritative) throw new Conflict("A newer authoritative task supersedes this task");
  const [claimed]=await sql`UPDATE fishery_flow_tasks SET status='running',updated_at=now() WHERE id=${id} AND status='queued' RETURNING *`;
  if(!claimed) throw new Conflict("Flow is not queued; running/failed/unknown outcomes require explicit operator reconciliation");
  let stage=claimed.stage as string,phase="source",receiptId:number|null=null;
  try {
    const input=await inputFor(claimed.document_id,hash(claimed.snapshot));
    let draft=claimed.draft;
    if(stage==="generation") assertFisheryPairFits(input);
    if(stage==="generation") {
      phase="call";
      draft=await prepareFisheryDraft(input,"default",async options=>{
        const answer=await stageInvoke(id,hash(claimed.snapshot),"generation",claimed.generation_attempt,options,invoke);receiptId=answer.receiptId;phase="validate";return answer;
      });
      phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
      await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET draft=${tx.json(draft)},stage='review',updated_at=now() WHERE id=${id}`;await completeReceipt(tx,draft.receiptId);await audit(claimed.actor,"fishery.flow.generated",`fishery:${claimed.document_id}`,null,null,{id,receiptId:draft.receiptId},{db:tx});});stage="review";receiptId=null;
    }
    phase="call";
    const quality=await reviewFisheryDraft(input,draft.draft,"default",async options=>{
      const answer=await stageInvoke(id,hash(claimed.snapshot),"review",claimed.review_attempt,options,invoke);receiptId=answer.receiptId;phase="validate";return answer;
    });
    phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
    await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET quality_review=${tx.json(quality)},status=${quality.status},stage='human',error=NULL,updated_at=now() WHERE id=${id}`;await completeReceipt(tx,quality.receiptId);await audit(claimed.actor,"fishery.flow.checked",`fishery:${claimed.document_id}`,null,null,{id,receiptId:quality.receiptId,status:quality.status},{db:tx});});
  } catch(error) {
    const detail={stage,phase,type:(error as Error).name,reason:(error as Error).message.slice(0,1000),receiptId:(error as {receiptId?:number}).receiptId??receiptId,noAutomaticRetry:true};
    await sql`UPDATE fishery_flow_tasks SET status='failed',stage=${stage},error=${sql.json(detail)},updated_at=now() WHERE id=${id}`;
  }
  return flowDetail(id);
}
export async function retryFlow(id:string,raw:unknown,actor:string) {
  const {note,mode,acknowledgeNewCharge}=z.strictObject({note:z.string().trim().min(1).max(2000),mode:z.enum(["resume","regenerate"]).default("resume"),acknowledgeNewCharge:z.boolean().default(false)}).parse(raw);
  const detail=await flowDetail(id);if(detail.stale||!detail.authoritative) throw new Conflict(detail.staleReason??"Task superseded");
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    if(!row||!["failed","needs_evidence","running"].includes(row.status)) throw new Conflict("Only failed, needs-evidence or reconciled interrupted flows can resume");
    const stage=row.draft?"review":"generation",oldAttempt=stage==="review"?row.review_attempt:row.generation_attempt;
    const bound=row.stage_requests[`${stage}:${oldAttempt}`];
    const [receipt]=bound?await tx`SELECT id,status FROM receipts WHERE subject=${bound.subject} AND purpose=${bound.purpose} ORDER BY id DESC LIMIT 1`:[];
    if(receipt&&["pending","unknown"].includes(receipt.status)) throw new Conflict("Receipt pending/unknown; reconcile outcome before any resume or regeneration");
    if(row.status==="running"&&(!receipt||!["received","completed"].includes(receipt.status))) throw new Conflict("Interrupted task has no reusable received receipt; reconcile manually");
    if(mode==="regenerate") {
      if(row.status==="running") throw new Conflict("Interrupted received result must first resume its existing attempt");
      if(!acknowledgeNewCharge) throw new Conflict("Regeneration may create a new paid call; explicit charge acknowledgement required");
      if(row.error?.phase==="persist") throw new Conflict("Received output persistence failed; resume same attempt to reuse its receipt, do not regenerate");
    } else if(receipt&&receipt.status==="failed") throw new Conflict("Failed receipt cannot resume without sending; explicitly regenerate after reconciliation");
    const attempt=oldAttempt+(mode==="regenerate"?1:0);
    if(attempt>3) throw new Conflict("Three explicit paid attempts per stage exhausted");
    await tx`UPDATE fishery_flow_tasks SET status='queued',stage=${stage},generation_attempt=${stage==="generation"?attempt:row.generation_attempt},review_attempt=${stage==="review"?attempt:row.review_attempt},quality_review=NULL,error=NULL,updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.retry",`fishery:${row.document_id}`,note,null,{id,stage,attempt,mode,receiptId:receipt?.id??null},{db:tx});
    return {id,status:"queued",stage,attempt,mode};
  });
}
export async function decideFlow(id:string,raw:unknown,actor:string) {
  const data=qualification.parse(raw);
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;if(!row) throw new NotFound("Flow not found");
    await lockDocument(tx,row.document_id);
    if(data.snapshotHash!==hash(row.snapshot)) throw new Conflict("Review snapshot changed");
    if(row.status==="running") throw new Conflict("Running task must finish or be reconciled before a human decision");
    if(data.decision==="qualified") {
      const [latest]=await tx`SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if(latest?.id!==id) throw new Conflict("A newer authoritative task supersedes this internal article");
      const before=await snapshot(row.document_id);
      await tx`SELECT source_id FROM fishery_sources WHERE source_id=${before.value.sourceId} FOR SHARE`;
      const current=await snapshot(row.document_id);
      await inputFor(row.document_id,current.hash);
      if(current.hash!==hash(row.snapshot)) throw new Conflict("Review snapshot changed");
      if(!["needs_human_review","qualified","rejected"].includes(row.status)||row.quality_review?.status!=="needs_human_review") throw new Conflict("Independent review and deterministic gates must pass before internal qualification");
    }
    const human={decision:data.decision,note:data.note,actor,snapshotHash:hash(row.snapshot),at:new Date().toISOString(),internalOnly:true};
    await tx`UPDATE fishery_flow_tasks SET status=${data.decision},human_decision=${tx.json(human)},updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.decision",`fishery:${row.document_id}`,data.note,null,{id,...human},{db:tx});return {id,...human,published:false};
  });
}
export async function flowRequiredCalls(id:string) {
  const [task]=await sql`SELECT draft,stage_requests,generation_attempt,review_attempt FROM fishery_flow_tasks WHERE id=${id}`;
  if(!task) throw new NotFound("Flow not found");
  let calls=0;
  for(const stage of task.draft?["review"]:["generation","review"]) {
    const attempt=stage==="generation"?task.generation_attempt:task.review_attempt,bound=task.stage_requests[`${stage}:${attempt}`];
    const [receipt]=bound?await sql`SELECT status FROM receipts WHERE subject=${bound.subject} AND purpose=${bound.purpose} ORDER BY id DESC LIMIT 1`:[];
    if(!receipt||!["received","completed"].includes(receipt.status)) calls++;
  }
  return calls;
}
export const flowQueue=defineQueue<{id:string}>({name:"fishery.flow",options:{policy:"short",retryLimit:0,expireInSeconds:600},worker:{batchSize:1,localConcurrency:1},run:async jobs=>{
  if(!config.modelCallsEnabled) throw new Conflict("MODEL_CALLS_ENABLED is closed; no model request sent");
  return withFisheryAuthorization(async()=>{const rows=[];for(const job of jobs) {const task=await flowDetail(job.id);await assertFisheryCapacity(await flowRequiredCalls(job.id));rows.push(await runFlow(job.id,chatJson));}return rows;});
}});
export async function enqueueFlow(id:string) {const detail=await flowDetail(id);if(detail.stale||!detail.authoritative||detail.status!=="queued") throw new Conflict("Current queued task required");return {id,jobId:await enqueueOn(flowQueue,{id}),status:"queued"};}
