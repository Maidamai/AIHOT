import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { marked } from "marked";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { setVisibility } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { getBoss, stopBoss, enqueueOn } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import fishery from "../server.ts";
import { exportMaterial, materialMarkdown } from "../backend/export.ts";
import { createDocument, documentHistory, hash, importCapturedMaterial, observe, registerSource, review, sourceHealth, withdraw } from "../backend/store.ts";
import { sourceFixture, observationFixture } from "./fixtures.ts";
import { materialDetail } from "../backend/workbench.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { workbench } from "../backend/workbench.ts";
import { collectColumns } from "../backend/column-batches.ts";
import { COLUMNS } from "../backend/official-columns.ts";

import { paidRequest } from "@aihot/backend/providers/receipts";
import { createFlow, flowDetail, runFlow, retryFlow, decideFlow, flowRequiredCalls, flowQueue, runQueuedFlows } from "../backend/flow.ts";

import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { authorizationKey } from "../backend/authorization.ts";
import { TRIAL } from "../backend/trial-transport.ts";

installModules([fishery]);
const app = await buildApp();
let count = 0;
const now = new Date("2026-10-20T00:00:00Z");
before(() => { config.devAdmin = null; });
after(async () => { await app.close(); await stopBoss(); await closeDb(); });
async function fixture(options: { unknownRights?: boolean; articleId?: string; sourceId?: string } = {}) {
  const sourceId = options.sourceId ?? `fishery-${++count}`;
  if (!options.sourceId) await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Fixture', 'external', false, '2100-01-01')`;
  await registerSource(sourceId, options.unknownRights ? { expectedRevision: 0 } : sourceFixture, "tester");
  const doc = await createDocument({ sourceId, articleId: options.articleId ?? null, issuer: "Fixture issuer", documentNumber: "CMM-fixture-01", canonicalUrl: `https://example.org/${sourceId}` }, "tester");
  await observe(doc.id, observationFixture, "tester");
  return { id: String(doc.id), sourceId };
}
const approve = (id: string, revision = 1, sourceRevision = 1) => review(id, { revision, sourceRevision, decision: "approved", applicabilityReviewed: false, note: "Manual fixture review" }, "reviewer");

test("archived batch imports through the guarded route and displays only its version-bound body",async()=>{
  const url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_1.htm",body="合成远洋渔业与公海履约原文，仅用于隔离测试，不是真实资讯。".repeat(4);
  await collectColumns({id:"synthetic-route-batch",dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request.endsWith("robots.txt")?404:200,headers:{get:()=>"text/html"},body:Buffer.from(request.endsWith("robots.txt")?"missing":request===COLUMNS.moa.url?`<ul class="sj_e_tonzhi_list"><li><a href="${url}">合成公海材料</a></li></ul>`:`<meta name="ArticleTitle" content="合成公海材料"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor"><p>${body}</p></div></div>`)})});
  config.devAdmin={displayName:"ISOLATED TEST IMPORT ONLY"};
  try {
    const response=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-route-batch/import",headers:{"x-csrf-token":"dev"},payload:{}});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.headers["cache-control"],"no-store");
    const id=response.json().rows[0].id,detail=await materialDetail(id);
    assert.equal(detail.state,"pending");assert.equal(detail.reviews.length,0);assert.equal(detail.text?.body,body);assert.equal(detail.text?.hashMatches,true);
    assert.equal(detail.source.profile.rightsStatus,"unknown");assert.equal(detail.source.enabled,false);
    const again=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-route-batch/import",headers:{"x-csrf-token":"dev"},payload:{}});
    assert.equal(again.statusCode,200,again.body);assert.equal(again.json().rows[0].unchanged,true);
    assert.equal((await documentHistory(id)).observations.length,1);
  } finally {config.devAdmin=null;}
});

