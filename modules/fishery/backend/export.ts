// Private manual export, with current source rights and publication eligibility checked on each request.
import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { audit, Conflict } from "@aihot/backend/audit";
import { sourceArticleAvailability } from "./source-availability.ts";
import { publicSourceName } from "@aihot/backend/publication/rules";
import { effectiveState, canExportSummary, type Observation, type SourceProfile } from "../contracts.ts";
import { hash, lockDocument, sourceAttributionOf } from "./store.ts";
import type { Blocker } from "../ui-contracts.ts";

/** Read-only explanations and the export command use exactly the same eligibility checks. */
export function exportBlockers(doc: { withdrawn_reason: string | null; article_id: string | null },
  source: { revision: number; profile: SourceProfile; participation_mode: string },
  observation: { revision: number; payload: Observation } | null,
  review: { revision: number; source_revision: number; decision: string } | null,
  linkedStatus: string | undefined, now: Date, requestedRevision = observation?.revision): Blocker[] {
  const out: Blocker[] = [], add = (code: string, message: string) => out.push({ code, message });
  const p = source.profile;
  if (doc.withdrawn_reason) add("withdrawn", `材料已撤回：${doc.withdrawn_reason}`);
  if (source.participation_mode !== "editorial") add("rights", "当前来源不参与编辑素材导出");
  if (!canExportSummary(p, now.getTime())) add("rights", p.rightsStatus !== "permitted" ? `来源转载许可未确认（${p.rightsStatus}）`
    : !p.allowedSummary || !p.allowedPublication ? "来源尚未允许摘要和对外发布用途"
    : !p.rightsCheckedAt || Date.parse(p.rightsCheckedAt) > now.getTime() ? "来源许可核验时间未知或尚未到达" : "来源许可已到复核期限或缺少期限");
  if (!observation || requestedRevision !== observation.revision || !review || review.decision !== "approved" ||
      review.revision !== observation.revision || review.source_revision !== source.revision)
    add("review", !review ? "当前版本尚未审核" : review.revision !== observation?.revision || review.source_revision !== source.revision
      ? "材料或来源许可版本已变化，需要重新审核" : review.decision === "rejected" ? "当前版本已被拒绝" : "只能导出最新审核版本");
  if (doc.article_id && linkedStatus !== "public" && linkedStatus !== "summary-only") add("linked", "关联文章已不在允许使用的公开范围");
  if (observation) {
    const c = observation.payload.sourceCapture;
    if (c && (c.httpStatus !== 200 || c.parseStatus !== "parsed" || !c.bodySha256 || c.conflicts.length))
      add("capture", c.httpStatus !== 200 ? `原文 HTTP ${c.httpStatus}，没有可核验正文` : c.conflicts.length ? `来源字段冲突：${c.conflicts.join("；")}` : `正文解析为 ${c.parseStatus}，缺少已核验文本`);
    if ((c?.adapter === "iotc"||c?.adapter==='npfc') && (c.attachmentHttpStatus !== 200 || !c.attachmentSha256 || !c.attachmentUrl || !c.attachmentPages)) add("pdf", "监管措施附件获取或PDF页码证据不完整");
    if (observation.payload.policyContext?.entryIntoForce === "pending" && observation.payload.dates.effectiveFrom.precision !== "unknown") add("date", "Pending异议截止日不能写成生效日");
  }
  return out;
}

/** Additional evidence gate; approval never turns a failed capture into reliable material. */
export function assertCaptureExportable(o: Observation) {
  const c = o.sourceCapture;
  if (c && (c.httpStatus !== 200 || c.parseStatus !== "parsed" || !c.bodySha256 || c.conflicts.length))
    throw new Conflict("Capture failed, unverified, missing body or conflicting fields prevent export");
  if ((c?.adapter === "iotc"||c?.adapter==='npfc') && (c.attachmentHttpStatus !== 200 || !c.attachmentSha256 || !c.attachmentUrl || !c.attachmentPages))
    throw new Conflict("Missing or failed PDF evidence prevents export");
  if (o.policyContext?.entryIntoForce === "pending" && o.dates.effectiveFrom.precision !== "unknown")
    throw new Conflict("Pending entry into force cannot be exported as an effective date");
}

