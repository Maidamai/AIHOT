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
const decision = (row: BusinessGuideAdminRecord, value: "approved" | "rejected" | "withdrawn" = "approved") => ({ expectedRevision: row.revision, snapshotHash: row.snapshotHash, payloadHash: row.payloadHash, decision: value, reason: "Synthetic human decision" });

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
  const approved = await decideBusinessGuide(row.id, decision(row), "synthetic-reviewer");
  assert.equal(approved.status, "approved"); assert.equal(approved.revision, 2); assert.equal(approved.readable, true);
  const page = await businessGuideReaderPage({ topicId: "funding" });
  assert.ok(page.rows.some(i => i.id === row.id)); assert.equal(page.topics.length, 10); assert.equal(page.topics.find(t => t.id === "crew")!.emptyMessage !== null, true);
  const item = await businessGuideReaderItem(row.id);
  assert.equal(item.verification.origin, "human_editorial"); assert.deepEqual(item.eligibility, { canApply: null, canFish: null });
  assert.equal(item.payload.relations[0]!.type, "amends"); assert.equal(item.payload.relations[0]!.url, null);
  assert.equal(item.payload.applicability.flagStates.state, "unknown"); assert.ok(item.verifiedAt); assert.notEqual(item.verifiedAt, item.source.publishedAt);
  assert.equal("humanDecision" in item, false); assert.equal("body" in item, false);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`, before, "human editorial flow never creates AI receipts");
  const profile = await sql`SELECT s.site_fulltext,f.profile FROM sources s JOIN fishery_sources f ON f.source_id=s.id WHERE s.id=${f.sourceId}`;
  assert.equal(profile[0]!.site_fulltext, false); assert.equal(profile[0]!.profile.rightsStatus, "unknown");
});

test("stale writes fail, edits require new approval, withdrawal is final and full audit history remains", async () => {
  const f = await fixture(), row = await draft(f.id), approved = await decideBusinessGuide(row.id, decision(row), "reviewer");
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
  const f = await fixture(), row = await draft(f.id); await decideBusinessGuide(row.id, decision(row), "reviewer");
  await review(f.id, { revision: 1, sourceRevision: 1, decision: "rejected", applicabilityReviewed: false, note: "Synthetic material rejection" }, "reviewer");
  await assert.rejects(businessGuideReaderItem(row.id), /No current/);
  await review(f.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic new material decision" }, "reviewer");
  assert.equal((await businessGuideAdminDetail(row.id)).readable, false);
  const after = await businessGuideReaderPage(); assert.ok(after.rows.every(i => i.id !== row.id));
  await assert.rejects(decideBusinessGuide(row.id, decision(await businessGuideAdminDetail(row.id)), "reviewer"), /save a new draft/);
});

test("source revision, observation, withdrawal and damaged actual archived body close reading", async () => {
  for (const change of ["source", "observation", "withdraw", "body"] as const) {
    const f = await fixture(), row = await draft(f.id); await decideBusinessGuide(row.id, decision(row), "reviewer");
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
    await decideBusinessGuide(row.id, decision(row), "reviewer");
    const item = await businessGuideReaderItem(row.id); assert.equal(item.documentId, f.id);
    if (options.pdf) assert.ok(Object.values(item.evidence).every(a => a.url === "https://example.org/synthetic.pdf"));
  }
});

test("missing capture or unavailable linked article cannot enter a current business projection", async () => {
  const f = await fixture(), row = await draft(f.id); await decideBusinessGuide(row.id, decision(row), "reviewer");
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
  for (const url of ["/api/admin/fishery/business-guides", "/api/admin/fishery/business-guides/missing", "/api/admin/fishery/business-guides/context/missing", "/api/admin/fishery/business-guides/missing/history", "/api/admin/fishery/business-reader", "/api/admin/fishery/business-reader/missing"])
    assert.equal((await app.inject(url)).statusCode, 401, url);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/fishery/business-guides", payload: {} })).statusCode, 401);
  config.devAdmin = { displayName: "ISOLATED BUSINESS ROUTE TEST" };
  try {
    for (const [method, url] of [["POST", "/api/admin/fishery/business-guides"], ["PUT", "/api/admin/fishery/business-guides/missing"], ["POST", "/api/admin/fishery/business-guides/missing/decision"]] as const)
      assert.equal((await app.inject({ method, url, payload: {} })).statusCode, 403);
    const f = await fixture(), c = await businessGuideContext(f.id);
    const saved = await app.inject({ method: "POST", url: "/api/admin/fishery/business-guides", headers: { "x-csrf-token": "dev" }, payload: { documentId: f.id, snapshotHash: c.snapshotHash, payload: payload(c), reason: "Synthetic route create" } });
    assert.equal(saved.statusCode, 201, saved.body); assert.equal(saved.headers["cache-control"], "private, no-store");
    const row = saved.json();
    const approved = await app.inject({ method: "POST", url: `/api/admin/fishery/business-guides/${row.id}/decision`, headers: { "x-csrf-token": "dev" }, payload: decision(row) });
    assert.equal(approved.statusCode, 200, approved.body);
    const readable = await app.inject(`/api/admin/fishery/business-reader/${row.id}`);
    assert.equal(readable.statusCode, 200); assert.equal(readable.headers["cache-control"], "private, no-store");
  } finally { config.devAdmin = null; }
});
