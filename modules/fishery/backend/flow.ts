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
import { reviewFisheryDraft } from "./ai-review.ts";
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
  const value={documentId,sourceId:row.source_id,sourceRevision:row.source_revision,sourceProfileHash:hash(row.profile),observationRevision:row.revision,observationHash:row.content_hash,bodySha256:c.bodySha256,rawSha256:c.rawSha256};
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
    const [row]=await tx`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) VALUES (${randomUUID()},${documentId},${data.identity},${tx.json(current.value)},'queued','generation',${actor}) RETURNING *`;
    await audit(actor,"fishery.flow.create",`fishery:${documentId}`,null,null,{id:row!.id,snapshotHash:current.hash},{db:tx});return row!;
  });
}
export async function flowDetail(id:string):Promise<Record<string,any>> {
  const [row]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;if(!row) throw new NotFound("Flow not found");
  let staleReason:string|null=null;try{await inputFor(row.document_id,hash(row.snapshot));}catch(error){staleReason=(error as Error).message;}
  return {...row,snapshotHash:hash(row.snapshot),stale:staleReason!==null,staleReason,internalOnly:true,published:false,
    internalArticle:row.status==="qualified"&&!staleReason?{summaryZh:row.draft?.draft.summaryZh??[],sourceDocumentId:row.document_id,qualifiedBy:row.human_decision?.actor}:null};
}
export async function listFlows(documentId:string) {const rows=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} ORDER BY created_at DESC LIMIT 50`;return Promise.all(rows.map(r=>flowDetail(r.id)));}
export async function runFlow(id:string,invoke:FisheryInvoke) {
  const [claimed]=await sql`UPDATE fishery_flow_tasks SET status='running',updated_at=now() WHERE id=${id} AND status='queued' RETURNING *`;
  if(!claimed) throw new Conflict("Flow is not queued; running/failed/unknown outcomes require explicit operator reconciliation");
  let stage=claimed.stage as string;
  try {
    const input=await inputFor(claimed.document_id,hash(claimed.snapshot));
    let draft=claimed.draft;
    if(stage==="generation") {
      draft=await prepareFisheryDraft(input,"default",options=>{options.subject+=`:flow:${id}:generation:${claimed.generation_attempt}`;return invoke(options);});
      await inputFor(claimed.document_id,hash(claimed.snapshot));
      await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET draft=${tx.json(draft)},stage='review',updated_at=now() WHERE id=${id}`;await completeReceipt(tx,draft.receiptId);await audit(claimed.actor,"fishery.flow.generated",`fishery:${claimed.document_id}`,null,null,{id,receiptId:draft.receiptId},{db:tx});});stage="review";
    }
    const quality=await reviewFisheryDraft(input,draft.draft,"default",options=>{options.subject+=`:flow:${id}:review:${claimed.review_attempt}`;return invoke(options);});
    await inputFor(claimed.document_id,hash(claimed.snapshot));
    await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET quality_review=${tx.json(quality)},status=${quality.status},stage='human',error=NULL,updated_at=now() WHERE id=${id}`;await completeReceipt(tx,quality.receiptId);await audit(claimed.actor,"fishery.flow.checked",`fishery:${claimed.document_id}`,null,null,{id,receiptId:quality.receiptId,status:quality.status},{db:tx});});
  } catch(error) {
    const detail={stage,type:(error as Error).name,reason:(error as Error).message.slice(0,1000),receiptId:(error as {receiptId?:number}).receiptId??null,noAutomaticRetry:true};
    await sql`UPDATE fishery_flow_tasks SET status='failed',stage=${stage},error=${sql.json(detail)},updated_at=now() WHERE id=${id}`;
  }
  return flowDetail(id);
}
export async function retryFlow(id:string,raw:unknown,actor:string) {
  const {note}=z.strictObject({note:z.string().trim().min(1).max(2000)}).parse(raw);
  const detail=await flowDetail(id);if(detail.stale) throw new Conflict(detail.staleReason!);
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    if(!row||!["failed","needs_evidence"].includes(row.status)) throw new Conflict("Only failed or needs-evidence flows can retry; reconcile running outcomes first");
    const stage=row.draft?"review":"generation",attempt=(stage==="review"?row.review_attempt:row.generation_attempt)+1;
    if(attempt>3) throw new Conflict("Three explicit attempts per stage exhausted; inspect evidence before creating another identity");
    await tx`UPDATE fishery_flow_tasks SET status='queued',stage=${stage},generation_attempt=${stage==="generation"?attempt:row.generation_attempt},review_attempt=${stage==="review"?attempt:row.review_attempt},quality_review=NULL,error=NULL,updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.retry",`fishery:${row.document_id}`,note,null,{id,stage,attempt},{db:tx});
    return {id,status:"queued",stage,attempt};
  });
}
export async function decideFlow(id:string,raw:unknown,actor:string) {
  const data=qualification.parse(raw);
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;if(!row) throw new NotFound("Flow not found");
    await lockDocument(tx,row.document_id);
    const before=await snapshot(row.document_id);
    await tx`SELECT source_id FROM fishery_sources WHERE source_id=${before.value.sourceId} FOR SHARE`;
    const current=await snapshot(row.document_id);
    await inputFor(row.document_id,current.hash);
    if(current.hash!==hash(row.snapshot)||data.snapshotHash!==current.hash) throw new Conflict("Review snapshot changed");
    if(!["needs_human_review","qualified","rejected"].includes(row.status)||row.quality_review?.status!=="needs_human_review") throw new Conflict("Independent review and deterministic gates must pass before internal qualification");
    const human={decision:data.decision,note:data.note,actor,snapshotHash:current.hash,at:new Date().toISOString(),internalOnly:true};
    await tx`UPDATE fishery_flow_tasks SET status=${data.decision},human_decision=${tx.json(human)},updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.decision",`fishery:${row.document_id}`,data.note,null,{id,...human},{db:tx});return {id,...human,published:false};
  });
}
export const flowQueue=defineQueue<{id:string}>({name:"fishery.flow",options:{policy:"short",retryLimit:0,expireInSeconds:600},worker:{batchSize:1,localConcurrency:1},run:async jobs=>{
  if(!config.modelCallsEnabled) throw new Conflict("MODEL_CALLS_ENABLED is closed; no model request sent");
  return withFisheryAuthorization(async()=>{const rows=[];for(const job of jobs) {const task=await flowDetail(job.id);await assertFisheryCapacity(task.draft?1:2);rows.push(await runFlow(job.id,chatJson));}return rows;});
}});
export async function enqueueFlow(id:string) {const detail=await flowDetail(id);if(detail.stale||detail.status!=="queued") throw new Conflict("Current queued task required");return {id,jobId:await enqueueOn(flowQueue,{id}),status:"queued"};}