test("captured imports are unreviewed, unchanged captures deduplicate and A→B→A invalidates review",async()=>{
  const column={id:"synthetic-import",name:"Synthetic column",issuer:"Synthetic official issuer"};
  const a={...observationFixture,sourceCapture:{adapter:"moa",sourceUrl:"https://example.org/import",capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:"a".repeat(64),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}};
  const first=await importCapturedMaterial(column,"https://example.org/import",a,"tester");
  assert.equal(first.revision,1);assert.equal((await materialDetail(first.id)).state,"pending");
  const sources=await sql`SELECT s.enabled,s.site_fulltext,f.profile FROM sources s JOIN fishery_sources f ON f.source_id=s.id WHERE s.id='fishery-column-synthetic-import'`;
  assert.equal(sources[0]!.enabled,false);assert.equal(sources[0]!.site_fulltext,false);assert.equal(sources[0]!.profile.rightsStatus,"unknown");
  await approve(first.id);
  const duplicate=await importCapturedMaterial(column,"https://example.org/import",{...a,sourceCapture:{...a.sourceCapture,capturedAt:"2026-10-21T00:00:00Z"}},"tester");
  assert.equal(duplicate.unchanged,true);assert.equal((await materialDetail(first.id)).state,"approved");
  const changed=await importCapturedMaterial(column,"https://example.org/import",{...a,sourceCapture:{...a.sourceCapture,bodySha256:"b".repeat(64)}},"tester");
  assert.equal(changed.revision,2);assert.equal((await materialDetail(first.id)).state,"stale");
  const back=await importCapturedMaterial(column,"https://example.org/import",a,"tester");
  assert.equal(back.revision,3);assert.equal(back.unchanged,false);
  assert.equal((await documentHistory(first.id)).reviews.length,1);
  for(let i=0;i<28;i++) await importCapturedMaterial(column,`https://example.org/page-${i}`,{...a,title:`Unique pagination fixture ${i}`},"tester");
  const page1=await workbench({q:"Unique pagination fixture",scope:"all",page:1}),page2=await workbench({q:"Unique pagination fixture",scope:"all",page:2});
  assert.equal(page1.total,28);assert.equal(page1.rows.length,25);assert.equal(page2.rows.length,3);
  assert.equal(new Set([...page1.rows,...page2.rows].map(r=>r.id)).size,28);
  config.devAdmin=null;
  assert.equal((await app.inject("/api/admin/fishery/batches")).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic/import",payload:{}})).statusCode,401);
  config.devAdmin={displayName:"Synthetic CSRF tester"};
  assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic/import",payload:{}})).statusCode,403);
  config.devAdmin=null;
});

test("column attribution never becomes a page publisher or policy issuer in main records and exports", async () => {
  // Offline counterexample: column owner, page source and joint policy issuers are distinct roles.
  const column = { id: "synthetic-attribution", name: "渔业渔政管理局栏目", issuer: "农业农村部渔业渔政管理局" };
  const url = "https://yyj.moa.gov.cn/gzdt/202609/t20260930_6488348.htm";
  const imported = await importCapturedMaterial(column, url, {
    ...observationFixture, originalTitle: "合成政策报道", title: "合成政策报道",
    summaryZh: "离线角色反例：网页来源为新闻办公室；正文提到农业农村部、财政部联合印发通知。",
  }, "tester");
  const sourceId = `fishery-column-${column.id}`;
  const history = await documentHistory(imported.id);
  assert.equal(history.document.issuer, column.issuer, "preserve legacy user data");
  assert.equal(history.document.sourceAttribution, column.issuer);
  assert.equal(history.document.legacyIssuerMeaning, "source_attribution_only");
  config.devAdmin = { displayName: "ISOLATED TEST ATTRIBUTION ONLY" };
  try {
    const response = await app.inject(`/api/admin/fishery/documents/${imported.id}/detail`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().sourceAttribution, column.issuer);
    assert.equal(response.json().legacyIssuerMeaning, "source_attribution_only");
    const list = await app.inject("/api/admin/fishery/workbench?scope=all&q=合成政策报道");
    assert.equal(list.json().rows.find((r: { id: string }) => r.id === imported.id).sourceAttribution, column.issuer);
  } finally { config.devAdmin = null; }
  await approve(imported.id);
  await assert.rejects(exportMaterial(imported.id, 1, "tester", now), /rights/);
  // Explicit isolated permission fixture is required; no real source rights are changed.
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  await approve(imported.id, 1, 2);
  const bundle = await exportMaterial(imported.id, 1, "tester", now);
  assert.equal(bundle.source.sourceAttribution, column.issuer);
  assert.equal(bundle.source.issuer, column.issuer);
  assert.equal(bundle.source.legacyIssuerMeaning, "source_attribution_only");
  assert.equal(bundle.source.pagePublisher, null, "column owner and mentioned source do not verify a page publisher");
  assert.equal(bundle.policy.issuers, null, "mentioning a notice does not verify its issuers in main-record metadata");
  const markdown = materialMarkdown(bundle);
  assert.match(markdown, /来源归属：农业农村部渔业渔政管理局/);
  assert.match(markdown, /网页发布机构：未知/);
  assert.match(markdown, /政策发文机关：未知/);
});

test("isolated test exports keep the test-review warning in JSON, Markdown and their content hash", async () => {
  const environment = config.environmentName;
  config.environmentName = "test";
  try {
    const { id } = await fixture();
    await approve(id);
    const bundle = await exportMaterial(id, 1, "ISOLATED TEST ONLY", now);
    assert.equal(bundle.editorial.confidence, "isolated_test_workflow_not_business_approval");
    assert.ok(materialMarkdown(bundle).includes("不代表人工业务批准或真实转载授权"));
    const { contentHash, ...payload } = bundle;
    assert.equal(contentHash, hash(payload));
  } finally { config.environmentName = environment; }
});

test("private workbench explains the same gates as export, separates explicit test clones and shows only matching archived text", async () => {
  config.devAdmin = null;
  assert.equal((await app.inject("/api/admin/fishery/workbench")).statusCode, 401);
  const { id, sourceId } = await fixture({ unknownRights: true });
  assert.equal((await app.inject(`/api/admin/fishery/documents/${id}/detail`)).statusCode, 401);
  const body = "Synthetic archived plain text <script>not executable</script>";
  const capture = { acquisitionMode: "live_capture", adapter: "jinjiang", sourceUrl: `https://example.org/${sourceId}`, capturedAt: "2026-10-20T00:00:00Z", httpStatus: 200,
    rawSha256: observationFixture.rawSha256, bodySha256: sha256(body), parser: "Synthetic UI parser/v1", parseStatus: "parsed", attachmentSha256: null, conflicts: [] };
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: capture }, "tester");
  await upsertMaterial({ sourceId, url: `https://example.org/${sourceId}`, title: "Synthetic archive", bodyText: body, bodyStatus: "ok", via: "unit-test", raw: { fisheryDocumentId: id, mode: "live_capture", htmlBase64: "do not expose raw JSON" } });
  config.devAdmin = { displayName: "Synthetic workbench reviewer" };
  const response = await app.inject(`/api/admin/fishery/documents/${id}/detail`);
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().text.hashMatches, true); assert.equal(response.json().text.body, body);
  assert.equal(response.body.includes("htmlBase64"), false); assert.equal(response.json().testOnly, false);
  assert.deepEqual(response.json().blockers.map((b: { code: string }) => b.code), ["rights", "review"]);
  await approve(id, 2);
  assert.deepEqual((await materialDetail(id)).blockers.map(b => b.code), ["rights"]);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  assert.equal((await materialDetail(id)).state, "stale");
  await approve(id, 2, 2); assert.equal((await materialDetail(id)).blockers.length, 0);
  await exportMaterial(id, 2, "tester", now);
  const testDoc = await createDocument({ sourceId, issuer: "ISOLATED TEST workbench clone", canonicalUrl: `https://example.org/test-${count}` }, "tester");
  await observe(testDoc.id, observationFixture, "tester");
  assert.equal((await materialDetail(testDoc.id)).testOnly, true);
  await observe(id, { ...observationFixture, expectedRevision: 2, sourceCapture: { ...capture, parser: "Synthetic UI parser/v2" } }, "tester");
  assert.equal((await materialDetail(id)).state, "stale");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await withdraw(id, { expectedRevision: 3, reason: "Synthetic workbench withdrawal" }, "tester");
  assert.equal((await materialDetail(id)).state, "withdrawn");
  assert.ok((await materialDetail(id)).blockers.some(b => b.code === "withdrawn"));
  const list = await app.inject("/api/admin/fishery/workbench");
  assert.equal(list.statusCode, 200, list.body); assert.equal(list.headers["cache-control"], "no-store");
  assert.ok(list.json().rows.some((r: { id: string; state: string }) => r.id === id && r.state === "withdrawn"));
  config.devAdmin = null;
});

