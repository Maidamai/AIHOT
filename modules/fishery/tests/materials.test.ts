import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import { collectColumns,readCapturedText } from "../backend/column-batches.ts";
import { importBatch } from "../backend/import-batch.ts";
import { COLUMNS } from "../backend/official-columns.ts";

import { paidRequest, completeReceipt } from "@aihot/backend/providers/receipts";
import { reconcileFlow, revisionContext, createHumanRevision, createFlow, flowDetail, runFlow, retryFlow, decideFlow, flowRequiredCalls, flowQueue, runQueuedFlows } from "../backend/flow.ts";

import { registerManualFlowConsumer } from "../backend/manual-processing.ts";
import { authorizationKey, upgradeExistingTrialToAmountOnly, assertFisheryCapacity } from "../backend/authorization.ts";
import { prepareFisheryDraft, buildFisheryDraftRequest } from "../backend/ai-draft.ts";
import { acquireProcessingLease } from "../backend/processing-lease.ts";
import { TRIAL, amountOnlyPolicy, trialBudget, trialCapacity } from "../backend/trial-transport.ts";

import { readerPage, readerItem } from "../backend/reader.ts";

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

test("PDF reacquisition times preserve imported approval and qualified flow while evidence changes invalidate them",async()=>{
  const column={id:"synthetic-pdf-capture-time",name:"Synthetic PDF column",issuer:"Synthetic source attribution"};
  const fact="合成公海远洋渔业事实。",body=`--- Page 1 ---\n${fact}`;
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p2s1"];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==="fishery_draft"?{
    relevance:{decision:"relevant",reason:"Synthetic source evidence",evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[],
  }:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic original sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevance evidence",evidence}]}),receiptId:999999,model:"mock",reused:false,usage:null});
  const variants=["times","html","pdf","body","parser"] as const;
  for(const variant of variants) {
    const url=`https://example.org/pdf-capture-${variant}`,initial={...observationFixture,rawSha256:sha256("original HTML"),sourceCapture:{acquisitionMode:"live_capture",adapter:"iotc",sourceUrl:url,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:sha256("original HTML"),bodySha256:sha256(body),parser:"synthetic-pdf/v1",parseStatus:"parsed",attachmentSha256:sha256("original PDF"),attachmentUrl:"https://example.org/measure.pdf",attachmentHttpStatus:200,attachmentCapturedAt:"2026-10-20T00:00:01Z",attachmentPages:1,conflicts:[]}};
    const imported=await importCapturedMaterial(column,url,initial,"tester");
    await upsertMaterial({sourceId:`fishery-column-${column.id}`,url,title:"Synthetic PDF source",bodyText:body,bodyStatus:"ok",via:"offline-fixture",raw:{fisheryDocumentId:imported.id}});
    await approve(imported.id);
    const task=await createFlow(imported.id,{identity:`capture-time-${variant}`},"tester"),checked=await runFlow(task.id,invoke);
    assert.equal(checked.status,"needs_human_review");
    await decideFlow(task.id,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Synthetic snapshot qualification"},"reviewer");
    assert.ok((await flowDetail(task.id)).internalArticle);
    const recaptured={...initial,sourceCapture:{...initial.sourceCapture,capturedAt:"2026-10-21T00:00:00Z",attachmentCapturedAt:"2026-10-21T00:00:01Z"}};
    const duplicate=await importCapturedMaterial(column,url,recaptured,"tester");
    assert.equal(duplicate.unchanged,true,variant);assert.equal(duplicate.revision,1,variant);
    assert.equal((await materialDetail(imported.id)).state,"approved");
    const stillQualified=await flowDetail(task.id);assert.equal(stillQualified.stale,false);assert.equal(stillQualified.status,"qualified");assert.ok(stillQualified.internalArticle);
    const history=await documentHistory(imported.id);assert.equal(history.observations.length,1);assert.equal(history.observations[0]!.payload.sourceCapture.capturedAt,initial.sourceCapture.capturedAt);assert.equal(history.observations[0]!.payload.sourceCapture.attachmentCapturedAt,initial.sourceCapture.attachmentCapturedAt);
    assert.equal(recaptured.sourceCapture.attachmentCapturedAt,"2026-10-21T00:00:01Z","The new acquisition record is not rewritten");
    if(variant==="times") continue;
    const changed=structuredClone(recaptured);
    if(variant==="html") changed.rawSha256=changed.sourceCapture.rawSha256=sha256("changed HTML");
    if(variant==="pdf") changed.sourceCapture.attachmentSha256=sha256("changed PDF");
    if(variant==="body") changed.sourceCapture.bodySha256=sha256(`--- Page 1 ---\n${fact}原文变化。`);
    if(variant==="parser") changed.sourceCapture.parser="synthetic-pdf/v2";
    const updated=await importCapturedMaterial(column,url,changed,"tester");
    assert.equal(updated.unchanged,false,variant);assert.equal(updated.revision,2,variant);assert.equal((await materialDetail(imported.id)).state,"stale");
    const stale=await flowDetail(task.id);assert.equal(stale.stale,true,variant);assert.equal(stale.internalArticle,null,variant);
  }
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
  const routes = ["sources", "documents", "documents/missing", "flows/missing/revision"];
  for (const path of routes) {
    const res = await app.inject(`/api/admin/fishery/${path}`);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.includes("rawSha256"), false);
  }
  assert.equal((await app.inject("/api/fishery/v1/materials/snapshot")).statusCode, 404);
  config.devAdmin = { displayName: "Fixture admin" };
  for(const csrf of [undefined,"wrong"]) assert.equal((await app.inject({method:"POST",url:"/api/admin/fishery/flows/missing/revision",headers:csrf?{"x-csrf-token":csrf}:{},payload:{}})).statusCode,403);
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
  await assert.rejects(decideFlow(id!,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"AI support cannot approve raw material"},"reviewer"),/must be approved/);
  await approve(checked.document_id,checked.snapshot.observationRevision,checked.snapshot.sourceRevision);
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
  const rechecked=await runFlow(next.id,invoke);assert.equal(rechecked.status,"needs_human_review");assert.equal(rechecked.materialApproved,false);
  await assert.rejects(decideFlow(next.id,{decision:"qualified",snapshotHash:rechecked.snapshotHash,note:"Old source approval cannot approve a new source version"},"reviewer"),/must be approved/);
  await approve(checked.document_id,rechecked.snapshot.observationRevision,rechecked.snapshot.sourceRevision);
  await decideFlow(next.id,{decision:"qualified",snapshotHash:rechecked.snapshotHash,note:"Current source and observation approved"},"reviewer");assert.ok((await flowDetail(next.id)).internalArticle);
  await observe(checked.document_id,{...document.observations[0]!.payload,expectedRevision:1,originalTitle:"合成新原标题，未经核查",title:"合成标题变更"},"tester");
  assert.equal((await flowDetail(next.id)).materialApproved,false);assert.equal((await flowDetail(next.id)).internalArticle,null);
  await assert.rejects(decideFlow(next.id,{decision:"qualified",snapshotHash:rechecked.snapshotHash,note:"Old raw approval cannot approve a new observation title"},"reviewer"),/must be approved/);
  await withdraw(checked.document_id,{expectedRevision:2,reason:"Synthetic withdrawal"},"tester");assert.equal((await flowDetail(next.id)).stale,true);assert.equal((await flowDetail(id!)).internalArticle,null);
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

test("manual flow API starts producer-only queues, reuses that mode and refuses a default-mode instance",async t=>{
  const body="合成公海远洋渔业生产者门禁材料。",jobs:string[]=[];
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Producer-only API must not send external requests");});
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-${f.id}`,title:"Synthetic producer evidence",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    return createFlow(f.id,{identity},"tester");
  }
  const previousAdmin=config.devAdmin;
  config.devAdmin={displayName:"ISOLATED TEST MANUAL PRODUCER"};
  try {
    for(const identity of ["producer-first","producer-again"]) {
      const flow=await task(identity),response=await app.inject({method:"POST",url:`/api/admin/fishery/flows/${flow.id}/run`,headers:{"x-csrf-token":"dev"},payload:{}});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,"queued");assert.ok(response.json().jobId,response.body);jobs.push(response.json().jobId);
      const boss=await getBoss({schedule:false,supervise:false});
      assert.equal((await boss.getJobById(flowQueue.name,jobs.at(-1)!))?.state,"created");
      await assert.rejects(getBoss({schedule:true}),/schedule mode differs/);
      await assert.rejects(getBoss({supervise:true}),/supervise mode differs/);
      assert.equal((await flowDetail(flow.id)).status,"queued");
      // Free the existing short-policy pending slot without starting a business consumer.
      await boss.cancel(flowQueue.name,jobs.at(-1)!);
    }
    assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.schedule`)[0]!.n,0);
    const conflict=await task("producer-existing-default");
    // A fresh process models an API whose shared instance already uses framework defaults;
    // leave the parent queue and its process-wide shutdown signal untouched.
    await promisify(execFile)(process.execPath,["--input-type=module","-e",`
      import assert from "node:assert/strict";
      import {getBoss,stopBoss} from "@aihot/backend/jobs/queue";
      import {closeDb} from "@aihot/backend/db";
      import {enqueueFlow,flowDetail,flowQueue} from "./modules/fishery/backend/flow.ts";
      globalThis.fetch=async()=>{throw new Error("Mode conflict must not send external requests");};
      try {
        const boss=await getBoss();
        assert.equal(await getBoss({schedule:true,supervise:true}),boss);
        const before=(await boss.findJobs(flowQueue.name)).length;
        await assert.rejects(enqueueFlow(process.argv[1]),/schedule mode differs/);
        assert.equal((await boss.findJobs(flowQueue.name)).length,before);
        assert.equal((await flowDetail(process.argv[1])).status,"queued");
      } finally {await stopBoss();await closeDb();}
    `,conflict.id],{env:process.env,timeout:30000});
  } finally {
    config.devAdmin=previousAdmin;
    if(jobs.length) await (await getBoss({schedule:false,supervise:false})).cancel(flowQueue.name,jobs);
  }
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
  const ledger={id:TRIAL.id,entries:[],maxRequests:TRIAL.maxRequests,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny};
  const setLedger=async(entries:{state:string;reservedMicroCny:number}[])=>{await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json({...ledger,entries:entries.map((e,i)=>({...e,id:i+1}))})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;};
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
    await boss.createQueue(flowQueue.name,flowQueue.options);
    await boss.updateQueue(flowQueue.name,{retryLimit:1});
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
    await setLedger(Array.from({length:25},()=>({state:"received",reservedMicroCny:400000})));
    const full=await task("manual-capacity"),fullJob=await enqueueOn(flowQueue,{id:full.id});
    assert.equal((await settled(fullJob)).state,"failed");assert.match((await flowDetail(full.id)).error.reason,/hard amount/);assert.equal(calls,0);
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
    await approve(goodTask.document_id,goodTask.snapshot.observationRevision,goodTask.snapshot.sourceRevision);
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
    await approve(unknownTask.document_id,unknownTask.snapshot.observationRevision,unknownTask.snapshot.sourceRevision);
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
    await approve(emptyTask.document_id,emptyTask.snapshot.observationRevision,emptyTask.snapshot.sourceRevision);
    await assert.rejects(decideFlow(empty.id,{decision:"qualified",snapshotHash:emptyTask.snapshotHash,note:"Empty article cannot qualify"},"reviewer"),/非空/);
  } finally {
    releaseHold?.();
    await boss.offWork(flowQueue.name);await release?.();
    config.modelCallsEnabled=enabled;envKeys.forEach((k,i)=>{if(oldEnv[i]===undefined) delete process.env[k];else process.env[k]=oldEnv[i];});globalThis.fetch=previousFetch;
    await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
  }
});


