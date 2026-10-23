import { enqueuePublication, publicationDecisionHash } from "./publication-queue.ts";
import { randomUUID } from "node:crypto";
import type { FlowTimeline, FlowReconciliation } from "../ui-contracts.ts";
import { z } from "zod";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { config } from "@aihot/backend/config";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn, getBoss } from "@aihot/backend/jobs/queue";
import { chatJson, type ChatJsonOptions, type ChatJsonResult } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { sourceArticleAvailable } from "./source-availability.ts";
import { noticeEvidenceSections } from "./fujian-notices.ts";
import { hash, lockDocument, NotFound } from "./store.ts";
import { readSourceBody } from "./source-body.ts";
import { assertReviewedPdfBlanks } from './pdf-text.ts';
import type { PdfBlankProof } from './pdf-blank-proof.ts';
import { prepareFisheryDraft, buildFisheryDraftRequest, parseFisheryManualRevision, fisheryDraftSchema, validateFisheryDraft, type DraftInput } from "./ai-draft.ts";
import { reviewFisheryDraft, buildFisheryReviewRequest, fisheryWireBytes, assertFisheryPairFits, fisheryConfigurationVersion } from "./ai-review.ts";
import { sha256 } from "./source-adapters.ts";
import { withFisheryAuthorization, assertFisheryCapacity, authorizationKey } from "./authorization.ts";

import { buildEvidenceCatalog, anchorIds, assertSavedEvidenceArtifact } from "./evidence.ts";
import { TRIAL, validateTrialLedger } from "./trial-transport.ts";
import { acquireProcessingLease, assertProcessingLease } from "./processing-lease.ts";
import {newSelection,selectionStages,selectionConfiguration,runFisherySelection,type SelectionState,type SelectionStage} from './selection.ts';
import type {AnalyzeInputArticle} from '@aihot/backend/editorial/input';