test("A→B→A and attachment-only replacements remain separate observations and invalidate approval", async () => {
  const { id } = await fixture();
  await approve(id);
  const first = await exportMaterial(id, 1, "tester", now);
  assert.equal(first.policy.documentNumber, "CMM-fixture-01");
  assert.equal(first.source.originalUrl.startsWith("https://example.org/"), true);
  assert.equal(first.policy.effectiveDateState, "future");
  const boundary = await exportMaterial(id, 1, "tester", new Date("2028-01-01T00:30:00+09:00"));
  assert.deepEqual(boundary.policy.dateComparisonReference, { date: "2027-12-31", timezone: "UTC" });
  assert.equal(boundary.policy.effectiveDateState, "future", "UTC date progress does not assert local legal commencement");
  assert.equal(first.dates.effectiveFrom.value, "2028-01-01");
  assert.equal(first.policy.applicabilityReviewed, false);
  assert.equal(first.rights.fulltextExport, false);
  assert.equal(first.rights.translationExport, false);
  assert.equal(first.observation.hashAssurance, "admin_declared_not_fetched");
  const { contentHash, ...payload } = first;
  assert.equal(contentHash, hash(payload));
  await observe(id, { ...observationFixture, expectedRevision: 1, rawSha256: "c".repeat(64) }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /latest observation/);
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await assert.rejects(approve(id, 1), /changed/);
  await observe(id, { ...observationFixture, expectedRevision: 2 }, "tester");
  const history = await documentHistory(id);
  assert.equal(history.observations.length, 3);
  assert.equal(history.observations[0].content_hash, history.observations[2].content_hash);
  assert.notEqual(history.observations[0].content_hash, history.observations[1].content_hash);
  await observe(id, { ...observationFixture, expectedRevision: 3, evidence: [{ ...observationFixture.evidence[0], sha256: "d".repeat(64) }] }, "tester");
  const changed = await documentHistory(id);
  assert.equal(changed.observations[2].payload.rawSha256, changed.observations[3].payload.rawSha256);
  assert.notEqual(changed.observations[2].content_hash, changed.observations[3].content_hash);
  await approve(id, 4);
  const last = await exportMaterial(id, 4, "tester", now);
  assert.equal(last.evidence[0].sha256, "d".repeat(64));
  assert.equal(last.dates.adopted.value, null);
  assert.ok(materialMarkdown(last).includes("unknown"));
  assert.ok(materialMarkdown(last).includes("尚未经系统抓取字节验证"));
});

test("parser-only revisions invalidate prior approval despite identical original and body hashes", async () => {
  const { id } = await fixture();
  const capture = { adapter: "jinjiang", sourceUrl: "https://example.org/synthetic", capturedAt: "2026-10-20T00:00:00Z", httpStatus: 200,
    rawSha256: observationFixture.rawSha256, bodySha256: "c".repeat(64), parser: "Synthetic parser/v1", parseStatus: "parsed",
    attachmentSha256: null, conflicts: [] };
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: capture }, "tester");
  await approve(id, 2); await exportMaterial(id, 2, "tester", now);
  await observe(id, { ...observationFixture, expectedRevision: 2, sourceCapture: { ...capture, parser: "Synthetic parser/v2" } }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /latest observation/);
  await assert.rejects(exportMaterial(id, 3, "tester", now), /latest observation/);
  const history = await documentHistory(id);
  assert.equal(history.observations[1].payload.sourceCapture.bodySha256, history.observations[2].payload.sourceCapture.bodySha256);
  assert.notEqual(history.observations[1].content_hash, history.observations[2].content_hash);
  await approve(id, 3); await exportMaterial(id, 3, "tester", now);
});

test("current source rights and review deadlines apply to old and current revisions", async () => {
  const unknown = await fixture({ unknownRights: true });
  await approve(unknown.id);
  await assert.rejects(exportMaterial(unknown.id, 1, "tester", now), /rights/);
  const { id, sourceId } = await fixture();
  await assert.rejects(exportMaterial(id, 1, "tester", now), /approved/);
  await approve(id);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 1 }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /current rights/);
  await approve(id, 1, 2);
  await exportMaterial(id, 1, "tester", now);
  await registerSource(sourceId, { expectedRevision: 2, rightsStatus: "revoked" }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 3, reviewDueAt: "2026-10-19T00:00:00Z" }, "tester");
  await approve(id, 1, 4);
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  await registerSource(sourceId, { ...sourceFixture, expectedRevision: 4, rightsCheckedAt: "2026-10-21T00:00:00Z" }, "tester");
  await approve(id, 1, 5);
  await assert.rejects(exportMaterial(id, 1, "tester", now), /rights/);
  assert.ok((await sourceHealth(now.getTime())).some((line) => line.includes(sourceId)));
});

test("latest rejection, terminal withdrawal and stale concurrent edits fail closed", async () => {
  const { id } = await fixture();
  await approve(id);
  await review(id, { revision: 1, sourceRevision: 1, decision: "rejected", applicabilityReviewed: false, note: "Evidence conflict" }, "reviewer");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /approved/);
  const attempts = await Promise.allSettled([observe(id, { ...observationFixture, expectedRevision: 1 }, "first"), observe(id, { ...observationFixture, expectedRevision: 1 }, "second")]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  await approve(id, 2);
  await withdraw(id, { expectedRevision: 2, reason: "Rights withdrawn" }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /withdrawal/);
  await assert.rejects(observe(id, { ...observationFixture, expectedRevision: 2 }, "tester"), /withdrawn/);
  assert.equal((await documentHistory(id)).observations.length, 2);
});

