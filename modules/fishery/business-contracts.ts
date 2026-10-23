import { z } from "zod";
import type { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { BUSINESS_TOPICS } from "./business-topics.ts";
import { dateSchema, idSchema, linkSchema } from "./contracts.ts";
import type { EvidenceCatalog } from "./backend/evidence.ts";

export const businessTopicIdSchema = z.enum(BUSINESS_TOPICS.map(t => t.id) as [string, ...string[]]);
export const businessGuideKindSchema = z.enum(["business_guide", "policy_reference"]);
const evidence = z.array(z.string().regex(/^p\d+s\d+$/)).max(12).refine(ids => new Set(ids).size === ids.length, "Duplicate evidence ID");
export const businessTextSchema = z.strictObject({ value: z.string().trim().min(1).max(1000), evidence: evidence.min(1) });
const missingState = z.enum(["unverified", "extraction_failed", "not_stated", "not_applicable"]);
const missingReason = z.string().trim().min(1).max(2000);
export const BUSINESS_FIELD_STATE_LABELS = { unknown: "未核实", unverified: "未核实", extraction_failed: "提取失败", not_stated: "原文未载明", not_applicable: "不适用", documented: "原文已载明" } as const;
const missingFields = [
  z.strictObject({ state: z.literal("unverified"), value: z.null(), evidence: z.tuple([]), reason: missingReason }),
  z.strictObject({ state: z.literal("extraction_failed"), value: z.null(), evidence: z.tuple([]), reason: missingReason }),
  z.strictObject({ state: z.literal("not_stated"), value: z.null(), evidence: z.tuple([]), reason: missingReason }),
  z.strictObject({ state: z.literal("not_applicable"), value: z.null(), evidence: evidence.min(1), reason: missingReason }),
] as const;
export const businessFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unknown"), value: z.null(), evidence: z.tuple([]) }),
  z.strictObject({ state: z.literal("documented"), value: z.string().trim().min(1).max(2000), evidence: evidence.min(1) }),
  ...missingFields,
]);
const date = z.strictObject({ value: dateSchema, evidence, state: missingState.optional(), reason: missingReason.optional() }).superRefine((v, ctx) => {
  if (v.state ? v.value.precision !== "unknown" || !v.reason : v.reason !== undefined)
    ctx.addIssue({ code: "custom", message: "Missing date state requires an unknown value and a reason" });
  const needsEvidence = v.value.precision !== "unknown" || v.state === "not_applicable";
  if (needsEvidence ? !v.evidence.length : v.evidence.length !== 0)
    ctx.addIssue({ code: "custom", message: "Known or not-applicable date needs evidence; other missing dates have no anchors" });
});
export const businessGuidePayloadSchema = z.strictObject({
  topicId: businessTopicIdSchema, kind: businessGuideKindSchema,
  title: businessTextSchema, summary: z.array(businessTextSchema).min(1).max(8),
  audience: businessFieldSchema, opportunity: businessFieldSchema, restrictions: businessFieldSchema, materials: businessFieldSchema,
  applicability: z.strictObject({ countriesOrRegions: businessFieldSchema, flagStates: businessFieldSchema, species: businessFieldSchema, fishingMethods: businessFieldSchema }),
  documentStatus: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown"), value: z.null(), evidence: z.tuple([]) }),
    z.strictObject({ state: z.literal("documented"), value: z.enum(["formal", "consultation"]), evidence: evidence.min(1) }),
    ...missingFields,
  ]),
  dates: z.strictObject({ published: date, effectiveFrom: date, deadline: date, expiresAt: date }),
  serviceEntry: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown"), label: z.null(), url: z.null(), evidence: z.tuple([]) }),
    z.strictObject({ state: z.literal("documented"), label: z.string().trim().min(1).max(200), url: linkSchema, evidence: evidence.min(1) }),
    ...missingFields.map(field => field.omit({ value: true }).extend({ label: z.null(), url: z.null() })),
  ]),
  relations: z.array(z.strictObject({ type: z.enum(["amends", "repeals", "interprets", "supersedes"]), title: z.string().trim().min(1).max(300), url: linkSchema.nullable(), evidence: evidence.min(1) })).max(12).default([]),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(2000);
