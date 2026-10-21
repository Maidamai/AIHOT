import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { createDocument, observe, registerSource, review, withdraw } from "../backend/store.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { buildEvidenceCatalog } from "../backend/evidence.ts";
import { observationFixture } from "./fixtures.ts";
import { registerBusinessGuideRoutes } from "../backend/business-routes.ts";
import { businessGuideContext, businessGuideAdminDetail, businessGuideReaderPage, businessGuideReaderItem, createBusinessGuide,
  updateBusinessGuide, decideBusinessGuide, businessGuideHistory, validateBusinessGuidePayload } from "../backend/business-guides.ts";
import type { BusinessGuideAdminRecord, BusinessGuideContext, BusinessGuidePayload } from "../business-contracts.ts";

import { createGuideAIReview, guideAIClaims, guideAIResultSchema, processGuideAIReview, type GuideAIInvoke, type GuideAIResult } from "../backend/business-ai-review.ts";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Offline guide gate tests forbid external/model requests"); };
after(() => { globalThis.fetch = originalFetch; });
const app = Fastify(); registerBusinessGuideRoutes(app);
after(async () => { await app.close(); await closeDb(); });
let sequence = 0;
const body = "本合成测试通知为正式文件，2026年10月21日发布。\n本合成测试仅适用远洋渔业企业，申请材料包括申请表。\n2026年11月1日截止。\n办理入口：https://example.org/service。\n本合成测试修改2020年第2号规定，并不废止整份规定。";
const unknown = () => ({ state: "unknown" as const, value: null, evidence: [] as [] });
async function fixture(options: { manual?: boolean; pdf?: boolean } = {}) {
  const sourceBody = options.pdf ? `--- Page 1 ---\n${body}\n--- Page 2 ---\n合成附件第二页，限定条件保留。` : body;
  const sourceId = `business-guide-${++sequence}`;
  await sql`INSERT INTO sources(id,name,kind,enabled,next_fetch_at) VALUES(${sourceId},'Synthetic official source','external',false,'2100-01-01')`;
  await registerSource(sourceId, { expectedRevision: 0 }, "synthetic-editor");
  const doc = await createDocument({ sourceId, issuer: "Synthetic source attribution", canonicalUrl: `https://example.org/${sourceId}` }, "synthetic-editor");
  const archiveId = `${sourceId}_${sha256(sourceId).slice(0, 16)}`, directory = options.manual ? path.join(config.dataDir, "fishery-manual-archives", sourceId) : path.join(config.dataDir, "fishery-batches", sourceId, "body"), filename = path.join(directory, options.manual ? "body.txt" : `${archiveId}.txt`);
  await mkdir(directory, { recursive: true }); await writeFile(filename, sourceBody);
  const observation = { ...observationFixture, originalTitle: "合成测试正式通知", title: "合成测试正式通知", rawSha256: sha256(sourceBody), sourceCapture: {
    adapter: options.manual ? "manual_official" : "moa", acquisitionMode: "live_capture", ...(options.manual ? { manualArchiveId: sourceId } : { archiveId }), sourceUrl: `https://example.org/${sourceId}`, capturedAt: "2026-10-21T00:00:00Z",
    httpStatus: 200, rawSha256: sha256(sourceBody), bodySha256: sha256(sourceBody), parser: "synthetic-business/v1", parseStatus: "parsed", attachmentSha256: options.pdf ? sha256("Synthetic PDF bytes") : null,
    attachmentPages: options.pdf ? 2 : null, attachmentUrl: options.pdf ? "https://example.org/synthetic.pdf" : null, conflicts: [],
  } };
  await observe(doc.id, observation, "synthetic-editor");
  await review(doc.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic ordinary source review, not rights permission" }, "synthetic-reviewer");
  return { id: String(doc.id), sourceId, observation, filename };
}
function payload(c: Pick<BusinessGuideContext, "catalog">): BusinessGuidePayload {
  const ids = c.catalog.spans.map(s => s.id), date = () => ({ value: { precision: "unknown" as const, value: null }, evidence: [] });
  return {
    topicId: "funding", kind: "policy_reference", title: { value: "合成通知信息", evidence: [ids[0]!] }, summary: [{ value: "本合成测试仅适用远洋渔业企业，申请材料包括申请表。", evidence: [ids[1]!] }],
    audience: { state: "documented", value: "远洋渔业企业", evidence: [ids[1]!] }, opportunity: unknown(), restrictions: unknown(), materials: unknown(),
    applicability: { countriesOrRegions: unknown(), flagStates: unknown(), species: unknown(), fishingMethods: unknown() },
    documentStatus: { state: "documented", value: "formal", evidence: [ids[0]!] },
    dates: { published: date(), effectiveFrom: date(), deadline: { value: { precision: "day", value: "2026-11-01" }, evidence: [ids[2]!] }, expiresAt: date() },
    serviceEntry: { state: "documented", label: "合成官方信息入口", url: "https://example.org/service", evidence: [ids[3]!] },
    relations: [{ type: "amends", title: "2020年第2号规定", url: null, evidence: [ids[4]!] }],
  };
}
async function draft(id: string) { const c = await businessGuideContext(id); return createBusinessGuide({ documentId: id, snapshotHash: c.snapshotHash, payload: payload(c), reason: "Synthetic editorial draft" }, "synthetic-editor"); }
const decision = (row: BusinessGuideAdminRecord, value: "approved" | "rejected" | "withdrawn" = "approved") => ({ expectedRevision: row.revision, snapshotHash: row.snapshotHash, payloadHash: row.payloadHash, decision: value, aiReviewHash: row.aiReview.reviewHash ?? undefined, reason: "Synthetic human decision" });

function aiAnswer(p: BusinessGuidePayload): GuideAIResult {
  return { coverage: "complete_input", findings: guideAIClaims(p).map(c => ({ claimId: c.id, verdict: "supported", evidence: c.evidenceIds, reason: "Synthetic support" })), omissions: guideAIResultSchema.shape.omissions.element.shape.field.options.map(field => ({ field, verdict: "none", evidence: [], reason: "Synthetic no omission" })) } as GuideAIResult;
}
async function aiPass(row: BusinessGuideAdminRecord, mutate?: (result: GuideAIResult) => void) {
  const task = await createGuideAIReview(row.id, { identity: `offline_${row.revision}`, expectedRevision: row.revision, payloadHash: row.payloadHash, snapshotHash: row.snapshotHash }, "synthetic-ai-requester");
  const data = aiAnswer(row.payload); mutate?.(data);
  const response = { model: "offline-fake", choices: [{ message: { role: "assistant", content: JSON.stringify(data) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } };
  const [r] = await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${task.id},'deepseek','offline-fake',${task.request_intent.purpose},${task.request_intent.subject},'received',${sql.json(response)}) RETURNING id`;
  await processGuideAIReview(task.id, (async options => ({ data: options.schema.parse(data), receiptId: Number(r!.id), model: "offline-fake", usage: null, reused: true })) as GuideAIInvoke);
  return businessGuideAdminDetail(row.id);
}
async function finalApproval(row: BusinessGuideAdminRecord, actor: string) {
  const checked = await aiPass(row);
  return decideBusinessGuide(row.id, decision(checked), actor);
}

test("business dates preserve spaced PDF literals without borrowing years or joining spans", () => {
  for (const [literal, accepted] of [
    ["实施日期：2026 年 1 月 1 日", true],
    ["实施日期：2026-01-01", true],
    ["实施日期：1 月 1 日", false],
    ["年份：2026 年。\n实施日期：1 月 1 日", false],
  ] as const) {
    const source = `${body}\n${literal}`;
    const catalog = buildEvidenceCatalog({ body: source, bodySha256: sha256(source), observationRevision: 1 });
    const input = payload({ catalog });
    input.dates.effectiveFrom = { value: { precision: "day", value: "2026-01-01" }, evidence: catalog.spans.slice(5).map(s => s.id) };
    const before = structuredClone(catalog);
    if (accepted) assert.doesNotThrow(() => validateBusinessGuidePayload(input, { catalog }), literal);
    else assert.throws(() => validateBusinessGuidePayload(input, { catalog }), /complete original literal/, literal);
    assert.deepEqual(catalog, before, "Matching must not normalize or rewrite original quotes");
    assert.equal(source.slice(catalog.spans.at(-1)!.start, catalog.spans.at(-1)!.end), catalog.spans.at(-1)!.quote);
  }
});

test("human guides require current ordinary approval, preserve unknowns, and private list/count/detail share current gate", async () => {
  const f = await fixture(), before = await sql`SELECT count(*)::int AS n FROM receipts`, row = await draft(f.id);
  assert.equal(row.status, "draft"); assert.equal(row.readable, false); assert.equal((await businessGuideReaderPage()).total, 0);
  const approved = await finalApproval(row, "synthetic-reviewer");
  assert.equal(approved.status, "approved"); assert.equal(approved.revision, 2); assert.equal(approved.readable, true);
  const page = await businessGuideReaderPage({ topicId: "funding" });
  assert.ok(page.rows.some(i => i.id === row.id)); assert.equal(page.topics.length, 10); assert.equal(page.topics.find(t => t.id === "crew")!.emptyMessage !== null, true);
  const item = await businessGuideReaderItem(row.id);
  assert.equal(item.verification.origin, "human_editorial"); assert.deepEqual(item.eligibility, { canApply: null, canFish: null });
  assert.equal(item.payload.relations[0]!.type, "amends"); assert.equal(item.payload.relations[0]!.url, null);
  assert.equal(item.payload.applicability.flagStates.state, "unknown"); assert.ok(item.verifiedAt); assert.notEqual(item.verifiedAt, item.source.publishedAt);
  assert.equal("humanDecision" in item, false); assert.equal("body" in item, false);
  assert.equal(Number((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n), Number(before[0]!.n) + 1, "Only the explicit offline AI fixture creates a receipt; reader calls create none");
  const profile = await sql`SELECT s.site_fulltext,f.profile FROM sources s JOIN fishery_sources f ON f.source_id=s.id WHERE s.id=${f.sourceId}`;
  assert.equal(profile[0]!.site_fulltext, false); assert.equal(profile[0]!.profile.rightsStatus, "unknown");
});

test("reader recomputes current timeliness instead of verification time and keeps expired history readable", async () => {
  const f = await fixture(), context = await businessGuideContext(f.id), input = payload(context);
  input.kind = "business_guide"; input.dates.expiresAt = structuredClone(input.dates.deadline);
  const row = await createBusinessGuide({ documentId: f.id, snapshotHash: context.snapshotHash, payload: input, reason: "Synthetic deadline and expiry" }, "editor");
  const approved = await finalApproval(row, "reviewer");
  const before = await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`business-guide:${row.id}`}`;
  const notElapsed = await businessGuideReaderItem(row.id, new Date("2026-11-01T23:59:59+08:00"));
  const elapsed = await businessGuideReaderItem(row.id, new Date("2026-11-02T00:00:00+08:00"));
  assert.equal(notElapsed.timeliness.deadline.state, "date_not_elapsed"); assert.equal(notElapsed.timeliness.label, "可申请状态未知/待核实");
  assert.equal(elapsed.timeliness.deadline.state, "elapsed"); assert.equal(elapsed.timeliness.expiry.state, "elapsed");
  assert.match(elapsed.timeliness.label, /^已过文载失效日期/); assert.match(elapsed.timeliness.label, /已截止（按原文日期）/);
  assert.equal(elapsed.verifiedAt, approved.verifiedAt); assert.notEqual(elapsed.timeliness.checkedAt, elapsed.verifiedAt);
  for (const item of [notElapsed, elapsed]) assert.deepEqual(item.eligibility, { canApply: null, canFish: null });
  const page = await businessGuideReaderPage({}, new Date("2026-11-02T00:00:00+08:00"));
  assert.ok(page.rows.some(i => i.id === row.id)); assert.ok(page.rows.every(i => i.timeliness.checkedAt === "2026-11-01T16:00:00.000Z"));
  assert.equal((await businessGuideAdminDetail(row.id)).status, "approved");
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`business-guide:${row.id}`}`, before, "time passing is a read projection, not withdrawal or another review");
});

test("stale writes fail, edits require new approval, withdrawal is final and full audit history remains", async () => {
  const f = await fixture(), row = await draft(f.id), approved = await finalApproval(row, "reviewer");
  await assert.rejects(decideBusinessGuide(row.id, decision(row), "reviewer"), /changed/);
  await assert.rejects(decideBusinessGuide(row.id, { ...decision(approved), payloadHash: "f".repeat(64) }, "reviewer"), /changed/);
  const c = await businessGuideContext(f.id), edited = await updateBusinessGuide(row.id, { expectedRevision: approved.revision, snapshotHash: c.snapshotHash, payload: payload(c), reason: "Synthetic edit" }, "editor");
  assert.equal(edited.status, "draft"); assert.equal(edited.verifiedAt, null); await assert.rejects(businessGuideReaderItem(row.id), /No current/);
  const withdrawn = await decideBusinessGuide(row.id, decision(edited, "withdrawn"), "reviewer");
  await assert.rejects(decideBusinessGuide(row.id, decision(withdrawn), "reviewer"), /cannot be restored/);
  await assert.rejects(updateBusinessGuide(row.id, { expectedRevision: withdrawn.revision, snapshotHash: c.snapshotHash, payload: payload(c), reason: "Forbidden restore" }, "editor"), /immutable/);
  const history = await businessGuideHistory(row.id); assert.equal(history.length, 4); assert.ok(history[2]!.before.payload); assert.ok(history[2]!.after.payload);
});

test("ordinary reject then reapprove on the same versions never revives an old guide", async () => {
  const f = await fixture(), row = await draft(f.id); await finalApproval(row, "reviewer");
  await review(f.id, { revision: 1, sourceRevision: 1, decision: "rejected", applicabilityReviewed: false, note: "Synthetic material rejection" }, "reviewer");
  await assert.rejects(businessGuideReaderItem(row.id), /No current/);
  await review(f.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic new material decision" }, "reviewer");
  assert.equal((await businessGuideAdminDetail(row.id)).readable, false);
  const after = await businessGuideReaderPage(); assert.ok(after.rows.every(i => i.id !== row.id));
  await assert.rejects(decideBusinessGuide(row.id, decision(await businessGuideAdminDetail(row.id)), "reviewer"), /save a new draft/);
});

test("source revision, observation, withdrawal and damaged actual archived body close reading", async () => {
  for (const change of ["source", "observation", "withdraw", "body"] as const) {
    const f = await fixture(), row = await draft(f.id); await finalApproval(row, "reviewer");
    if (change === "source") await registerSource(f.sourceId, { expectedRevision: 1, healthNote: "Synthetic changed rights record" }, "editor");
    if (change === "observation") await observe(f.id, { ...f.observation, expectedRevision: 1, summaryZh: "Synthetic changed observation" }, "editor");
    if (change === "withdraw") await withdraw(f.id, { expectedRevision: 1, reason: "Synthetic source withdrawal" }, "editor");
    if (change === "body") await writeFile(f.filename, body + "changed");
    assert.equal((await businessGuideAdminDetail(row.id)).readable, false, change);
    await assert.rejects(businessGuideReaderItem(row.id), /No current/, change);
  }
});

test("only current catalog IDs, complete date literals and original explicit service URLs are accepted", async () => {
  const f = await fixture(), c = await businessGuideContext(f.id), good = payload(c);
  assert.doesNotThrow(() => validateBusinessGuidePayload(good, c));
  assert.throws(() => validateBusinessGuidePayload({ ...good, title: { value: "Synthetic invented", evidence: ["p999s1"] } }, c), /absent/);
  assert.throws(() => validateBusinessGuidePayload({ ...good, serviceEntry: { ...good.serviceEntry, state: "documented", label: "Guessed application", url: c.source.url, evidence: [c.catalog.spans[0]!.id] } }, c), /explicit URL/);
  assert.throws(() => validateBusinessGuidePayload({ ...good, dates: { ...good.dates, effectiveFrom: { value: { precision: "day", value: "2026-11-02" }, evidence: [c.catalog.spans[2]!.id] } } }, c), /complete original literal/);
  assert.throws(() => validateBusinessGuidePayload({ ...good, relations: good.relations.map(r => ({ ...r, type: "repeals" })) }, c), /amendment is not wholesale repeal/);
  assert.throws(() => validateBusinessGuidePayload({ ...good, relations: good.relations.map(r => ({ ...r, url: "https://example.org/guessed-old-version" })) }, c), /do not invent/);
  const unknownEntry = { ...good, serviceEntry: { state: "unknown", label: null, url: null, evidence: [] } };
  assert.doesNotThrow(() => validateBusinessGuidePayload(unknownEntry, c), "unknown official entry is preserved, not guessed from source URL");
  await rm(f.filename); await assert.rejects(businessGuideContext(f.id), /missing|ENOENT/);
});

test("manual official archives and complete PDF page intervals use the shared source-body reader", async () => {
  for (const options of [{ manual: true }, { pdf: true }]) {
    const f = await fixture(options), c = await businessGuideContext(f.id), row = await draft(f.id);
    if (options.pdf) { assert.equal(c.catalog.pages.length, 2); assert.ok(c.catalog.spans.every(s => s.page !== null)); }
    await finalApproval(row, "reviewer");
    const item = await businessGuideReaderItem(row.id); assert.equal(item.documentId, f.id);
    if (options.pdf) assert.ok(Object.values(item.evidence).every(a => a.url === "https://example.org/synthetic.pdf"));
  }
});

test("missing capture or unavailable linked article cannot enter a current business projection", async () => {
  const f = await fixture(), row = await draft(f.id); await finalApproval(row, "reviewer");
  const material = await upsertMaterial({ sourceId: f.sourceId, url: `https://example.org/linked-${f.id}`, title: "Synthetic linked record", bodyText: body, bodyStatus: "ok", via: "synthetic-guide-test" });
  await sql`UPDATE fishery_documents SET article_id=${material.articleId} WHERE id=${f.id}`;
  await sql`DELETE FROM publications WHERE article_id=${material.articleId}`;
  await assert.rejects(businessGuideReaderItem(row.id), /No current/);
  await assert.rejects(businessGuideContext(f.id), /Linked article unavailable/);
  const missing = await fixture();
  const { sourceCapture: _capture, ...withoutCapture } = missing.observation;
  await observe(missing.id, { ...withoutCapture, expectedRevision: 1 }, "editor");
  await review(missing.id, { revision: 2, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic approval cannot manufacture missing capture" }, "reviewer");
  await assert.rejects(businessGuideContext(missing.id), /complete source capture/);
});

test("normal admin guards protect every guide route and writes still require CSRF", async () => {
  config.devAdmin = null;
  for (const url of ["/api/admin/fishery/business-guides", "/api/admin/fishery/business-guides/missing", "/api/admin/fishery/business-guides/context/missing", "/api/admin/fishery/business-guides/missing/history", "/api/admin/fishery/business-guides/missing/ai-review", "/api/admin/fishery/business-reader", "/api/admin/fishery/business-reader/missing"])
    assert.equal((await app.inject(url)).statusCode, 401, url);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/fishery/business-guides", payload: {} })).statusCode, 401);
  config.devAdmin = { displayName: "ISOLATED BUSINESS ROUTE TEST" };
  try {
    for (const [method, url] of [["POST", "/api/admin/fishery/business-guides"], ["PUT", "/api/admin/fishery/business-guides/missing"], ["POST", "/api/admin/fishery/business-guides/missing/decision"], ["POST", "/api/admin/fishery/business-guides/missing/ai-review"]] as const)
      assert.equal((await app.inject({ method, url, payload: {} })).statusCode, 403);
    const f = await fixture(), c = await businessGuideContext(f.id);
    const saved = await app.inject({ method: "POST", url: "/api/admin/fishery/business-guides", headers: { "x-csrf-token": "dev" }, payload: { documentId: f.id, snapshotHash: c.snapshotHash, payload: payload(c), reason: "Synthetic route create" } });
    assert.equal(saved.statusCode, 201, saved.body); assert.equal(saved.headers["cache-control"], "private, no-store");
    const row = saved.json();
    const receiptsBefore = await sql`SELECT count(*)::int AS n FROM receipts`;
    const task = await app.inject({ method: "POST", url: `/api/admin/fishery/business-guides/${row.id}/ai-review`, headers: { "x-csrf-token": "dev" }, payload: { identity: "route_create_only", expectedRevision: row.revision, payloadHash: row.payloadHash, snapshotHash: row.snapshotHash } });
    assert.equal(task.statusCode, 201, task.body); assert.equal(task.json().modelCalls, 0); assert.equal(task.json().enqueued, false);
    const aiStatus = await app.inject(`/api/admin/fishery/business-guides/${row.id}/ai-review`);
    assert.equal(aiStatus.statusCode, 200); assert.equal(aiStatus.json().status, "queued"); assert.equal(aiStatus.json().pass, false);
    assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`, receiptsBefore);
    const checked = await aiPass(row);
    const approved = await app.inject({ method: "POST", url: `/api/admin/fishery/business-guides/${row.id}/decision`, headers: { "x-csrf-token": "dev" }, payload: decision(checked) });
    assert.equal(approved.statusCode, 200, approved.body);
    const readable = await app.inject(`/api/admin/fishery/business-reader/${row.id}`);
    assert.equal(readable.statusCode, 200); assert.equal(readable.headers["cache-control"], "private, no-store");
  } finally { config.devAdmin = null; }
});


test("four legacy manual approvals remain administrator-only until current AI and a new final decision", async () => {
  const rows: BusinessGuideAdminRecord[] = [];
  for (let i = 0; i < 4; i++) {
    const f = await fixture(), row = await draft(f.id);
    const human = { decision: "approved", actor: "legacy-human-author", at: "2026-10-21T00:00:00Z", reason: "Retained original manual approval", revision: 2, payloadHash: row.payloadHash, snapshotHash: row.snapshotHash };
    await sql`UPDATE fishery_business_guides SET status='approved',revision=2,verified_at=${human.at},human_decision=${sql.json(human)} WHERE id=${row.id}`;
    const legacy = await businessGuideAdminDetail(row.id); rows.push(legacy);
    assert.equal(legacy.status, "approved"); assert.equal(legacy.humanDecision!.actor, human.actor); assert.equal(legacy.readable, false); assert.equal(legacy.aiReview.status, "not_requested");
    await assert.rejects(businessGuideReaderItem(row.id), /No current/);
    await assert.rejects(decideBusinessGuide(row.id, decision(legacy), "reviewer"), /AI review hash/);
  }
  const hidden = await businessGuideReaderPage();
  assert.ok(hidden.rows.every(i => rows.every(r => r.id !== i.id)));
  const qualifiedBefore = hidden.topics.find(t => t.id === "funding")!.count;
  const checked = await aiPass(rows[0]!);
  assert.equal(checked.aiReview.pass, true); assert.equal(checked.readable, false, "New AI result cannot inherit old human approval");
  assert.equal((await businessGuideReaderPage()).topics.find(t => t.id === "funding")!.count, qualifiedBefore);
  const approved = await decideBusinessGuide(checked.id, decision(checked), "final-reviewer");
  assert.equal(approved.readable, true); assert.equal(approved.aiReview.current, true); assert.equal(approved.aiReview.guideRevision, 2);
  assert.equal(approved.humanDecision!.aiReviewHash, approved.aiReview.reviewHash);
  const again = await decideBusinessGuide(approved.id, decision(approved), "final-reviewer");
  assert.equal(again.aiReview.reviewHash, approved.aiReview.reviewHash); assert.equal(again.aiReview.guideRevision, 2); assert.equal(again.readable, true);
  const item = await businessGuideReaderItem(again.id);
  assert.equal(item.qualification.status, "qualified"); assert.equal(item.verification.aiStatus, "passed"); assert.equal(item.verification.origin, "human_editorial");
});

test("final gate closes missing, contradicted, not-found, ambiguous and partial-input AI results", async () => {
  for (const kind of ["missing", "contradicted", "not_found", "ambiguous", "partial_input"] as const) {
    const f = await fixture(), row = await draft(f.id);
    const checked = kind === "missing" ? row : await aiPass(row, data => {
      if (kind === "partial_input") data.coverage = "unknown";
      else data.findings[0]!.verdict = kind;
    });
    assert.equal(checked.aiReview.pass, false, kind);
    await assert.rejects(decideBusinessGuide(row.id, { ...decision(checked), aiReviewHash: "f".repeat(64) }, "reviewer"), /passing AI/, kind);
    assert.equal((await businessGuideAdminDetail(row.id)).readable, false);
    await assert.rejects(businessGuideReaderItem(row.id), /No current/, kind);
  }
});


test("elapsed dates reject current application-window claims without hiding accurately qualified history", () => {
  const source = `${body}\n2000年1月1日截止。`, catalog = buildEvidenceCatalog({ body: source, bodySha256: sha256(source), observationRevision: 1 });
  const input = payload({ catalog });
  input.dates.deadline = { value: { precision: "day", value: "2000-01-01" }, evidence: [catalog.spans.at(-1)!.id] };
  for (const value of ["正在申报", "当前开放申报", "申报窗口已开放", "目前正在受理", "现行有效"]) {
    assert.throws(() => validateBusinessGuidePayload({ ...input, summary: [{ value, evidence: [catalog.spans.at(-1)!.id] }] }, { catalog }), /Elapsed source deadline/, value);
    assert.throws(() => validateBusinessGuidePayload({ ...input, opportunity: { state: "documented", value, evidence: [catalog.spans.at(-1)!.id] } }, { catalog }), /Elapsed source deadline/, value);
  }
  for (const value of ["原公告当时表示正在申报", "企业可向部门提出申请", "是否现行有效仍待核实"]) {
    assert.doesNotThrow(() => validateBusinessGuidePayload({ ...input, summary: [{ value, evidence: [catalog.spans.at(-1)!.id] }] }, { catalog }), value);
  }
  assert.throws(() => validateBusinessGuidePayload({ ...input, summary: [{ value: "原公告当时表示正在申报，但目前正在受理", evidence: [catalog.spans.at(-1)!.id] }] }, { catalog }), /Elapsed source deadline/);
});