test("linked articles remain governed by publication withdrawal", async () => {
  const sourceId = `fishery-${++count}`;
  await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Fixture', 'external', false, '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.org/article-${count}`, title: "Fixture", bodyText: "Fixture", bodyHtml: "<p>Fixture</p>", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await publishArticle(articleId);
  const { id } = await fixture({ sourceId, articleId });
  await approve(id);
  await exportMaterial(id, 1, "tester", now);
  await setVisibility(articleId, { visibility: "summary-only", version: 0, reason: "fixture summary" }, "tester");
  const summaryOnly = await exportMaterial(id, 1, "tester", now);
  assert.equal(summaryOnly.rights.fulltextExport, false);
  await setVisibility(articleId, { visibility: "withdrawn", version: 1, reason: "fixture withdrawn" }, "tester");
  await assert.rejects(exportMaterial(id, 1, "tester", now), /publicly available/);
});

test("real module routes enforce admin and CSRF before reading or mutating evidence", async () => {
  config.devAdmin = null;
  const routes = ["sources", "documents", "documents/missing"];
  for (const path of routes) {
    const res = await app.inject(`/api/admin/fishery/${path}`);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.includes("rawSha256"), false);
  }
  assert.equal((await app.inject("/api/fishery/v1/materials/snapshot")).statusCode, 404);
  config.devAdmin = { displayName: "Fixture admin" };
  const { id } = await fixture();
  const request = (path: string, payload: Record<string, unknown>, csrf?: string) => app.inject({ method: "POST", url: `/api/admin/fishery/documents/${id}/${path}`, headers: csrf ? { "x-csrf-token": csrf } : {}, payload });
  for (const csrf of [undefined, "wrong"]) assert.equal((await request("observations", { ...observationFixture, expectedRevision: 1 }, csrf)).statusCode, 403);
  assert.equal((await documentHistory(id)).observations.length, 1);
  assert.equal((await request("reviews", { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Route fixture review" }, "dev")).statusCode, 201);
  for (const format of ["json", "markdown"]) {
    const res = await request("export", { revision: 1, format }, "dev");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(res.headers["content-disposition"]?.includes(format === "json" ? ".json" : ".md"));
    assert.equal(res.body.includes("仅审核摘要与元数据"), true);
  }
  const bad = await request("observations", { ...observationFixture, expectedRevision: 1, dates: { ...observationFixture.dates, published: { precision: "day", value: "2026-02-30" } } }, "dev");
  assert.equal(bad.statusCode, 400);
  assert.equal((await app.inject("/api/admin/fishery/documents/missing")).statusCode, 404);
  const [audit] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  assert.equal(Number(audit.n), 2);
  config.devAdmin = null;
});


test("administrator can register, observe, review and export a complete offline fixture over HTTP", async () => {
  config.devAdmin = { displayName: "Fixture operator" };
  const sourceId = `fishery-${++count}`;
  await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Offline HTTP fixture', 'external', false, '2100-01-01')`;
  const headers = { "x-csrf-token": "dev" };
  const put = await app.inject({ method: "PUT", url: `/api/admin/fishery/sources/${sourceId}`, headers, payload: sourceFixture });
  assert.equal(put.statusCode, 200, put.body);
  const made = await app.inject({ method: "POST", url: "/api/admin/fishery/documents", headers,
    payload: { sourceId, issuer: "Offline fixture", canonicalUrl: `https://example.org/manual-${count}` } });
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().id;
  const base = `/api/admin/fishery/documents/${id}`;
  const observed = await app.inject({ method: "POST", url: `${base}/observations`, headers,
    payload: { ...observationFixture, dates: { ...observationFixture.dates, published: { precision: "unknown", value: null }, effectiveFrom: { precision: "month", value: "2026-10" } } } });
  assert.equal(observed.statusCode, 201, observed.body);
  const detail = await app.inject(base);
  assert.equal(detail.json().observations.length, 1);
  const duplicate = await app.inject({ method: "POST", url: "/api/admin/fishery/documents", headers,
    payload: { sourceId, issuer: "Offline fixture", canonicalUrl: `https://example.org/manual-${count}` } });
  assert.equal(duplicate.statusCode, 409);
  const reviewed = await app.inject({ method: "POST", url: `${base}/reviews`, headers,
    payload: { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic offline fixture reviewed" } });
  assert.equal(reviewed.statusCode, 201, reviewed.body);
  const exported = await app.inject({ method: "POST", url: `${base}/export`, headers, payload: { revision: 1 } });
  assert.equal(exported.statusCode, 200, exported.body);
  const bundle = exported.json();
  assert.equal(bundle.policy.documentNumber, null);
  assert.deepEqual(bundle.dates.published, { precision: "unknown", value: null });
  assert.deepEqual(bundle.dates.effectiveFrom, { precision: "month", value: "2026-10" });
  assert.equal(bundle.policy.effectiveDateState, "unknown");
  assert.equal(JSON.stringify(bundle).includes("body_html"), false);
  config.devAdmin = null;
});

test("material size limits and Markdown escaping prevent unsafe or oversized manual attachments", async () => {
  const { id } = await fixture();
  await observe(id, { ...observationFixture, expectedRevision: 1, title: "<img src=x onerror=alert(1)>", summaryZh: "[unsafe](javascript:alert(1))" }, "tester");
  await approve(id, 2);
  const markdown = materialMarkdown(await exportMaterial(id, 2, "tester", now));
  const html = await marked.parse(markdown);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.ok(html.includes("&lt;img"));
  assert.ok(markdown.includes("\n\n"));
  const evidence = Array.from({ length: 20 }, () => ({ ...observationFixture.evidence[0], url: `https://example.org/${"x".repeat(1900)}`, section: "长".repeat(200) }));
  await observe(id, { ...observationFixture, expectedRevision: 2, evidence }, "tester");
  await approve(id, 3);
  assert.ok(JSON.stringify(evidence).length < 48 * 1024, "fixture character count fits but multibyte bytes do not");
  const [before] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  await assert.rejects(exportMaterial(id, 3, "tester", now), /48 KiB/);
  const [after] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject = ${`fishery:${id}`} AND action = 'fishery.export'`;
  assert.equal(Number(after.n), Number(before.n), "failed oversized export must not record success");
});


test("an approved observation cannot export a failed source capture", async () => {
  const { id } = await fixture();
  await observe(id, { ...observationFixture, expectedRevision: 1, sourceCapture: {
    adapter: "fuzhou", sourceUrl: "https://hyj.fuzhou.gov.cn/fixture.htm", capturedAt: "2026-10-20T00:00:00Z",
    httpStatus: 404, rawSha256: observationFixture.rawSha256, bodySha256: null, parser: "none", parseStatus: "failed",
    attachmentSha256: null, conflicts: [],
  } }, "tester");
  await assert.rejects(exportMaterial(id, 2, "tester", now), /approved/);
  await approve(id, 2);
  await assert.rejects(exportMaterial(id, 2, "tester", now), /prevent export/);
});


test("persistent fishery flow reuses successful stages, requires human snapshot decision and invalidates versions",async()=>{
  const body="合成公海远洋渔业证据材料。",url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_2.htm";
  await collectColumns({id:"synthetic-flow",dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>({url:request,status:request.endsWith("robots.txt")?404:200,headers:{get:()=>"text/html"},body:Buffer.from(request.endsWith("robots.txt")?"missing":request===COLUMNS.moa.url?`<ul class="sj_e_tonzhi_list"><li><a href="${url}">合成公海材料</a></li></ul>`:`<meta name="ArticleTitle" content="合成公海材料"><div class="sj_arc_body"><div class="TRS_Editor">${Array.from({length:5},()=>`<p>${body}</p>`).join("")}</div></div>`)})});
  config.devAdmin={displayName:"ISOLATED TEST FLOW"};
  let id:string;
  try {
    assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",payload:{identity:"test"}})).statusCode,403);
    const created=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"test"}});
    assert.equal(created.statusCode,200,created.body);assert.equal(created.json().modelCalls,0);id=created.json().tasks[0].id;
    const again=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"test"}});assert.equal(again.json().tasks[0].id,id);
    const otherIdentity=await app.inject({method:"POST",url:"/api/admin/fishery/batches/synthetic-flow/flows",headers:{"x-csrf-token":"dev"},payload:{identity:"different-click-same-evidence"}});assert.equal(otherIdentity.json().tasks[0].id,id);
  } finally {config.devAdmin=null;}
  assert.equal((await app.inject(`/api/admin/fishery/flows/${id!}`)).statusCode,401);
  let generated=0,reviewed=0,failReview=true;
  const invoke=async(options:any)=>{
    let data:any;
    const evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};
    if(options.purpose==="fishery_draft") {generated++;data={relevance:{decision:"relevant",reason:"test",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};}
    else {reviewed++;if(failReview) throw new Error("Synthetic review failure");data={decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"原句一致",evidence},{field:"relevance",verdict:"supported",reason:"原句明确公海远洋",evidence}]};}
    return {data:options.schema.parse(data),receiptId:999999,model:"mock",reused:false,usage:null};
  };
  const failed=await runFlow(id!,invoke);assert.equal(failed.status,"failed");assert.equal(failed.stage,"review");assert.ok(failed.draft);assert.equal(generated,1);
  await assert.rejects(runFlow(id!,invoke),/not queued/);
  await retryFlow(id!,{note:"Explicit reconciled mock failure"},"tester");failReview=false;
  const checked=await runFlow(id!,invoke);assert.equal(checked.status,"needs_human_review");assert.equal(generated,1);assert.equal(reviewed,2);assert.equal(checked.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",snapshotHash:"a".repeat(64),note:"wrong snapshot"},"reviewer"),/snapshot changed/);
  await decideFlow(id!,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Synthetic internal decision only"},"reviewer");
  const qualified=await flowDetail(id!);assert.equal(qualified.status,"qualified");assert.ok(qualified.internalArticle);assert.equal(qualified.published,false);
  await decideFlow(id!,{decision:"rejected",snapshotHash:checked.snapshotHash,note:"Retract synthetic qualification"},"reviewer");assert.equal((await flowDetail(id!)).internalArticle,null);
  await decideFlow(id!,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Synthetic review again"},"reviewer");
  // A preexisting/newer pending or rejected task is authoritative; never fall back to old qualified.
  await sql`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) SELECT 'superseding-'||id,document_id,'superseding-'||identity,snapshot,'queued','generation',actor FROM fishery_flow_tasks WHERE id=${id!}`;
  const historical=await flowDetail(id!);assert.equal(historical.authoritative,false);assert.equal(historical.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Cannot revive old article"},"reviewer"),/newer authoritative/);
  const newer=await flowDetail("superseding-"+id!);await decideFlow(newer.id,{decision:"rejected",snapshotHash:newer.snapshotHash,note:"Reject latest task; older qualified must stay hidden"},"reviewer");assert.equal((await flowDetail(id!)).internalArticle,null);
  const document=await documentHistory(checked.document_id),sourceId=document.document.source_id;
  await registerSource(sourceId,{expectedRevision:1,healthNote:"Changed source rights metadata"},"tester");
  const stale=await flowDetail(id!);assert.equal(stale.stale,true);assert.equal(stale.internalArticle,null);
  await assert.rejects(decideFlow(id!,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Old snapshot"},"reviewer"),/snapshot changed|newer authoritative/);
  await assert.rejects(createFlow(checked.document_id,{identity:"test"},"tester"),/old evidence/);
  const next=await createFlow(checked.document_id,{identity:"new-version"},"tester");assert.notEqual(next.id,id!);
  await withdraw(checked.document_id,{expectedRevision:1,reason:"Synthetic withdrawal"},"tester");assert.equal((await flowDetail(next.id)).stale,true);assert.equal((await flowDetail(id!)).internalArticle,null);
});


test("stage persistence failures resume the same received receipt; only explicit regeneration creates a new paid identity",async()=>{
  const body="合成公海远洋渔业事实。",date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  const output={relevance:{decision:"relevant",reason:"test",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic source",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const sends={generation:0,review:0};let badReview=false;
  const invoke=async(options:any)=>{
    const generation=options.purpose==="fishery_draft";
    const receipt=await paidRequest({service:"flow-local-mock",model:"mock",purpose:options.purpose,subject:options.subject,identity:{promptVersion:options.promptVersion,system:options.system,user:options.user},attemptTag:options.attemptTag},async()=>{
      if(generation)sends.generation++;else sends.review++;
      const data=generation?output:{decision:badReview?"needs_evidence":"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:badReview?"not_found":"supported",reason:"Synthetic mock claim check",evidence:badReview?[]:evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevant original",evidence}]};
      return {response:data};
    });
    return {data:options.schema.parse(receipt.response),receiptId:receipt.receiptId,reused:receipt.reused,model:"mock",usage:null};
  };
  await sql.unsafe(`CREATE FUNCTION fishery_test_persist_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (NEW.draft IS NOT NULL AND OLD.draft IS NULL AND EXISTS (SELECT 1 FROM settings WHERE key='flow-test-fault' AND value='"generation"'::jsonb))
      OR (NEW.quality_review IS NOT NULL AND EXISTS (SELECT 1 FROM settings WHERE key='flow-test-fault' AND value='"review"'::jsonb))
    THEN RAISE EXCEPTION 'Synthetic stage transaction failure'; END IF; RETURN NEW; END $$`);
  await sql.unsafe(`CREATE TRIGGER fishery_test_persist_fault BEFORE UPDATE ON fishery_flow_tasks FOR EACH ROW EXECUTE FUNCTION fishery_test_persist_fault()`);
  try {
    const g=await task("persist-generation");
    await sql`INSERT INTO settings(key,value) VALUES ('flow-test-fault','"generation"'::jsonb)`;
    const failed=await runFlow(g.id,invoke);assert.equal(failed.status,"failed");assert.equal(failed.error.phase,"persist");assert.equal(failed.draft,null);assert.equal(sends.generation,1);
    await assert.rejects(retryFlow(g.id,{note:"Do not pay for a received output again",mode:"regenerate",acknowledgeNewCharge:true},"tester"),/resume same attempt/);
    await sql`DELETE FROM settings WHERE key='flow-test-fault'`;
    const resumed=await retryFlow(g.id,{note:"Resume durable received generation"},"tester");assert.equal(resumed.attempt,1);assert.equal(await flowRequiredCalls(g.id),1);
    const saved=await runFlow(g.id,invoke);assert.equal(saved.status,"needs_human_review");assert.equal(sends.generation,1);assert.equal(sends.review,1);
    const r=await task("persist-review");
    await sql`INSERT INTO settings(key,value) VALUES ('flow-test-fault','"review"'::jsonb)`;
    const reviewFailed=await runFlow(r.id,invoke);assert.equal(reviewFailed.status,"failed");assert.equal(reviewFailed.error.phase,"persist");assert.ok(reviewFailed.draft);assert.equal(reviewFailed.quality_review,null);
    await sql`DELETE FROM settings WHERE key='flow-test-fault'`;
    // Simulate a crash after receiving the answer: a running row can only resume a reusable receipt.
    await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${r.id}`;
    await sql`UPDATE receipts SET status='unknown' WHERE id=${reviewFailed.error.receiptId}`;
    await assert.rejects(retryFlow(r.id,{note:"Unknown outcome must block"},"tester"),/pending\/unknown/);
    await assert.rejects(retryFlow(r.id,{note:"Unknown cannot regenerate",mode:"regenerate",acknowledgeNewCharge:true},"tester"),/pending\/unknown/);
    await sql`UPDATE receipts SET status='received' WHERE id=${reviewFailed.error.receiptId}`;
    const before={...sends};await retryFlow(r.id,{note:"Reconciled interrupted received review"},"tester");assert.equal(await flowRequiredCalls(r.id),0);
    assert.equal((await runFlow(r.id,invoke)).status,"needs_human_review");assert.deepEqual(sends,before);
    const bad=await task("semantic-negative");badReview=true;
    const first=await runFlow(bad.id,invoke);assert.equal(first.status,"needs_evidence");const sent=sends.review;
    await retryFlow(bad.id,{note:"Resume returns existing negative review"},"tester");assert.equal((await runFlow(bad.id,invoke)).status,"needs_evidence");assert.equal(sends.review,sent);
    await assert.rejects(retryFlow(bad.id,{note:"Missing charge acknowledgement",mode:"regenerate"},"tester"),/acknowledgement/);
    await retryFlow(bad.id,{note:"Reconciled prior negative; explicitly request another paid check",mode:"regenerate",acknowledgeNewCharge:true},"tester");
    assert.equal((await runFlow(bad.id,invoke)).review_attempt,2);assert.equal(sends.review,sent+1);
    const rejected=await flowDetail(bad.id);await decideFlow(bad.id,{decision:"rejected",snapshotHash:rejected.snapshotHash,note:"Reject unsupported facts"},"reviewer");assert.equal((await flowDetail(bad.id)).status,"rejected");
    await withdraw(saved.document_id,{expectedRevision:2,reason:"Synthetic source withdrawal"},"tester");
    await decideFlow(g.id,{decision:"rejected",snapshotHash:saved.snapshotHash,note:"Reject stale withdrawn material, retain old snapshot"},"reviewer");assert.equal((await flowDetail(g.id)).status,"rejected");
  } finally {await sql.unsafe('DROP TRIGGER fishery_test_persist_fault ON fishery_flow_tasks');await sql.unsafe('DROP FUNCTION fishery_test_persist_fault()');await sql`DELETE FROM settings WHERE key='flow-test-fault'`;}
});

test("manual processor only consumes explicit flows, persists blocks and failures, and never resends duplicate tasks",async()=>{
  const boss=await getBoss({schedule:false,supervise:false});
  await assert.rejects(getBoss({schedule:true}),/mode differs/);
  const body="合成公海远洋渔业事实。",date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic source",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const envKeys=["LLM_MODEL","LLM_BASE_URL","LLM_REASONING_TOKENS","LLM_EXTRA_JSON"] as const;
  const oldEnv=envKeys.map(k=>process.env[k]),enabled=config.modelCallsEnabled;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("Unexpected external request in manual processor test");};
  process.env.LLM_MODEL=TRIAL.model;process.env.LLM_BASE_URL="https://api.deepseek.com";process.env.LLM_REASONING_TOKENS="0";process.env.LLM_EXTRA_JSON='{"thinking":{"type":"disabled"}}';
  const ledger={id:TRIAL.id,entries:[],maxRequests:TRIAL.maxRequests,maxReservedMicroCny:TRIAL.maxReservedMicroCny};
  const setLedger=async(entries:{state:string;reservedMicroCny:number}[])=>{await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({...ledger,entries})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;};
  let calls=0,fail=false,ineligible=false,emptySummary=false,hold:Promise<void>|undefined,releaseHold:(()=>void)|undefined;
  const invoke=async(options:any)=>{
    calls++;if(hold) await hold;if(fail) throw new Error("Synthetic model failure");
    const data=options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"test",evidence},summaryZh:emptySummary?[]:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]}:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic original sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevant original",evidence}]};
    if(ineligible&&options.purpose==="fishery_draft") data.relevance={decision:"unknown",reason:"Synthetic relevance unknown",evidence:[]};
    return {data:options.schema.parse(data),receiptId:999999,model:"mock",reused:false,usage:null};
  };
  let release:(()=>Promise<void>)|undefined;
  const settled=async(jobId:string|null)=>{
    const until=Date.now()+15000;
    while(Date.now()<until) {
      const job=await boss.getJobById(flowQueue.name,jobId!);
      if(job&&["failed","completed"].includes(job.state)) return job;
      await new Promise(r=>setTimeout(r,25));
    }
    throw new Error(`Queue job ${jobId} did not settle`);
  };
  try {
    await boss.createQueue(flowQueue.name,{...flowQueue.options,retryLimit:1});
    await assert.rejects(registerManualFlowConsumer(boss),/reconcile deployed queue/);
    await boss.updateQueue(flowQueue.name,{retryLimit:0,expireInSeconds:600});
    release=await registerManualFlowConsumer(boss,jobs=>runQueuedFlows(jobs,invoke));
    await assert.rejects(registerManualFlowConsumer(boss),/already running/);
    assert.deepEqual(boss.getWipData().map(w=>w.name),[flowQueue.name]);
    assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.schedule`)[0]!.n,0);
    assert.equal(calls,0,"idle startup performs no model calls");
    config.modelCallsEnabled=false;
    const closed=await task("manual-closed"),closedJob=await enqueueOn(flowQueue,{id:closed.id});
    assert.equal((await settled(closedJob)).state,"failed");
    const closedTask=await flowDetail(closed.id);assert.equal(closedTask.status,"failed");assert.equal(closedTask.error.phase,"authorization");assert.match(closedTask.error.reason,/MODEL_CALLS_ENABLED/);assert.equal(calls,0);
    config.modelCallsEnabled=true;
    await setLedger(Array.from({length:20},()=>({state:"received",reservedMicroCny:400000})));
    const full=await task("manual-capacity"),fullJob=await enqueueOn(flowQueue,{id:full.id});
    assert.equal((await settled(fullJob)).state,"failed");assert.match((await flowDetail(full.id)).error.reason,/hard request/);assert.equal(calls,0);
    await setLedger([]);
    process.env.LLM_MODEL="refused-model";
    const refused=await task("manual-authorization"),refusedJob=await enqueueOn(flowQueue,{id:refused.id});
    assert.equal((await settled(refusedJob)).state,"failed");assert.match((await flowDetail(refused.id)).error.reason,/configuration refused/);assert.equal(calls,0);
    process.env.LLM_MODEL=TRIAL.model;
    fail=true;
    const bad=await task("manual-failed"),badJob=await enqueueOn(flowQueue,{id:bad.id});
    const failedJob=await settled(badJob);assert.equal(failedJob.state,"failed");assert.match(JSON.stringify(failedJob.output),new RegExp(bad.id));assert.equal((await flowDetail(bad.id)).status,"failed");assert.equal(calls,1);
    fail=false;hold=new Promise<void>(resolve=>{releaseHold=resolve;});
    const good=await task("manual-good"),goodJob=await enqueueOn(flowQueue,{id:good.id});
    const until=Date.now()+15000;
    while((await flowDetail(good.id)).status!=="running"&&Date.now()<until) await new Promise(r=>setTimeout(r,25));
    await assert.rejects(runQueuedFlows([{id:good.id}],invoke),/not queued/);
    assert.equal((await flowDetail(good.id)).status,"running");
    releaseHold!();hold=undefined;
    assert.equal((await settled(goodJob)).state,"completed");assert.equal((await flowDetail(good.id)).status,"needs_human_review");assert.equal(calls,3);
    const duplicate=await enqueueOn(flowQueue,{id:good.id});
    assert.equal((await settled(duplicate)).state,"failed");assert.equal((await flowDetail(good.id)).status,"needs_human_review");assert.equal(calls,3);
    const goodTask=await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"));
    assert.deepEqual(goodTask.timeline.sourcePublished,{precision:"day",value:"2026-04-17"});
    assert.equal(goodTask.timeline.originalAgeDays,186);assert.equal(goodTask.timeline.historical,true);assert.equal(goodTask.timeline.isOriginalDay,false);
    assert.equal(goodTask.timeline.candidateEvent.precision,"unknown");assert.equal(goodTask.timeline.sourceEvent.precision,"unknown");
    assert.ok(goodTask.timeline.generatedAt);assert.ok(goodTask.timeline.checkedAt);assert.equal(goodTask.timeline.sourceCapturedAt,"2026-10-20T00:00:00Z");
    await decideFlow(good.id,{decision:"qualified",snapshotHash:goodTask.snapshotHash,note:"Synthetic historical internal article"},"reviewer");
    const article=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).internalArticle;
    assert.equal(article.timeline.historical,true);assert.equal(article.timeline.originalAgeDays,186);assert.equal(article.timeline.candidateEvent.precision,"unknown");
    const [goodObservation]=await sql`SELECT payload FROM fishery_observations WHERE document_id=${goodTask.document_id} AND revision=2`;
    for(const published of [{precision:"month",value:"2026-04"},{precision:"year",value:"2025"},{precision:"unknown",value:null}]) {
      const payload={...goodObservation!.payload,dates:{...goodObservation!.payload.dates,published}};
      await sql`UPDATE fishery_observations SET payload=${sql.json(payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
      const timeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
      assert.deepEqual(timeline.sourcePublished,published);assert.equal(timeline.originalAgeDays,null);assert.equal(timeline.isOriginalDay,null);
      assert.equal(timeline.historical,published.precision!=="unknown");
      if(published.precision==="unknown") assert.match(timeline.label,/发布日期未知/);
    }
    for(const [value,age,historical] of [["2026-10-20",0,false],["2026-10-19",1,false],["2026-10-13",7,true]] as const) {
      const payload={...goodObservation!.payload,dates:{...goodObservation!.payload.dates,published:{precision:"day",value}}};
      await sql`UPDATE fishery_observations SET payload=${sql.json(payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
      const timeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
      assert.equal(timeline.originalAgeDays,age);assert.equal(timeline.isOriginalDay,age===0);assert.equal(timeline.historical,historical);
      if(age===1) assert.equal(timeline.label,"非当日原文");
    }
    await sql`UPDATE fishery_observations SET payload=${sql.json(goodObservation!.payload)} WHERE document_id=${goodTask.document_id} AND revision=2`;
    await observe(goodTask.document_id,{...observationFixture,expectedRevision:2,dates:{...observationFixture.dates,published:{precision:"day",value:"2026-10-20"}}},"tester");
    const oldTimeline=(await flowDetail(good.id,new Date("2026-10-20T00:00:00Z"))).timeline;
    assert.deepEqual(oldTimeline.sourcePublished,{precision:"day",value:"2026-04-17"},"a later observation cannot rewrite the article's original publication date");
    assert.equal(oldTimeline.generatedAt,goodTask.timeline.generatedAt,"human qualification and newer metadata do not rewrite generation time");
    const interrupted=await task("manual-interrupted");await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${interrupted.id}`;
    const interruptedJob=await enqueueOn(flowQueue,{id:interrupted.id});assert.equal((await settled(interruptedJob)).state,"failed");assert.equal((await flowDetail(interrupted.id)).status,"running");assert.equal(calls,3);
    ineligible=true;
    const unknown=await task("manual-unknown"),unknownJob=await enqueueOn(flowQueue,{id:unknown.id});
    assert.equal((await settled(unknownJob)).state,"completed");const unknownTask=await flowDetail(unknown.id);assert.equal(unknownTask.status,"needs_evidence");assert.equal(unknownTask.error.code,"FISHERY_ARTICLE_INELIGIBLE");assert.equal(calls,4,"unknown relevance skips paid review");
    await assert.rejects(decideFlow(unknown.id,{decision:"qualified",snapshotHash:unknownTask.snapshotHash,note:"Unknown cannot qualify"},"reviewer"),/relevant/);
    await sql`UPDATE fishery_flow_tasks SET status='qualified',quality_review=${sql.json({status:"needs_human_review",receiptId:999999,review:{decision:"supported",coverage:"complete_input",findings:[]},missingFields:[]})},human_decision=${sql.json({actor:"legacy-reviewer",decision:"qualified"})} WHERE id=${unknown.id}`;
    assert.equal((await flowDetail(unknown.id)).internalArticle,null,"legacy unknown qualified tasks have no internal article preview even with a formerly passing review");
    await assert.rejects(decideFlow(unknown.id,{decision:"qualified",snapshotHash:unknownTask.snapshotHash,note:"Legacy passing review cannot qualify unknown relevance"},"reviewer"),/relevant/);
    await sql`UPDATE fishery_flow_tasks SET status='needs_evidence',quality_review=NULL,human_decision=NULL WHERE id=${unknown.id}`;
    ineligible=false;
    await retryFlow(unknown.id,{note:"Explicit regeneration of unknown draft",mode:"regenerate",acknowledgeNewCharge:true},"tester");
    assert.equal(await flowRequiredCalls(unknown.id),2);
    assert.equal((await settled(await enqueueOn(flowQueue,{id:unknown.id}))).state,"completed");assert.equal((await flowDetail(unknown.id)).status,"needs_human_review");assert.equal(calls,6);
    emptySummary=true;
    const empty=await task("manual-empty"),emptyJob=await enqueueOn(flowQueue,{id:empty.id});assert.equal((await settled(emptyJob)).state,"completed");const emptyTask=await flowDetail(empty.id);assert.equal(emptyTask.status,"needs_evidence");assert.equal(calls,7,"empty summary skips paid review");
    await assert.rejects(decideFlow(empty.id,{decision:"qualified",snapshotHash:emptyTask.snapshotHash,note:"Empty article cannot qualify"},"reviewer"),/非空/);
  } finally {
    releaseHold?.();
    await boss.offWork(flowQueue.name);await release?.();
    config.modelCallsEnabled=enabled;envKeys.forEach((k,i)=>{if(oldEnv[i]===undefined) delete process.env[k];else process.env[k]=oldEnv[i];});globalThis.fetch=previousFetch;
    await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
  }
});