export const createBusinessGuideSchema = z.strictObject({ documentId: idSchema, snapshotHash: digest, payload: businessGuidePayloadSchema, reason });
export const updateBusinessGuideSchema = z.strictObject({ expectedRevision: z.int().positive(), snapshotHash: digest, payload: businessGuidePayloadSchema, reason });
export const businessExecutorKindSchema = z.enum(["human", "authorized_agent", "unspecified"]);
export type BusinessExecutorKind = z.infer<typeof businessExecutorKindSchema>;
export const BUSINESS_EXECUTOR_LABELS: Record<BusinessExecutorKind, string> = { human: "真人手动审核（声明）", authorized_agent: "授权代理审核（声明）", unspecified: "执行身份未知（未记录）" };
export const decideBusinessGuideSchema = z.strictObject({ expectedRevision: z.int().positive(), payloadHash: digest, snapshotHash: digest, decision: z.enum(["approved", "rejected", "withdrawn"]), approvalMode: z.literal("final").default("final"), aiReviewHash: digest.optional(), executorKind: businessExecutorKindSchema.default("unspecified"), reason });
export type BusinessGuidePayload = z.infer<typeof businessGuidePayloadSchema>;
export type BusinessGuideKind = z.infer<typeof businessGuideKindSchema>;
export interface BusinessGuideSnapshot {
  version: "fishery-business-guide/1"; documentId: string; sourceId: string; articleId: string | null; canonicalUrl: string; sourceRevision: number; sourceProfileHash: string;
  observationRevision: number; observationHash: string; rawSha256: string; bodySha256: string;
  materialReviewId: number; materialReviewHash: string; catalogHash: string; catalogVersion: string;
}
export interface BusinessGuideContext {
  documentId: string; snapshot: BusinessGuideSnapshot; snapshotHash: string;
  source: { name: string; url: string; originalTitle: string; published: z.infer<typeof dateSchema>; publishedAt: string | null; publicationLiteral: string | null; capturedAt: string }; catalog: EvidenceCatalog;
}
export interface BusinessGuideAdminRecord {
  id: string; documentId: string; revision: number; status: "draft" | "approved" | "rejected" | "withdrawn";
  snapshot: BusinessGuideSnapshot; snapshotHash: string; payload: BusinessGuidePayload; payloadHash: string;
  createdAt: string; updatedAt: string; verifiedAt: string | null; readable: boolean; blockedReason: string | null;
  aiReview: BusinessGuideAIReview;
  humanDecision: { executorKind?: BusinessExecutorKind; mode?: "final"; aiReviewHash?: string; aiEditorialRevision?: number; decision: string; actor: string; at: string; reason: string } | null;
}
export interface BusinessGuideAIReview {
  current: boolean; pass: boolean; status: string; reviewHash: string | null;
  receiptId: number | null; guideRevision: number | null; confirmedConflict: boolean;
}
export interface BusinessDateBoundary {
  state: "unknown" | "elapsed" | "date_not_elapsed";
  lastDate: string | null;
}
export interface BusinessTimeliness {
  checkedAt: string;
  timeZone: typeof BEIJING_TIMEZONE;
  deadline: BusinessDateBoundary;
  expiry: BusinessDateBoundary;
  label: string;
}
export interface BusinessGuideReaderItem {
  id: string; documentId: string; revision: number; payload: BusinessGuidePayload;
  source: BusinessGuideContext["source"]; snapshot: BusinessGuideSnapshot;
  evidence: Record<string, { quote: string; paragraph: number; page: number | null; url: string; sourceId?: string; sha256?: string }>;
  verifiedAt: string; timeliness: BusinessTimeliness; qualification: { status: "qualified"; label: string }; verification: { executorKind: BusinessExecutorKind; origin: "human_editorial"; aiStatus: "passed"; label: string; legalApplicability: "not_determined" };
  eligibility: { canApply: null; canFish: null }; internalOnly: true;
}
export interface BusinessGuideReaderPage {
  rows: BusinessGuideReaderItem[]; total: number; page: number; limit: number;
  topics: { id: string; label: string; firstRelease: boolean; count: number; emptyMessage: string | null }[];
  internalOnly: true;
}
