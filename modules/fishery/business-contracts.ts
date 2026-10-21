import { z } from "zod";
import { BUSINESS_TOPICS } from "./business-topics.ts";
import { dateSchema, idSchema, linkSchema } from "./contracts.ts";
import type { EvidenceCatalog } from "./backend/evidence.ts";

export const businessTopicIdSchema = z.enum(BUSINESS_TOPICS.map(t => t.id) as [string, ...string[]]);
export const businessGuideKindSchema = z.enum(["business_guide", "policy_reference"]);
const evidence = z.array(z.string().regex(/^p\d+s\d+$/)).max(12).refine(ids => new Set(ids).size === ids.length, "Duplicate evidence ID");
export const businessTextSchema = z.strictObject({ value: z.string().trim().min(1).max(1000), evidence: evidence.min(1) });
export const businessFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unknown"), value: z.null(), evidence: z.tuple([]) }),
  z.strictObject({ state: z.literal("documented"), value: z.string().trim().min(1).max(2000), evidence: evidence.min(1) }),
]);
const date = z.strictObject({ value: dateSchema, evidence }).superRefine((v, ctx) => {
  if (v.value.precision === "unknown" ? v.evidence.length !== 0 : v.evidence.length === 0)
    ctx.addIssue({ code: "custom", message: "Known date needs evidence; unknown date has no assertion" });
});
export const businessGuidePayloadSchema = z.strictObject({
  topicId: businessTopicIdSchema, kind: businessGuideKindSchema,
  title: businessTextSchema, summary: z.array(businessTextSchema).min(1).max(8),
  audience: businessFieldSchema, opportunity: businessFieldSchema, restrictions: businessFieldSchema, materials: businessFieldSchema,
  applicability: z.strictObject({ countriesOrRegions: businessFieldSchema, flagStates: businessFieldSchema, species: businessFieldSchema, fishingMethods: businessFieldSchema }),
  documentStatus: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown"), value: z.null(), evidence: z.tuple([]) }),
    z.strictObject({ state: z.literal("documented"), value: z.enum(["formal", "consultation"]), evidence: evidence.min(1) }),
  ]),
  dates: z.strictObject({ published: date, effectiveFrom: date, deadline: date, expiresAt: date }),
  serviceEntry: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown"), label: z.null(), url: z.null(), evidence: z.tuple([]) }),
    z.strictObject({ state: z.literal("documented"), label: z.string().trim().min(1).max(200), url: linkSchema, evidence: evidence.min(1) }),
  ]),
  relations: z.array(z.strictObject({ type: z.enum(["amends", "repeals", "interprets", "supersedes"]), title: z.string().trim().min(1).max(300), url: linkSchema.nullable(), evidence: evidence.min(1) })).max(12).default([]),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(2000);
export const createBusinessGuideSchema = z.strictObject({ documentId: idSchema, snapshotHash: digest, payload: businessGuidePayloadSchema, reason });
export const updateBusinessGuideSchema = z.strictObject({ expectedRevision: z.int().positive(), snapshotHash: digest, payload: businessGuidePayloadSchema, reason });
export const decideBusinessGuideSchema = z.strictObject({ expectedRevision: z.int().positive(), payloadHash: digest, snapshotHash: digest, decision: z.enum(["approved", "rejected", "withdrawn"]), reason });
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
  humanDecision: { decision: string; actor: string; at: string; reason: string } | null;
}
export interface BusinessDateBoundary {
  state: "unknown" | "elapsed" | "date_not_elapsed";
  lastDate: string | null;
}
export interface BusinessTimeliness {
  checkedAt: string;
  timeZone: "Asia/Shanghai";
  deadline: BusinessDateBoundary;
  expiry: BusinessDateBoundary;
  label: string;
}
export interface BusinessGuideReaderItem {
  id: string; documentId: string; revision: number; payload: BusinessGuidePayload;
  source: BusinessGuideContext["source"]; snapshot: BusinessGuideSnapshot;
  evidence: Record<string, { quote: string; paragraph: number; page: number | null; url: string }>;
  verifiedAt: string; timeliness: BusinessTimeliness; verification: { origin: "human_editorial"; label: string; legalApplicability: "not_determined" };
  eligibility: { canApply: null; canFish: null }; internalOnly: true;
}
export interface BusinessGuideReaderPage {
  rows: BusinessGuideReaderItem[]; total: number; page: number; limit: number;
  topics: { id: string; label: string; firstRelease: boolean; count: number; emptyMessage: string | null }[];
  internalOnly: true;
}
