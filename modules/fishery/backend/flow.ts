import { randomUUID } from "node:crypto";
import type { FlowTimeline } from "../ui-contracts.ts";
import { z } from "zod";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { config } from "@aihot/backend/config";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { chatJson, type ChatJsonOptions, type ChatJsonResult } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { itemAvailability } from "@aihot/backend/publication/availability";
import { hash, lockDocument, NotFound } from "./store.ts";
import { readCapturedText } from "./column-batches.ts";
import { prepareFisheryDraft, buildFisheryDraftRequest, fisheryDraftWireSchema, fisheryDraftSchema, validateFisheryDraft, type DraftInput } from "./ai-draft.ts";
import { reviewFisheryDraft, buildFisheryReviewRequest, fisheryWireBytes, assertFisheryPairFits, fisheryConfigurationVersion } from "./ai-review.ts";
import { sha256 } from "./source-adapters.ts";
import { withFisheryAuthorization, assertFisheryCapacity } from "./authorization.ts";

import { buildEvidenceCatalog, evidenceBinding, anchorIds } from "./evidence.ts";
import { TRIAL } from "./trial-transport.ts";

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
// Revision provenance is admin-only; it is never included in reviewFisheryDraft input.
export async function revisionContext(id:string) {
  const [original]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;
  if(!original) throw new NotFound("Original flow not found");
  const manual=original.draft?.provenance?.origin==="human_revision";
  if(!(manual?["failed","needs_evidence","rejected"]:["failed","needs_evidence"]).includes(original.status)) throw new Conflict("Only settled failed or needs-evidence candidates, or rejected manual revisions, can be revised");
  for(const request of Object.values(original.stage_requests??{}) as {subject:string;purpose:string}[]) {
    const [uncertain]=await sql`SELECT id FROM receipts WHERE subject=${request.subject} AND purpose=${request.purpose} AND status IN ('pending','unknown') LIMIT 1`;
    if(uncertain) throw new Conflict("Parent has pending/unknown receipt; reconcile before revision");
  }
  let generation=original;
  if(manual) {
    if(original.draft.provenance.candidateHash!==sha256(JSON.stringify(fisheryDraftSchema.parse(original.draft.draft)))) throw new Conflict("Parent manual candidate hash changed");
    const rootId=original.draft.provenance.originalGenerationTaskId??original.draft.provenance.originalTaskId;
    const [root]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${rootId}`;
    if(!root||root.document_id!==original.document_id||root.draft?.provenance) throw new Conflict("Invalid original generation lineage");
    generation=root;
  }
  const current=await snapshot(original.document_id),input=await inputFor(original.document_id,current.hash),catalog=buildEvidenceCatalog(input);
  const receiptId=generation.draft?.receiptId??generation.error?.receiptId;
  const [receipt]=receiptId?await sql`SELECT id,response,status,purpose,subject FROM receipts WHERE id=${receiptId}`:[];
  if(!receipt||!receipt.response||!["received","completed","failed"].includes(receipt.status)) throw new Conflict("A reconciled received original response is required");
  const generationRequests=Object.entries(generation.stage_requests??{}).filter(([key])=>key.startsWith("generation:")).map(([,request])=>request as {subject:string;purpose:string});
  if(receipt.purpose!=="fishery_draft"||!generationRequests.some(request=>request.subject===receipt.subject&&request.purpose===receipt.purpose)) throw new Conflict("Original receipt is not bound to this task generation stage");
  const response=receipt.response;
  if(manual&&(original.draft.provenance.receiptId!==receipt.id||original.draft.provenance.responseHash!==hash(response))) throw new Conflict("Original generation receipt provenance changed");
  let candidate:unknown=original.draft?.draft??null;
  if(!manual) try {candidate=JSON.parse(response?.choices?.[0]?.message?.content??"null")??candidate;}catch{/* Preserve malformed original as provenance, never silently parse it. */}
  let editable=candidate;
  if(manual&&hash(original.snapshot)===current.hash) {
    // Canonical parent anchors may become IDs only in the identical current catalog; never migrate old versions.
    const convert=(value:any):any=>Array.isArray(value)?value.map(convert):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==="evidence"?anchorIds(catalog,v as any):convert(v)])):value;
    editable=convert(candidate);
  }
  const unknownDate={date:{precision:"unknown",value:null},evidence:[]};
  const template={relevance:{decision:"unknown",reason:"待人工选择当前证据",evidence:[]},summaryZh:[],dates:{published:unknownDate,event:unknownDate,adopted:unknownDate,effective:unknownDate,objectionDeadline:unknownDate},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
  return {originalTaskId:id,originalGenerationTaskId:generation.id,documentId:original.document_id,receiptId:receipt.id,responseHash:hash(response),snapshotHash:current.hash,evidenceCatalog:catalog,originalCandidate:candidate,candidate:hash(original.snapshot)===current.hash&&editable?editable:template,originalContent:typeof response?.choices?.[0]?.message?.content==="string"?response.choices[0].message.content:null};
}
export async function createHumanRevision(id:string,raw:unknown,actor:string) {
  const data=z.strictObject({identity,snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(2000),candidate:z.unknown()}).parse(raw);
  const context=await revisionContext(id);
  if(data.snapshotHash!==context.snapshotHash||data.evidenceHash!==context.evidenceCatalog.hash) throw new Conflict("Current snapshot or evidence catalog changed; reload and select current IDs");
  const input=await inputFor(context.documentId,context.snapshotHash),catalog=buildEvidenceCatalog(input);
  const candidate=(()=>{try{return validateFisheryDraft(input,fisheryDraftWireSchema(catalog).parse(data.candidate));}catch(error){throw new Conflict(`Candidate validation refused: ${(error as Error).message.slice(0,2000)}`);}})();
  if(candidate.relevance.decision!=="relevant"||!candidate.summaryZh.length) throw new Conflict("Revision requires relevant nonempty supported summary");
  if(fisheryWireBytes(buildFisheryReviewRequest(input,candidate,"default"))>TRIAL.maxWireBytes) throw new Conflict("Full source and revision review exceed wire capacity; no request sent");
  const candidateHash=sha256(JSON.stringify(candidate)),current=await snapshot(context.documentId);
  const provenance={origin:"human_revision",originalTaskId:id,directParentTaskId:id,originalGenerationTaskId:context.originalGenerationTaskId,receiptId:context.receiptId,responseHash:context.responseHash,actor,at:new Date().toISOString(),reason:data.reason,candidateHash,
    diff:{before:context.originalCandidate,after:data.candidate}};
  const draft={receiptId:null,model:"human_revision",promptVersion:buildFisheryDraftRequest(input,"default").promptVersion,schemaVersion:"fishery-draft-wire-v5",evidenceCatalog:evidenceBinding(catalog),draft:candidate,provenance};
  return sql.begin(async tx=>{
    await lockDocument(tx,context.documentId);
    if((await snapshot(context.documentId)).hash!==context.snapshotHash) throw new Conflict("Snapshot changed while saving revision");
    const [old]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${context.documentId} AND identity=${data.identity}`;
    if(old) {if(old.draft?.provenance?.candidateHash!==candidateHash||hash(old.snapshot)!==context.snapshotHash) throw new Conflict("Revision identity already belongs to a different candidate");return old;}
    const [same]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${context.documentId} AND snapshot=${tx.json(current.value)} AND draft->'provenance'->>'candidateHash'=${candidateHash} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if(same) return same;
    const [row]=await tx`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor,draft) VALUES (${randomUUID()},${context.documentId},${data.identity},${tx.json(current.value)},'queued','review',${actor},${tx.json(JSON.parse(JSON.stringify(draft)))}) RETURNING *`;
    await audit(actor,"fishery.flow.human_revision",`fishery:${context.documentId}`,data.reason,null,{id:row!.id,snapshotHash:context.snapshotHash,...provenance},{db:tx});
    return row!;
  });
}
function candidateReviewBound(row:Record<string,any>) {
  try {const candidateHash=sha256(JSON.stringify(fisheryDraftSchema.parse(row.draft?.draft)));return row.quality_review?.draftSha256===candidateHash&&(!row.draft.provenance||row.draft.provenance.candidateHash===candidateHash);}catch{return false;}
}
async function flowTimeline(row:Record<string,any>,now:Date):Promise<FlowTimeline> {
  // Read the task's bound revision, never a newer observation or the model's publication guess.
  const [observation]=await sql`SELECT payload FROM fishery_observations WHERE document_id=${row.document_id} AND revision=${row.snapshot.observationRevision}`;
  const unknown={precision:"unknown" as const,value:null},payload=observation?.payload,capture=payload?.sourceCapture;
  const sourcePublished=payload?.dates.published??unknown;
  const [times]=await sql`SELECT
    max(created_at) FILTER (WHERE action='fishery.flow.generated' AND after->>'receiptId'=${String(row.draft?.receiptId??"")}) AS generated_at,
    max(created_at) FILTER (WHERE action='fishery.flow.checked' AND after->>'receiptId'=${String(row.quality_review?.receiptId??"")}) AS checked_at
    FROM audit_log WHERE subject=${`fishery:${row.document_id}`} AND after->>'id'=${row.id}`;
  const iso=(value:Date|string|null|undefined)=>value?new Date(value).toISOString():null;
  const referenceDate=now.toISOString().slice(0,10),dayMs=86_400_000,referenceMs=Date.parse(referenceDate);
  const originalAgeDays=sourcePublished.precision==="day"?Math.floor((referenceMs-Date.parse(sourcePublished.value))/dayMs):null;
  const latestDay=sourcePublished.precision==="year"?`${sourcePublished.value}-12-31`:sourcePublished.precision==="month"?new Date(Date.UTC(Number(sourcePublished.value.slice(0,4)),Number(sourcePublished.value.slice(5,7)),0)).toISOString().slice(0,10):sourcePublished.value;
  const historical=latestDay!==null&&(referenceMs-Date.parse(latestDay))/dayMs>=7;
  const label=sourcePublished.precision==="unknown"?"原文资料 · 发布日期未知":historical?"7日及更早原文资料":originalAgeDays===0?"当日原文 · 不代表最新消息":originalAgeDays!==null&&originalAgeDays>0?"非当日原文":originalAgeDays!==null&&originalAgeDays<0?"原文日期晚于核对日，需核验":`原文仅有${sourcePublished.precision==="year"?"年":"月"}精度，是否当日未知`;
  return {sourcePublished,sourcePublishedAt:capture?.publishedAt??null,publicationLiteral:capture?.publicationLiteral??null,
    sourceEvent:payload?.dates.event??unknown,candidateEvent:row.draft?.draft.dates?.event?.date??unknown,
    sourceCapturedAt:capture?.capturedAt??null,generatedAt:iso(times?.generated_at),checkedAt:iso(times?.checked_at),taskCreatedAt:iso(row.created_at)!,taskUpdatedAt:iso(row.updated_at)!,
    referenceDate,originalAgeDays,isOriginalDay:originalAgeDays===null?null:originalAgeDays===0,historical,label};
}
async function currentMaterialRejected(documentId:string,db:Db=sql) {
  const [row]=await db`SELECT r.decision,r.revision,r.source_revision,o.revision AS current_revision,s.revision AS current_source_revision
    FROM fishery_documents d JOIN fishery_sources s ON s.source_id=d.source_id
    JOIN LATERAL (SELECT revision FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT decision,revision,source_revision FROM fishery_reviews WHERE document_id=d.id AND revision=o.revision AND source_revision=s.revision ORDER BY id DESC LIMIT 1) r ON true WHERE d.id=${documentId}`;
  return row?.decision==="rejected"&&row.revision===row.current_revision&&row.source_revision===row.current_source_revision;
}
export async function flowDetail(id:string,now=new Date()):Promise<Record<string,any>> {
  const [row]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;if(!row) throw new NotFound("Flow not found");
  let staleReason:string|null=null;try{await inputFor(row.document_id,hash(row.snapshot));}catch(error){staleReason=(error as Error).message;}
  const [latest]=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
  const authoritative=latest?.id===id,timeline=await flowTimeline(row,now),materialRejected=await currentMaterialRejected(row.document_id);
  return {...row,authoritative,timeline,materialRejected,snapshotHash:hash(row.snapshot),stale:staleReason!==null,staleReason,internalOnly:true,published:false,
    internalArticle:row.status==="qualified"&&candidateReviewBound(row)&&!staleReason&&authoritative&&!materialRejected&&row.draft?.draft.relevance.decision==="relevant"&&row.draft?.draft.summaryZh?.some((item:{sentence:string})=>item.sentence.trim())?{summaryZh:row.draft?.draft.summaryZh??[],sourceDocumentId:row.document_id,qualifiedBy:row.human_decision?.actor,timeline}:null};
}
export async function listFlows(documentId:string) {const rows=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} ORDER BY created_at DESC LIMIT 50`;return Promise.all(rows.map(r=>flowDetail(r.id)));}
async function stageInvoke<S extends z.ZodType>(id:string,snapshotHash:string,stage:string,attempt:number,options:ChatJsonOptions<S>,invoke:FisheryInvoke) {
  const [task]=await sql`SELECT draft FROM fishery_flow_tasks WHERE id=${id}`;
  const revisionHash=task?.draft?.provenance?.candidateHash;
  options.attemptTag=`fishery-flow:${snapshotHash}:${stage}:${attempt}${revisionHash?`:revision:${revisionHash}`:""}`;
  options.subject+=`:snapshot:${snapshotHash}:${stage}:${attempt}${revisionHash?`:revision:${revisionHash}`:""}`;
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
export async function runFlow(id:string,invoke:FisheryInvoke,authorize:(run:()=>Promise<void>)=>Promise<void>=run=>run()) {
  if(!(await flowDetail(id)).authoritative) throw new Conflict("A newer authoritative task supersedes this task");
  const [claimed]=await sql`UPDATE fishery_flow_tasks SET status='running',updated_at=now() WHERE id=${id} AND status='queued' RETURNING *`;
  if(!claimed) throw new Conflict("Flow is not queued; running/failed/unknown outcomes require explicit operator reconciliation");
  let stage=claimed.stage as string,phase="authorization",receiptId:number|null=null;
  try {
    await authorize(async()=>{
      phase="source";
      const input=await inputFor(claimed.document_id,hash(claimed.snapshot));
      let draft=claimed.draft;
      if(draft?.provenance?.origin==="human_revision") {
        if(stage!=="review"||draft.provenance.candidateHash!==sha256(JSON.stringify(fisheryDraftSchema.parse(draft.draft)))) throw new Conflict("Human revision candidate hash or review-only stage changed");
        validateFisheryDraft(input,draft.draft);
        if(fisheryWireBytes(buildFisheryReviewRequest(input,draft.draft,"default"))>TRIAL.maxWireBytes) throw new Conflict("Revision review exceeds wire capacity");
      }
      if(stage==="generation") assertFisheryPairFits(input);
      if(stage==="generation") {
        phase="call";
        draft=await prepareFisheryDraft(input,"default",async options=>{
          const answer=await stageInvoke(id,hash(claimed.snapshot),"generation",claimed.generation_attempt,options,invoke);receiptId=answer.receiptId;phase="validate";return answer;
        });
        phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
        await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET draft=${tx.json(draft)},stage='review',updated_at=now() WHERE id=${id}`;await completeReceipt(tx,draft.receiptId);await audit(claimed.actor,"fishery.flow.generated",`fishery:${claimed.document_id}`,null,null,{id,receiptId:draft.receiptId},{db:tx});});stage="review";receiptId=null;
      }
      if(draft.draft.relevance.decision!=="relevant"||!draft.draft.summaryZh.some((item:{sentence:string})=>item.sentence.trim())) {
        const reason="行业相关性须为relevant，且至少有一条非空事实摘要；请补证、明确重新生成或人工拒绝";
        await sql`UPDATE fishery_flow_tasks SET status='needs_evidence',stage=${draft.provenance?.origin==="human_revision"?"review":"generation"},quality_review=NULL,error=${sql.json({code:"FISHERY_ARTICLE_INELIGIBLE",stage:"generation",phase:"eligibility",reason,receiptId:draft.receiptId,noAutomaticRetry:true})},updated_at=now() WHERE id=${id}`;
        return;
      }
      phase="call";
      const quality=await reviewFisheryDraft(input,draft.draft,"default",async options=>{
        const answer=await stageInvoke(id,hash(claimed.snapshot),"review",claimed.review_attempt,options,invoke);receiptId=answer.receiptId;phase="validate";return answer;
      });
      phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
      await sql.begin(async tx=>{await tx`UPDATE fishery_flow_tasks SET quality_review=${tx.json(quality)},status=${quality.status},stage='human',error=NULL,updated_at=now() WHERE id=${id}`;await completeReceipt(tx,quality.receiptId);await audit(claimed.actor,"fishery.flow.checked",`fishery:${claimed.document_id}`,null,null,{id,receiptId:quality.receiptId,status:quality.status},{db:tx});});
    });
  } catch(error) {
    const detail={code:phase==="authorization"?"FISHERY_FLOW_BLOCKED":"FISHERY_FLOW_FAILED",stage,phase,type:(error as Error).name,reason:(error as Error).message.slice(0,1000),receiptId:(error as {receiptId?:number}).receiptId??receiptId,noAutomaticRetry:true};
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
    const stage=row.draft?.provenance?.origin==="human_revision"?"review":row.draft&&row.error?.code!=="FISHERY_ARTICLE_INELIGIBLE"?"review":"generation",oldAttempt=stage==="review"?row.review_attempt:row.generation_attempt;
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
      if(await currentMaterialRejected(row.document_id,tx)) throw new Conflict("Current material observation review is rejected; internal qualification is blocked");
      const before=await snapshot(row.document_id);
      await tx`SELECT source_id FROM fishery_sources WHERE source_id=${before.value.sourceId} FOR SHARE`;
      const current=await snapshot(row.document_id);
      await inputFor(row.document_id,current.hash);
      if(current.hash!==hash(row.snapshot)) throw new Conflict("Review snapshot changed");
      if(row.draft?.draft.relevance.decision!=="relevant"||!row.draft?.draft.summaryZh?.some((item:{sentence:string})=>item.sentence.trim())) throw new Conflict("行业相关性须为relevant，且至少一条非空事实摘要，方可内部合格");
      if(!candidateReviewBound(row)) throw new Conflict("Review is not bound to the current candidate hash");
      if(!["needs_human_review","qualified","rejected"].includes(row.status)||row.quality_review?.status!=="needs_human_review") throw new Conflict("Independent review and deterministic gates must pass before internal qualification");
    }
    const human={decision:data.decision,note:data.note,actor,snapshotHash:hash(row.snapshot),at:new Date().toISOString(),internalOnly:true};
    await tx`UPDATE fishery_flow_tasks SET status=${data.decision},human_decision=${tx.json(human)},updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.decision",`fishery:${row.document_id}`,data.note,null,{id,...human},{db:tx});return {id,...human,published:false};
  });
}
export async function flowRequiredCalls(id:string) {
  const [task]=await sql`SELECT draft,stage,stage_requests,generation_attempt,review_attempt FROM fishery_flow_tasks WHERE id=${id}`;
  if(!task) throw new NotFound("Flow not found");
  let calls=0;
  for(const stage of task.stage==="generation"?["generation","review"]:["review"]) {
    const attempt=stage==="generation"?task.generation_attempt:task.review_attempt,bound=task.stage_requests[`${stage}:${attempt}`];
    const [receipt]=bound?await sql`SELECT status FROM receipts WHERE subject=${bound.subject} AND purpose=${bound.purpose} ORDER BY id DESC LIMIT 1`:[];
    if(!receipt||!["received","completed"].includes(receipt.status)) calls++;
  }
  return calls;
}
export async function runQueuedFlows(jobs:{id:string}[],invoke:FisheryInvoke=chatJson) {
  const rows=[];
  for(const job of jobs) {
    const result=await runFlow(job.id,invoke,async run=>{
      if(!config.modelCallsEnabled) throw new Conflict("MODEL_CALLS_ENABLED is closed; 模型调用开关关闭，未发送请求");
      await withFisheryAuthorization(async()=>{await assertFisheryCapacity(await flowRequiredCalls(job.id));await run();});
    });
    // runFlow persists business failures so the UI remains authoritative. Throw as well so
    // pg-boss cannot report a failed task as a successfully completed queue job.
    if(result.status==="failed") throw new Error(`任务 ${job.id} 执行失败 [${result.stage}/${result.error?.phase}]: ${result.error?.reason??"未知错误"}`);
    rows.push(result);
  }
  return rows;
}
export const flowQueue=defineQueue<{id:string}>({name:"fishery.flow",options:{policy:"short",retryLimit:0,expireInSeconds:600},worker:{batchSize:1,localConcurrency:1},run:runQueuedFlows});
export async function enqueueFlow(id:string) {const detail=await flowDetail(id);if(detail.stale||!detail.authoritative||detail.status!=="queued") throw new Conflict("Current queued task required");return {id,jobId:await enqueueOn(flowQueue,{id}),status:"queued"};}