test("private reader projects only the current real qualified set and never exposes audit data or charges on reads",async()=>{
  const baseline=(await readerPage({},now)).total;
  const f=await fixture({unknownRights:true}),quote="合成验收：仅在2026年10月20日且安全条件满足时，远洋研究资料用于接口门禁测试。",body=quote+"\nRAW_BODY_SENTINEL_NOT_FOR_READER";
  await observe(f.id,{...observationFixture,expectedRevision:1,originalTitle:"配额增100%（合成未核查原标题）",title:"配额增100%（合成未核查原标题）",sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-reader/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  const material=await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/private-reader-${f.id}`,title:"SYNTHETIC FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const task=await createFlow(f.id,{identity:"reader-synthetic-contract"},"fixture-admin"),evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};let calls=0;
  const invoke=async(options:any)=>{calls++;const output=options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"公海远洋政策合成样例",evidence},summaryZh:[{sentence:quote,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",uncertainties:[]}: {decision:"supported",coverage:"complete_input",findings:JSON.parse(options.user).claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic contract verification only",evidence:c.evidenceIds}))};return {data:options.schema.parse(output),receiptId:999999,model:"mock",reused:false,usage:null};};
  const checked=await runFlow(task.id,invoke);assert.equal(checked.status,"needs_human_review",JSON.stringify(checked.error));
  assert.equal(checked.materialApproved,false);
  await assert.rejects(decideFlow(task.id,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Must not bypass raw material approval"},"fixture-admin"),/must be approved/);
  await sql`UPDATE fishery_flow_tasks SET status='qualified',human_decision=${sql.json({actor:"synthetic-legacy",decision:"qualified",snapshotHash:checked.snapshotHash})} WHERE id=${task.id}`;
  assert.equal((await flowDetail(task.id)).internalArticle,null);await assert.rejects(readerItem(f.id,now),/No current/);
  await sql`UPDATE fishery_flow_tasks SET status='needs_human_review',human_decision=NULL WHERE id=${task.id}`;
  await approve(f.id,2,1);assert.equal((await flowDetail(task.id)).materialApproved,true);
  await decideFlow(task.id,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"INTERNAL_AUDIT_SENTINEL_DO_NOT_PROJECT"},"PRIVATE_REVIEWER_SENTINEL");
  const [original]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`;
  const one=await readerItem(f.id,now),page=await readerPage({},now);assert.equal(page.total,baseline+1);assert.equal(one.category.id,"safety");assert.equal(one.dates.published.value,"2026-04-17");assert.equal(one.age.historical,true);
  assert.equal(page.categories.reduce((n,c)=>n+c.count,0),page.total);assert.ok(page.categories.every(c=>c.count>0));assert.ok((await readerPage({category:"safety"},now)).rows.some(r=>r.id===f.id));
  assert.equal(one.verification.label,"摘要已完成内部核对");assert.equal(one.title,quote);assert.equal(one.source.originalTitle,"配额增100%（合成未核查原标题）");assert.ok(!one.title.includes("100%"));
  const categoriesBefore=page.categories;
  await review(f.id,{revision:2,sourceRevision:1,decision:"rejected",applicabilityReviewed:false,note:"Synthetic current-version material rejection"},"fixture-admin");
  assert.equal((await flowDetail(task.id)).materialRejected,true);assert.equal((await flowDetail(task.id)).internalArticle,null);
  await assert.rejects(readerItem(f.id,now),/No current/);assert.equal((await readerPage({},now)).total,baseline);
  assert.equal((await readerPage({},now)).categories.reduce((n,c)=>n+c.count,0),baseline);
  await assert.rejects(decideFlow(task.id,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Cannot bypass current material rejection"},"fixture-admin"),/must be approved/);
  await review(f.id,{revision:2,sourceRevision:1,decision:"approved",applicabilityReviewed:false,note:"Synthetic latest current review replaces rejection"},"fixture-admin");
  assert.deepEqual((await readerPage({},now)).categories,categoriesBefore);
  // A historic-version rejection is not a rejection of the current observation.
  await sql`INSERT INTO fishery_reviews(document_id,revision,source_revision,decision,applicability_reviewed,note,actor) VALUES (${f.id},1,1,'rejected',false,'Synthetic historic review','fixture-admin')`;
  assert.equal((await flowDetail(task.id)).materialRejected,false);assert.equal((await readerItem(f.id,now)).id,f.id);
  const serialized=JSON.stringify(one);for(const secret of ["INTERNAL_AUDIT_SENTINEL","PRIVATE_REVIEWER_SENTINEL","RAW_BODY_SENTINEL","promptVersion","receiptId","cost","rawSha256"]) assert.ok(!serialized.includes(secret));
  const receiptCount=(await sql`SELECT count(*)::integer AS n FROM receipts`)[0]!.n;
  config.devAdmin=null;assert.equal((await app.inject("/api/admin/fishery/reader")).statusCode,401);assert.equal((await app.inject(`/api/admin/fishery/reader/${f.id}`)).statusCode,401);
  config.devAdmin={displayName:"Synthetic reader gate tester"};
  try {const response=await app.inject("/api/admin/fishery/reader");assert.equal(response.statusCode,200,response.body);assert.match(response.headers["cache-control"]!,/no-store/);assert.equal((await app.inject(`/api/admin/fishery/reader/${f.id}`)).statusCode,200);}finally{config.devAdmin=null;}
  assert.equal(calls,2);assert.equal((await sql`SELECT count(*)::integer AS n FROM receipts`)[0]!.n,receiptCount);
  async function absent(){assert.equal((await readerPage({},now)).rows.some(r=>r.id===f.id),false);await assert.rejects(readerItem(f.id,now),/No current/);}
  for(const decision of ["unknown","irrelevant"]) {const draft=structuredClone(original.draft);draft.draft.relevance.decision=decision;await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(draft)} WHERE id=${task.id}`;await absent();}
  const empty=structuredClone(original.draft);empty.draft.summaryZh=[];await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(empty)} WHERE id=${task.id}`;await absent();
  await sql`UPDATE fishery_flow_tasks SET draft=${sql.json(original.draft)} WHERE id=${task.id}`;
  const [source]=await sql`SELECT profile FROM fishery_sources WHERE source_id=${f.sourceId}`,testProfile={...source.profile,attribution:"ISOLATED TEST FIXTURE reader clone"},testSnapshot={...original.snapshot,sourceProfileHash:hash(testProfile)},testHuman={...original.human_decision,snapshotHash:hash(testSnapshot)};
  await sql`UPDATE fishery_sources SET profile=${sql.json(testProfile)} WHERE source_id=${f.sourceId}`;await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(testSnapshot)},human_decision=${sql.json(testHuman)} WHERE id=${task.id}`;assert.equal((await flowDetail(task.id)).stale,false);await absent();
  await sql`UPDATE fishery_sources SET profile=${sql.json(source.profile)} WHERE source_id=${f.sourceId}`;await sql`UPDATE fishery_flow_tasks SET snapshot=${sql.json(original.snapshot)},human_decision=${sql.json(original.human_decision)} WHERE id=${task.id}`;
  await sql`UPDATE fishery_documents SET article_id=${material.articleId} WHERE id=${f.id}`;await absent();await sql`UPDATE fishery_documents SET article_id=NULL WHERE id=${f.id}`;
  await sql`INSERT INTO fishery_flow_tasks(id,document_id,identity,snapshot,status,stage,actor) VALUES (${task.id+"-newer"},${f.id},'newer-reader-pending',${sql.json(original.snapshot)},'queued','generation','fixture-admin')`;await absent();
  await sql`UPDATE fishery_flow_tasks SET status='rejected' WHERE id=${task.id+"-newer"}`;await absent();
  await registerSource(f.sourceId,{...source.profile,expectedRevision:1},"fixture-admin");
  assert.equal((await flowDetail(task.id)).materialApproved,false);await absent();
  await observe(f.id,{...observationFixture,expectedRevision:2,originalTitle:"合成新原标题增200%",title:"合成新版本，旧稿失效"},"fixture-admin");assert.equal((await flowDetail(task.id)).materialApproved,false);await absent();
  await withdraw(f.id,{expectedRevision:3,reason:"Synthetic withdrawal"},"fixture-admin");await absent();
});


test("human revision preserves received provenance, saves without calls and only reviews the hash-bound current candidate",async()=>{
  const f=await fixture({unknownRights:true}),body="合成远洋渔业资料，仅用于人工修订测试。合成资料第二句。合成资料第三句。合成资料第四句。合成资料第五句。";
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1","p1s2","p1s3","p1s4","p1s5"];
  const wire={relevance:{decision:"relevant",reason:"合成远洋渔业资料",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",uncertainties:[]};
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-revision/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/revision-${f.id}`,title:"SYNTHETIC FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const original=await createFlow(f.id,{identity:"revision-original"},"fixture-admin");
  const received=await paidRequest({service:"revision-local-mock",model:"mock",purpose:"fishery_draft",subject:original.id,identity:{original:original.id}},async()=>({response:{choices:[{message:{content:JSON.stringify(wire)}}]}}));
  await sql`UPDATE fishery_flow_tasks SET status='failed',stage_requests=${sql.json({'generation:1':{subject:original.id,purpose:'fishery_draft'}})},error=${sql.json({receiptId:received.receiptId,phase:"validate",reason:"synthetic invalid original"})} WHERE id=${original.id}`;
  const [receiptBefore]=await sql`SELECT * FROM receipts WHERE id=${received.receiptId}`,[taskBefore]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${original.id}`;
  await sql`UPDATE receipts SET status='unknown' WHERE id=${received.receiptId}`;
  await assert.rejects(revisionContext(original.id),/pending\/unknown|reconciled/);
  await sql`UPDATE receipts SET status=${receiptBefore.status},purpose='fishery_quality_review' WHERE id=${received.receiptId}`;
  await assert.rejects(revisionContext(original.id),/generation stage/);
  await sql`UPDATE receipts SET purpose=${receiptBefore.purpose} WHERE id=${received.receiptId}`;
  const context=await revisionContext(original.id),request={identity:"revision-candidate",snapshotHash:context.snapshotHash,evidenceHash:context.evidenceCatalog.hash,reason:"PRIVATE_REVISION_REASON",candidate:wire};
  await assert.rejects(createHumanRevision(original.id,{...request,candidate:{...wire,summaryZh:[{sentence:body,evidence:["wrong-id"]}]}},"PRIVATE_REVISION_ACTOR"),/Invalid/);
  await assert.rejects(createHumanRevision(original.id,{...request,snapshotHash:"0".repeat(64)},"fixture-admin"),/snapshot/);
  const beforeCalls=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  const revised=await createHumanRevision(original.id,request,"PRIVATE_REVISION_ACTOR");
  assert.notEqual(revised.id,original.id);assert.equal(revised.stage,"review");assert.equal(revised.status,"queued");
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,beforeCalls);
  assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${received.receiptId}`)[0],receiptBefore);
  assert.deepEqual((await sql`SELECT * FROM fishery_flow_tasks WHERE id=${original.id}`)[0],taskBefore);
  assert.equal((await flowDetail(revised.id)).internalArticle,null);
  assert.equal((await createHumanRevision(original.id,request,"PRIVATE_REVISION_ACTOR")).id,revised.id);
  assert.equal((await createHumanRevision(original.id,{...request,identity:"duplicate-revision"},"PRIVATE_REVISION_ACTOR")).id,revised.id);
  await assert.rejects(createHumanRevision(original.id,{...request,identity:"queued-bypass",candidate:{...wire,uncertainties:["Different queued candidate"]}},"fixture-admin"),/queued/);
  let locked!:()=>void,unlock!:()=>void;
  const lockReady=new Promise<void>(resolve=>{locked=resolve;}),lockRelease=new Promise<void>(resolve=>{unlock=resolve;});
  const editing=sql.begin(async tx=>{await tx`SELECT id FROM fishery_documents WHERE id=${f.id} FOR UPDATE`;locked();await lockRelease;});
  await lockReady;
  let calls=0,entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=runFlow(revised.id,async(options:any)=>{
    entered();await hold;calls++;assert.equal(options.purpose,"fishery_quality_review");assert.ok(options.attemptTag.includes(revised.draft.provenance.candidateHash));
    assert.ok(!JSON.stringify(options).includes("PRIVATE_REVISION"));
    const claims=JSON.parse(options.user).claims;
    return {data:options.schema.parse({decision:"supported",coverage:"complete_input",findings:claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic verification",evidence:c.evidenceIds}))}),receiptId:999999,model:"mock",reused:false,usage:null};
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal((await flowDetail(revised.id)).status,"queued","model claim waits for the document editing boundary");
  unlock();await editing;await started;
  await assert.rejects(createHumanRevision(original.id,{...request,identity:"running-bypass",candidate:{...wire,uncertainties:["Different running candidate"]}},"fixture-admin"),/running/);
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/running/);
  release();const result=await running;
  assert.equal(calls,1);assert.equal(result.status,"needs_human_review",JSON.stringify(result.error));
  await approve(f.id,2,1);
  await decideFlow(revised.id,{decision:"qualified",snapshotHash:result.snapshotHash,note:"synthetic qualification"},"fixture-admin");
  assert.ok((await flowDetail(revised.id)).internalArticle);
  assert.equal((await readerItem(f.id,now)).verification.label,"人工修订候选，经模型辅助核查与人工审核");
  await sql`UPDATE fishery_flow_tasks SET draft=jsonb_set(draft,'{provenance,candidateHash}',${sql.json("0".repeat(64))}) WHERE id=${revised.id}`;
  assert.equal((await flowDetail(revised.id)).internalArticle,null);
  await assert.rejects(decideFlow(revised.id,{decision:"qualified",snapshotHash:result.snapshotHash,note:"tampered hash"},"fixture-admin"),/candidate hash/);
  await assert.rejects(readerItem(f.id,now),/No current/);
  await sql`UPDATE fishery_flow_tasks SET draft=jsonb_set(draft,'{provenance,candidateHash}',${sql.json(result.draft.provenance.candidateHash)}) WHERE id=${revised.id}`;
  await decideFlow(revised.id,{decision:"rejected",snapshotHash:result.snapshotHash,note:"synthetic follow-up correction"},"fixture-admin");
  const nextContext=await revisionContext(revised.id);
  assert.deepEqual((nextContext.candidate as any).summaryZh[0].evidence,evidence);
  const next=await createHumanRevision(revised.id,{...request,identity:"revision-follow-up",candidate:{...wire,uncertainties:["合成修订记录"]}},"fixture-admin");
  assert.equal(next.draft.provenance.directParentTaskId,revised.id);assert.equal(next.draft.provenance.originalGenerationTaskId,original.id);
  assert.equal(next.draft.provenance.receiptId,received.receiptId);assert.equal(next.stage,"review");
  const uncertain=await paidRequest({service:"revision-local-mock",model:"mock",purpose:"fishery_quality_review",subject:next.id,identity:{next:next.id}},async()=>({response:{synthetic:"received at provider, receipt not durably settled"}}));
  await sql`UPDATE receipts SET status='pending' WHERE id=${uncertain.receiptId}`;
  await sql`UPDATE fishery_flow_tasks SET status='failed',stage_requests=${sql.json({'review:1':{subject:next.id,purpose:'fishery_quality_review'}})} WHERE id=${next.id}`;
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/pending\/unknown/);
  await sql`UPDATE fishery_flow_tasks SET status='rejected' WHERE id=${next.id}`;
  await observe(f.id,{...observationFixture,expectedRevision:2,title:"SYNTHETIC changed current observation",sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-revision/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/pending\/unknown/);
  await assert.rejects(revisionContext(original.id),/pending\/unknown/);
  await sql`UPDATE receipts SET status='unknown' WHERE id=${uncertain.receiptId}`;
  await assert.rejects(revisionContext(original.id),/pending\/unknown/);
  await sql`UPDATE receipts SET status='received' WHERE id=${uncertain.receiptId}`;
  await assert.rejects(createHumanRevision(original.id,request,"fixture-admin"),/snapshot/i);
  const fresh=await revisionContext(original.id);assert.deepEqual((fresh.candidate as any).summaryZh,[],"new observation never auto-migrates old IDs");
  const freshTask=await createHumanRevision(original.id,{...request,identity:"fresh-observation-revision",snapshotHash:fresh.snapshotHash,evidenceHash:fresh.evidenceCatalog.hash},"fixture-admin");
  assert.equal(freshTask.snapshot.observationRevision,3);assert.equal(freshTask.stage,"review");
});


test("a verified irrelevant recapture supersedes qualified evidence while 404 and timeout only record unavailability",async()=>{
  const url="https://yyj.moa.gov.cn/gzdt/202610/t20261020_99821.htm",newUrl=url.replace("99821","99822"),fact="远洋渔业公海履约管理措施已经公布。";
  const relevant=`<p>${fact}</p><p>本材料用于离线采集回归，全部请求由本地合成数据提供，第二段保留完整上下文供审核。</p>`,nearshore="近海养殖场开展池塘设备维护培训。参加人员学习饲料管理、车间清洁和水质监测。本地课程安排另行公布。";
  const capture=async(id:string,target:string,mode:"relevant"|"irrelevant"|"404"|"timeout")=>collectColumns({id,dataDir:config.dataDir,columns:["moa"],limit:1,wait:async()=>{},fetch:async request=>{
    if(request===target&&mode==="timeout") throw new Error("Synthetic acquisition timeout");
    const robots=request.endsWith("robots.txt"),listing=request===COLUMNS.moa.url;
    return {url:request,status:robots||request===target&&mode==="404"?404:200,headers:{get:()=>"text/html"},body:Buffer.from(robots?"missing":listing?`<ul class="sj_e_tonzhi_list"><li><a href="${target}">远洋渔业素材更新</a></li></ul>`:mode==="404"?"<h1>404</h1>":`<meta name="ArticleTitle" content="离线正文变更材料"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor">${mode==="relevant"?relevant:`<p>${nearshore}</p>`}</div></div>`)};
  }});
  const ready=await capture("recapture-current-ready",url,"relevant"),first=await importBatch(ready.id,"tester"),id=first.rows[0]!.id;
  const [source]=await sql`SELECT revision FROM fishery_sources WHERE source_id='fishery-column-moa'`;
  await approve(id,1,source!.revision);
  const date={date:{precision:"unknown",value:null},evidence:[]},evidence=["p1s1"];
  const invoke=async(options:any)=>({data:options.schema.parse(options.purpose==="fishery_draft"?{relevance:{decision:"relevant",reason:"Synthetic public-sea source evidence",evidence},summaryZh:[{sentence:fact,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",organizations:[],locations:[],uncertainties:[]}:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic source sentence",evidence},{field:"relevance",verdict:"supported",reason:"Synthetic relevance",evidence}]}),receiptId:999999,model:"mock",reused:false,usage:null});
  const task=await createFlow(id,{identity:"before-irrelevant-recapture"},"tester"),checked=await runFlow(task.id,invoke);
  assert.equal(checked.status,"needs_human_review");await decideFlow(task.id,{decision:"qualified",snapshotHash:checked.snapshotHash,note:"Synthetic original snapshot approved"},"reviewer");
  assert.equal((await readerItem(id)).id,id);
  const original=await documentHistory(id),oldCapture=original.observations[0]!.payload.sourceCapture,oldBody=await readCapturedText(config.dataDir,oldCapture.archiveId,oldCapture.bodySha256);
  for(const mode of ["404","timeout"] as const) {
    const unavailable=await capture(`recapture-current-${mode}`,url,mode);assert.equal(unavailable.items[0]!.state,"failed");
    await importBatch(unavailable.id,"tester");
    assert.equal((await documentHistory(id)).observations.length,1);assert.equal((await flowDetail(task.id)).stale,false);assert.equal((await readerItem(id)).id,id);
    const [audit]=await sql`SELECT after,reason FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${unavailable.id}`;
    assert.equal(audit!.after.outcome,"unavailable");assert.match(audit!.reason,/no confirmed source-body change/);
    if(mode==="timeout") assert.match(audit!.after.reason,/timeout/);
  }
  const recaptured=await capture("recapture-current-irrelevant",url,"irrelevant");assert.equal(recaptured.items[0]!.state,"irrelevant");
  const update=await importBatch(recaptured.id,"tester");
  assert.deepEqual(update.rows,[],"Irrelevant updates cannot seed processing tasks");
  const history=await documentHistory(id);assert.equal(history.observations.length,2);assert.equal(history.observations[1]!.revision,2);assert.equal(history.reviews.length,1);
  const latest=history.observations[1]!.payload;assert.match(latest.summaryZh,/未提供明确远洋/);assert.equal(await readCapturedText(config.dataDir,latest.sourceCapture.archiveId,latest.sourceCapture.bodySha256),nearshore);
  assert.equal(await readCapturedText(config.dataDir,oldCapture.archiveId,oldCapture.bodySha256),oldBody,"The previous source archive is retained");
  const stale=await flowDetail(task.id);assert.equal(stale.stale,true);assert.equal(stale.internalArticle,null);await assert.rejects(readerItem(id),/No current/);
  const [trace]=await sql`SELECT after FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${recaptured.id}`;
  assert.equal(trace!.after.outcome,"irrelevant");assert.equal(trace!.after.relevance.decision,"not_proven");
  await importBatch(recaptured.id,"tester");assert.equal((await documentHistory(id)).observations.length,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`fishery:${id}`} AND action='fishery.acquisition' AND after->>'batchId'=${recaptured.id}`)[0]!.n,1,"Reimporting the same archive does not fabricate another acquisition");
  const newIrrelevant=await capture("recapture-new-irrelevant",newUrl,"irrelevant");await importBatch(newIrrelevant.id,"tester");
  assert.equal((await sql`SELECT id FROM fishery_documents WHERE canonical_url=${newUrl}`).length,0,"A new irrelevant URL is not registered as a fishery material");
});

test("synthetic interrupted-before-request reconciliation is leased, fingerprinted, zero-call and preserves saved generation",async()=>{
  const boss=await getBoss({schedule:false,supervise:false});await boss.createQueue(flowQueue.name,flowQueue.options);
  const ledger={id:TRIAL.id,entries:[] as {id:number;state:string;reservedMicroCny:number}[],maxRequests:TRIAL.maxRequests,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny};
  const setLedger=async()=>sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json(ledger)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  await setLedger();
  const body="合成远洋渔业中断恢复测试原文。",evidence=["p1s1"],date={date:{precision:"unknown",value:null},evidence:[]};
  const wire={relevance:{decision:"relevant",reason:"Synthetic source",evidence},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
  async function task(identity:string) {
    const f=await fixture({unknownRights:true});
    await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-reconcile/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
    await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/reconcile-${f.id}`,title:"SYNTHETIC RECONCILIATION FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
    await approve(f.id,2,1);
    return createFlow(f.id,{identity},"fixture-admin");
  }
  const request=(state:any)=>({snapshotHash:state.snapshotHash,executionFingerprint:state.executionFingerprint,expectedStatus:"running",acknowledgeRunnerStopped:true,reason:"Synthetic operator verified all old runners stopped",...state.activeJobId?{cancelActiveJobId:state.activeJobId}:{}});
  const zero=await task("synthetic-zero-request");
  // Local fault injection: claim commits, the authorization callback stands in for a process that never reaches its stage request.
  await runFlow(zero.id,async()=>{throw new Error("No synthetic request is allowed");},async()=>{});
  let detail=await flowDetail(zero.id);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  const oldRunner=await acquireProcessingLease();
  try {await assert.rejects(reconcileFlow(zero.id,request(detail.reconciliation),"fixture-admin"),/lease unavailable/);}finally{await oldRunner.release();}
  assert.equal((await flowDetail(zero.id)).status,"running");
  const stale=request(detail.reconciliation);await sql`UPDATE fishery_flow_tasks SET review_attempt=2,updated_at=now() WHERE id=${zero.id}`;
  await assert.rejects(reconcileFlow(zero.id,stale,"fixture-admin"),/fingerprint changed/);
  detail=await flowDetail(zero.id);
  const receiptCount=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,ledgerBefore=(await sql`SELECT value FROM settings WHERE key=${authorizationKey}`)[0]!.value,reviewBefore=(await documentHistory(zero.document_id)).reviews;
  config.devAdmin=null;assert.equal((await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,payload:request(detail.reconciliation)})).statusCode,401);
  config.devAdmin={displayName:"Synthetic recovery operator"};
  try {
    assert.equal((await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,payload:request(detail.reconciliation)})).statusCode,403);
    const recovered=await app.inject({method:"POST",url:`/api/admin/fishery/flows/${zero.id}/reconcile`,headers:{"x-csrf-token":"dev"},payload:request(detail.reconciliation)});
    assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().modelCalls,0);assert.equal(recovered.json().status,"failed");
  }finally{config.devAdmin=null;}
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receiptCount);assert.deepEqual((await sql`SELECT value FROM settings WHERE key=${authorizationKey}`)[0]!.value,ledgerBefore);assert.deepEqual((await documentHistory(zero.document_id)).reviews,reviewBefore);
  await assert.rejects(reconcileFlow(zero.id,request(detail.reconciliation),"fixture-admin"),/fingerprint changed/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='fishery.flow.reconcile' AND after->>'id'=${zero.id}`)[0]!.n,1);
  await assert.rejects(retryFlow(zero.id,{note:"No hidden first call acknowledgement"},"fixture-admin"),/acknowledge new stage charges/);
  await retryFlow(zero.id,{note:"Explicitly accept future first-stage calls",acknowledgeNewCharge:true},"fixture-admin");
  await decideFlow(zero.id,{decision:"rejected",snapshotHash:detail.snapshotHash,note:"Synthetic cleanup, no business qualification"},"fixture-admin");

  const saved=await task("synthetic-generation-saved"),input={documentId:saved.document_id,observationRevision:2,body,bodySha256:sha256(body),language:"en"};let generationCalls=0,reviewCalls=0;
  const generationRequest=buildFisheryDraftRequest(input,"default"),subject=generationRequest.subject+`:snapshot:${hash(saved.snapshot)}:generation:1`,attemptTag=`fishery-flow:${hash(saved.snapshot)}:generation:1`;
  const draft=await prepareFisheryDraft(input,"default",async options=>{
    const response=await paidRequest({service:"reconcile-local-mock",model:"mock",purpose:options.purpose,subject,identity:{input:options.user},attemptTag},async()=>{generationCalls++;return {response:wire};});
    return {data:options.schema.parse(response.response),receiptId:response.receiptId,reused:response.reused,model:"mock",usage:null};
  });
  await completeReceipt(sql,draft.receiptId);ledger.entries=[{id:1,state:"received",reservedMicroCny:TRIAL.reserveMicroCny}];await setLedger();
  // Local DB fault fixture: the generation transaction is durable, but the process dies before recording its first review request.
  await sql`UPDATE fishery_flow_tasks SET status='running',stage='review',draft=${sql.json(draft)},stage_requests=${sql.json({'generation:1':{subject,purpose:'fishery_draft',attemptTag,promptVersion:generationRequest.promptVersion}})} WHERE id=${saved.id}`;
  const [originalReceipt]=await sql`SELECT * FROM receipts WHERE id=${draft.receiptId}`;
  detail=await flowDetail(saved.id);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));assert.equal(detail.reconciliation.reusableGenerationReceiptId,draft.receiptId);
  for(const state of ["pending","unknown","refused"]) {ledger.entries[0]!.state=state;await setLedger();const blocked=await flowDetail(saved.id);assert.equal(blocked.reconciliation.eligible,false);await assert.rejects(reconcileFlow(saved.id,request(blocked.reconciliation),"fixture-admin"),/pending\/unknown\/refused/);}
  ledger.entries[0]!.state="received";await setLedger();
  await sql`UPDATE receipts SET response=NULL WHERE id=${draft.receiptId}`;detail=await flowDetail(saved.id);await assert.rejects(reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin"),/response missing|Generation receipt/);
  await sql`UPDATE receipts SET response=${sql.json(wire)} WHERE id=${draft.receiptId}`;
  detail=await flowDetail(saved.id);await reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin");
  await assert.rejects(retryFlow(saved.id,{note:"Resume must not silently send the first review"},"fixture-admin"),/acknowledge new stage charges/);
  const resumed=await retryFlow(saved.id,{note:"Explicit first review charge acknowledgement",acknowledgeNewCharge:true},"fixture-admin");assert.equal(resumed.stage,"review");assert.equal(resumed.attempt,1);
  const invoke=async(options:any)=>{
    assert.equal(options.purpose,"fishery_quality_review");
    const received=await paidRequest({service:"reconcile-local-mock",model:"mock",purpose:options.purpose,subject:options.subject,identity:{user:options.user},attemptTag:options.attemptTag},async()=>{reviewCalls++;return {response:{decision:"supported",coverage:"complete_input",findings:JSON.parse(options.user).claims.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic review only",evidence:c.evidenceIds}))}};});
    return {data:options.schema.parse(received.response),receiptId:received.receiptId,reused:received.reused,model:"mock",usage:null};
  };
  assert.equal((await runFlow(saved.id,invoke)).status,"needs_human_review");assert.equal(generationCalls,1);assert.equal(reviewCalls,1);
  await assert.rejects(runFlow(saved.id,invoke),/not queued/);assert.equal(reviewCalls,1);assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${draft.receiptId}`)[0],originalReceipt);
  await sql`UPDATE fishery_flow_tasks SET status='running' WHERE id=${saved.id}`;
  detail=await flowDetail(saved.id);await assert.rejects(reconcileFlow(saved.id,request(detail.reconciliation),"fixture-admin"),/durable request|already has a receipt/);
  await retryFlow(saved.id,{note:"Original completed review receipt resumes without another charge"},"fixture-admin");assert.equal((await runFlow(saved.id,invoke)).status,"needs_human_review");assert.equal(reviewCalls,1);

  const intent=await task("synthetic-intent-no-receipt");await sql`UPDATE fishery_flow_tasks SET status='running',stage_requests=${sql.json({'generation:1':{subject:`fishery:${intent.document_id}:missing`,purpose:'fishery_draft'}})} WHERE id=${intent.id}`;
  detail=await flowDetail(intent.id);await assert.rejects(reconcileFlow(intent.id,request(detail.reconciliation),"fixture-admin"),/durable request|prior stage request/);
  await decideFlow(intent.id,{decision:"rejected",snapshotHash:detail.snapshotHash,note:"Cannot decide running task"},"fixture-admin").then(()=>assert.fail("running decision must reject"),error=>assert.match(error.message,/Running/));

  const duplicate=await task("synthetic-duplicate-jobs");await runFlow(duplicate.id,async()=>{throw new Error("No request");},async()=>{});
  const activeId=await boss.send(flowQueue.name,{id:duplicate.id});await boss.fetch(flowQueue.name);const queuedId=await boss.send(flowQueue.name,{id:duplicate.id});
  detail=await flowDetail(duplicate.id);assert.equal(detail.reconciliation.eligible,false);await assert.rejects(reconcileFlow(duplicate.id,request(detail.reconciliation),"fixture-admin"),/Queued\/retry|duplicate/);
  await boss.cancel(flowQueue.name,[activeId!,queuedId!]);
  const sole=await boss.send(flowQueue.name,{id:duplicate.id});await boss.fetch(flowQueue.name);detail=await flowDetail(duplicate.id);assert.equal(detail.reconciliation.activeJobId,sole);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  await assert.rejects(reconcileFlow(duplicate.id,{...request(detail.reconciliation),cancelActiveJobId:undefined},"fixture-admin"),/exact old active job/);
  await reconcileFlow(duplicate.id,request(detail.reconciliation),"fixture-admin");assert.equal((await boss.getJobById(flowQueue.name,sole!))?.state,"cancelled");
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='fishery.flow.reconcile.cancel_job' AND after->>'taskId'=${duplicate.id}`)[0]!.n,1);
  const oldSnapshot=await task("synthetic-stale-pre-request");await runFlow(oldSnapshot.id,async()=>{throw new Error("No request");},async()=>{});
  const history=await documentHistory(oldSnapshot.document_id);
  await observe(oldSnapshot.document_id,{...history.observations.find(o=>o.revision===2)!.payload,expectedRevision:2,title:"Synthetic current observation after interrupted old task"},"fixture-admin");await approve(oldSnapshot.document_id,3,1);
  detail=await flowDetail(oldSnapshot.id);assert.equal(detail.stale,true);assert.equal(detail.reconciliation.eligible,true,detail.reconciliation.reasons.join(";"));
  await reconcileFlow(oldSnapshot.id,request(detail.reconciliation),"fixture-admin");assert.equal((await flowDetail(oldSnapshot.id)).status,"failed");
  await assert.rejects(retryFlow(oldSnapshot.id,{note:"Never resume a stale task",acknowledgeNewCharge:true},"fixture-admin"),/changed|superseded/);
  await sql`DELETE FROM settings WHERE key=${authorizationKey}`;
});

test("synthetic old lease owner cannot claim after waiting for a document lock",async()=>{
  const f=await fixture({unknownRights:true}),body="合成远洋渔业租约领取故障测试。";
  await observe(f.id,{...observationFixture,expectedRevision:1,sourceCapture:{adapter:"iotc",sourceUrl:`https://example.org/${f.sourceId}`,capturedAt:"2026-10-20T00:00:00Z",httpStatus:200,rawSha256:observationFixture.rawSha256,bodySha256:sha256(body),parser:"synthetic-claim-lease/v1",parseStatus:"parsed",attachmentSha256:null,conflicts:[]}},"fixture-admin");
  await upsertMaterial({sourceId:f.sourceId,url:`https://example.org/claim-${f.id}`,title:"SYNTHETIC LEASE CLAIM FIXTURE",bodyText:body,bodyStatus:"ok",via:"fishery-mock",raw:{fisheryDocumentId:f.id}});
  const task=await createFlow(f.id,{identity:"synthetic-lease-claim"},"fixture-admin");
  const [before]=await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`,ledgerBefore=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`,receiptCount=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
  let releaseDocument!:()=>void,documentLocked!:()=>void;
  const gate=new Promise<void>(resolve=>{releaseDocument=resolve;}),locked=new Promise<void>(resolve=>{documentLocked=resolve;});
  const editing=sql.begin(async tx=>{await tx`SELECT id FROM fishery_documents WHERE id=${f.id} FOR UPDATE`;documentLocked();await gate;});await locked;
  const ownerA=await acquireProcessingLease();let ownerB:Awaited<ReturnType<typeof acquireProcessingLease>>|undefined,calls=0;
  try {
    const abandoned=ownerA.run(()=>runFlow(task.id,async()=>{calls++;throw new Error("Lost owner must not send");},undefined,{requireProcessingLease:true})).then(value=>({value,error:null}),error=>({value:null,error}));
    const until=Date.now()+5000;let waiting=false;
    while(Date.now()<until) {const [row]=await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM fishery_documents%'`;if(row!.n){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(waiting,true,"old production claim reached the held document lock");
    // Kill only this test's own retained lease session, never PostgreSQL or another application's session.
    await sql`SELECT pg_terminate_backend(${ownerA.backendPid})`;ownerB=await acquireProcessingLease();
    releaseDocument();await editing;
    const stopped=await abandoned;assert.ok(stopped.error);assert.match(stopped.error.message,/lease/);assert.equal(calls,0);
    assert.deepEqual((await sql`SELECT * FROM fishery_flow_tasks WHERE id=${task.id}`)[0],before);
    assert.deepEqual(await sql`SELECT value FROM settings WHERE key=${authorizationKey}`,ledgerBefore);assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receiptCount);
    await ownerB.assertHeld();
  }finally{releaseDocument();await editing;await ownerB?.release();await ownerA.release();}
});


