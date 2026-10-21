import type { Observation, SourceProfile } from "./contracts.ts";

export const MATERIAL_STATES = { pending: "待审核", failed: "获取失败", unverified: "待核验", stale: "审核已失效", rejected: "已拒绝", approved: "已审核", withdrawn: "已撤回" } as const;
export const ACQUISITION_MODES = { live_capture: "实时获取收据", archive_replay: "归档回放", unknown: "获取方式未标记" } as const;
export type MaterialState = keyof typeof MATERIAL_STATES;
export interface Blocker { code: string; message: string; }
export interface MaterialSource {
  id: string; name: string; revision: number; profile: SourceProfile; enabled: boolean;
  participationMode: string; testOnly: boolean;
}
export interface MaterialObservation { revision: number; observedAt: string; actor: string; contentHash: string; payload: Observation; }
export interface MaterialReview { revision: number; sourceRevision: number; decision: "approved" | "rejected"; note: string; actor: string; reviewedAt: string; applicabilityReviewed: boolean; }
export interface MaterialRow {
  id: string; sourceId: string; title: string; issuer: string; sourceAttribution:string;legacyIssuerMeaning:"source_attribution_only";canonicalUrl: string; documentNumber: string | null;
  articleId: string | null; withdrawnReason: string | null; source: MaterialSource; latest: MaterialObservation | null;
  review: MaterialReview | null; state: MaterialState; blockers: Blocker[]; testOnly: boolean;
}
export type SourceCaptureSummary=Pick<NonNullable<Observation["sourceCapture"]>,"capturedAt"|"httpStatus"|"parseStatus"|"acquisitionMode">&{documentId:string;observationRevision:number};
export interface Workbench { sourceCaptures:Record<string,SourceCaptureSummary>;rows: MaterialRow[]; sources: MaterialSource[]; limit: number; page: number; total: number; counts: Record<MaterialState, number>; scopeCounts: { real: number; test: number; all: number }; }
export interface MaterialDetail extends MaterialRow {
  observations: MaterialObservation[]; reviews: MaterialReview[];
  text: { body: string; truncated: boolean; hashMatches: boolean; acquisitionMode: string | null } | null;
}


export const FLOW_STATES:Record<string,string>={queued:"待处理",running:"处理中",failed:"失败，待人工核对",needs_evidence:"待补证",needs_human_review:"待人工审核",qualified:"内部合格",rejected:"已拒绝"};
export interface FlowTimeline {
  sourcePublished:Observation["dates"]["published"];sourcePublishedAt:string|null;publicationLiteral:string|null;
  sourceEvent:Observation["dates"]["published"];candidateEvent:Observation["dates"]["published"];
  sourceCapturedAt:string|null;generatedAt:string|null;checkedAt:string|null;taskCreatedAt:string;taskUpdatedAt:string;
  referenceDate:string;originalAgeDays:number|null;isOriginalDay:boolean|null;historical:boolean;label:string;
}
export interface FlowReconciliation {
  version:string;eligible:boolean;reasons:string[];executionFingerprint:string;snapshotHash:string;status:string;stage:string;currentSourceRevision:number|null;currentObservationRevision:number|null;currentMaterialApproved:boolean;stageRequestCount:number;candidateHash:string;reusableGenerationReceiptId:number|null;newCallsOnResume:number;
  ledger:{id:string|null;valid:boolean;entryCount:number;reservedMicroCny:number;states:string[]};receipts:{id:number;status:string;purpose:string;subject:string|null;responsePresent:boolean}[];jobs:{id:string;taskId:string;state:string}[];activeJobId:string|null;
}
export interface FlowView {
  id:string;document_id:string;identity:string;status:string;stage:string;snapshotHash:string;authoritative:boolean;materialRejected:boolean;materialApproved:boolean;stale:boolean;staleReason:string|null;
  timeline:FlowTimeline;reconciliation?:FlowReconciliation;
  generation_attempt:number;review_attempt:number;created_at:string;updated_at:string;
  selection?:{config:{version:string;calibrated:false};results:Record<string,{data:unknown;receiptId:number;model:string}>;outcome?:{label:string;values:number[];threshold:number|null;average:number|null;attentionCandidate:boolean;calibrated:false;factApproval:false}}|null;
  draft:{receiptId:number|null;promptVersion:string;model:string;provenance?:{origin:"human_revision";candidateHash:string;originalTaskId:string;receiptId:number;responseHash:string;reason:string;actor:string;at:string;diff:unknown};draft:{relevance:{decision:string};summaryZh:{sentence:string;evidence:{quote:string;paragraph:number;page:number|null}[]}[];[key:string]:unknown}}|null;
  quality_review:{receiptId:number;model:string;promptVersion:string;status:string;review:{decision:string;coverage:string;findings:{field:string;verdict:string;reason:string;evidence:{quote:string;paragraph:number;page:number|null}[]}[]};missingFields:string[]}|null;
  human_decision:{decision:string;actor:string;at:string;note:string}|null;
  error:{code?:string;nextStageRequiresNewCharge?:boolean;newCallsOnResume?:number;stage:string;phase?:string;reason:string;receiptId:number|null}|null;
  internalArticle:{summaryZh:{sentence:string}[];qualifiedBy:string;timeline:FlowTimeline}|null;
}

export type ReaderCategoryId="policy"|"safety"|"market"|"research"|"equipment"|"operations"|"reference";
export interface ReaderCategory { id:ReaderCategoryId;label:string;count:number; }
export interface FisheryReaderItem {
  id:string;title:string;source:{name:string;url:string;originalTitle:string};category:{id:ReaderCategoryId;label:string};
  summary:{sentence:string;evidence:{quote:string;paragraph:number;page:number|null;url:string}[]}[];
  dates:{published:{precision:"unknown"|"year"|"month"|"day";value:string|null};event:{precision:"unknown"|"year"|"month"|"day";value:string|null}};
  age:{referenceDate:string;days:number|null;historical:boolean;label:string};
  verification:{status:"internally_qualified";label:string;legalApplicability:string};
}
export interface FisheryReaderPage { rows:FisheryReaderItem[];categories:ReaderCategory[];total:number;filteredTotal:number;page:number;limit:number;selectedCategory:ReaderCategoryId|null;internalOnly:true;referenceDate:string; }
