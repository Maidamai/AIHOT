import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setVisibility } from "@aihot/backend/admin/content";
import { publicationQueue, enqueuePublication, type PublicationJob } from "../backend/publication-queue.ts";
import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { flowQueue } from "../backend/flow.ts";
import { getBoss, stopBoss, enqueueOn } from "@aihot/backend/jobs/queue";
import { listTopicSummaries, loadTopicPage } from "@aihot/backend/publication/topics";
import { installModules } from "@aihot/backend/modules";
import { fisheryPublicationCondition, allowFisheryUndatedArchive, fisheryPublicationItemDetails, fisheryReferenceMetadata, syncFisheryPublications } from "../backend/publication-bridge.ts";
import { loadPool } from "@aihot/backend/publication/pool";
import { loadItemDetail, exportMarkdown } from "@aihot/backend/publication/detail";
import { loadItemShare } from "@aihot/backend/publication/og";
import { itemAvailability } from "@aihot/backend/publication/availability";
import { itemFeed } from "@aihot/backend/publication/feeds";
import { registerFeeds } from "../../../apps/api/src/routes/feeds.ts";
import { registerV1 } from "../../../apps/api/src/routes/v1.ts";
import { registerSite } from "../../../apps/api/src/routes/site.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { sql, closeDb, type Tx } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { createDocument, observe, registerSource, review, withdraw } from "../backend/store.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { buildEvidenceCatalog } from "../backend/evidence.ts";
import { observationFixture } from "./fixtures.ts";
import { registerBusinessGuideRoutes } from "../backend/business-routes.ts";
import { businessGuideContext, businessGuideAdminDetail, businessGuideReaderPage, businessGuideReaderItem, createBusinessGuide,
  updateBusinessGuide, decideBusinessGuide, businessGuideHistory, validateBusinessGuidePayload } from "../backend/business-guides.ts";
import type { BusinessGuideAdminRecord, BusinessGuideContext, BusinessGuidePayload } from "../business-contracts.ts";