test("explicit amount-only upgrade retains cumulative history and audits the original ledger",async()=>{
  const entries=Array.from({length:18},(_,i)=>({id:i+1,state:"received",wireBytes:100,reservedMicroCny:400_000,usage:{promptTokens:100,completionTokens:10,estimatedMicroCny:280}}));
  const old={id:TRIAL.id,maxRequests:20,maxReservedMicroCny:10_000_000,entries};
  await sql`INSERT INTO settings(key,value) VALUES (${authorizationKey},${sql.json(old)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  await assert.rejects(assertFisheryCapacity(),/explicit amount-only/);
  const result=await upgradeExistingTrialToAmountOnly("tester","User explicitly cancelled count cap; retain cumulative ten yuan");
  assert.equal(result.entryCount,18);assert.equal(result.spentMicroCny,5040);assert.equal(result.modelCalls,0);
  const [stored]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
  assert.deepEqual(stored!.value.entries,entries);assert.equal(stored!.value.maxRequests,null);
  await assertFisheryCapacity(2);
  const [record]=await sql`SELECT before,after FROM audit_log WHERE subject=${authorizationKey} AND action='fishery.authorization.amount_only' ORDER BY id DESC LIMIT 1`;
  assert.match(record!.before.ledgerHash,/^[a-f0-9]{64}$/);assert.equal(record!.after.previousLedgerHash,record!.before.ledgerHash);
  await assert.rejects(upgradeExistingTrialToAmountOnly("tester","repeat"),/upgrade refused/);
});

test("cumulative amount budget uses validated received usage and reserves every unresolved cost",()=>{
  const usage={promptTokens:100,completionTokens:10,estimatedMicroCny:280};
  const entries=Array.from({length:30},()=>({state:"received",reservedMicroCny:400_000,usage}));
  assert.doesNotThrow(()=>trialCapacity(entries,2));assert.equal(trialBudget(entries).occupiedMicroCny,8400);
  assert.equal(trialBudget([{state:"received",reservedMicroCny:400_000}]).occupiedMicroCny,400_000);
  for(const state of ["pending","unknown","refused"]) {
    assert.equal(trialBudget([{state,reservedMicroCny:400_000,usage}]).occupiedMicroCny,400_000);
    assert.throws(()=>trialCapacity([{state,reservedMicroCny:400_000,usage}]),/reconciliation/);
  }
  assert.throws(()=>trialCapacity(Array.from({length:25},()=>({state:"received",reservedMicroCny:400_000}))),/hard amount/);
  assert.throws(()=>trialBudget([{state:"received",reservedMicroCny:200,usage}]),/exceeds reservation/);
  assert.throws(()=>trialBudget([{state:"received",reservedMicroCny:400_000,usage:{...usage,promptTokens:0.5}}]),/usage/);
});
