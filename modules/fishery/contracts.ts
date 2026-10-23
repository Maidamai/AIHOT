import { isIP } from "node:net";
import { z } from "zod";
import { pdfBlankProofSchema } from "./backend/pdf-blank-proof.ts";
import { isBlockedAddress } from "@aihot/backend/lib/url";

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = z.string().trim().min(1);
const verifiedMetadataQueries = new Set([
  "https://zj.singlewindow.cn/pen-portal/guide/basic.jspa?id=196",
  "https://www.ccs.org.cn/ccswz/columnDetail?columnid=201900002000000618",
]);
// Metadata only; a future collector must use assertPublicUrl at connection time.
export const linkSchema = z.url().max(2000).refine((value) => {
  const u = new URL(value);
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const paginationQuery=/^https:\/\/iotc\.org\/cmms\/basic\?page=[1-9]\d{0,2}$/.test(value);
  const verifiedQuery = (verifiedMetadataQueries.has(u.href)||paginationQuery) && value === u.href && !u.hash && !u.port;
  return u.protocol === "https:" && !u.username && !u.password && (!u.search || verifiedQuery) &&
    (isIP(host) ? !isBlockedAddress(host) : host.includes(".") && !/(^|\.)(localhost|local|internal)$/.test(host));
}, "Use a public HTTPS metadata link without credentials or unverified query parameters").transform((value) => new URL(value).href);
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
  issuer: text.max(300).describe("Legacy input for source attribution only; does not verify a page publisher or policy issuer"), documentNumber: text.max(200).nullable().default(null), canonicalUrl: linkSchema,
});
export const policyContextSchema = z.strictObject({
  entryIntoForce: z.enum(["unknown", "pending", "in_force"]),
  objectionDeadline: dateSchema,
  nonApplicationMentioned: z.array(text.max(100)).max(20),
  provisionYears: z.array(z.int().min(1900).max(2199)).max(20),
});
const pdfTextNodeSchema=z.strictObject({text:z.string().max(1200),fontSize:z.number().positive(),top:z.number().finite(),left:z.number().finite(),width:z.number().nonnegative(),height:z.number().positive()});
export const pdfTextEvidenceSchema=z.strictObject({
  version:z.literal("pdf-footnotes/v1"),layoutSha256:z.string().regex(/^[a-f0-9]{64}$/),structureSha256:z.string().regex(/^[a-f0-9]{64}$/),textSha256:z.string().regex(/^[a-f0-9]{64}$/),
  transformations:z.array(z.strictObject({page:z.int().positive(),marker:z.string().regex(/^\d{1,3}$/),sourceStart:z.int().nonnegative(),sourceEnd:z.int().positive(),outputStart:z.int().nonnegative(),outputEnd:z.int().positive(),sourceText:z.string().min(1).max(3),replacement:z.string().min(3).max(5),base:pdfTextNodeSchema,reference:pdfTextNodeSchema,footnote:pdfTextNodeSchema,footnoteLines:z.array(pdfTextNodeSchema).min(1).max(20),footnoteText:z.string().min(1).max(1200)})).max(128),
});
export const noticeContextSchema=z.strictObject({
  nature:z.enum(['consultation','application_notice','funding_allocation','publicity','policy_reference','issued_document','unknown']),
  validity:z.literal('unknown'),deadline:dateSchema,deadlineLiteral:z.string().max(1000).nullable(),deadlineRole:z.enum(['consultation','application','publicity','unknown']),
  evidenceVersion:z.literal('notice-sections/v2').optional(),
  pageBody:z.strictObject({bodyStart:z.literal(0),bodyEnd:z.int().nonnegative(),sourceUrl:linkSchema,rawSha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  pageTextSha256:z.string().regex(/^[a-f0-9]{64}$/),attachmentCount:z.int().min(0).max(1000),
  attachments:z.array(z.strictObject({url:linkSchema,label:z.string().max(500),extension:z.string().max(12),format:z.enum(['pdf','office_zip','ole','html','other','not_fetched']),
    sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),httpStatus:z.int().min(100).max(599).nullable(),parseStatus:z.enum(['parsed','failed','unverified','not_fetched']),pages:z.int().positive().nullable(),
    textSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),bodyStart:z.int().nonnegative().nullable(),bodyEnd:z.int().nonnegative().nullable(),pageIntervals:z.array(z.strictObject({page:z.int().min(1).max(200),start:z.int().nonnegative(),end:z.int().positive()})).min(1).max(200).optional(),pdfTextEvidence:pdfTextEvidenceSchema.optional()})).max(3),
});
export type NoticeContext=z.infer<typeof noticeContextSchema>;
export const jfaContextSchema=noticeContextSchema.pick({pageBody:true,pageTextSha256:true,attachmentCount:true,attachments:true}).extend({attachmentListSha256:z.string().regex(/^[a-f0-9]{64}$/),capacityLimit:z.literal(6).optional(),attachments:z.array(noticeContextSchema.shape.attachments.element.extend({
  manualReviewReason:z.literal('raised_reference_nonunique_footnote').optional(),
  parserError:z.literal('Raised PDF reference lacks a unique same-page footnote; manual review required').optional(),
  parser:z.string().max(100).optional(),
})).max(6)});
export type JfaContext=z.infer<typeof jfaContextSchema>;
export function noticeDeadlineState(n:NoticeContext,today:string){
  if(n.deadline.precision!=='day')return 'unknown' as const;
  return n.deadline.value<today?'closed' as const:n.deadline.value===today?'deadline_today' as const:'future_deadline' as const;
}
export function completeNoticeAttachments(n:Pick<NoticeContext,'attachmentCount'|'attachments'>){
  return n.attachmentCount===n.attachments.length&&n.attachments.every(a=>a.httpStatus===200&&a.format==='pdf'&&a.extension==='pdf'&&a.parseStatus==='parsed'&&a.sha256&&a.textSha256&&a.pages&&a.bodyStart!==null&&a.bodyEnd!==null&&a.bodyEnd>a.bodyStart);
}
const hash256=z.string().regex(/^[a-f0-9]{64}$/);
export const businessContextSchema=z.strictObject({
  version:z.literal('business-capture/v1'),versionHash:hash256.nullable(),evidenceHash:hash256.nullable(),pageTextSha256:hash256,
  links:z.array(z.strictObject({url:linkSchema,label:z.string().max(500),role:z.enum(['required_attachment','reference'])})).max(50),
  attachments:z.array(z.strictObject({url:linkSchema,sha256:hash256,httpStatus:z.int().min(100).max(599)})).max(3),
  sections:z.array(z.strictObject({id:z.string().max(50),kind:z.enum(['webpage','pdf']),sourceUrl:linkSchema,rawSha256:hash256,textSha256:hash256,start:z.int().nonnegative(),end:z.int().nonnegative(),label:z.string().max(500).optional(),pages:z.array(z.strictObject({page:z.int().positive(),start:z.int().nonnegative(),end:z.int().positive()})).max(200).optional()})).max(4),
});
export const captureSchema = z.strictObject({
  acquisitionMode: z.enum(["live_capture", "archive_replay", "unknown"]).default("unknown"),
  adapter: z.enum(["jinjiang", "iotc", "npfc", "fuzhou", "moa", "fujian", "fujian-notices", "jfa-press", "manual_official", "itf-fisheries", "fao-tuna", "mpa-port"]), sourceUrl: linkSchema, capturedAt: instant,
  businessContext:businessContextSchema.optional(),
  noticeContext:noticeContextSchema.optional(),
  jfaContext:jfaContextSchema.optional(),
  regulatoryListing:z.strictObject({measureNumber:z.string().regex(/^\d{4}-\d{2}$/),statedEffectiveDate:z.string().max(100).nullable(),membership:z.literal('listed_current_only'),applicableSea:z.literal('unknown'),effectiveStatus:z.literal('unknown')}).optional(),
  archiveId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional(),
  manualArchiveId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional(),
  httpStatus: z.int().min(100).max(599), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  pdfTextEvidence:pdfTextEvidenceSchema.optional(),
  pdfTextlessPages:z.array(z.int().min(1).max(200)).max(200).optional(),
  pdfBlankReview:pdfBlankProofSchema.optional(),
  parser: text.max(100), parseStatus: z.enum(["parsed", "missing", "failed", "unverified"]),
  attachmentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  attachmentUrl: linkSchema.nullable().default(null), attachmentHttpStatus: z.int().min(100).max(599).nullable().default(null),
  attachmentCapturedAt: instant.nullable().default(null), attachmentPages: z.int().positive().nullable().default(null),
  publishedAt: instant.nullable().default(null), publicationLiteral: z.string().max(150).nullable().default(null),
  conflicts: z.array(text.max(300)).max(20),
}).superRefine((c, ctx) => {
  if(['itf-fisheries','fao-tuna','mpa-port'].includes(c.adapter)!==!!c.businessContext)ctx.addIssue({code:'custom',message:'Business capture requires its own bound source context'});
  if(c.businessContext&&c.parseStatus==='parsed'&&(!c.businessContext.versionHash||!c.businessContext.evidenceHash||!c.businessContext.sections.length))ctx.addIssue({code:'custom',message:'Business capture requires a complete content version and evidence sections'});
  if(c.pdfBlankReview&&(c.adapter!=='manual_official'||c.pdfBlankReview.rawSha256!==c.rawSha256||c.pdfBlankReview.physicalPages!==c.attachmentPages))ctx.addIssue({code:'custom',message:'Blank-page review requires its exact manual original PDF and physical page count'});
  if(c.parseStatus==='parsed'&&c.pdfTextlessPages?.length&&(!c.pdfBlankReview||JSON.stringify(c.pdfTextlessPages)!==JSON.stringify(c.pdfBlankReview.pageImages.map(p=>p.page))))ctx.addIssue({code:'custom',message:'Unverified textless PDF pages cannot be marked parsed'});
  if((c.adapter==='fujian-notices')!==!!c.noticeContext)ctx.addIssue({code:'custom',message:'Fujian notice captures require their bound page/attachment context only'});
  if(c.noticeContext&&c.parseStatus==='parsed'&&!completeNoticeAttachments(c.noticeContext))ctx.addIssue({code:'custom',message:'Parsed notices require every complete verified attachment'});
  if((c.adapter==='jfa-press')!==!!c.jfaContext)ctx.addIssue({code:'custom',message:'JFA captures require their bound page/attachment context only'});
  if(c.jfaContext&&c.parseStatus==='parsed'&&!completeNoticeAttachments(c.jfaContext))ctx.addIssue({code:'custom',message:'Parsed JFA press releases require every complete verified attachment'});
  if((c.adapter==='npfc')!==!!c.regulatoryListing)ctx.addIssue({code:'custom',message:'NPFC captures require their bound unreviewed measure identity only'});
  if ((c.manualArchiveId && c.adapter !== "manual_official") || (c.adapter === "manual_official" && (!c.manualArchiveId || c.archiveId)))
    ctx.addIssue({code:"custom",message:"Manual official captures require their own manual archive only"});
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