const identity=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const qualification=z.strictObject({decision:z.enum(["qualified","rejected"]),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().min(1).max(2000)});
export type FisheryInvoke=<S extends z.ZodType>(options:ChatJsonOptions<S>)=>Promise<ChatJsonResult<z.infer<S>>>;
const isSelectionStage=(stage:string):stage is SelectionStage=>selectionStages.includes(stage as SelectionStage);
const stageAttempt=(row:Record<string,any>,stage:string)=>isSelectionStage(stage)?row.selection.attempts[stage]:stage==="generation"?row.generation_attempt:row.review_attempt;
const remainingStages=(row:Record<string,any>)=>{
  const all=row.selection?[...selectionStages,"generation","review"]:["generation","review"];
  return row.stage==='human'?[]:all.slice(Math.max(0,all.indexOf(row.stage)));
};
async function snapshot(documentId:string) {
  const [row]=await sql`SELECT d.id,d.source_id,d.article_id,d.withdrawn_reason,s.revision AS source_revision,s.profile,core.participation_mode,
    o.revision,o.content_hash,o.payload FROM fishery_documents d JOIN fishery_sources s ON s.source_id=d.source_id
    JOIN sources core ON core.id=d.source_id
    JOIN LATERAL (SELECT * FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1) o ON true WHERE d.id=${documentId}`;
  if(!row) throw new NotFound("Document with observed evidence required");
  if(row.participation_mode==='isolated') throw new Conflict("Source is isolated; processing is disabled");
  if(row.withdrawn_reason) throw new Conflict("Document withdrawn");
  const c=row.payload.sourceCapture;
  if(!c||c.httpStatus!==200||c.parseStatus!=="parsed"||!c.bodySha256||c.conflicts.length) throw new Conflict("Verified archived source body required");
  if(row.article_id&&!await sourceArticleAvailable(row.article_id)) throw new Conflict("Linked source article unavailable");
  const value={executionConfig:fisheryConfigurationVersion(),documentId,sourceId:row.source_id,sourceRevision:row.source_revision,sourceProfileHash:hash(row.profile),observationRevision:row.revision,observationHash:row.content_hash,bodySha256:c.bodySha256,rawSha256:c.rawSha256};
  return {value,hash:hash(value),payload:row.payload,articleId:row.article_id};
}
export function pdfPages(body:string,expected:number,blankReview?:PdfBlankProof) {
  const markers=[...body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  if(!Number.isInteger(expected)||expected<1||markers.length!==expected||markers.some((m,i)=>Number(m[1])!==i+1)) throw new Conflict("PDF page coverage missing or incomplete; no full-document claim");
  const pages=markers.map((m,i)=>({page:i+1,text:body.slice(m.index!+m[0].length,markers[i+1]?.index??body.length).trim()}));
  const textless=pages.filter(p=>!p.text).map(p=>p.page);
  if(textless.length&&!blankReview)throw new Conflict('PDF textless pages require review; no complete-document model input');
  if(blankReview)assertReviewedPdfBlanks(blankReview,blankReview.rawSha256,expected,textless);
  return pages;
}
async function inputFor(documentId:string,expectedHash:string):Promise<DraftInput> {
  const current=await snapshot(documentId);
  if(current.hash!==expectedHash) throw new Conflict("Source, metadata or rights version changed; create a new task");
  const c=current.payload.sourceCapture;let body:string|null=null;
  if(c.archiveId||c.manualArchiveId) body=await readSourceBody(c);
  else {
    const [stored]=await sql`SELECT body_text FROM articles WHERE source_id=${current.value.sourceId} AND (id=${current.articleId} OR raw->>'fisheryDocumentId'=${documentId}) ORDER BY created_at DESC LIMIT 1`;
    body=stored?.body_text??null;
  }
  if(!body||sha256(body)!==c.bodySha256||body.length>64000) throw new Conflict("Full bound body missing, changed or oversized; no silent truncation");
  const sections=c.adapter==='fujian-notices'?noticeEvidenceSections(body,c):undefined;
  const pages=!sections&&c.attachmentPages?pdfPages(body,c.attachmentPages,c.pdfBlankReview):undefined;
  return {pages,sections,pdfBlankReview:c.pdfBlankReview,documentId,observationRevision:current.value.observationRevision,body,bodySha256:c.bodySha256,language:current.payload.language};
}
async function assertDocumentSettled(documentId:string,db:Db=sql,exceptRunningId:string|null=null) {
  const [running]=await db`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} AND status='running' AND (${exceptRunningId}::text IS NULL OR id<>${exceptRunningId}) LIMIT 1`;
  if(running) throw new Conflict(`Document task ${running.id} is running, not queued; reconcile before replacing or dispatching`);
  const [uncertain]=await db`SELECT r.id FROM fishery_flow_tasks t CROSS JOIN LATERAL jsonb_each(t.stage_requests) b
    JOIN receipts r ON r.subject=b.value->>'subject' AND r.purpose=b.value->>'purpose'
    WHERE t.document_id=${documentId} AND r.status IN ('pending','unknown') LIMIT 1`;
  if(uncertain) throw new Conflict(`Document has pending/unknown receipt ${uncertain.id}; reconcile before any new candidate or dispatch`);
}
async function assertNoQueuedReplacement(documentId:string,db:Db) {
  const [queued]=await db`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} AND status='queued' LIMIT 1`;
  if(queued) throw new Conflict(`Document task ${queued.id} is queued; explicitly reject it before creating a different candidate`);
}
export async function createFlow(documentId:string,raw:unknown,actor:string) {
  // Opt-in only. Existing automatic dispatch and existing tasks retain their two-call pipeline.
  const data=z.strictObject({identity,selection:z.boolean().default(false)}).parse(raw),current=await snapshot(documentId);
  return sql.begin(async tx=>{
    await lockDocument(tx,documentId);
    await assertDocumentSettled(documentId,tx);
    if((await snapshot(documentId)).hash!==current.hash) throw new Conflict("Source changed while creating task");
    const [old]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${documentId} AND identity=${data.identity}`;
    if(old) {if(hash(old.snapshot)!==current.hash) throw new Conflict("Attempt identity belongs to old evidence");if(!!old.selection!==data.selection)throw new Conflict('Existing task has a different selection mode; no automatic upgrade or backfill');return old;}
    const [sameEvidence]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${documentId} AND snapshot=${tx.json(current.value)} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if(sameEvidence) {if(!!sameEvidence.selection!==data.selection)throw new Conflict('Existing evidence task has a different selection mode; preserve it without backfill');return sameEvidence;}
    await assertNoQueuedReplacement(documentId,tx);
    const [source]=await tx`SELECT tier FROM sources WHERE id=${current.value.sourceId}`;
    const [row]=await tx`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor,selection) VALUES (${randomUUID()},${documentId},${data.identity},${tx.json(current.value)},'queued',${data.selection?'prefilter':'generation'},${actor},${data.selection?tx.json(newSelection(source!.tier)):null}) RETURNING *`;
    await audit(actor,"fishery.flow.create",`fishery:${documentId}`,null,null,{id:row!.id,snapshotHash:current.hash},{db:tx});return row!;
  });
}
// Revision provenance is admin-only; it is never included in reviewFisheryDraft input.
export async function revisionContext(id:string) {
  const [original]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${id}`;
  if(!original) throw new NotFound("Original flow not found");
  await assertDocumentSettled(original.document_id);
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
  const input=await inputFor(context.documentId,context.snapshotHash);
  const parsed=(()=>{try{return parseFisheryManualRevision(input,data.candidate);}catch(error){throw new Conflict(`Candidate validation refused: ${(error as Error).message.slice(0,2000)}`);}})(),candidate=parsed.draft;
  if(candidate.relevance.decision!=="relevant"||!candidate.summaryZh.length) throw new Conflict("Revision requires relevant nonempty supported summary");
  if(fisheryWireBytes(buildFisheryReviewRequest(input,candidate,"default",{mode:"manual_revision"}))>TRIAL.maxWireBytes) throw new Conflict("Full source and revision review exceed wire capacity; no request sent");
  const candidateHash=sha256(JSON.stringify(candidate)),current=await snapshot(context.documentId);
  const provenance={origin:"human_revision",originalTaskId:id,directParentTaskId:id,originalGenerationTaskId:context.originalGenerationTaskId,receiptId:context.receiptId,responseHash:context.responseHash,actor,at:new Date().toISOString(),reason:data.reason,candidateHash,
    diff:{before:context.originalCandidate,after:data.candidate}};
  const draft={receiptId:null,model:"human_revision",promptVersion:buildFisheryDraftRequest(input,"default").promptVersion,schemaVersion:parsed.schemaVersion,evidenceCatalog:parsed.evidenceCatalog,draft:candidate,provenance};
  return sql.begin(async tx=>{
    await lockDocument(tx,context.documentId);
    await assertDocumentSettled(context.documentId,tx);
    if((await snapshot(context.documentId)).hash!==context.snapshotHash) throw new Conflict("Snapshot changed while saving revision");
    const [old]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${context.documentId} AND identity=${data.identity}`;
    if(old) {if(old.draft?.provenance?.candidateHash!==candidateHash||hash(old.snapshot)!==context.snapshotHash) throw new Conflict("Revision identity already belongs to a different candidate");return old;}
    const [same]=await tx`SELECT * FROM fishery_flow_tasks WHERE document_id=${context.documentId} AND snapshot=${tx.json(current.value)} AND draft->'provenance'->>'candidateHash'=${candidateHash} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if(same) return same;
    await assertNoQueuedReplacement(context.documentId,tx);
    const [parent]=await tx`SELECT selection,snapshot FROM fishery_flow_tasks WHERE id=${id}`;
    if(parent?.selection&&parent.selection.outcome?.label!=='SCORED')throw new Conflict('Selection must complete before revising an article candidate');
    if(parent?.selection&&hash(parent.snapshot)!==context.snapshotHash)throw new Conflict('Selection belongs to older evidence; a manual revision cannot inherit its scores');
    const [row]=await tx`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor,draft,selection) VALUES (${randomUUID()},${context.documentId},${data.identity},${tx.json(current.value)},'queued','review',${actor},${tx.json(JSON.parse(JSON.stringify(draft)))},${parent?.selection?tx.json(parent.selection):null}) RETURNING *`;
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
async function currentMaterialDecision(documentId:string,db:Db=sql) {
  const [row]=await db`SELECT r.decision,r.revision,r.source_revision,o.revision AS current_revision,s.revision AS current_source_revision
    FROM fishery_documents d JOIN fishery_sources s ON s.source_id=d.source_id
    JOIN LATERAL (SELECT revision FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT decision,revision,source_revision FROM fishery_reviews WHERE document_id=d.id AND revision=o.revision AND source_revision=s.revision ORDER BY id DESC LIMIT 1) r ON true WHERE d.id=${documentId}`;
  return row?.revision===row?.current_revision&&row?.source_revision===row?.current_source_revision?row?.decision??null:null;
}
const reconcileSchema=z.strictObject({snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),executionFingerprint:z.string().regex(/^[a-f0-9]{64}$/),expectedStatus:z.literal("running"),acknowledgeRunnerStopped:z.literal(true),reason:z.string().trim().min(1).max(2000),cancelActiveJobId:z.uuid().optional()});
function executionState(row:Record<string,any>) {
  return {id:row.id,documentId:row.document_id,snapshotHash:hash(row.snapshot),status:row.status,stage:row.stage,executionToken:row.execution_token??null,generationAttempt:row.generation_attempt,reviewAttempt:row.review_attempt,stageRequests:row.stage_requests,
    candidateHash:hash(row.draft?.draft??null),draftHash:hash(row.draft??null),qualityHash:hash(row.quality_review??null),selection:row.selection??null,humanHash:hash(row.human_decision??null),error:row.error,updatedAt:row.execution_updated_at??new Date(row.updated_at).toISOString()};
}
async function reconciliationState(row:Record<string,any>,db:Db=sql,locking=false):Promise<FlowReconciliation> {
  const tasks=locking?await db`SELECT *,updated_at::text AS execution_updated_at FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY id FOR UPDATE`:await db`SELECT *,updated_at::text AS execution_updated_at FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY id`;
  const [queueCatalog]=await db`SELECT to_regclass('pgboss.job') IS NOT NULL AS available`;
  const jobs=queueCatalog?.available?(locking?await db`SELECT id,data->>'id' AS task_id,state,created_on,started_on,completed_on FROM pgboss.job WHERE name='fishery.flow' AND data->>'id' IN (SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id}) ORDER BY id FOR UPDATE`:await db`SELECT id,data->>'id' AS task_id,state,created_on,started_on,completed_on FROM pgboss.job WHERE name='fishery.flow' AND data->>'id' IN (SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id}) ORDER BY id`):[];
  const receipts=await db`SELECT r.id,r.status,r.purpose,r.subject,r.response,r.error,r.attempts,r.updated_at::text AS receipt_updated_at FROM receipts r
    WHERE starts_with(r.purpose,'fishery_') OR starts_with(r.subject,${`fishery:${row.document_id}:`})
    OR r.id IN (SELECT NULLIF(t.draft->>'receiptId','')::bigint FROM fishery_flow_tasks t WHERE document_id=${row.document_id}
      UNION SELECT NULLIF(t.error->>'receiptId','')::bigint FROM fishery_flow_tasks t WHERE document_id=${row.document_id}
      UNION SELECT NULLIF(t.quality_review->>'receiptId','')::bigint FROM fishery_flow_tasks t WHERE document_id=${row.document_id})
    OR EXISTS (SELECT 1 FROM fishery_flow_tasks t CROSS JOIN LATERAL jsonb_each(t.stage_requests) b WHERE t.document_id=${row.document_id} AND r.subject=b.value->>'subject' AND r.purpose=b.value->>'purpose') ORDER BY r.id`;
  const [stored]=locking?await db`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`:await db`SELECT value FROM settings WHERE key=${authorizationKey}`;
  const [current]=await db`SELECT d.withdrawn_reason,s.revision AS source_revision,s.profile,o.revision AS observation_revision,o.content_hash,r.id AS review_id,r.decision FROM fishery_documents d JOIN fishery_sources s ON s.source_id=d.source_id
    JOIN LATERAL (SELECT revision,content_hash FROM fishery_observations WHERE document_id=d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT id,decision FROM fishery_reviews WHERE document_id=d.id AND revision=o.revision AND source_revision=s.revision ORDER BY id DESC LIMIT 1) r ON true WHERE d.id=${row.document_id}`;
  const reasons:string[]=[],ledger=stored?.value,entries=Array.isArray(ledger?.entries)?ledger.entries:[];
  let ledgerValid=false;
  try {validateTrialLedger(ledger);ledgerValid=true;} catch { /* Invalid authorization remains closed. */ }
  if(!ledgerValid) reasons.push("Existing cumulative authorization ledger is missing or inconsistent; no allowance is created");
  if(entries.some((e:any)=>e.state!=="received")) reasons.push("Global ledger pending/unknown/refused outcome requires billing reconciliation");
  if(receipts.some(r=>["pending","unknown"].includes(r.status))) reasons.push("Global fishery receipt pending/unknown requires reconciliation");
  if(receipts.some(r=>["received","completed","failed"].includes(r.status)&&r.response===null)) reasons.push("Fishery receipt response missing; zero-request recovery cannot infer an outcome");
  if(row.status!=="running") reasons.push("Only running interrupted tasks can be reconciled");
  if(current?.decision!=="approved"||current.withdrawn_reason) reasons.push("Current source and observation must be normally approved and not withdrawn");
  if(tasks.some(t=>t.id!==row.id&&["running","queued"].includes(t.status))) reasons.push("Another document task is running/queued; reconcile it explicitly first");
  const requests=Object.entries(row.stage_requests??{}) as [string,{subject:string;purpose:string}][];
  const currentKey=`${row.stage}:${stageAttempt(row,row.stage)}`;
  if(![...selectionStages,"generation","review"].includes(row.stage)||requests.some(([key])=>key===currentKey||key.startsWith(`${row.stage}:`))) reasons.push("Current stage has a durable request; use its original receipt/recovery, never zero-request reconciliation");
  const selectionRequests=requests.filter(([key])=>selectionStages.some(stage=>key.startsWith(stage+':')));
  if(row.selection){
    if(hash(row.selection.config)!==hash(selectionConfiguration()))reasons.push('Selection configuration changed');
    for(const [key,request] of selectionRequests){
      const step=key.split(':')[0] as SelectionStage;
      if(key!==step+':'+row.selection.attempts[step])continue;
      const result=row.selection.results[step],receipt=receipts.find(r=>r.id===result?.receiptId&&r.subject===request.subject&&r.purpose===request.purpose);
      if(!receipt||!['received','completed'].includes(receipt.status)||!receipt.response)reasons.push('Prior selection stage lacks a reusable saved result');
    }
    if(!isSelectionStage(row.stage)&&row.selection.outcome?.label!=='SCORED')reasons.push('Complete selection required before generation/review recovery');
    if(isSelectionStage(row.stage)&&(row.draft||row.quality_review))reasons.push('Selection recovery cannot contain a later article candidate');
  }
  let reusableGenerationReceiptId:number|null=null;
  if(row.stage==="generation"&&(requests.length!==selectionRequests.length||row.draft||row.quality_review)) reasons.push("Generation recovery requires no prior generation request or output");
  if(row.stage==="review") {
    if(!row.draft||row.quality_review) reasons.push("Review-before-request recovery requires a saved candidate and no review output");
    else try {
      const candidate=fisheryDraftSchema.parse(row.draft.draft),manual=row.draft.provenance?.origin==="human_revision";
      if(row.draft.evidenceCatalog?.bodySha256!==row.snapshot.bodySha256||row.draft.evidenceCatalog?.observationRevision!==row.snapshot.observationRevision) throw new Error("Saved draft body/observation binding changed");
      const schemaVersion=manual?"fishery-manual-revision-wire-v1":"fishery-draft-wire-v5";
      if(row.draft.schemaVersion!==schemaVersion) throw new Error("Saved candidate schema changed; do not infer reusable output");
      const currentSnapshot=await snapshot(row.document_id);
      if(currentSnapshot.hash===hash(row.snapshot)) {
        const input=await inputFor(row.document_id,currentSnapshot.hash);
        assertSavedEvidenceArtifact(input,row.draft,{promptVersion:buildFisheryDraftRequest(input,"default").promptVersion,schemaVersion});
        validateFisheryDraft(input,candidate,manual?{mode:"manual_revision"}:{});
      }
      if(manual) {if(requests.length||row.draft.provenance.candidateHash!==sha256(JSON.stringify(candidate))) throw new Error("Manual candidate/request binding changed");}
      else {
        const generation=requests.filter(([key])=>key.startsWith("generation:"));
        if(!generation.length||generation.length+selectionRequests.length!==requests.length) throw new Error("Only durable selection/generation requests may precede a new review");
        for(const [,request] of generation) {
          const found=receipts.filter(r=>r.subject===request.subject&&r.purpose===request.purpose);
          if(request.purpose!=="fishery_draft"||!found.length||found.some(r=>!["received","completed"].includes(r.status)||!r.response)) throw new Error("Generation receipt missing, unsettled or unusable");
        }
        const receipt=receipts.find(r=>r.id===row.draft.receiptId);
        if(!receipt||receipt.purpose!=="fishery_draft"||!["received","completed"].includes(receipt.status)||!receipt.response||row.stage_requests[`generation:${row.generation_attempt}`]?.subject!==receipt.subject||row.draft.documentId!==row.document_id||row.draft.bodySha256!==row.snapshot.bodySha256||row.draft.observationRevision!==row.snapshot.observationRevision) throw new Error("Saved generation receipt binding changed");
        reusableGenerationReceiptId=receipt.id;
      }
    } catch(error) {reasons.push((error as Error).message);}
  }
  const base=`fishery:${row.document_id}:v${row.snapshot.observationRevision}:${row.snapshot.bodySha256}`,candidate=row.draft?.draft;
  let currentSubject:string|null=null;
  try {currentSubject=(row.stage==="review"?`${base}:draft:${sha256(JSON.stringify(fisheryDraftSchema.parse(candidate)))}`:base)+`:snapshot:${hash(row.snapshot)}:${row.stage}:${row.stage==="generation"?row.generation_attempt:row.review_attempt}`+(row.draft?.provenance?.candidateHash?`:revision:${row.draft.provenance.candidateHash}`:"");}catch{reasons.push("Current candidate cannot identify its review request");}
  if(row.error?.receiptId||row.quality_review?.receiptId||receipts.some(r=>r.subject===currentSubject)) reasons.push("Current stage already has a receipt; original received output or billing reconciliation is required");
  if(!queueCatalog?.available) reasons.push("Queue catalog unavailable; cannot verify interrupted jobs");
  if(jobs.some(j=>["created","retry"].includes(j.state))) reasons.push("Queued/retry jobs or duplicate dispatches must be reconciled explicitly");
  const active=jobs.filter(j=>j.state==="active");
  if(active.length>1||active.some(j=>j.task_id!==row.id)) reasons.push("Multiple or other active document jobs cannot be cancelled by this recovery");
  const receiptState=receipts.map(r=>({id:r.id,status:r.status,purpose:r.purpose,subject:r.subject,responseHash:r.response===null?null:hash(r.response),errorHash:hash(r.error),attempts:r.attempts,updatedAt:r.receipt_updated_at}));
  const jobState=jobs.map(j=>({id:String(j.id),task_id:String(j.task_id),state:String(j.state),created_on:j.created_on?.toISOString(),started_on:j.started_on?.toISOString(),completed_on:j.completed_on?.toISOString()}));
  return {version:"fishery-reconcile-v1",eligible:reasons.length===0,reasons,executionFingerprint:hash({version:"fishery-reconcile-v1",task:executionState(row),tasks:tasks.map(executionState),current,jobs:jobState,receipts:receiptState,ledger}),snapshotHash:hash(row.snapshot),status:row.status,stage:row.stage,
    currentSourceRevision:current?.source_revision??null,currentObservationRevision:current?.observation_revision??null,currentMaterialApproved:current?.decision==="approved",stageRequestCount:requests.length,candidateHash:hash(candidate??null),reusableGenerationReceiptId,newCallsOnResume:remainingStages(row).length,
    ledger:{id:ledger?.id??null,valid:ledgerValid,entryCount:entries.length,reservedMicroCny:entries.reduce((sum:number,e:any)=>sum+(Number.isSafeInteger(e.reservedMicroCny)?e.reservedMicroCny:0),0),states:entries.map((e:any)=>String(e.state))},
    receipts:receiptState.map(({responseHash,errorHash,...r})=>({...r,responsePresent:responseHash!==null})),jobs:jobState.map(j=>({id:j.id,taskId:j.task_id,state:j.state})),activeJobId:active.length===1?active[0]!.id:null};
}
export async function reconcileFlow(id:string,raw:unknown,actor:string) {
  const data=reconcileSchema.parse(raw);
  const lease=await acquireProcessingLease().catch((error:unknown)=>{throw new Conflict(`Processing lease unavailable; stop and reconcile old runners first: ${(error as Error).message}`);});
  try {return await lease.run(async()=>{
    await lease.assertHeld();
    const [target]=await sql`SELECT document_id FROM fishery_flow_tasks WHERE id=${id}`;if(!target) throw new NotFound("Flow not found");
    return sql.begin(async tx=>{
      await lockDocument(tx,target.document_id);
      const [row]=await tx`SELECT *,updated_at::text AS execution_updated_at FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
      const state=await reconciliationState(row!,tx,true);
      if(data.snapshotHash!==state.snapshotHash||data.expectedStatus!==state.status||data.executionFingerprint!==state.executionFingerprint) throw new Conflict("Execution snapshot/fingerprint changed; reload all task, queue, receipt and cost states");
      if(!state.eligible) throw new Conflict(state.reasons.join("; "));
      if((state.activeJobId??undefined)!==data.cancelActiveJobId) throw new Conflict("Explicit exact old active job acknowledgement required; no job is cancelled implicitly");
      await lease.assertHeld();
      if(state.activeJobId) {
        const boss=await getBoss({schedule:false,supervise:false}).catch(error=>{throw new Conflict(`Controlled queue instance requires schedule:false/supervise:false; stop old runners and reconcile instance mode: ${(error as Error).message}`);});
        await boss.cancel(flowQueue.name,state.activeJobId,{db:{executeSql:async(text:string,values?:unknown[])=>({rows:await tx.unsafe(text,(values??[]) as never[])})}});
        const [cancelled]=await tx`SELECT state FROM pgboss.job WHERE name='fishery.flow' AND id=${state.activeJobId}::uuid`;
        if(cancelled?.state!=="cancelled") throw new Conflict("Old active job changed; cancellation refused");
        await audit(actor,"fishery.flow.reconcile.cancel_job",`fishery:${row!.document_id}`,data.reason,{id:state.activeJobId,state:"active"},{id:state.activeJobId,state:"cancelled",taskId:id},{db:tx});
      }
      const error={code:"FISHERY_INTERRUPTED_BEFORE_REQUEST",stage:row!.stage,phase:"interrupted_before_request",reason:data.reason,receiptId:null,noAutomaticRetry:true,nextStageRequiresNewCharge:true,newCallsOnResume:state.newCallsOnResume,reusableGenerationReceiptId:state.reusableGenerationReceiptId};
      await lease.assertHeld();
      await tx`UPDATE fishery_flow_tasks SET status='failed',execution_token=NULL,error=${tx.json(error)},updated_at=now() WHERE id=${id}`;
      await audit(actor,"fishery.flow.reconcile",`fishery:${row!.document_id}`,data.reason,{...executionState(row!),executionFingerprint:state.executionFingerprint},{id,status:"failed",error,leaseBackendPid:lease.backendPid,leaseInstanceId:lease.instanceId,acknowledgeRunnerStopped:true,cancelledJobId:state.activeJobId,checkedLedger:state.ledger,checkedReceipts:state.receipts,currentSourceRevision:state.currentSourceRevision,currentObservationRevision:state.currentObservationRevision,modelCalls:0,published:false},{db:tx});
      await lease.assertHeld();
      return {id,status:"failed",stage:row!.stage,modelCalls:0,published:false,newCallsOnResume:state.newCallsOnResume};
    });
  });}finally{await lease.release();}
}
export async function flowDetail(id:string,now=new Date()):Promise<Record<string,any>> {
  const [row]=await sql`SELECT *,updated_at::text AS execution_updated_at FROM fishery_flow_tasks WHERE id=${id}`;if(!row) throw new NotFound("Flow not found");
  let staleReason:string|null=null;try{await inputFor(row.document_id,hash(row.snapshot));}catch(error){staleReason=(error as Error).message;}
  const [latest]=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
  const authoritative=latest?.id===id,timeline=await flowTimeline(row,now),materialDecision=await currentMaterialDecision(row.document_id),materialRejected=materialDecision==="rejected",materialApproved=materialDecision==="approved";
  const reconciliation=await reconciliationState(row);
  return {...row,authoritative,timeline,materialRejected,materialApproved,reconciliation,snapshotHash:hash(row.snapshot),stale:staleReason!==null,staleReason,internalOnly:true,published:false,
    internalArticle:row.status==="qualified"&&candidateReviewBound(row)&&!staleReason&&authoritative&&materialApproved&&row.draft?.draft.relevance.decision==="relevant"&&row.draft?.draft.summaryZh?.some((item:{sentence:string})=>item.sentence.trim())?{summaryZh:row.draft?.draft.summaryZh??[],sourceDocumentId:row.document_id,qualifiedBy:row.human_decision?.actor,timeline}:null};
}
export async function listFlows(documentId:string) {const rows=await sql`SELECT id FROM fishery_flow_tasks WHERE document_id=${documentId} ORDER BY created_at DESC LIMIT 50`;return Promise.all(rows.map(r=>flowDetail(r.id)));}
class FlowExecutionLost extends Conflict {}
function assertExecutionOwner(row:Record<string,any>|undefined,executionToken:string) {
  if(row?.status!=="running"||row.execution_token!==executionToken) throw new FlowExecutionLost("Flow execution ownership changed; old runner cannot write or invoke");
}
function assertExecutionUpdated(rows:readonly unknown[]) {
  if(rows.length!==1) throw new FlowExecutionLost("Flow execution ownership changed; old runner cannot persist");
}
async function stageInvoke<S extends z.ZodType>(id:string,snapshotHash:string,stage:string,attempt:number,options:ChatJsonOptions<S>,invoke:FisheryInvoke,executionToken:string,assertLease:()=>Promise<void>) {
  await assertLease();
  const [task]=await sql`SELECT draft,document_id,selection,status,execution_token FROM fishery_flow_tasks WHERE id=${id}`;
  assertExecutionOwner(task,executionToken);
  await inputFor(task!.document_id,snapshotHash);
  if(task!.selection)await assertSelectionFlowCurrent(id);
  const revisionHash=task?.draft?.provenance?.candidateHash;
  const native=isSelectionStage(stage)?`:native:${hash(options.attemptTag??'').slice(0,16)}`:"";
  options.attemptTag=`fishery-flow:${snapshotHash}:${stage}:${attempt}${revisionHash?`:revision:${revisionHash}`:""}${native}`;
  options.subject+=`:snapshot:${snapshotHash}:${stage}:${attempt}${revisionHash?`:revision:${revisionHash}`:""}`;
  const fingerprint=hash({model:options.model,purpose:options.purpose,promptVersion:options.promptVersion,system:options.system,user:options.user,temperature:options.temperature,maxTokens:options.maxTokens,attemptTag:options.attemptTag});
  await assertLease();
  await sql.begin(async tx=>{
    const [row]=await tx`SELECT stage_requests,status,execution_token FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    await assertLease();
    assertExecutionOwner(row,executionToken);
    const key=`${stage}:${attempt}`,previous=row!.stage_requests[key];
    if(previous&&previous.fingerprint!==fingerprint) throw new Conflict("Stage request changed; resume cannot send a different prompt/model/input. Explicit regenerated attempt required");
    if(!previous) {
      row!.stage_requests[key]={fingerprint,subject:options.subject,purpose:options.purpose,promptVersion:options.promptVersion,attemptTag:options.attemptTag};
      assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET stage_requests=${tx.json(row!.stage_requests)},updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);
    }
    // paidRequest reuses received/completed, but automatically retries failed. For this flow an
    // existing failed/pending/unknown receipt must never be resent by a mere resume operation.
    const [receipt]=await tx`SELECT id,status FROM receipts WHERE subject=${options.subject} AND purpose=${options.purpose} ORDER BY id DESC LIMIT 1`;
    if(receipt&&!["received","completed"].includes(receipt.status)) throw new Conflict(`Existing ${receipt.status} receipt ${receipt.id}; reconcile and explicitly regenerate, never blind resume`);
    await assertLease();
  });
  const [current]=await sql`SELECT status,execution_token FROM fishery_flow_tasks WHERE id=${id}`;
  assertExecutionOwner(current,executionToken);
  await assertLease();
  return invoke(options);
}
export async function runFlow(id:string,invoke:FisheryInvoke,authorize:(run:()=>Promise<void>)=>Promise<void>=run=>run(),options:{requireProcessingLease?:boolean}={}) {
  const [task]=await sql`SELECT document_id,status FROM fishery_flow_tasks WHERE id=${id}`;
  if(!task) throw new NotFound("Flow not found");
  if(task.status!=="queued") throw new Conflict("Flow is not queued; running/failed/unknown outcomes require explicit operator reconciliation");
  const requireLease=options.requireProcessingLease||invoke===chatJson;
  const assertLease=async()=>{
    if(requireLease) try {await assertProcessingLease();}catch(error){throw new FlowExecutionLost("Fishery processing lease lost; old runner cannot write or invoke",{cause:error});}
  };
  const executionToken=randomUUID();
  await assertLease();
  const claimed=await sql.begin(async tx=>{
    await lockDocument(tx,task.document_id);
    await assertDocumentSettled(task.document_id,tx);
    const [latest]=await tx`SELECT id FROM fishery_flow_tasks WHERE document_id=${task.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if(latest?.id!==id) throw new Conflict("A newer authoritative task supersedes this task");
    await assertLease();
    const [row]=await tx`UPDATE fishery_flow_tasks SET status='running',execution_token=${executionToken},updated_at=now() WHERE id=${id} AND status='queued' RETURNING *`;
    if(!row) throw new Conflict("Flow is not queued; running/failed/unknown outcomes require explicit operator reconciliation");
    await assertLease();
    return row;
  });
  const persist=async(write:(tx:Db)=>Promise<void>)=>{
    await assertLease();
    await sql.begin(async tx=>{
      await write(tx);
      // A row update can wait behind recovery; lease loss during that wait rolls back all business writes.
      await assertLease();
    });
  };
  let stage=claimed.stage as string,phase="authorization",receiptId:number|null=null;
  try {
    await authorize(async()=>{
      await assertLease();
      phase="source";
      const input=await inputFor(claimed.document_id,hash(claimed.snapshot));
      let draft=claimed.draft;
      if(claimed.selection){
        if(hash(claimed.selection.config)!==hash(selectionConfiguration()))throw new Conflict('Selection configuration changed; keep the original request version and reconcile explicitly');
        if(await currentMaterialDecision(claimed.document_id)!=="approved")throw new Conflict('Current material approval required before selection');
        if(isSelectionStage(stage)){
          const current=await snapshot(claimed.document_id),[source]=await sql`SELECT name,kind,tier FROM sources WHERE id=${current.value.sourceId}`;
          if(source!.tier!==claimed.selection.sourceTier)throw new Conflict('Source tier changed since selection was authorized');
          const p=current.payload,c=p.sourceCapture,day=p.dates.published;
          const article:AnalyzeInputArticle={id:claimed.document_id,revision:current.value.observationRevision,title:p.originalTitle||p.title,url:c.sourceUrl,author:null,
            publishedAt:day.precision==='day'?new Date(day.value+'T00:00:00+08:00'):null,publicationTime:day.precision==='day'?day.value:null,
            bodyText:input.body,bodyStatus:'ok',excerpt:null,xPost:null,media:[],source:{name:source!.name,kind:source!.kind,tier:source!.tier,firstParty:source!.tier==='T1'}};
          const state=claimed.selection as SelectionState;
          const outcome=await runFisherySelection(article,state,async options=>{
            const requestStage:SelectionStage=options.purpose==='prefilter_article'?'prefilter':options.attemptTag?.endsWith('score-1')?'score-1':'score-2';
            stage=requestStage;phase='call';
            const answer=await stageInvoke(id,hash(claimed.snapshot),requestStage,state.attempts[requestStage],options,invoke,executionToken,assertLease);
            receiptId=answer.receiptId;phase='persist';return answer;
          },async(selected,result,next)=>{
            await inputFor(claimed.document_id,hash(claimed.snapshot));
            await persist(async tx=>{
              assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET selection=${tx.json(state)},stage=${next},updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);
              await assertLease();
              await completeReceipt(tx,result!.receiptId);
              await audit(claimed.actor,'fishery.flow.selection',`fishery:${claimed.document_id}`,null,null,{id,stage:selected,receiptId:result!.receiptId,data:result!.data,calibrated:false,factApproval:false},{db:tx});
            });stage=next;receiptId=null;
          });
          state.outcome=outcome;
          const stopped=outcome.label!=='SCORED';
          stage=stopped?(outcome.label==='BLOCK'||outcome.label==='UNKNOWN'?'prefilter':String(stage)==='generation'?'score-2':stage):'generation';
          await persist(async tx=>{assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET selection=${tx.json(state)},stage=${stage},status=${stopped?'needs_evidence':'running'},error=${stopped?tx.json({code:'FISHERY_SELECTION_STOP',stage,phase:'selection',reason:outcome.label+'; selection is not fact approval',receiptId:null,noAutomaticRetry:true}):null},updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);});
          if(stopped)return;
        }
        if(claimed.selection.outcome?.label!=='SCORED')throw new Conflict('Complete PASS and two independent scores required before article generation or review');
      }
      if(draft?.provenance?.origin==="human_revision") {
        if(stage!=="review"||draft.provenance.candidateHash!==sha256(JSON.stringify(fisheryDraftSchema.parse(draft.draft)))) throw new Conflict("Human revision candidate hash or review-only stage changed");
        assertSavedEvidenceArtifact(input,draft,{promptVersion:buildFisheryDraftRequest(input,"default").promptVersion,schemaVersion:"fishery-manual-revision-wire-v1"});
        validateFisheryDraft(input,draft.draft,{mode:"manual_revision"});
        if(fisheryWireBytes(buildFisheryReviewRequest(input,draft.draft,"default",{mode:"manual_revision"}))>TRIAL.maxWireBytes) throw new Conflict("Revision review exceeds wire capacity");
      }
      if(stage==="generation") assertFisheryPairFits(input);
      if(stage==="generation") {
        phase="call";
        draft=await prepareFisheryDraft(input,"default",async options=>{
          const answer=await stageInvoke(id,hash(claimed.snapshot),"generation",claimed.generation_attempt,options,invoke,executionToken,assertLease);receiptId=answer.receiptId;phase="validate";return answer;
        });
        phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
        await persist(async tx=>{assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET draft=${tx.json(draft)},stage='review',updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);await assertLease();await completeReceipt(tx,draft.receiptId);await audit(claimed.actor,"fishery.flow.generated",`fishery:${claimed.document_id}`,null,null,{id,receiptId:draft.receiptId},{db:tx});});stage="review";receiptId=null;
      }
      if(draft.draft.relevance.decision!=="relevant"||!draft.draft.summaryZh.some((item:{sentence:string})=>item.sentence.trim())) {
        const reason="行业相关性须为relevant，且至少有一条非空事实摘要；请补证、明确重新生成或人工拒绝";
        await persist(async tx=>{assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET status='needs_evidence',stage=${draft.provenance?.origin==="human_revision"?"review":"generation"},quality_review=NULL,error=${tx.json({code:"FISHERY_ARTICLE_INELIGIBLE",stage:"generation",phase:"eligibility",reason,receiptId:draft.receiptId,noAutomaticRetry:true})},updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);});
        return;
      }
      phase="call";
      const quality=await reviewFisheryDraft(input,draft.draft,"default",async options=>{
        const answer=await stageInvoke(id,hash(claimed.snapshot),"review",claimed.review_attempt,options,invoke,executionToken,assertLease);receiptId=answer.receiptId;phase="validate";return answer;
      },draft.provenance?.origin==="human_revision"?{mode:"manual_revision"}:{});
      phase="persist";await inputFor(claimed.document_id,hash(claimed.snapshot));
      await persist(async tx=>{assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET quality_review=${tx.json(quality)},status=${quality.status},stage='human',error=NULL,updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);await assertLease();await completeReceipt(tx,quality.receiptId);await audit(claimed.actor,"fishery.flow.checked",`fishery:${claimed.document_id}`,null,null,{id,receiptId:quality.receiptId,status:quality.status},{db:tx});});
    });
  } catch(error) {
    const detail={code:phase==="authorization"?"FISHERY_FLOW_BLOCKED":"FISHERY_FLOW_FAILED",stage,phase,type:(error as Error).name,reason:(error as Error).message.slice(0,1000),receiptId:(error as {receiptId?:number}).receiptId??receiptId,noAutomaticRetry:true};
    try {
      await persist(async tx=>{assertExecutionUpdated(await tx`UPDATE fishery_flow_tasks SET status='failed',stage=${stage},error=${tx.json(detail)},updated_at=now() WHERE id=${id} AND status='running' AND execution_token=${executionToken} RETURNING id`);});
    } catch(failure) {if(!(failure instanceof FlowExecutionLost)) throw failure;}
  }
  return flowDetail(id);
}
export async function retryFlow(id:string,raw:unknown,actor:string) {
  const {note,mode,acknowledgeNewCharge}=z.strictObject({note:z.string().trim().min(1).max(2000),mode:z.enum(["resume","regenerate"]).default("resume"),acknowledgeNewCharge:z.boolean().default(false)}).parse(raw);
  const detail=await flowDetail(id);if(detail.stale||!detail.authoritative) throw new Conflict(detail.staleReason??"Task superseded");
  const [target]=await sql`SELECT document_id FROM fishery_flow_tasks WHERE id=${id}`;if(!target) throw new NotFound("Flow not found");
  return sql.begin(async tx=>{
    await lockDocument(tx,target.document_id);
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;
    await assertDocumentSettled(target.document_id,tx,id);
    const currentDetail=await flowDetail(id);if(currentDetail.stale||!currentDetail.authoritative) throw new Conflict(currentDetail.staleReason??"Task superseded");
    if(!row||!["failed","needs_evidence","running"].includes(row.status)) throw new Conflict("Only failed, needs-evidence or reconciled interrupted flows can resume");
    if(row.error?.code==="FISHERY_INTERRUPTED_BEFORE_REQUEST"&&(!acknowledgeNewCharge||mode!=="resume")) throw new Conflict("Reconciled stage had no request; explicitly acknowledge new stage charges and resume without regenerating saved output");
    const stage=isSelectionStage(row.stage)?row.stage:row.draft?.provenance?.origin==="human_revision"?"review":row.draft&&row.error?.code!=="FISHERY_ARTICLE_INELIGIBLE"?"review":"generation",oldAttempt=stageAttempt(row,stage);
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
    if(isSelectionStage(stage)){
      row.selection.attempts[stage]=attempt;
      if(mode==='regenerate')for(const key of selectionStages.slice(selectionStages.indexOf(stage)))delete row.selection.results[key];
      delete row.selection.outcome;
    }
    await tx`UPDATE fishery_flow_tasks SET status='queued',execution_token=NULL,stage=${stage},generation_attempt=${stage==="generation"?attempt:row.generation_attempt},review_attempt=${stage==="review"?attempt:row.review_attempt},quality_review=NULL,error=NULL,updated_at=now() WHERE id=${id}`;
    if(row.selection)await tx`UPDATE fishery_flow_tasks SET selection=${tx.json(row.selection)},updated_at=now() WHERE id=${id}`;
    await audit(actor,"fishery.flow.retry",`fishery:${row.document_id}`,note,null,{id,stage,attempt,mode,receiptId:receipt?.id??null,acknowledgeNewCharge,newStageAfterReconciliation:row.error?.code==="FISHERY_INTERRUPTED_BEFORE_REQUEST",preservedGenerationReceiptId:row.draft?.receiptId??null},{db:tx});
    return {id,status:"queued",stage,attempt,mode};
  });
}
export async function decideFlow(id:string,raw:unknown,actor:string) {
  const data=qualification.parse(raw);
  const [target]=await sql`SELECT document_id FROM fishery_flow_tasks WHERE id=${id}`;if(!target) throw new NotFound("Flow not found");
  return sql.begin(async tx=>{
    await lockDocument(tx,target.document_id);
    const [row]=await tx`SELECT * FROM fishery_flow_tasks WHERE id=${id} FOR UPDATE`;if(!row) throw new NotFound("Flow not found");
    if(data.snapshotHash!==hash(row.snapshot)) throw new Conflict("Review snapshot changed");
    if(row.status==="running") throw new Conflict("Running task must finish or be reconciled before a human decision");
    if(data.decision==="qualified") {
      if(row.selection&&row.selection.outcome?.label!=='SCORED')throw new Conflict('Selection is incomplete; a high score never replaces evidence review');
      const [latest]=await tx`SELECT id FROM fishery_flow_tasks WHERE document_id=${row.document_id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if(latest?.id!==id) throw new Conflict("A newer authoritative task supersedes this internal article");
      if(await currentMaterialDecision(row.document_id,tx)!=="approved") throw new Conflict("Current material observation and source revision must be approved; pending or rejected material blocks internal qualification");
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
    if(data.decision==="qualified") await enqueuePublication({kind:"article",itemId:row.document_id,decisionId:id,decisionHash:publicationDecisionHash(human),actor},tx);
    await audit(actor,"fishery.flow.decision",`fishery:${row.document_id}`,data.note,null,{id,...human},{db:tx});return {id,...human,published:false};
  });
}
export async function flowRequiredCalls(id:string) {
  const [task]=await sql`SELECT draft,stage,stage_requests,generation_attempt,review_attempt,selection FROM fishery_flow_tasks WHERE id=${id}`;
  if(!task) throw new NotFound("Flow not found");
  if(task.selection&&isSelectionStage(task.stage)&&task.selection.results.prefilter&&task.selection.results.prefilter.data.label!=='PASS')return 0;
  let calls=0;
  for(const stage of remainingStages(task)) {
    const attempt=stageAttempt(task,stage),bound=task.stage_requests[`${stage}:${attempt}`];
    const [receipt]=bound?await sql`SELECT status FROM receipts WHERE subject=${bound.subject} AND purpose=${bound.purpose} ORDER BY id DESC LIMIT 1`:[];
    if(!receipt||!["received","completed"].includes(receipt.status)) calls++;
  }
  return calls;
}
export async function assertSelectionFlowCurrent(id:string){
  const [task]=await sql`SELECT document_id,snapshot,status,selection FROM fishery_flow_tasks WHERE id=${id}`;
  if(!task?.selection)return;
  await inputFor(task.document_id,hash(task.snapshot));
  const [source]=await sql`SELECT tier FROM sources WHERE id=${task.snapshot.sourceId}`;
  if(source?.tier!==task.selection.sourceTier)throw new Conflict('Source tier changed since selection was authorized');
  if(!['queued','running'].includes(task.status)||await currentMaterialDecision(task.document_id)!=='approved')throw new Conflict('Selection task or current material approval changed; no new request');
}
export async function runQueuedFlows(jobs:FlowJob[],invoke:FisheryInvoke=chatJson) {
  const rows=[];
  for(const job of jobs) {
    const [task]=await sql`SELECT selection FROM fishery_flow_tasks WHERE id=${job.id}`;
    const permit=job.automatic?async()=>{const {automaticFlowPermit}=await import('./automatic-flows.ts');await automaticFlowPermit(job.id,job.automatic);await assertSelectionFlowCurrent(job.id);}:task?.selection?()=>assertSelectionFlowCurrent(job.id):null;
    if(permit){try{await permit();}catch(error){rows.push({id:job.id,skipped:'Automatic approval, source or configuration no longer current',reason:(error as Error).message});continue;}}
    const result=await runFlow(job.id,permit?async options=>{await permit();return invoke(options);}:invoke,async run=>{
      if(!config.modelCallsEnabled) throw new Conflict("MODEL_CALLS_ENABLED is closed; 模型调用开关关闭，未发送请求");
      await withFisheryAuthorization(async()=>{await assertFisheryCapacity(await flowRequiredCalls(job.id));await run();},permit?{assertAuthorized:permit}:{});
    },{requireProcessingLease:true});
    // runFlow persists business failures so the UI remains authoritative. Throw as well so
    // pg-boss cannot report a failed task as a successfully completed queue job.
    if(result.status==="failed") throw new Error(`任务 ${job.id} 执行失败 [${result.stage}/${result.error?.phase}]: ${result.error?.reason??"未知错误"}`);
    rows.push(result);
  }
  return rows;
}
export interface FlowJob {id:string;automatic?:import('./automatic-flows.ts').AutomaticFlowBinding;}
export const flowQueue=defineQueue<FlowJob>({name:"fishery.flow",options:{policy:"short",retryLimit:0,expireInSeconds:600},worker:{batchSize:1,localConcurrency:1},run:runQueuedFlows});
export async function enqueueFlow(id:string) {
  const [task]=await sql`SELECT document_id FROM fishery_flow_tasks WHERE id=${id}`;if(!task) throw new NotFound("Flow not found");
  return sql.begin(async tx=>{
    await lockDocument(tx,task.document_id);await assertDocumentSettled(task.document_id,tx);
    const detail=await flowDetail(id);if(detail.stale||!detail.authoritative||detail.status!=="queued") throw new Conflict("Current queued task required");
    // This manual API only produces jobs. Do not start pg-boss's default scheduler/supervisor
    // or silently change the mode of an instance already started by another caller.
    await getBoss({schedule:false,supervise:false});
    return {id,jobId:await enqueueOn(flowQueue,{id},{},tx),status:"queued"};
  });
}