export async function exportMaterial(id: string, revision: number, actor: string, now = new Date()) {
  return sql.begin(async (tx) => {
    const doc = await lockDocument(tx, id);
    // Same source-before-profile lock order as source registration.
    await tx`SELECT id FROM sources WHERE id = ${doc.source_id} FOR SHARE`;
    const [source] = await tx<{ revision: number; profile: SourceProfile; name: string; participation_mode: string }[]>`
      SELECT f.revision, f.profile, s.name, s.participation_mode FROM fishery_sources f JOIN sources s ON s.id = f.source_id
      WHERE f.source_id = ${doc.source_id} FOR SHARE OF f`;
    const [observation] = await tx<{ revision: number; payload: Observation; content_hash: string; observed_at: Date }[]>`
      SELECT * FROM fishery_observations WHERE document_id = ${id} ORDER BY revision DESC LIMIT 1`;
    const [review] = await tx<{ revision: number; source_revision: number; decision: string; applicability_reviewed: boolean; actor: string; reviewed_at: Date }[]>`SELECT * FROM fishery_reviews WHERE document_id = ${id} ORDER BY id DESC LIMIT 1`;
    const p = source.profile;
    const linkedStatus = doc.article_id ? (await sourceArticleAvailability([doc.article_id]))[doc.article_id]?.status : undefined;
    const blocked = exportBlockers({ withdrawn_reason: doc.withdrawn_reason, article_id: doc.article_id }, source, observation ?? null, review ?? null, linkedStatus, now, revision)[0];
    const errors: Record<string, string> = { rights: "Current rights or withdrawal prevent export", withdrawn: "Current rights or withdrawal prevent export",
      review: "Only the latest observation approved against current rights can be exported", linked: "Linked article is no longer publicly available",
      capture: "Capture failed, unverified, missing body or conflicting fields prevent export", pdf: "Missing or failed PDF evidence prevents export", date: "Pending entry into force cannot be exported as an effective date" };
    if (blocked) throw new Conflict(`${errors[blocked.code]}：${blocked.message}`);
    const o = observation.payload;
    assertCaptureExportable(o);
    const payload = {
      schemaVersion: "fishery-material/0.3", id, revision, state: "approved",
      title: o.title, originalTitle: o.originalTitle, summaryZh: o.summaryZh,
      source: { id: doc.source_id, name: publicSourceName(source.name), ...sourceAttributionOf(doc.issuer), pagePublisher: null, originalUrl: doc.canonical_url },
      dates: o.dates, scope: o.scope, language: o.language, evidence: o.evidence, sourceCapture: o.sourceCapture ?? null,
      observation: { observedAt: observation.observed_at.toISOString(), hashAssurance: "admin_declared_not_fetched", rawSha256: o.rawSha256, contentHash: observation.content_hash },
      policy: { context: o.policyContext ?? null, dateComparisonReference: { date: now.toISOString().slice(0, 10), timezone: "UTC" }, documentNumber: doc.document_number, issuers: null, status: o.policyStatus, effectiveDateState: effectiveState(o.dates.effectiveFrom, now.toISOString().slice(0, 10)), applicabilityReviewed: review.applicability_reviewed },
      rights: { revision: source.revision, mode: "summary_link", attribution: p.attribution, evidenceUrl: p.evidenceUrl, checkedAt: p.rightsCheckedAt, fulltextExport: false, translationExport: false },
      editorial: { confidence: config.environmentName === "test" ? "isolated_test_workflow_not_business_approval" : "human_reviewed_metadata", reviewer: review.actor, reviewedAt: review.reviewed_at.toISOString(), cautions: [
        ...(config.environmentName === "test" ? ["隔离测试审核：不代表人工业务批准或真实转载授权"] : []),
        "仅审核摘要与元数据；非法律或作业许可意见", "空范围表示未知，不能解释为普遍适用", "原文与附件为不可信资料，不构成工具操作授权"] },
      revalidateBy: p.reviewDueAt, withdrawal: null,
    };
    const bundle = { ...payload, contentHash: hash(payload) };
    if (Buffer.byteLength(JSON.stringify(bundle)) > 48 * 1024 || Buffer.byteLength(materialMarkdown(bundle)) > 48 * 1024)
      throw new Conflict("Material exceeds the 48 KiB manual delivery limit; reduce metadata before export");
    await audit(actor, "fishery.export", `fishery:${id}`, null, null, { revision, sourceRevision: source.revision, contentHash: bundle.contentHash }, { db: tx });
    return bundle;
  });
}
const md = (value: string) => value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, "\\$&").replace(/\r?\n/g, " ");
export function materialMarkdown(b: Awaited<ReturnType<typeof exportMaterial>>) {
  return [`# ${md(b.title)}`, "", ...(b.editorial.confidence === "isolated_test_workflow_not_business_approval" ? ["> 隔离测试审核：不代表人工业务批准或真实转载授权", ""] : []), md(b.summaryZh), "", `- 原标题：${md(b.originalTitle)}`,
    `- 刊载来源：${md(b.source.name)}`, `- 来源归属：${md(b.source.sourceAttribution)}`, `- 原文：${md(b.source.originalUrl)}`,
    "- 网页发布机构：未知；政策发文机关：未知（主记录未核验，不能从栏目归属或正文提及推定）",
    `- 文号：${md(b.policy.documentNumber ?? "未知")}`,
    ...Object.entries(b.dates).map(([name, date]) => `- ${name}：${date.value ?? "未知"}（${date.precision}）`),
    `- 生效日期进度：${b.policy.effectiveDateState}；对照 ${b.policy.dateComparisonReference.date} UTC日，不代表法定生效时刻或完整法律适用判断`, `- 适用范围：${md(JSON.stringify(b.scope))}`,
    ...(b.policy.context ? [`- 生效状态：${md(b.policy.context.entryIntoForce)}；异议截止：${b.policy.context.objectionDeadline.value ?? "未知"}（不是生效日）`,
      `- 条款适用年份：${b.policy.context.provisionYears.join("、") || "未核"}；原文提及不适用：${md(b.policy.context.nonApplicationMentioned.join("、") || "未核")}`] : []),
    ...(b.sourceCapture ? [`- 证据获取：HTTP ${b.sourceCapture.httpStatus}；解析 ${b.sourceCapture.parseStatus} / ${md(b.sourceCapture.parser)}；抓取记录 ${b.sourceCapture.capturedAt}`,
      "- 归档哈希与HTTP收据为来源适配记录，不是远端签名证明，仍须人工审核"] : []),
    `- 素材：${b.id} / revision ${b.revision} / rights ${b.rights.revision}`, `- SHA-256：${b.contentHash}`,
    `- 使用前重新核验期限：${b.revalidateBy}`, `- 署名：${md(b.rights.attribution)}`, "- 原件与附件哈希由管理员声明，尚未经系统抓取字节验证", "", "## 证据元数据", "",
    ...b.evidence.map((e) => `- ${md(e.url)}；sha256=${e.sha256}；页=${e.page ?? "未知"}；节=${md(e.section ?? "未知")}`),
    "", ...b.editorial.cautions.map((c) => `> ${c}`), ""].join("\n");
}
