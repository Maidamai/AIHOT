import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { marked } from "marked";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { setVisibility } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
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
