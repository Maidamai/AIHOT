import { isIP } from "node:net";
import { z } from "zod";
import { isBlockedAddress } from "@aihot/backend/lib/url";

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = z.string().trim().min(1);
// Metadata only; a future collector must use assertPublicUrl at connection time.
export const linkSchema = z.url().max(2000).refine((value) => {
  const u = new URL(value);
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  return u.protocol === "https:" && !u.username && !u.password && !u.search &&
    (isIP(host) ? !isBlockedAddress(host) : host.includes(".") && !/(^|\.)(localhost|local|internal)$/.test(host));
}, "Use a public HTTPS metadata link without credentials or query parameters").transform((value) => new URL(value).href);
const instant = z.iso.datetime({ offset: true });
export const dateSchema = z.discriminatedUnion("precision", [
  z.strictObject({ precision: z.literal("unknown"), value: z.null() }),
  z.strictObject({ precision: z.literal("year"), value: z.string().regex(/^(19|20|21)\d{2}$/) }),
  z.strictObject({ precision: z.literal("month"), value: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.strictObject({ precision: z.literal("day"), value: z.iso.date() }),
]);
export const sourceSchema = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  rightsStatus: z.enum(["unknown", "permitted", "restricted", "revoked"]).default("unknown"),
  rightsCheckedAt: instant.nullable().default(null),
  accessMode: z.enum(["public", "permission", "subscription"]).default("public"),
  authRequired: z.boolean().default(false),
  allowedInternalArchive: z.boolean().default(false),
  allowedSummary: z.boolean().default(false),
  allowedTranslation: z.boolean().default(false),
  allowedFulltextExport: z.boolean().default(false),
  allowedPublication: z.boolean().default(false),
  evidenceUrl: linkSchema.nullable().default(null),
  reviewDueAt: instant.nullable().default(null),
  attribution: text.max(300).default("来源原文"),
  healthNote: z.string().trim().max(1000).default(""),
}).superRefine((s, ctx) => {
  if (s.rightsStatus === "permitted" && (!s.evidenceUrl || !s.rightsCheckedAt || !s.reviewDueAt))
    ctx.addIssue({ code: "custom", message: "Permitted rights require evidence, checked time and review deadline" });
  if (s.rightsStatus !== "permitted" && [s.allowedInternalArchive, s.allowedSummary, s.allowedTranslation, s.allowedFulltextExport, s.allowedPublication].some(Boolean))
    ctx.addIssue({ code: "custom", message: "Unknown, restricted or revoked rights cannot grant use" });
  if (s.reviewDueAt && s.rightsCheckedAt && Date.parse(s.reviewDueAt) <= Date.parse(s.rightsCheckedAt))
    ctx.addIssue({ code: "custom", message: "Review deadline must follow rights check" });
});
export type SourceProfile = Omit<z.infer<typeof sourceSchema>, "expectedRevision">;
export const documentSchema = z.strictObject({
  sourceId: idSchema, articleId: idSchema.nullable().default(null),
  issuer: text.max(300), documentNumber: text.max(200).nullable().default(null), canonicalUrl: linkSchema,
});
export const policyContextSchema = z.strictObject({
  entryIntoForce: z.enum(["unknown", "pending", "in_force"]),
  objectionDeadline: dateSchema,
  nonApplicationMentioned: z.array(text.max(100)).max(20),
  provisionYears: z.array(z.int().min(1900).max(2199)).max(20),
});
export const captureSchema = z.strictObject({
  acquisitionMode: z.enum(["live_capture", "archive_replay", "unknown"]).default("unknown"),
  adapter: z.enum(["jinjiang", "iotc", "fuzhou", "moa", "fujian"]), sourceUrl: linkSchema, capturedAt: instant,
  archiveId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional(),
  httpStatus: z.int().min(100).max(599), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  parser: text.max(100), parseStatus: z.enum(["parsed", "missing", "failed", "unverified"]),
  attachmentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  attachmentUrl: linkSchema.nullable().default(null), attachmentHttpStatus: z.int().min(100).max(599).nullable().default(null),
  attachmentCapturedAt: instant.nullable().default(null), attachmentPages: z.int().positive().nullable().default(null),
  publishedAt: instant.nullable().default(null), publicationLiteral: z.string().max(150).nullable().default(null),
  conflicts: z.array(text.max(300)).max(20),
});
export const observationSchema = z.strictObject({
  expectedRevision: z.int().nonnegative(), originalTitle: text.max(500), title: text.max(500),
  summaryZh: text.max(4000), language: text.max(30), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  dates: z.strictObject({ published: dateSchema, event: dateSchema.optional(), adopted: dateSchema, effectiveFrom: dateSchema, effectiveUntil: dateSchema }),
  policyStatus: z.enum(["unknown", "draft", "adopted", "repealed", "superseded"]),
  policyContext: policyContextSchema.optional(), sourceCapture: captureSchema.optional(),
  scope: z.strictObject({
    regions: z.array(z.enum(["NPFC", "SE_PACIFIC", "WCPFC", "CHINA", "OTHER"])).max(5),
    species: z.array(text.max(150)).max(20), flags: z.array(text.max(80)).max(20),
    activities: z.array(z.enum(["fishing", "transshipment", "port", "trade", "employment", "other"])).max(6),
    unknownFields: z.array(z.enum(["regions", "species", "flags", "activities"])).max(4),
  }).superRefine((s, ctx) => {
    for (const key of ["regions", "species", "flags", "activities"] as const) {
      if (!s[key].length && !s.unknownFields.includes(key)) ctx.addIssue({ code: "custom", path: [key], message: "Empty scope must be explicitly unknown" });
      if (s[key].length && s.unknownFields.includes(key)) ctx.addIssue({ code: "custom", path: [key], message: "Known scope cannot also be unknown" });
    }
  }),
  evidence: z.array(z.strictObject({
    url: linkSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    page: z.int().positive().nullable(), section: text.max(200).nullable(),
  })).min(1).max(20),
}).superRefine((o, ctx) => {
  if (o.policyContext?.entryIntoForce === "pending" && o.dates.effectiveFrom.precision !== "unknown")
    ctx.addIssue({ code: "custom", path: ["dates", "effectiveFrom"], message: "Pending entry into force cannot supply an effective date" });
  if (o.sourceCapture && o.sourceCapture.rawSha256 !== o.rawSha256)
    ctx.addIssue({ code: "custom", path: ["rawSha256"], message: "Capture and observation hashes must match" });
});
export type Observation = Omit<z.infer<typeof observationSchema>, "expectedRevision">;
export const reviewSchema = z.strictObject({
  revision: z.int().positive(), sourceRevision: z.int().positive(), decision: z.enum(["approved", "rejected"]),
  applicabilityReviewed: z.boolean(), note: text.max(1000),
});
export const withdrawSchema = z.strictObject({ expectedRevision: z.int().positive(), reason: text.max(1000) });
export const exportSchema = z.strictObject({ revision: z.int().positive(), format: z.enum(["json", "markdown"]).default("json") });

export function effectiveState(date: z.infer<typeof dateSchema>, today: string): "unknown" | "future" | "reached" {
  if (date.precision === "unknown") return "unknown";
  if (date.precision === "year") return date.value > today.slice(0, 4) ? "future" : "unknown";
  if (date.precision === "month") return date.value > today.slice(0, 7) ? "future" : "unknown";
  return date.value > today ? "future" : "reached";
}

export function canExportSummary(p: SourceProfile, now: number): boolean {
  return p.rightsStatus === "permitted" && p.allowedSummary && p.allowedPublication &&
    !!p.rightsCheckedAt && Date.parse(p.rightsCheckedAt) <= now && !!p.reviewDueAt && Date.parse(p.reviewDueAt) > now;
}