import { createGuideAIReview, guideAIClaims, guideAIResultSchema, guideAIResultToWire, processGuideAIReview, type GuideAIInvoke, type GuideAIResult } from "../backend/business-ai-review.ts";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Offline guide gate tests forbid external/model requests"); };
after(() => { globalThis.fetch = originalFetch; });
const app = Fastify(); registerBusinessGuideRoutes(app);
after(async () => { await app.close(); await stopBoss(); await closeDb(); });
let sequence = 0;
const body = "本合成测试通知为正式文件，2026年10月21日发布。\n本合成测试仅适用远洋渔业企业，申请材料包括申请表。\n2026年11月1日截止。\n办理入口：https://example.org/service。\n本合成测试修改2020年第2号规定，并不废止整份规定。";
const unknown = () => ({ state: "unknown" as const, value: null, evidence: [] as [] });
async function fixture(options: { manual?: boolean; pdf?: boolean; undated?: boolean } = {}) {
  const sourceBody = options.pdf ? `--- Page 1 ---\n${body}\n--- Page 2 ---\n合成附件第二页，限定条件保留。` : body;
  const sourceId = `business-guide-${++sequence}`;
  await sql`INSERT INTO sources(id,name,kind,enabled,next_fetch_at) VALUES(${sourceId},'Synthetic official source','external',false,'2100-01-01')`;
  await registerSource(sourceId, { expectedRevision: 0 }, "synthetic-editor");
  const doc = await createDocument({ sourceId, issuer: "Synthetic source attribution", canonicalUrl: `https://example.org/${sourceId}` }, "synthetic-editor");
  const archiveId = `${sourceId}_${sha256(sourceId).slice(0, 16)}`, directory = options.manual ? path.join(config.dataDir, "fishery-manual-archives", sourceId) : path.join(config.dataDir, "fishery-batches", sourceId, "body"), filename = path.join(directory, options.manual ? "body.txt" : `${archiveId}.txt`);
  await mkdir(directory, { recursive: true }); await writeFile(filename, sourceBody);
  const observation = { ...observationFixture, dates: { ...observationFixture.dates, published: options.undated ? { precision: "unknown", value: null } : observationFixture.dates.published }, originalTitle: "合成测试正式通知", title: "合成测试正式通知", rawSha256: sha256(sourceBody), sourceCapture: {
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

test("isolated source rejects guide context and new AI review without changing evidence",async()=>{
  const f=await fixture(),row=await draft(f.id);
  const [before]=await sql`SELECT count(*)::int AS n FROM receipts`;
  await sql`UPDATE sources SET participation_mode='isolated' WHERE id=${f.sourceId}`;
  try {
    await assert.rejects(businessGuideContext(f.id),/Source is isolated/);
    await assert.rejects(createGuideAIReview(row.id,{identity:"isolated-guide-ai",expectedRevision:row.revision,payloadHash:row.payloadHash,snapshotHash:row.snapshotHash},"tester"),/Source is isolated/);
    const [after]=await sql`SELECT count(*)::int AS n FROM receipts`;assert.equal(after!.n,before!.n);
    const [evidence]=await sql`SELECT count(*)::int AS n FROM fishery_observations WHERE document_id=${f.id}`;assert.equal(evidence!.n,1);
  } finally {await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${f.sourceId}`;}
});
const decision = (row: BusinessGuideAdminRecord, value: "approved" | "rejected" | "withdrawn" = "approved") => ({ expectedRevision: row.revision, snapshotHash: row.snapshotHash, payloadHash: row.payloadHash, decision: value, aiReviewHash: row.aiReview.reviewHash ?? undefined, reason: "Synthetic human decision" });

function aiAnswer(p: BusinessGuidePayload): GuideAIResult {
  return { coverage: "complete_input", findings: guideAIClaims(p).map(c => ({ claimId: c.id, verdict: "supported", evidence: c.evidenceIds, reason: "Synthetic support" })), omissions: guideAIResultSchema.shape.omissions.element.shape.field.options.map(field => ({ field, verdict: "none", evidence: [], reason: "Synthetic no omission" })) } as GuideAIResult;
}
async function aiPass(row: BusinessGuideAdminRecord, mutate?: (result: GuideAIResult) => void) {
  const task = await createGuideAIReview(row.id, { identity: `offline_${row.revision}`, expectedRevision: row.revision, payloadHash: row.payloadHash, snapshotHash: row.snapshotHash }, "synthetic-ai-requester");
  const data = aiAnswer(row.payload); mutate?.(data);
  await processGuideAIReview(task.id, (async options => {
    const input = JSON.parse(String(options.user));
    const wire = guideAIResultToWire(data, input.source.evidenceCatalog.spans.map((span: [number, string]) => span[1]), input.claims);
    const response = { model: "offline-fake", choices: [{ message: { role: "assistant", content: JSON.stringify(wire) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100 } };
    assert.equal(options.purpose, task.request_intent.purpose); assert.equal(options.subject, task.request_intent.subject);
    const [r] = await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${task.id},'deepseek','offline-fake',${options.purpose},${options.subject},'received',${sql.json(response)}) RETURNING id`;
    return { data: options.schema.parse(wire), receiptId: Number(r!.id), model: "offline-fake", usage: null, reused: false };
  }) as GuideAIInvoke);
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
    assert.equal(legacy.humanDecision!.executorKind, undefined); assert.equal(legacy.status, "approved"); assert.equal(legacy.humanDecision!.actor, human.actor); assert.equal(legacy.readable, false); assert.equal(legacy.aiReview.status, "not_requested");
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
  assert.equal(item.verification.executorKind, "unspecified");
  assert.doesNotMatch(JSON.stringify(item), /final-reviewer|legacy-human-author/);
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


test("new final decisions explicitly distinguish declared executor kinds without deriving them from actors", async () => {
  for (const executorKind of ["human", "authorized_agent", "unspecified"] as const) {
    const f = await fixture(), row = await aiPass(await draft(f.id));
    const actor = "human_editorial-role-is-not-identity";
    const approved = await decideBusinessGuide(row.id, { ...decision(row), executorKind }, actor);
    assert.equal(approved.readable, true);
    assert.equal(approved.humanDecision!.executorKind, executorKind);
    assert.equal(approved.humanDecision!.actor, actor);
    assert.equal(approved.humanDecision!.aiReviewHash, row.aiReview.reviewHash);
    const item = await businessGuideReaderItem(row.id);
    assert.equal(item.verification.executorKind, executorKind);
    assert.equal(item.verification.origin, "human_editorial");
    assert.doesNotMatch(JSON.stringify(item), /human_editorial-role-is-not-identity/);
    await assert.rejects(decideBusinessGuide(row.id, { ...decision(approved), executorKind: "admin" }, actor));
  }
});


test("reviewed guides use original publication pool/detail and immediately disappear when canonical review or body changes", async () => {
  const f = await fixture(), created = await draft(f.id);
  await finalApproval(created, "synthetic-reviewer");
  installModules([{ name: "fishery", publication: { referenceMetadata: fisheryReferenceMetadata, readCondition: fisheryPublicationCondition, itemDetails: fisheryPublicationItemDetails, allowUndatedArchive: allowFisheryUndatedArchive } }]);
  try {
    const before = (await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
    const sync = await syncFisheryPublications("synthetic-bridge");
    const linked = sync.rows.find(row => row.itemId === created.id)!;
    assert.ok(linked);
    const id = linked.articleId;
    const [publication] = await sql`SELECT p.*,a.publication_time,a.backfill,a.grouping_status FROM publications p JOIN articles a ON a.id=p.article_id WHERE p.article_id=${id}`;
    assert.equal(publication!.selected, false); assert.equal(publication!.score, null);
    assert.deepEqual(publication!.tags, ["补贴融资", "资料"]);
    assert.ok((await loadTopicPage("funding", 1))!.topic.poolTotal > 0);
    assert.ok((await loadPool({channel:"all",category:"reference",tag:"补贴融资",q:"合成通知"})).items.some(item => item.id === id));
    assert.equal(publication!.published_at.toISOString(), "2026-04-16T16:00:00.000Z");
    assert.equal(publication!.publication_time, "2026-04-17"); assert.equal(publication!.backfill, true);
    const metadata = (await fisheryReferenceMetadata([id], new Date()))[id]!;
    assert.match(metadata.lifecycle!.notice, /来源元数据发布日期：2026-04-17/);
    assert.deepEqual((await businessGuideAdminDetail(created.id)).payload, created.payload, "Metadata projection does not rewrite approved body claims");
    assert.equal(publication!.grouping_status, "pending"); assert.equal(publication!.body_mode, "summary"); assert.equal(publication!.syndicate, false);
    assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${id}`).length, 0);
    // Controlled barrier: compute accepted IDs, mutate only canonical module state, then execute
    // that already-built predicate. Core article revision remains unchanged in every case.
    const barrier = async (mutate: (tx: Tx) => Promise<unknown>) => {
      const accepted = (await fisheryPublicationCondition(new Date())).condition;
      const rollback = new Error("Rollback controlled qualification race");
      await assert.rejects(sql.begin(async tx => {
        await mutate(tx);
        const rows = await tx`SELECT p.article_id FROM publications p WHERE p.article_id=${id} AND ${accepted}`;
        assert.equal(rows.length, 0, "Final SQL rejects qualification revoked after accepted-ID calculation");
        throw rollback;
      }), error => error === rollback);
    };
    await barrier(tx => tx`UPDATE publications SET tags=ARRAY['Unreviewed navigation tag'] WHERE article_id=${id}`);
    await barrier(tx => tx`UPDATE fishery_documents SET withdrawn_reason='Controlled race withdrawal' WHERE id=${f.id}`);
    await barrier(tx => tx`INSERT INTO fishery_reviews(document_id,revision,source_revision,decision,applicability_reviewed,note,actor)
      VALUES (${f.id},1,1,'rejected',false,'Controlled newer material decision','synthetic-barrier')`);
    await barrier(tx => tx`UPDATE fishery_business_guides SET human_decision=NULL WHERE id=${created.id}`);
    await barrier(tx => tx`UPDATE fishery_sources SET revision=revision+1 WHERE source_id=${f.sourceId}`);
    await barrier(tx => tx`UPDATE fishery_observations SET payload=jsonb_set(payload,'{title}','"Changed after qualification"'::jsonb) WHERE document_id=${f.id}`);
    const first = await loadPool({channel:"all",category:null,tag:null});
    assert.ok(first.items.some(item => item.id === id));
    const detail = await loadItemDetail(id);
    assert.equal(detail.kind, "found");
    if (detail.kind === "found") assert.ok("moduleDetails" in detail.item, "Original item endpoint carries current structured guide");
    assert.ok(await loadItemShare(id));
    assert.equal((await itemAvailability([id]))[id]!.status, "public");
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, before);
    const again = await syncFisheryPublications("synthetic-bridge");
    assert.equal(again.rows.find(row => row.itemId === created.id)!.articleId, id);
    // No fixed clock: a cached pool count or search result must not retain a withdrawn reference.
    await writeFile(f.filename, "SOURCE BODY CHANGED");
    const hidden = await loadPool({channel:"all",category:null,tag:null});
    assert.ok(!hidden.items.some(item => item.id === id)); assert.ok(hidden.total < first.total);
    assert.equal((await loadItemDetail(id)).kind, "not_found"); assert.equal(await loadItemShare(id), null);
    assert.equal((await itemAvailability([id]))[id]!.status, "unavailable");
    assert.ok(!(await itemFeed("all", null)).includes(id));
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, before);
  } finally { installModules([]); }
});


test("reviewed business topics reuse the original tag-filtered pool and disappear from topic collection after withdrawal", async () => {
  const f = await fixture(), context = await businessGuideContext(f.id), candidate = payload(context);
  candidate.topicId = "crew"; candidate.kind = "business_guide";
  const created = await createBusinessGuide({ documentId: f.id, snapshotHash: context.snapshotHash, payload: candidate, reason: "Synthetic crew navigation fixture" }, "synthetic-editor");
  await finalApproval(created, "synthetic-reviewer");
  installModules([{ name: "fishery", publication: { referenceMetadata: fisheryReferenceMetadata, readCondition: fisheryPublicationCondition, allowUndatedArchive: allowFisheryUndatedArchive } }]);
  try {
    const id = (await syncFisheryPublications("synthetic-topic-bridge")).rows.find(row => row.itemId === created.id)!.articleId;
    const page = (await loadTopicPage("crew", 1))!;
    assert.equal(page.topic.poolTotal, 1);
    assert.equal((await listTopicSummaries()).topics.find(t => t.slug === "crew")!.poolTotal, 1);
    assert.equal(page.topic.total, 0, "Reference collection does not invent a selected report");
    const pool = await loadPool({channel:"all",category:"reference",tag:"船员/外籍用工",q:"合成通知"});
    assert.deepEqual(pool.items.map(item => item.id), [id]);
    assert.equal(pool.items[0]!.reference!.kind, "business_guide");
    assert.equal(pool.items[0]!.reference!.deadlineDate, "2026-11-01");
    assert.equal(pool.items[0]!.reference!.expiryDate, null);
    const beforeMidnight = await fisheryReferenceMetadata([id], new Date("2026-11-01T15:59:59Z"));
    const afterMidnight = await fisheryReferenceMetadata([id], new Date("2026-11-01T16:00:00Z"));
    assert.equal(beforeMidnight[id]!.deadlineDate, "2026-11-01");
    assert.equal(afterMidnight[id]!.deadlineDate, "2026-11-01");
    assert.equal(afterMidnight[id]!.checkedAt, "2026-11-01T16:00:00.000Z");
    assert.equal(beforeMidnight[id]!.lifecycle!.deadlinePassed, false);
    assert.equal(afterMidnight[id]!.lifecycle!.deadlinePassed, true);
    assert.equal(afterMidnight[id]!.lifecycle!.policyExpired, null);
    assert.equal(afterMidnight[id]!.lifecycle!.applicationStatus, "unknown");
    const [row] = await sql`SELECT tags,selected,score FROM publications WHERE article_id=${id}`;
    assert.deepEqual(row!.tags, ["船员/外籍用工", "资料"]); assert.equal(row!.selected, false); assert.equal(row!.score, null);
    await withdraw(f.id, { expectedRevision: 1, reason: "Synthetic source withdrawal" }, "synthetic-reviewer");
    assert.equal((await loadTopicPage("crew", 1))!.topic.poolTotal, 0);
    assert.equal((await listTopicSummaries()).topics.find(t => t.slug === "crew")!.poolTotal, 0);
    assert.deepEqual(await fisheryReferenceMetadata([id], new Date()), {});
    assert.equal((await loadPool({channel:"all",category:"reference",tag:"船员/外籍用工",q:"合成通知"})).total, 0);
  } finally { installModules([]); }
});

test("original RSS and v1 routes project guide dates at Beijing midnight without rewriting approved history", async t => {
  const f = await fixture({ undated: true }), context = await businessGuideContext(f.id), input = payload(context);
  input.dates.published = { value: { precision: "day", value: "2026-10-21" }, evidence: [context.catalog.spans[0]!.id] };
  input.dates.expiresAt = structuredClone(input.dates.deadline);
  input.documentStatus = { state: "unknown", value: null, evidence: [] };
  const created = await createBusinessGuide({ documentId: f.id, snapshotHash: context.snapshotHash, payload: input, reason: "Synthetic export lifecycle" }, "editor");
  const approved = await finalApproval(created, "reviewer");
  installModules([{ name: "fishery", publication: { referenceMetadata: fisheryReferenceMetadata, readCondition: fisheryPublicationCondition, itemDetails: fisheryPublicationItemDetails, allowUndatedArchive: allowFisheryUndatedArchive } }]);
  const routes = Fastify(); registerFeeds(routes); registerV1(routes); registerSite(routes);
  try {
    const id = (await syncFisheryPublications("synthetic-lifecycle")).rows.find(row => row.itemId === created.id)!.articleId;
    // Put this historical article inside the normal rolling window without substituting its original
    // publication date. RSS's published ordering intentionally leaves old dated archives out.
    await sql`UPDATE publications SET discovered_at='2026-10-21T02:00:00Z',timeline_at='2026-10-21T02:00:00Z' WHERE article_id=${id}`;
    const stored = await sql`SELECT summary,published_at FROM publications WHERE article_id=${id}`;
    const history = await sql`SELECT payload,payload_hash,human_decision FROM fishery_business_guides WHERE id=${created.id}`;
    const receipts = (await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
    const requestAt = async (date: string, feedEtag?: string) => {
      t.mock.timers.enable({ apis: ["Date"], now: new Date(date) });
      try {
        const api = await routes.inject("/api/v1/items?mode=all&window=7d&by=timeline");
        const rss = await routes.inject({ url: "/feed/all.xml", ...(feedEtag ? { headers: { "if-none-match": feedEtag } } : {}) });
        const markdown = await routes.inject(`/items/${id}/markdown`);
        assert.equal(api.statusCode, 200);
        return { api: api.json(), rss: rss.body, feedStatus: rss.statusCode, feedEtag: String(rss.headers.etag), markdown };
      } finally { t.mock.timers.reset(); }
    };
    // A dated historical guide stays out of RSS's seven-day source-publication window.
    const archived = await requestAt("2026-11-01T15:59:59Z");
    assert.ok(!archived.rss.includes(id));
    // Reuse an independently approved undated guide to exercise the actual RSS/API route, rather
    // than changing a stored approved publication date or bypassing its binding predicate.
    const undated = await draft(f.id); await finalApproval(undated, "reviewer");
    const undatedId = (await syncFisheryPublications("synthetic-undated-lifecycle")).rows.find(row => row.itemId === undated.id)!.articleId;
    await sql`UPDATE publications SET discovered_at='2026-11-01T12:00:00Z',timeline_at='2026-11-01T12:00:00Z' WHERE article_id=${undatedId}`;
    const before = await requestAt("2026-11-01T15:59:59Z");
    assert.equal(before.feedStatus, 200);
    assert.equal((await requestAt("2026-11-01T15:59:59.500Z", before.feedEtag)).feedStatus, 304);
    const after = await requestAt("2026-11-01T16:00:00Z", before.feedEtag);
    assert.equal(after.feedStatus, 200, "A pre-midnight ETag cannot hide the next Beijing day's deadline warning");
    assert.equal(before.markdown.statusCode, 200); assert.equal(after.markdown.statusCode, 200);
    const first = before.api.items.find((item: { id: string }) => item.id === undatedId), last = after.api.items.find((item: { id: string }) => item.id === undatedId);
    assert.ok(first); assert.ok(last);
    assert.equal(first.reference.lifecycle.deadlinePassed, false); assert.equal(last.reference.lifecycle.deadlinePassed, true);
    assert.equal(last.reference.lifecycle.policyExpired, null); assert.equal(last.reference.lifecycle.legalValidity, "unknown");
    assert.deepEqual(last.reference.lifecycle.dates, undated.payload.dates);
    assert.equal(last.reference.lifecycle.verifiedAt, (await businessGuideAdminDetail(undated.id)).verifiedAt);
    assert.equal(last.reference.lifecycle.qualification.status, "qualified");
    assert.ok(Object.keys(last.reference.lifecycle.evidence).length > 0);
    assert.equal(last.publishedAt, null); assert.equal(last.approvedSummary, undated.payload.summary.map(s => s.value).join("\n"));
    assert.match(last.summary, /派生状态提示.*已截止（按原文日期）/s);
    assert.match(last.summary, /办理截止不等于政策废止/); assert.match(last.summary, /可申请状态未知/);
    assert.doesNotMatch(before.rss, /已截止（按原文日期）/);
    assert.match(after.rss, /派生状态提示.*已截止（按原文日期）/s); assert.match(after.rss, /原文发布日期：未知/);
    assert.match(after.rss, /AI对照核查及最终审核通过/);
    assert.doesNotMatch(before.markdown!.body, /已截止（按原文日期）/);
    assert.match(after.markdown!.body, /## 派生状态提示\n\n.*已过文载失效日期.*已截止（按原文日期）/s);
    assert.match(after.markdown!.body, /原文发布日期：2026-10-21（day）/);
    assert.match(after.markdown!.body, /AI对照核查及最终审核通过/);
    const reference = (await fisheryReferenceMetadata([id], new Date("2026-11-01T16:00:00Z")))[id]!;
    assert.equal(reference.lifecycle!.policyExpired, true); assert.equal(reference.lifecycle!.documentStatus.value, null);
    assert.equal(reference.lifecycle!.dates.published.value.value, "2026-10-21");
    assert.equal(reference.lifecycle!.dates.effectiveFrom.value.value, null);
    assert.deepEqual(await sql`SELECT summary,published_at FROM publications WHERE article_id=${id}`, stored);
    assert.deepEqual(await sql`SELECT payload,payload_hash,human_decision FROM fishery_business_guides WHERE id=${created.id}`, history);
    assert.equal(approved.payloadHash, history[0]!.payload_hash);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, receipts + 1, "Only the second explicit fake AI review creates a receipt");
    await sql`UPDATE fishery_sources SET revision=revision+1 WHERE source_id=${f.sourceId}`;
    const stale = await requestAt("2026-11-01T16:00:00Z");
    assert.ok(!stale.rss.includes(undatedId)); assert.ok(!stale.api.items.some((item: { id: string }) => item.id === undatedId));
    assert.equal(stale.markdown.statusCode, 404);
    assert.equal((await loadItemDetail(undatedId)).kind, "not_found");
    assert.equal(await exportMarkdown(id), null);
  } finally { t.mock.timers.reset(); await routes.close(); installModules([]); }
});


test("normal final approval durably schedules non-paid publication with bounded recovery and version-safe replay", async () => {
  const f = await fixture(), created = await draft(f.id);
  const boss = await getBoss({ schedule: false, supervise: false });
  const old = await sql`SELECT id FROM pgboss.job WHERE name=${publicationQueue.name} AND state IN ('created','retry')`;
  if (old.length) await boss.cancel(publicationQueue.name, old.map(row => row.id));
  const approved = await finalApproval(created, "synthetic-auto-publisher");
  const [job] = await sql`SELECT id,data FROM pgboss.job WHERE name=${publicationQueue.name} AND data->>'itemId'=${created.id} ORDER BY created_on DESC LIMIT 1`;
  assert.ok(job, "Final decision and durable continuation commit together");
  assert.equal((await sql`SELECT 1 FROM fishery_publication_bindings WHERE item_id=${created.id}`).length, 0);
  const receipts = (await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  let attempts = 0;
  installModules([{ name: "fishery", publication: { referenceMetadata: fisheryReferenceMetadata, readCondition: fisheryPublicationCondition, itemDetails: fisheryPublicationItemDetails, allowUndatedArchive: allowFisheryUndatedArchive } }]);
  const release = await registerManualFlowConsumer(boss, async () => {}, { publicationMaintenanceMs: 100, publicationRun: async jobs => {
    if (++attempts === 1) throw new Error("Synthetic transient non-paid publication failure");
    return publicationQueue.run(jobs);
  } });
  const wait = async (id: string) => {
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      const [row] = await sql`SELECT state,retry_count FROM pgboss.job WHERE name=${publicationQueue.name} AND id=${id}`;
      if (row?.state === "completed") return row;
      if (row?.state === "failed") assert.fail("Non-paid publication exhausted recovery");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("Timed out waiting for durable publication");
  };
  try {
    const protectedPaid = await sql.begin(async tx => {
      const id = await enqueueOn(flowQueue,{id:"synthetic-active-paid-protection"},{},tx);
      await tx`UPDATE pgboss.job SET state='active',started_on=now()-interval '1 hour' WHERE name=${flowQueue.name} AND id=${id}`;
      return id!;
    });
    const crashedPublication = await sql.begin(async tx => {
      const id = await boss.send(publicationQueue.name,job!.data as PublicationJob,{db:{executeSql:async(text:string,values?:unknown[])=>({rows:await tx.unsafe(text,(values??[]) as never[])})}});
      await tx`UPDATE pgboss.job SET state='active',started_on=now()-interval '1 hour' WHERE name=${publicationQueue.name} AND id=${id}`;
      await tx`UPDATE pgboss.queue SET monitor_claim_on=NULL,monitor_on=NULL WHERE name=${publicationQueue.name}`;
      return id!;
    });
    const completed = await wait(job!.id);
    await wait(crashedPublication);
    const [paid] = await sql`SELECT state FROM pgboss.job WHERE name=${flowQueue.name} AND id=${protectedPaid}`;
    assert.equal(paid!.state,"active","Scoped publication maintenance never recovers an expired paid flow");
    await boss.cancel(flowQueue.name,protectedPaid);
    assert.equal(completed.retry_count, 1); assert.ok(attempts >= 2);
    const [binding] = await sql`SELECT * FROM fishery_publication_bindings WHERE item_id=${created.id}`;
    const articleId = String(binding!.article_id);
    assert.equal((await loadItemDetail(articleId)).kind, "found");
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, receipts);
    const duplicate = await boss.send(publicationQueue.name, job!.data as PublicationJob);
    await wait(duplicate!);
    assert.equal((await sql`SELECT 1 FROM articles WHERE id=${articleId}`).length, 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, receipts);
    const [controls] = await sql`SELECT version FROM editorial_overrides WHERE article_id=${articleId}`;
    await setVisibility(articleId,{visibility:"withdrawn",version:controls!.version,reason:"Synthetic core withdrawal"},"synthetic-editor");
    const retryWithdrawn=await boss.send(publicationQueue.name,job!.data as PublicationJob);await wait(retryWithdrawn!);
    assert.equal((await loadItemDetail(articleId)).kind,"not_found","Non-paid replay preserves the original core withdrawal");
    const [withdrawn] = await sql`SELECT version,visibility FROM editorial_overrides WHERE article_id=${articleId}`;
    assert.equal(withdrawn!.visibility,"withdrawn");
    await setVisibility(articleId,{visibility:"public",version:withdrawn!.version,reason:"Synthetic explicit core restoration"},"synthetic-editor");
    assert.equal((await loadItemDetail(articleId)).kind,"found");
    const activeOldDecision = await sql.begin(async tx => {
      const id = await enqueuePublication(job!.data as PublicationJob,tx);
      await tx`UPDATE pgboss.job SET state='active',started_on=now() WHERE name=${publicationQueue.name} AND id=${id}`;
      return id!;
    });
    const revisedPayload = structuredClone(approved.payload); revisedPayload.title.value = "合成通知修订参考";
    const revised = await updateBusinessGuide(created.id, { expectedRevision: approved.revision, snapshotHash: approved.snapshotHash, payload: revisedPayload, reason: "Synthetic reviewed revision" }, "synthetic-editor");
    assert.equal((await loadItemDetail(articleId)).kind, "not_found");
    await finalApproval(revised, "synthetic-auto-publisher");
    const [next] = await sql`SELECT id,data FROM pgboss.job WHERE name=${publicationQueue.name} AND data->>'itemId'=${created.id} AND id<>${job!.id} AND data->>'decisionHash'<>${job!.data.decisionHash} ORDER BY created_on DESC LIMIT 1`;
    assert.ok(next); assert.notEqual(next!.id,activeOldDecision,"A new decision is not swallowed by an active older singleton"); await wait(next!.id);
    await boss.cancel(publicationQueue.name,activeOldDecision);
    const latest = await loadItemDetail(articleId);
    assert.equal(latest.kind, "found"); if (latest.kind === "found") assert.equal(latest.item.title, revisedPayload.title.value);
    const late = await boss.send(publicationQueue.name, job!.data as PublicationJob); await wait(late!);
    const [current] = await sql`SELECT article_id,title FROM fishery_publication_bindings WHERE item_id=${created.id}`;
    assert.equal(current!.article_id, articleId); assert.equal(current!.title, revisedPayload.title.value);
    await withdraw(f.id, { expectedRevision: 1, reason: "Synthetic terminal withdrawal" }, "synthetic-reviewer");
    const stale = await boss.send(publicationQueue.name, next!.data as PublicationJob); await wait(stale!);
    assert.equal((await loadItemDetail(articleId)).kind, "not_found");
  } finally { await release(); installModules([]); }
});


test("real consumer entry installs only configured modules and preserves unknown-date publication on replay", async () => {
  const boss = await getBoss({ schedule: false, supervise: false });
  const old = await sql`SELECT id FROM pgboss.job WHERE name=${publicationQueue.name} AND state IN ('created','retry')`;
  if (old.length) await boss.cancel(publicationQueue.name, old.map(row => row.id));
  const f = await fixture({ undated: true }), approved = await finalApproval(await draft(f.id), "synthetic-entry-reviewer");
  const unapproved = await fixture(); await draft(unapproved.id);
  installModules([{ name: "fishery", publication: { referenceMetadata: fisheryReferenceMetadata, readCondition: fisheryPublicationCondition, itemDetails: fisheryPublicationItemDetails, allowUndatedArchive: allowFisheryUndatedArchive } }]);
  const bootstrap = await syncFisheryPublications("synthetic-entry-bootstrap");
  const articleId = bootstrap.rows.find(row => row.itemId === approved.id)!.articleId;
  const beforePool = await loadPool({channel:"all",category:null,tag:null});
  const receipts = (await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  const [job] = await sql`SELECT id,data FROM pgboss.job WHERE name=${publicationQueue.name} AND data->>'itemId'=${approved.id} ORDER BY created_on DESC LIMIT 1`;
  const preload = (disabled: boolean) => `data:text/javascript,${encodeURIComponent(`
    globalThis.fetch=async()=>{throw new Error("Consumer entry test forbids network/model calls");};
    ${disabled ? `const {registerHooks}=await import("node:module");registerHooks({resolve(spec,context,next){if(spec==="@aihot/site/modules/server")return {url:"data:text/javascript,export const SERVER_MODULES=[]",shortCircuit:true};return next(spec,context);}});` : ""}
  `)}`;
  const entry = fileURLToPath(new URL("../scripts/consume-flows.ts", import.meta.url));
  const child = spawn(process.execPath,["--import",preload(false),entry],{env:process.env,stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",data=>{output+=data;});child.stderr.on("data",data=>{output+=data;});
  const exit = once(child,"exit");
  const waitFor = async (check:()=>Promise<boolean>) => {
    const end=Date.now()+20000;
    while(Date.now()<end) {if(await check()) return; if(child.exitCode!==null) assert.fail(`Consumer stopped before publication: ${output}`);await new Promise(resolve=>setTimeout(resolve,50));}
    assert.fail("Consumer entry did not finish the non-paid replay");
  };
  try {
    await waitFor(async()=>output.includes("fishery manual processor started"));
    await waitFor(async()=>(await sql`SELECT state FROM pgboss.job WHERE name=${publicationQueue.name} AND id=${job!.id}`)[0]?.state==="completed");
    const [published]=await sql`SELECT p.eligible,p.published_at,a.publication_time,a.backfill FROM publications p JOIN articles a ON a.id=p.article_id WHERE p.article_id=${articleId}`;
    assert.equal(published!.eligible,true);assert.equal(published!.published_at,null);assert.equal(published!.publication_time,null);assert.equal(published!.backfill,true);
    const afterPool=await loadPool({channel:"all",category:null,tag:null});
    assert.equal(afterPool.total,beforePool.total);assert.ok(afterPool.items.some(item=>item.id===articleId));
    assert.equal((await sql`SELECT 1 FROM fishery_publication_bindings WHERE document_id=${unapproved.id}`).length,0);
    await withdraw(f.id,{expectedRevision:1,reason:"Synthetic real-entry withdrawal"},"synthetic-reviewer");
    const stale=await boss.send(publicationQueue.name,job!.data as PublicationJob);
    await waitFor(async()=>(await sql`SELECT state FROM pgboss.job WHERE name=${publicationQueue.name} AND id=${stale}`)[0]?.state==="completed");
    assert.ok(!(await loadPool({channel:"all",category:null,tag:null})).items.some(item=>item.id===articleId));
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receipts);
  } finally {child.kill("SIGTERM");await exit;installModules([]);}
  const jobsBefore=(await sql`SELECT count(*)::int AS n FROM pgboss.job`)[0]!.n;
  const disabled=spawn(process.execPath,["--import",preload(true),entry],{env:process.env,stdio:["ignore","pipe","pipe"]});
  let disabledOutput="";disabled.stdout.on("data",data=>{disabledOutput+=data;});disabled.stderr.on("data",data=>{disabledOutput+=data;});
  const [code]=await once(disabled,"exit");
  assert.equal(code,1);assert.match(disabledOutput,/Fishery module is not enabled/);assert.doesNotMatch(disabledOutput,/manual processor started/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.job`)[0]!.n,jobsBefore);
});
