import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareOfficial, sha256, type ArchiveReceipt } from "../backend/source-adapters.ts";
import { assertCaptureExportable } from "../backend/export.ts";
import { canExportSummary, dateSchema, effectiveState, linkSchema, observationSchema, sourceSchema } from "../contracts.ts";
import { observationFixture, sourceFixture, unknownDate } from "./fixtures.ts";
import { extractPdf } from "../backend/pdf-text.ts";
import { readFile, access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COLUMNS, discoverColumn, prepareColumnArticle, relevanceEvidence, titlePriority } from "../backend/official-columns.ts";
import { collectColumns, readBatch, readCapturedText, verifyBatchItem } from "../backend/column-batches.ts";
import { evidenceIdentity } from "../backend/store.ts";
import { buildFisheryDraftRequest, fisheryDraftSchema, prepareFisheryDraft, validateFisheryDraft, fisheryDraftWireSchema,parseFisheryManualRevision } from "../backend/ai-draft.ts";
import { TRIAL, installTrialTransport, trialCapacity, trialUsage } from "../backend/trial-transport.ts";
import {reviewFisheryDraft,buildFisheryReviewRequest,assertFisheryPairFits} from "../backend/ai-review.ts";
import {buildEvidenceCatalog,evidenceBinding,assertEvidenceBinding,assertSavedEvidenceArtifact} from "../backend/evidence.ts";
import { createHash } from "node:crypto";
import { discoverIotc, iotcAttachment, prepareIotc } from "../backend/iotc-columns.ts";

test("saved DeepSeek responses preserve strict evidence arrays and the accepted draft's source anchors",async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL("./fixtures/ai-trial-responses-20261020.json",import.meta.url),"utf8"));
  const input=(f:any)=>({documentId:`offline-receipt-${f.receiptId}`,observationRevision:1,body:f.body,bodySha256:f.bodySha256,language:"zh"});
  const [first,accepted]=fixtures,original=structuredClone(first.response);
  const failure=fisheryDraftSchema.safeParse(first.response);
  assert.equal(failure.success,false);
  if(!failure.success) assert.ok(failure.error.issues.some(i=>i.path.join(".")==="relevance.evidence"));
  // An explicit test-only format correction demonstrates the desired contract. Runtime never coerces.
  const corrected=structuredClone(first.response);
  function arrays(v:any) {if(!v||typeof v!=="object") return;for(const [key,value]of Object.entries(v)){if(key==="evidence") v[key]=value===null?[]:Array.isArray(value)?value:[value];else arrays(value);}}
  arrays(corrected);
  assert.throws(()=>validateFisheryDraft(input(first),corrected),/Actual fishing area/);
  assert.deepEqual(first.response,original,"Never rewrite the original model response");
  assert.throws(()=>validateFisheryDraft(input(accepted),accepted.response),/Ambiguous issuer/);
  assert.equal(accepted.response.dates.published.date.precision,"unknown");
});

test("saved partial event dates cannot become ISO dates or borrow the source publication date",async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL("./fixtures/ai-trial-responses-20261020.json",import.meta.url),"utf8"));
  const f=structuredClone(fixtures[2]);f.response.locations=[];const input={documentId:"offline-partial-date",observationRevision:1,body:f.body,bodySha256:f.bodySha256,language:"zh"};
  assert.equal(f.response.dates.event.date.value,"--05-16");
  assert.throws(()=>validateFisheryDraft(input,f.response),/Invalid ISO date/);
  for(const value of ["2026-05-16",f.sourcePublication.value]) {
    const invented=structuredClone(f.response);invented.dates.published={date:unknownDate,evidence:[]};invented.dates.event.date={precision:"day",value};
    assert.throws(()=>validateFisheryDraft(input,invented),/components are not explicit/);
  }
  const partial=structuredClone(f.response);partial.dates.published={date:unknownDate,evidence:[]};partial.dates.event.date=unknownDate;
  const result=validateFisheryDraft(input,partial);
  assert.deepEqual(result.dates.event.date,unknownDate);assert.equal(result.dates.event.evidence[0]!.quote,"5月16日");
  // This only passes structural/date gates; the saved location-role inferences still need human review.
  const body="会议于2026年5月16日在福州举行。",anchor={quote:body,paragraph:1,page:null};
  const complete={...partial,summaryZh:[],relevance:{decision:"unknown",reason:"Synthetic date test",evidence:[]},locations:[],dates:{...partial.dates,event:{date:{precision:"day",value:"2026-05-16"},evidence:[anchor]}}};
  const fullInput={...input,body,bodySha256:sha256(body)};
  assert.equal(validateFisheryDraft(fullInput,complete).dates.event.date.value,"2026-05-16");
  assert.throws(()=>validateFisheryDraft(fullInput,{...complete,dates:{...complete.dates,published:complete.dates.event}}),/Publication metadata/);
  for(const body of ["Meeting occurred on 16 May 2026.","会议记载2026-05-16T23:30:00Z。"]){
    const event={date:{precision:"day",value:"2026-05-16"},evidence:[{quote:body,paragraph:1,page:null}]};
    const dated={...complete,dates:{...complete.dates,event}},context={...input,body,bodySha256:sha256(body)};
    assert.doesNotThrow(()=>validateFisheryDraft(context,dated));
    assert.throws(()=>validateFisheryDraft(context,{...dated,dates:{...dated.dates,event:{...event,date:{precision:"day",value:"2026-05-17"}}}}),/components are not explicit/);
  }
});

test("trial counts actual sends, refuses overrides and redirects, and stops after twenty cumulative reservations",async()=>{
  const entries:{state:string;reservedMicroCny:number}[]=[],wire={model:TRIAL.model,messages:[{role:"system",content:"JSON only"},{role:"user",content:"Synthetic public article"}],max_tokens:2048,thinking:{type:"disabled"},response_format:{type:"json_object"},temperature:0};
  const options={method:"POST",body:JSON.stringify(wire)};let sends=0;
  const restore=installTrialTransport({reserve:async()=>{trialCapacity(entries);entries.push({state:"pending",reservedMicroCny:TRIAL.reserveMicroCny});return entries.length;},settle:async(id,state)=>{entries[id-1]!.state=state;}},async(_url,opts)=>{
    sends++;assert.equal(opts?.redirect,"error");return new Response(JSON.stringify({usage:{prompt_tokens:1000,completion_tokens:100}}),{status:200});
  });
  try {
    await assert.rejects(fetch("https://example.org/chat/completions",options),/destination/);
    for(const override of [{max_tokens:9000},{tools:[]},{model:"different"},{n:2},{thinking:{type:"enabled"}},{messages:[{role:"user",content:"x"}]}]) await assert.rejects(fetch(TRIAL.endpoint,{method:"POST",body:JSON.stringify({...wire,...override})}));
    assert.equal(sends,0);
    for(let i=0;i<TRIAL.maxRequests;i++) await fetch(TRIAL.endpoint,options);
    await assert.rejects(fetch(TRIAL.endpoint,options),/hard request/);assert.equal(sends,20);assert.equal(entries.length*TRIAL.reserveMicroCny,8_000_000);
    assert.throws(()=>trialCapacity([{state:"unknown",reservedMicroCny:400000}]),/manual reconciliation/);
    assert.throws(()=>trialUsage(null),/usage missing/);assert.throws(()=>trialUsage({prompt_tokens:100001,completion_tokens:1}));
    assert.equal(trialUsage({prompt_tokens:100000,completion_tokens:2048}).estimatedMicroCny,216384);
  } finally {restore();}
});

const columnUrl = "https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/202605/t20260519_7149775.htm";
function columnHtml(body="明确推进远洋渔业和南极磷虾产业合规发展。".repeat(4),date="2026-05-20 08:29") {
  return Buffer.from(`<meta name="ArticleTitle" content="合成远洋渔业材料"><meta name="PubDate" content="${date}"><h1>合成远洋渔业材料</h1><div id="detailCont"><div class="TRS_Editor"><html><body><p>${body}</p></body></html></div><p>第二个正文块：公海作业合规证据。</p><script>NEVER_EXECUTE</script></div><aside>无关推荐</aside>`);
}
const columnReceipt=(body:Buffer,url=columnUrl,status=200)=>({requestedUrl:url,finalUrl:url,status,finishedAt:"2026-10-20T00:00:00Z",sha256:sha256(body)});

test("official discovery reads present column identities and excludes domestic contract performance",()=>{
  const html=`<ul class="xw-list-1 gl_list"><li><a href="${columnUrl}">远洋渔业新材料</a><span>2026-05-19</span></li><li><a href="${columnUrl.replace("7149775","9999999")}">近海养殖合同履约</a></li><li><a href="https://example.org/t20260519_1.htm">公海</a></li><li><a href="${columnUrl}">重复</a></li></ul>`;
  const result=discoverColumn("fujian",html);
  assert.equal(result.listed,2);assert.equal(result.rejected,1);assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0]!.url,columnUrl);assert.equal(result.candidates[0]!.listDate,"2026-05-19");
  assert.equal(titlePriority("近海养殖合同履约"),null);
  const long="中性背景文字".repeat(150)+"公海渔业治理证据";
  assert.ok(relevanceEvidence(long)[0]!.includes("公海渔业治理证据"));
});

test("official metadata outranks URL dates; nested blocks survive and missing dates remain unknown",()=>{
  const raw=columnHtml(),result=prepareColumnArticle("fujian",columnReceipt(raw),raw,"archive_replay");
  assert.equal(result.readyForReview,true);assert.equal(result.dates.published.value,"2026-05-20");
  assert.equal(result.sourceCapture.publishedAt,"2026-05-20T00:29:00.000Z");assert.equal(result.dates.event.value,null);
  assert.match(result.body!,/第二个正文块/);assert.doesNotMatch(result.body!,/NEVER_EXECUTE|无关推荐/);
  assert.equal(result.sourceCapture.acquisitionMode,"archive_replay");
  for(const date of ["","2026-02-30 08:29"]) {
    const bytes=columnHtml(undefined,date),r=prepareColumnArticle("fujian",columnReceipt(bytes),bytes);
    assert.equal(r.dates.published.value,null);
    if(date) assert.equal(r.readyForReview,false);
  }
  for(const [bytes,receipt] of [[raw,columnReceipt(raw,columnUrl,404)],[raw,{...columnReceipt(raw),sha256:"0".repeat(64)}],[raw,columnReceipt(raw,"https://hyyyj.fujian.gov.cn/other/t20260519_1.htm")],[Buffer.from([0xff]),columnReceipt(Buffer.from([0xff]))]] as const) {
    assert.equal(prepareColumnArticle("fujian",receipt,bytes).readyForReview,false);
  }
  const empty=Buffer.from('<meta name="ArticleTitle" content="标题"><div id="detailCont"></div>');
  assert.equal(prepareColumnArticle("fujian",columnReceipt(empty),empty).readyForReview,false);
});

test("manual batches archive current-list responses, expose failures and verify bound body hashes",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-batch-test-"));
  const badUrl=columnUrl.replace("7149775","7149776"), raw=columnHtml(), called:string[]=[];
  const fetch=async(url:string)=>{
    called.push(url);if(url===badUrl) throw new Error("Synthetic upstream timeout");
    const body=url.endsWith("robots.txt")?Buffer.from("not found"):url===COLUMNS.fujian.url?Buffer.from(`<ul class="xw-list-1 gl_list"><li><a href="${badUrl}">公海超时样例</a></li><li><a href="${columnUrl}">南极磷虾</a></li></ul>`):raw;
    return {url,status:url.endsWith("robots.txt")?404:200,body,headers:{get:()=>"text/html"}};
  };
  try {
    const b=await collectColumns({id:"synthetic-1",dataDir,columns:["fujian"],limit:1,fetch,wait:async()=>{}});
    assert.equal(b.sources[0]!.listed,2);assert.deepEqual(b.items.map(i=>i.state),["failed","ready"]);
    assert.match(b.items[0]!.error!,/timeout/);assert.equal(b.status,"complete");
    const stored=await readBatch(dataDir,b.id);const item=stored.items[1]!;
    assert.equal((await verifyBatchItem(dataDir,stored,item)).readyForReview,true);
    assert.equal(await readCapturedText(dataDir,item.archiveId,item.prepared!.sourceCapture.bodySha256!),prepareColumnArticle("fujian",columnReceipt(raw),raw).body);
    await writeFile(path.join(dataDir,"fishery-batches",b.id,"body",`${item.archiveId}.txt`),"tampered");
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/hash mismatch/);
    await assert.rejects(collectColumns({id:b.id,dataDir,columns:["fujian"],limit:1,fetch,wait:async()=>{}}),/EEXIST/);
    await assert.rejects(readBatch(dataDir,"../escape"));
    const denied=await collectColumns({id:"synthetic-2",dataDir,columns:["fujian"],limit:1,fetch:async url=>({url,status:403,body:Buffer.from("denied"),headers:{get:()=>null}}),wait:async()=>{}});
    assert.equal(denied.items.length,0);assert.match(denied.sources[0]!.error!,/policy inspection/);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("capture time and archive relocation do not change evidence, but latest-body changes do",()=>{
  const raw=columnHtml(),r=prepareColumnArticle("fujian",columnReceipt(raw),raw);
  const a={...observationFixture,rawSha256:r.sourceCapture.rawSha256,sourceCapture:r.sourceCapture};
  const first=evidenceIdentity(a);
  assert.equal(evidenceIdentity({...a,sourceCapture:{...r.sourceCapture,capturedAt:"2026-10-21T00:00:00Z",archiveId:"later_1234"}}),first);
  const b={...a,sourceCapture:{...r.sourceCapture,bodySha256:"b".repeat(64)}};
  assert.notEqual(evidenceIdentity(b),first);
  assert.notEqual(evidenceIdentity(a),evidenceIdentity(b));
});

test("fishery AI mock yields only version-bound drafts; false anchors and Pending-as-effective fail",async()=>{
  const body="Resolution status: Pending. Objection deadline is 18 November 2026.\nIndian Ocean meeting; vessels departed Xiamen port.", input={documentId:"synthetic",observationRevision:2,body,bodySha256:sha256(body),language:"en"};
  const anchor={quote:"Resolution status: Pending.",paragraph:1,page:null};
  const unknown={date:unknownDate,evidence:[]};
  const output={relevance:{decision:"unknown",reason:"Needs original review",evidence:[]},summaryZh:[{sentence:"该决议仍待生效。",evidence:[anchor]}],dates:{published:unknown,event:unknown,adopted:unknown,effective:unknown,objectionDeadline:unknown},entryIntoForce:{value:"pending",evidence:[anchor]},locations:[],uncertainties:["No vessel registration evidence"]};
  const result=await prepareFisheryDraft(input,"mock",async options=>{assert.equal(options.purpose,"fishery_draft");return {data:fisheryDraftSchema.parse(output),receiptId:123,reused:false,model:"mock",usage:null};});
  assert.equal(result.status,"needs_review");assert.equal(result.observationRevision,2);assert.equal(result.bodySha256,input.bodySha256);
  assert.throws(()=>validateFisheryDraft(input,{...output,summaryZh:[{sentence:"False",evidence:[{...anchor,quote:"In force"}]}]}),/continuous/);
  assert.throws(()=>validateFisheryDraft(input,{...output,entryIntoForce:{value:"pending",evidence:[{...anchor,page:4}]}}),/page anchor/);
  assert.throws(()=>validateFisheryDraft(input,{...output,dates:{...output.dates,effective:{date:{precision:"day",value:"2026-11-18"},evidence:[anchor]}}}),/Pending/);
  assert.throws(()=>buildFisheryDraftRequest({...input,body:body+" changed"},"mock"),/changed source body/);
});

test("date precision never supplies missing days, times or legal applicability", () => {
  assert.deepEqual(dateSchema.parse(unknownDate), unknownDate);
  const month = dateSchema.parse({ precision: "month", value: "2026-10" });
  assert.equal(month.value, "2026-10");
  assert.equal(effectiveState(month, "2026-10-20"), "unknown");
  assert.equal(effectiveState(month, "2026-09-20"), "future");
  assert.equal(effectiveState(unknownDate, "2026-10-20"), "unknown");
  assert.equal(effectiveState({ precision: "day", value: "2028-01-01" }, "2026-10-20"), "future");
  assert.equal(effectiveState({ precision: "day", value: "2026-10-20" }, "2026-10-20"), "reached");
  for (const value of ["2026-02-30", "2026-13-01", "2026-04-17T00:00:00Z"])
    assert.equal(dateSchema.safeParse({ precision: "day", value }).success, false);
});

test("unknown rights fail closed, and expired or future rights cannot authorize an export", () => {
  const unknown = sourceSchema.parse({ expectedRevision: 0 });
  assert.equal(unknown.allowedFulltextExport, false);
  assert.equal(canExportSummary(unknown, Date.parse("2026-10-20")), false);
  assert.equal(sourceSchema.safeParse({ expectedRevision: 0, allowedSummary: true }).success, false);
  assert.equal(sourceSchema.safeParse({ ...sourceFixture, evidenceUrl: null }).success, false);
  const allowed = sourceSchema.parse(sourceFixture);
  assert.equal(canExportSummary(allowed, Date.parse("2026-10-20")), true);
  assert.equal(canExportSummary({ ...allowed, reviewDueAt: "2026-10-20T00:00:00Z" }, Date.parse("2026-10-20")), false);
  assert.equal(canExportSummary({ ...allowed, rightsCheckedAt: "2026-10-21T00:00:00Z" }, Date.parse("2026-10-20")), false);
});

test("observation contracts refuse raw bodies and ambiguous empty scopes", () => {
  assert.equal(observationSchema.safeParse(observationFixture).success, true);
  for (const extra of [{ fulltext: "forbidden" }, { body: "forbidden" }, { translation: "forbidden" }])
    assert.equal(observationSchema.safeParse({ ...observationFixture, ...extra }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, scope: { ...observationFixture.scope, unknownFields: [] } }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, rawSha256: "not-a-hash" }).success, false);
});

test("metadata links cannot carry credentials, query secrets or private literal destinations", () => {
  for (const url of ["http://example.org/policy", "https://user:secret@example.org/", "https://example.org/?token=secret", "https://127.0.0.1/policy", "https://[::1]/", "https://localhost/policy", "https://secret.internal/policy", "file:///tmp/policy"])
    assert.equal(linkSchema.safeParse(url).success, false, url);
  assert.equal(linkSchema.safeParse("https://example.org/policy.pdf").success, true);
});

// These are synthetic structures, not copies of third-party articles or PDFs.
const jjUrl = "https://www.jinjiang.gov.cn/xxgk/jjyw/202603/t20260321_fixture.htm";
const ioUrl = "https://iotc.org/cmm/fixture-measure";
const pdfUrl = "https://iotc.org/sites/default/files/fixture.pdf";
const paragraph = "合成企业报道，仅用于离线提取测试。船队从厦门出发，不据港口反推企业归属。".repeat(12);
const jjHtml = (time = "2026-03-21 19:36", meta = "2026-03-21", body = paragraph) => Buffer.from(`<html><head><title>合成测试</title><meta name="ArticleTitle" content="合成船队报道"><meta name="PubDate" content="${meta}"></head><body><article><h1>合成船队报道</h1><span class="article_time">${time}</span><div class="TRS_Editor"><p>${body}</p></div></article></body></html>`);
const ioHtml = (status = "Pending", deadline = "18 November 2026") => Buffer.from(`<html><body><h1>Synthetic Resolution 26/01</h1><div id="content"><div class="node-cmm"><a href="${pdfUrl}">PDF</a><div class="field-name-field-cmm-status">${status}</div><div class="field-name-field-cmm-remarks">Entry into force pending extended objection deadline on ${deadline}. Does not apply to India and Somalia.</div><div class="field-name-field-cmm-adoption-date"><span class="date-display-single" content="2026-01-01T00:00:00+04:00">2026</span></div></div></div></body></html>`);
const receipt = (raw: Buffer, url = jjUrl, status = 200): ArchiveReceipt => ({ requestedUrl: url, finalUrl: url, status, finishedAt: "2026-10-20T05:00:00Z", sha256: sha256(raw) });
const syntheticPdf = () => {
  const bytes = Buffer.from("%PDF- synthetic fixture bytes, not an actual third-party PDF");
  return { bytes, receipt: receipt(bytes, pdfUrl), parsed: { status: "parsed" as const, rawSha256: sha256(bytes), parser: "synthetic test parser", text: "RESOLUTION 26/01. Entry into force pending extended objection deadline on 18 November 2026. The total allowable catch is a synthetic amount in 2027 and 2028.", pages: 2 } };
};

test("Jinjiang reads visible source time at +08:00 and leaves the body geography untouched", () => {
  const raw = jjHtml(), result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(result.readyForReview, true);
  assert.equal(result.reviewState, "awaiting_human_review");
  assert.equal(result.sourceCapture.publishedAt, "2026-03-21T11:36:00.000Z");
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.ok(result.body?.includes("从厦门出发"));
  assert.equal("approved" in result, false);
});

test("live receipts and archive replay are labelled separately without upgrading a 404 to article text", () => {
  const raw = jjHtml();
  const archived = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(archived.sourceCapture.acquisitionMode, "archive_replay");
  assert.ok(archived.warnings.some(w => w.includes("no new network acquisition")));
  const live = prepareOfficial("jinjiang", receipt(raw), raw, undefined, "live_capture");
  assert.equal(live.sourceCapture.acquisitionMode, "live_capture");
  assert.ok(live.warnings.some(w => w.includes("Live HTTP acquisition receipt")));
  assert.equal(live.warnings.some(w => /Offline archive/i.test(w)), false);
  const missing = Buffer.from("404 error response");
  const failed = prepareOfficial("fuzhou", receipt(missing, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), missing, undefined, "live_capture");
  assert.equal(failed.sourceCapture.acquisitionMode, "live_capture");
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.readyForReview, false); assert.equal(failed.body, null);
});

test("missing source dates remain unknown despite a dated URL; day-only metadata stays day-only", () => {
  let raw = jjHtml("", "");
  let result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, unknownDate);
  assert.equal(result.sourceCapture.publishedAt, null);
  raw = jjHtml("", "2026-03-21"); result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.equal(result.sourceCapture.publishedAt, null);
});

test("conflicting or invalid publication fields block a prepared body", () => {
  for (const raw of [jjHtml("2026-03-22 19:36"), jjHtml("2026-02-30 19:36")]) {
    const result = prepareOfficial("jinjiang", receipt(raw), raw);
    assert.equal(result.readyForReview, false); assert.equal(result.body, null);
    assert.ok(result.sourceCapture.conflicts.length > 0);
    assert.deepEqual(result.dates.published, unknownDate);
  }
});

test("404, missing body, wrong host and hash mismatch never become article material", () => {
  const raw = Buffer.from("<title>404 missing</title>cached snippets must not be used");
  const failed = prepareOfficial("fuzhou", receipt(raw, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), raw);
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.sourceCapture.parseStatus, "failed");
  assert.equal(failed.body, null); assert.equal(failed.readyForReview, false);
  const empty = jjHtml("2026-03-21 19:36", "2026-03-21", "");
  assert.equal(prepareOfficial("jinjiang", receipt(empty), empty).readyForReview, false);
  const good = jjHtml();
  assert.equal(prepareOfficial("jinjiang", { ...receipt(good), sha256: "0".repeat(64) }, good).readyForReview, false);
  assert.equal(prepareOfficial("jinjiang", receipt(good, "https://example.org/"), good).readyForReview, false);
});

test("IOTC Pending keeps objection deadline separate and 2027–2028 provisions out of 2026", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  assert.equal(result.readyForReview, true);
  assert.deepEqual(result.dates.adopted, { precision: "year", value: "2026" });
  assert.deepEqual(result.dates.published, unknownDate);
  assert.deepEqual(result.dates.effectiveFrom, unknownDate);
  assert.equal(result.policyContext?.entryIntoForce, "pending");
  assert.deepEqual(result.policyContext?.objectionDeadline, { precision: "day", value: "2026-11-18" });
  assert.deepEqual(result.policyContext?.provisionYears, [2027, 2028]);
  assert.deepEqual(result.policyContext?.nonApplicationMentioned, ["India", "Somalia"]);
  assert.equal(result.sourceCapture.attachmentHttpStatus, 200);
  assert.equal(result.sourceCapture.attachmentSha256, sha256(syntheticPdf().bytes));
  assert.equal(effectiveState(result.dates.adopted, "2026-10-20"), "unknown");
});

test("IOTC missing/failed/unverified PDF and conflicting status or deadline stay blocked", () => {
  const raw = ioHtml();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw).readyForReview, false);
  for (const status of ["failed", "unverified", "missing"] as const) {
    const pdf = syntheticPdf();
    assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, status } }).readyForReview, false);
  }
  const conflict = ioHtml("In force");
  assert.equal(prepareOfficial("iotc", receipt(conflict, ioUrl), conflict, syntheticPdf()).readyForReview, false);
  const otherDeadline = ioHtml("Pending", "19 November 2026");
  assert.equal(prepareOfficial("iotc", receipt(otherDeadline, ioUrl), otherDeadline, syntheticPdf()).readyForReview, false);
  const pdf = syntheticPdf();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, text: pdf.parsed.text.replace("26/01", "26/02") } }).readyForReview, false);
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, receipt: { ...pdf.receipt, status: 404 } }).sourceCapture.attachmentHttpStatus, 404);
  // A parser claiming success must not turn empty bytes or an HTML error page into a verified PDF.
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>Upstream error pretending to be a PDF</html>")]) {
    const failed = prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, bytes, receipt: receipt(bytes, pdfUrl), parsed: { ...pdf.parsed, rawSha256: sha256(bytes) } });
    assert.equal(failed.readyForReview, false);
    assert.equal(failed.body, null);
    assert.equal(failed.sourceCapture.parseStatus, "failed");
  }
});

function iotcList(rows: Array<[string, string, string, string]> = [[ioUrl, "26/01", "Pending", "2026"]]) {
  return Buffer.from(`<table class="views-table"><tbody>${rows.map(([url, number, status, year]) => `<tr><td class="views-field-title-1"><a href="${url}">Resolution ${number} Synthetic measure</a></td><td class="views-field-nothing"><b>${status.replaceAll("&", "&amp;")} </b><br>Supersedes: <a href="/cmm/resolution-1601-synthetic-old">Resolution 16/01</a></td><td class="views-field-field-cmm-adoption-date"><span class="date-display-single" content="${year}-01-01T00:00:00+04:00">${year}</span></td></tr>`).join("")}</tbody></table>`);
}

test("IOTC current-list discovery keeps list order, deduplicates URLs and reads current identities", () => {
  const active = "https://iotc.org/cmm/resolution-2803-synthetic", pending = "https://iotc.org/cmm/resolution-2801-synthetic";
  const html = iotcList([[active,"28/03","Active & supersedes","2028"],[active,"28/03","Active & supersedes","2028"],[pending,"28/01","Pending","2028"],["https://example.org/cmm/resolution-2804-no","28/04","Active","2028"],["https://iotc.org/cmm/resolution-2501-old","25/01","Superseded","2025"]]);
  const result = discoverIotc(html.toString());
  assert.equal(result.listed,3); assert.equal(result.rejected,1);
  assert.deepEqual(result.candidates.map(c => [c.url,c.number,c.status,c.adoptionYear]),[[active,"28/03","Active & supersedes","2028"],[pending,"28/01","Pending","2028"]]);
  assert.deepEqual(discoverColumn("iotc",html.toString()),result);
  const candidate = discoverIotc(iotcList().toString()).candidates[0]!;
  const raw = ioHtml(), good = prepareIotc(candidate,receipt(raw,ioUrl),raw,syntheticPdf());
  assert.equal(good.readyForReview,true); assert.equal(good.policyContext?.entryIntoForce,"pending");
  for (const mismatch of [{number:"26/02"},{status:"Active"},{adoptionYear:"2025"},{url:active}]) {
    const result = prepareIotc({...candidate,...mismatch},receipt(raw,ioUrl),raw,syntheticPdf());
    assert.equal(result.readyForReview,false); assert.equal(result.body,null); assert.equal(result.sourceCapture.bodySha256,null);
  }
  assert.equal(iotcAttachment(raw,ioUrl),pdfUrl);
  assert.throws(() => iotcAttachment(Buffer.from(raw.toString().replace(pdfUrl,"https://example.org/document.pdf")),ioUrl),/same-origin PDF/);
});

test("IOTC batch captures a selected current Active measure and verifies original listing/PDF/body", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(),"fishery-iotc-test-"));
  // Public inspected robots policy fixture; every article, listing and PDF in this test is synthetic.
  const robots = await readFile(new URL("./fixtures/iotc-robots.txt",import.meta.url));
  const activeUrl = "https://iotc.org/cmm/resolution-2603-synthetic", list = iotcList([[ioUrl,"26/01","Pending","2026"],[activeUrl,"26/03","Active & supersedes","2026"]]);
  const html = Buffer.from(ioHtml("Active &amp; supersedes").toString().replace("26/01","26/03").replace(/Entry into force pending[^<]+/,"Synthetic active metadata; applicability unknown."));
  const pdf = pdfFixture(false,false,"RESOLUTION 26/03. Synthetic current fishery measure."), calls: string[] = [], waits: number[] = [];
  const fetch = async (url:string) => {
    calls.push(url);
    const body = url.endsWith("robots.txt") ? robots : url === COLUMNS.iotc.url ? list : url === activeUrl ? html : url === pdfUrl ? pdf : Buffer.from("not found");
    return {url,status:200,body,headers:{get:()=>url.endsWith(".pdf") ? "application/pdf" : "text/html"}};
  };
  try {
    const batch = await collectColumns({id:"iotc-current",dataDir,columns:["iotc"],limit:1,iotcSelect:["26/03"],fetch,wait:async ms=>{waits.push(ms);}});
    assert.equal(batch.sources[0]!.error,null); assert.equal(batch.items.length,1);
    const item = batch.items[0]!; assert.equal(item.state,"ready",item.error ?? "Expected full measure");
    assert.deepEqual(calls,["https://iotc.org/robots.txt",COLUMNS.iotc.url,activeUrl,pdfUrl]); assert.deepEqual(waits,[10000,10000,10000]);
    const stored = await readBatch(dataDir,batch.id), verified = await verifyBatchItem(dataDir,stored,stored.items[0]!);
    assert.equal(verified.readyForReview,true); assert.equal(verified.sourceCapture.attachmentPages,1);
    assert.equal(verified.sourceCapture.attachmentSha256,sha256(pdf)); assert.match(verified.body!,/--- Page 1 ---/);
    assert.ok("policyContext" in verified); if (!("policyContext" in verified)) throw new Error("Missing policy context");
    assert.equal(verified.policyContext?.entryIntoForce,"unknown"); assert.deepEqual(verified.dates.effectiveFrom,unknownDate);
    assert.equal(verified.evidence.find(e=>e.url===COLUMNS.iotc.url)?.sha256,sha256(list));
    observationSchema.parse({...observationFixture,rawSha256:verified.sourceCapture.rawSha256,dates:verified.dates,sourceCapture:verified.sourceCapture,policyContext:verified.policyContext,evidence:verified.evidence});
    const root = path.join(dataDir,"fishery-batches",batch.id);
    await writeFile(path.join(root,"raw","iotc-list.bin"),iotcList());
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/raw hash mismatch/);
    await writeFile(path.join(root,"raw","iotc-list.bin"),list);
    await writeFile(path.join(root,"raw",`${item.archiveId}-pdf.bin`),Buffer.from("tampered"));
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/raw hash mismatch/);
    calls.length=0; waits.length=0;
    const missing = await collectColumns({id:"iotc-selection-missing",dataDir,columns:["iotc"],limit:1,iotcSelect:["29/01"],fetch,wait:async ms=>{waits.push(ms);}});
    assert.equal(missing.items.length,0); assert.match(missing.sources[0]!.error!,/absent from current listing/);
    assert.deepEqual(calls,["https://iotc.org/robots.txt",COLUMNS.iotc.url]);
    calls.length=0;
    const changed = await collectColumns({id:"iotc-policy-changed",dataDir,columns:["iotc"],limit:1,fetch:async url=>{calls.push(url);return {url,status:200,body:Buffer.from("User-agent: *\nCrawl-delay: 10\n"),headers:{get:()=>"text/plain"}};},wait:async()=>{throw new Error("Must stop before another request");}});
    assert.equal(changed.items.length,0); assert.match(changed.sources[0]!.error!,/policy inspection/); assert.deepEqual(calls,["https://iotc.org/robots.txt"]);
  } finally { await rm(dataDir,{recursive:true,force:true}); }
});

test("observation and export gates refuse pending-as-effective or failed capture, even after approval", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  const input = { ...observationFixture, rawSha256: sha256(raw), dates: result.dates, sourceCapture: result.sourceCapture, policyContext: result.policyContext! };
  const parsed = observationSchema.parse(input);
  assertCaptureExportable(parsed);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, attachmentHttpStatus: 404 }, { ...parsed.sourceCapture!, attachmentSha256: null }, { ...parsed.sourceCapture!, attachmentPages: null }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevents export/);
  assert.equal(observationSchema.safeParse({ ...input, dates: { ...input.dates, effectiveFrom: { precision: "day", value: "2026-11-18" } } }).success, false);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, httpStatus: 404 }, { ...parsed.sourceCapture!, parseStatus: "unverified" as const }, { ...parsed.sourceCapture!, bodySha256: null }, { ...parsed.sourceCapture!, conflicts: ["fields disagree"] }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevent export/);
  assert.equal(canExportSummary(sourceSchema.parse({ expectedRevision: 0 }), Date.now()), false);
  assert.deepEqual(dateSchema.parse({ precision: "year", value: "2026" }), { precision: "year", value: "2026" });
});

// Generated PDF 1.4 fixtures: no third-party documents or persisted passwords.
function pdfFixture(blank = false, encrypted = false, text = "Synthetic fishery evidence"): Buffer {
  const md5 = (b: Buffer) => createHash("md5").update(b).digest();
  const rc4 = (key: Buffer, input: Buffer) => {
    const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; }
    let i = 0; j = 0;
    return Buffer.from(input.map(v => { i = (i + 1) % 256; j = (j + s[i]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; return v ^ s[(s[i]! + s[j]!) % 256]!; }));
  };
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (s: string) => Buffer.concat([Buffer.from(s), padding]).subarray(0, 32);
  const id = md5(Buffer.from("synthetic-fishery-test")), p = Buffer.alloc(4); p.writeInt32LE(-4);
  const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad("fixture-user"));
  const key = md5(Buffer.concat([pad("fixture-user"), owner, p, id])).subarray(0, 5);
  let content = Buffer.from(blank ? "" : `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`);
  if (encrypted) content = rc4(md5(Buffer.concat([key, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10), content);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [4 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
  ];
  if (encrypted) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`));
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets = [0]; let size = chunks[0]!.length;
  objects.forEach((body, i) => { offsets.push(size); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 6 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>]` : ""} >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test("PDF commands read a private snapshot and retain byte hash and page evidence", async () => {
  const original = pdfFixture(); const expected = Buffer.from(original); let snapshot = "";
  const parsed = await extractPdf(original, { platform: "linux", execute: async (program, args, options) => {
    assert.ok(options.timeout > 0 && options.timeout <= 60_000); assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
    snapshot = args.find(a => a.endsWith("original.pdf"))!;
    original.fill(0); assert.deepEqual(await readFile(snapshot), expected);
    return { stdout: program === "pdfinfo" ? "Pages: 2\nEncrypted: no\n" : "Verified synthetic page\n", stderr: "" };
  } });
  assert.equal(parsed.status, "parsed"); assert.equal(parsed.rawSha256, sha256(expected)); assert.equal(parsed.pages, 2);
  assert.match(parsed.text, /--- Page 2 ---/); assert.match(parsed.parser, /Poppler 25.03.0/);
  await assert.rejects(access(snapshot));
});

test("PDF missing tools, blank pages, diagnostics, encryption, page and output limits block text", async () => {
  const raw = pdfFixture();
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(result.status, code === "ENOENT" ? "unverified" : "failed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const scenario of ["blank", "encrypted", "pages", "diagnostic", "output", "aggregate"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async (program, args) => {
      if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
      if (program === "pdfinfo") return { stdout: `Pages: ${scenario === "pages" ? 201 : 2}\nEncrypted: ${scenario === "encrypted" ? "yes" : "no"}\n`, stderr: "" };
      return { stdout: scenario === "blank" ? " \n" : scenario === "output" ? "x".repeat(4 * 1024 * 1024 + 1) : scenario === "aggregate" ? "x".repeat(2200000) : "Text", stderr: scenario === "diagnostic" ? "Syntax Warning" : "" };
    } });
    assert.equal(result.status, scenario === "blank" ? "unverified" : "failed", scenario); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>404</html>"), Buffer.alloc(10 * 1024 * 1024 + 1)])
    assert.equal((await extractPdf(bytes)).status, "failed");
});

test("installed PDF parser accepts generated text and blocks blank, encrypted and corrupt PDFs", { skip: !["linux", "darwin"].includes(process.platform) }, async () => {
  const positive = await extractPdf(pdfFixture());
  assert.equal(positive.status, "parsed", positive.error ?? "Expected parsed PDF"); assert.equal(positive.pages, 1);
  assert.match(positive.text, /Synthetic fishery evidence/);
  for (const bytes of [pdfFixture(true), pdfFixture(false, true), Buffer.from("%PDF-1.4\ncorrupted")]) {
    const result = await extractPdf(bytes); assert.notEqual(result.status, "parsed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
});


test("independent review uses isolated context, distinct receipt purpose and requires every fact",async()=>{
  const body="远洋渔船共10艘。",input={documentId:"review",observationRevision:1,body,bodySha256:sha256(body),language:"zh"};
  const evidence=[{quote:body,paragraph:1,page:null}],date={date:unknownDate,evidence:[]};
  const draft={relevance:{decision:"unknown",reason:"待核",evidence:[]},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],uncertainties:[]};
  const invoke=async(options:any)=>{assert.equal(options.purpose,"fishery_quality_review");assert.deepEqual(Object.keys(JSON.parse(options.user)),["source","candidate","claims"]);return {data:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"原文一致",evidence}]},receiptId:22,reused:false,model:"mock",usage:null} as any;};
  const result=await reviewFisheryDraft(input,draft,"mock",invoke);assert.equal(result.status,"needs_human_review");assert.equal(result.approved,false);assert.equal(result.receiptId,22);
  await assert.rejects(reviewFisheryDraft(input,draft,"mock",async o=>{const a=await invoke(o);a.data.findings[0].field="other";return a;}),/Invalid/);
  const missing=await reviewFisheryDraft(input,draft,"mock",async o=>{const a=await invoke(o);a.data.findings[0].verdict="not_found";return a;});assert.equal(missing.status,"needs_evidence");assert.deepEqual(missing.missingFields,["summaryZh.0"]);
  assert.throws(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence:"远洋渔船共10吨。",evidence}]}),/Numeric value\/unit/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,organizations:[{role:"page_publisher",value:"远洋渔船",evidence}]}),/publisher role/);
  assert.throws(()=>trialCapacity([{state:"received",reservedMicroCny:9_800_000}]),/hard request/);
  assert.doesNotThrow(()=>trialCapacity([{state:"received",reservedMicroCny:9_500_000}]));
});


test("real review-v1 identifiers and absent optional fields fail the explicit claim-manifest contract",async()=>{
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-review-response-20261020.json",import.meta.url),"utf8")),original=structuredClone(fixture);
  const input={documentId:"receipt4-excerpts",observationRevision:1,body:fixture.body,bodySha256:fixture.bodySha256,language:"zh"};
  assert.throws(()=>validateFisheryDraft(input,fixture.draft),/Actual fishing area/);
  // Test-only counterfactual to isolate the review contract. Never save or approve this edited copy.
  const candidate=structuredClone(fixture.draft);candidate.locations=candidate.locations.map((v:any)=>v.role==="fishing_area"?{...v,role:"policy_scope"}:v);
  const request=buildFisheryReviewRequest(input,candidate,"mock"),manifest=JSON.parse(request.user as string).claims;
  assert.ok(manifest.some((c:any)=>c.id==="summaryZh.0"));assert.ok(!manifest.some((c:any)=>c.id.startsWith("dates.")));
  assert.equal(request.schema.safeParse(fixture.review).success,false,"Do not normalize legacy paths or remove real conflicting findings");
  const findings=manifest.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic contract-only example, not a factual endorsement",evidence:[]}));
  const contractFindings=findings.map((f:any)=>({...f,verdict:"not_found"}));
  assert.equal(request.schema.safeParse({decision:"needs_evidence",coverage:"complete_input",findings:contractFindings}).success,true);
  for(const invalid of [findings.slice(1),[...findings,findings[0]],[...findings.slice(1),findings[1]],findings.map((f:any,i:number)=>i?f:{...f,field:"summaryZh[0].sentence"})]) assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:invalid}).success,false);
  assert.deepEqual(fixture,original);
});

test("numeric checks preserve signs, thousands separators and opaque domain units",()=>{
  const date={date:unknownDate,evidence:[]};
  const draft={relevance:{decision:"unknown",reason:"test",evidence:[]},summaryZh:[],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],uncertainties:[]};
  for(const [body,sentence] of [["增长10%。","下降-10%。"],["增长10万吨。","增长10亿美元。"],["配额1,000吨。","配额1。"],["增长-10%。","增长10%。"],["货物10吨。","货物10未知计量。"],["quota 10 tonnes.","quota 10 USD."]]) {
    const input={documentId:"numeric",observationRevision:1,body,bodySha256:sha256(body),language:"zh"},evidence=[{quote:body,paragraph:1,page:null}];
    assert.throws(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence,evidence}]}),/Numeric value\/unit/);
    assert.doesNotThrow(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence:body,evidence}]}));
  }
  const body="计划于2020年5月举行会议，讨论公海治理。",input={documentId:"planned",observationRevision:1,body,bodySha256:sha256(body),language:"zh"},evidence=[{quote:body,paragraph:1,page:null}];
  assert.doesNotThrow(()=>validateFisheryDraft(input,{...draft,eventStatus:{value:"planned",evidence},locations:[{role:"policy_scope",value:"公海",evidence}]}));
  assert.throws(()=>validateFisheryDraft(input,{...draft,eventStatus:{value:"reported_occurred",evidence}}),/Reported occurrence/);
  const announced="将举行公海治理会议。",announcement={...input,body:announced,bodySha256:sha256(announced)};
  assert.throws(()=>validateFisheryDraft(announcement,{...draft,eventStatus:{value:"reported_occurred",evidence:[{quote:announced,paragraph:1,page:null}]}}),/Reported occurrence/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,validityStatus:"in_force"}),/Invalid input/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,locations:[{role:"fishing_area",value:"公海",evidence}]}),/Actual fishing area/);
});


test("full-source generation and bounded review envelopes are checked before any send",()=>{
  const body="--- Page 1 ---\n"+Array.from({length:150},()=>"International fisheries governance full source evidence.").join("\n"),input={documentId:"full-pdf",observationRevision:1,body,bodySha256:sha256(body),language:"en",pages:[{page:1,text:body.slice("--- Page 1 ---\n".length)}]};
  const sizes=assertFisheryPairFits(input);assert.ok(sizes.generationBytes<96000);assert.ok(sizes.reviewEnvelopeBytes<96000);assert.equal(sizes.maxWireBytes,96000);
  const oversized=Array.from({length:4000},(_,i)=>`完整原文${i}。`).join("\n");
  assert.throws(()=>assertFisheryPairFits({...input,body:oversized,bodySha256:sha256(oversized),pages:[]}),/zero-call manual/);
});

function idTestDraft() {
  const date={date:unknownDate,evidence:[]};
  return {relevance:{decision:"unknown",reason:"Synthetic protocol test only",evidence:[]},summaryZh:[],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
}
function idTestInput(body:string) {return {documentId:"synthetic-id-protocol",observationRevision:1,body,bodySha256:sha256(body),language:"zh"};}

test("v5 strict ID wire expands complete evidence without repairing original receipt6",async()=>{
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-v4-receipt6-20261020.json",import.meta.url),"utf8")),original=JSON.stringify(fixture);
  const input=idTestInput(fixture.body),catalog=buildEvidenceCatalog(input),request=buildFisheryDraftRequest(input,"mock");
  assert.equal(input.bodySha256,fixture.bodySha256);
  assert.throws(()=>validateFisheryDraft(input,fixture.response),/Role value lacks literal evidence/);
  assert.equal(request.schema.safeParse(fixture.response).success,false,"Old quotes cannot be interpreted as ID wire");
  assert.equal(catalog.spans[0]!.id,"p1s1");assert.match(catalog.spans[0]!.quote,/在上海召开。$/);
  const wire={...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]},locations:[{role:"meeting_location",value:"上海",evidence:["p1s1"]}],dates:{...idTestDraft().dates,event:{date:unknownDate,evidence:["p1s1"]}}};
  const canonical=validateFisheryDraft(input,request.schema.parse(wire));
  assert.equal(canonical.eventStatus.value,"reported_occurred");assert.equal(canonical.locations[0]!.value,"上海");assert.deepEqual(canonical.dates.event.date,unknownDate);
  assert.equal(canonical.locations[0]!.evidence[0]!.quote,catalog.spans[0]!.quote);
  const source=JSON.parse(request.user as string);assert.equal(source.body,input.body);assert.ok(source.evidenceCatalog.spans.every((s:any)=>s.quote===input.body.slice(s.start,s.end)));
  for(const evidence of [null,{id:"p1s1"},[{quote:catalog.spans[0]!.quote,paragraph:1,page:null}],["p999s1"],["p1s1","p1s1"],Array(5).fill("p1s1")]) assert.equal(request.schema.safeParse({...wire,eventStatus:{value:"reported_occurred",evidence}}).success,false);
  assert.equal(request.schema.safeParse({...wire,eventStatus:{...wire.eventStatus,page:null}}).success,false);
  assert.throws(()=>buildEvidenceCatalog({...input,body:input.body+"变"}),/changed source body/);
  const binding=evidenceBinding(catalog);
  assert.doesNotThrow(()=>assertEvidenceBinding(input,{hash:binding.hash,version:binding.version,observationRevision:binding.observationRevision,bodySha256:binding.bodySha256}));
  assert.throws(()=>assertEvidenceBinding(input,{...binding,version:"fishery-spans-v0"}),/cannot be reinterpreted/);
  assert.throws(()=>assertEvidenceBinding({...input,observationRevision:2},binding),/cannot be reinterpreted/);
  assert.throws(()=>assertEvidenceBinding(idTestInput(input.body+"变"),binding),/cannot be reinterpreted/);
  assert.equal(JSON.stringify(fixture),original);
});

test("catalog preserves literal offsets, conservative English boundaries and verified PDF page intervals",()=>{
  const body="--- Page 1 ---\nRepeated evidence.\nNo. 1: Dr. A reports 1.5 tonnes.\n--- Page 2 ---\nRepeated evidence.\n会议已召开。第二会拟召开！";
  const pages=[{page:1,text:"Repeated evidence.\nNo. 1: Dr. A reports 1.5 tonnes."},{page:2,text:"Repeated evidence.\n会议已召开。第二会拟召开！"}],input={...idTestInput(body),pages};
  const catalog=buildEvidenceCatalog(input);
  assert.equal(catalog.spans[0]!.page,1);assert.equal(catalog.spans[2]!.page,2);assert.equal(catalog.spans[1]!.quote,"No. 1: Dr. A reports 1.5 tonnes.");
  for(const span of catalog.spans) assert.equal(body.slice(span.start,span.end),span.quote);
  const evidence=[{quote:"Repeated evidence.",paragraph:5,page:1}];
  assert.throws(()=>validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence:"Repeated evidence.",evidence}]}),/page anchor/);
  for(const badPages of [[pages[1]!,pages[0]!],[pages[0]!],pages.map(p=>({...p,text:"Repeated evidence."}))]) assert.throws(()=>buildEvidenceCatalog({...input,pages:badPages}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog({...idTestInput("Repeated evidence."),pages:[{page:1,text:"Repeated evidence."}]}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog({...idTestInput(body.replace("Page 2","Page 1")),pages}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog(idTestInput("重复句。重复句。")),/Ambiguous repeated span/);
  assert.throws(()=>buildEvidenceCatalog(idTestInput("x".repeat(1201))),/source not truncated/);
  const whitespace="  完整原句。  后一句！\r\nEnglish e.g. 1.5. ";
  for(const span of buildEvidenceCatalog(idTestInput(whitespace)).spans) assert.equal(whitespace.slice(span.start,span.end),span.quote);
});

test("ID expansion retains occurrence, date, unit, role and expanded review-envelope gates",()=>{
  const body="会议A已召开。会议B拟召开。会议未召开。如果会议召开则另行通知。公海是治理领域。船队10艘。会议于5月16日召开。",input=idTestInput(body),request=buildFisheryDraftRequest(input,"mock");
  const parse=(patch:object)=>validateFisheryDraft(input,request.schema.parse({...idTestDraft(),...patch}));
  assert.doesNotThrow(()=>parse({eventStatus:{value:"reported_occurred",evidence:["p1s1"]}}));
  for(const text of ["会议已正式召开。","会议如期举行。","工作已按期完成。","The meeting was held.","The meeting took place."]) {
    const positive=idTestInput(text),positiveRequest=buildFisheryDraftRequest(positive,"mock");
    assert.doesNotThrow(()=>validateFisheryDraft(positive,positiveRequest.schema.parse({...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]}})),text);
  }
  for(const text of ["会议未举行。","工作未完成。","会议并未正式召开。","会议未如期召开。","工作未能按期完成。","会议尚未正式举行。","The meeting never took place.","The meeting was not actually held.","The work was never completed.","会议取消召开。","会议延期举行。","若条件具备会议召开。","会议A已召开，会议B拟召开。","The meeting was not held.","The meeting was held if conditions were met.","The meeting was held but cancelled."]) {
    const negative=idTestInput(text),negativeRequest=buildFisheryDraftRequest(negative,"mock");
    assert.throws(()=>validateFisheryDraft(negative,negativeRequest.schema.parse({...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]}})),/Reported occurrence/,text);
  }
  for(const id of ["p1s2","p1s3","p1s4"]) assert.throws(()=>parse({eventStatus:{value:"reported_occurred",evidence:[id]}}),/Reported occurrence/);
  assert.throws(()=>parse({locations:[{role:"fishing_area",value:"公海",evidence:["p1s5"]}]}),/Actual fishing area/);
  assert.throws(()=>parse({summaryZh:[{sentence:"船队10吨。",evidence:["p1s6"]}]}),/Numeric value\/unit/);
  assert.throws(()=>parse({dates:{...idTestDraft().dates,event:{date:{precision:"day",value:"2026-05-16"},evidence:["p1s7"]}}}),/components are not explicit/);
  assert.throws(()=>parse({organizations:[{role:"page_publisher",value:"会议A",evidence:["p1s1"]}]}),/publisher role/);
  const longInput=idTestInput(Array.from({length:4},(_,i)=>"源".repeat(1149)+i+"。").join("")),longRequest=buildFisheryDraftRequest(longInput,"mock");
  assert.throws(()=>validateFisheryDraft(longInput,longRequest.schema.parse({...idTestDraft(),summaryZh:[{sentence:"合成包络",evidence:["p1s1","p1s2","p1s3","p1s4"]}]})),/bounded review envelope/);
});

test("review wire only supports original claim ID subsets and preserves complete unique claim manifests",async()=>{
  const input=idTestInput("船队10艘。另有另一船队10艘。"),catalog=buildEvidenceCatalog(input),generation=buildFisheryDraftRequest(input,"mock");
  const draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"船队10艘。",evidence:["p1s1"]}]})),request=buildFisheryReviewRequest(input,draft,"mock");
  const finding={field:"summaryZh.0",verdict:"supported",reason:"Synthetic only",evidence:["p1s1"]},wire={decision:"supported",coverage:"complete_input",findings:[finding]};
  assert.equal(request.schema.safeParse(wire).success,true);
  for(const evidence of [[],["p1s2"],["unknown"],null,{id:"p1s1"}]) assert.equal(request.schema.safeParse({...wire,findings:[{...finding,evidence}]}).success,false);
  for(const findings of [[],[finding,finding],[{...finding,field:"invented"}]]) assert.equal(request.schema.safeParse({...wire,findings}).success,false);
  const contradicted={...wire,decision:"needs_evidence",findings:[{...finding,verdict:"contradicted",evidence:["p1s2"]}]};
  assert.equal(request.schema.safeParse(contradicted).success,true,"Other source IDs can identify contradictions");
  const review=await reviewFisheryDraft(input,draft,"mock",async o=>({data:o.schema.parse(wire),receiptId:999,reused:false,model:"mock",usage:null}));
  assert.equal(review.status,"needs_human_review");assert.equal(review.approved,false);assert.deepEqual(review.evidenceCatalog,evidenceBinding(catalog));
  const empty=validateFisheryDraft(input,generation.schema.parse(idTestDraft())),emptyRequest=buildFisheryReviewRequest(input,empty,"mock");
  const result=await reviewFisheryDraft(input,empty,"mock",async()=>({data:emptyRequest.schema.parse({...wire,findings:[]}),receiptId:1000,reused:false,model:"mock",usage:null}));
  assert.equal(result.status,"needs_evidence");
});


test("saved generation and review cannot inherit a new prompt/schema or catalog version",()=>{
  const input=idTestInput("合成公海会议已召开。"),catalog=buildEvidenceCatalog(input),generation=buildFisheryDraftRequest(input,"mock"),draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"合成公海会议已召开。",evidence:["p1s1"]}]}));
  for(const [request,schemaVersion] of [[generation,"fishery-draft-wire-v5"],[buildFisheryReviewRequest(input,draft,"mock"),"fishery-review-wire-v3"]] as const) {
    const expected={promptVersion:request.promptVersion,schemaVersion},saved={...expected,evidenceCatalog:evidenceBinding(catalog)};
    assert.doesNotThrow(()=>assertSavedEvidenceArtifact(input,saved,expected));
    for(const changed of [{...saved,promptVersion:"old-prompt"},{...saved,schemaVersion:"old-schema"},{...saved,evidenceCatalog:{...saved.evidenceCatalog,version:"old-spans"}},{...saved,evidenceCatalog:{...saved.evidenceCatalog,hash:"0".repeat(64)}}]) assert.throws(()=>assertSavedEvidenceArtifact(input,changed,expected),/version changed|cannot be reinterpreted/);
    assert.throws(()=>assertSavedEvidenceArtifact(input,{},expected),/preserve the old attempt/);
    assert.deepEqual(saved,{...expected,evidenceCatalog:evidenceBinding(catalog)},"Version checks never rewrite saved results");
  }
});

async function iotcEntry9Fixture() {
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-iotc-entry9-20261020.json",import.meta.url),"utf8"));
  const input={...idTestInput(fixture.body),documentId:"offline-original-entry9",language:"en",pages:fixture.pageRanges.map((p:{page:number;start:number;end:number})=>({page:p.page,text:fixture.body.slice(p.start,p.end).trim()}))};
  return {fixture,input};
}

test("readable IOTC ID catalog preserves complete source and original entry9 wrong-anchor rejection",async()=>{
  const {fixture,input}=await iotcEntry9Fixture(),original=JSON.stringify(fixture),catalog=buildEvidenceCatalog(input),request=buildFisheryDraftRequest(input,"mock"),source=JSON.parse(request.user as string);
  assert.equal(input.bodySha256,fixture.bodySha256);assert.equal(Buffer.byteLength(input.body),19598);assert.equal(input.pages.length,6);
  assert.equal(source.body,input.body);assert.deepEqual(source.evidenceCatalog.spans,catalog.spans);
  for(const span of source.evidenceCatalog.spans) assert.equal(span.quote,input.body.slice(span.start,span.end),span.id);
  const quote=(id:string)=>catalog.spans.find(s=>s.id===id)!.quote;
  assert.match(quote("p2s1"),/RESOLUTION 26\/03/);assert.match(quote("p5s1"),/Keywords/);assert.match(quote("p6s1"),/Indian Ocean Tuna Commission/);
  assert.match(quote("p46s1"),/means all fisheries/);assert.match(quote("p47s1"),/Subsistence fisheries/);assert.match(quote("p50s1"),/Artisanal fisheries/);
  assert.match(quote("p59s1"),/prohibit.*targeted fishing/);assert.match(quote("p60s1"),/mobulid rays/);
  assert.match(quote("p66s1"),/extent practicable.*safety/);assert.match(quote("p67s1"),/crew and observers/);
  const wrong=JSON.parse(fixture.rawContent);
  assert.deepEqual(wrong.organizations[0].evidence,["p2s1"]);
  assert.throws(()=>validateFisheryDraft(input,request.schema.parse(wrong)),/Role value lacks literal evidence: policy_issuer/);
  assert.throws(()=>assertEvidenceBinding(input,{...evidenceBinding(catalog),version:fixture.protocol.evidenceVersion}),/cannot be reinterpreted/);
  const sizes=assertFisheryPairFits(input,request);
  assert.ok(sizes.generationBytes<96000);assert.ok(sizes.reviewEnvelopeBytes<96000);assert.equal(sizes.maxWireBytes,96000);
  assert.throws(()=>assertFisheryPairFits(input,{...request,system:request.system+"界".repeat(7000)}),/zero-call manual/);
  // A fresh synthetic case proves readable ID expansion only. It is not a repair of entry9 or a real model result.
  const synthetic=validateFisheryDraft(input,request.schema.parse({...idTestDraft(),summaryZh:[{sentence:"CPCs须禁止其悬旗船故意设置任何渔具定向捕捞蝠鲼科鳐类。",evidence:["p59s1","p60s1"]}],organizations:[{role:"policy_issuer",value:"Indian Ocean Tuna Commission (IOTC)",evidence:["p6s1"]}]}));
  assert.deepEqual(synthetic.summaryZh[0]!.evidence.map(e=>e.quote),[quote("p59s1"),quote("p60s1")]);
  assert.equal(JSON.stringify(fixture),original,"Never rewrite the old wrong-ID response or its evidence bindings");
});

test("IOTC release claim missing safety qualifications cannot be repaired by supported review IDs",async()=>{
  const {input}=await iotcEntry9Fixture(),generation=buildFisheryDraftRequest(input,"mock");
  // Deliberately incomplete synthetic candidate: its bound line omits release, practicability and crew/observer safety.
  const draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"CPCs须要求悬旗渔船尽快活体释放意外捕获的蝠鲼科鳐类。",evidence:["p65s1"]}]})),request=buildFisheryReviewRequest(input,draft,"mock");
  const finding={field:"summaryZh.0",verdict:"supported",reason:"Synthetic attempted repair",evidence:["p65s1","p66s1","p67s1"]};
  assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[finding]}).success,false,"Readable source must not authorize adding omitted safety anchors");
  assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{...finding,evidence:["p66s1","p67s1"]}]}).success,false);
  const result=await reviewFisheryDraft(input,draft,"mock",async options=>{
    const source=JSON.parse(options.user as string).source;
    assert.match(source.body,/extent practicable/);assert.match(source.body,/crew and observers/);
    return {data:options.schema.parse({decision:"needs_evidence",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"not_found",reason:"Synthetic complete-context review: bound line lacks release, practicability and crew/observer safety; do not supplement anchors",evidence:[]}]}),receiptId:9999,reused:false,model:"mock",usage:null};
  });
  assert.equal(result.status,"needs_evidence");assert.deepEqual(result.missingFields,["summaryZh.0"]);assert.equal(result.approved,false);
});


test("complete calendar dates translate at equal day precision without exempting counts or inventing years",()=>{
  const check=(body:string,sentence:string)=>{const input=idTestInput(body),evidence=[{quote:body,paragraph:1,page:null}];return validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence,evidence}]});};
  for(const body of ["From 1 January 2028.","From January 1, 2028.","From 2028-01-01.","From 1 January 2028[1]."]) assert.doesNotThrow(()=>check(body,"自2028年1月1日起。"));
  assert.doesNotThrow(()=>check("自2028 年 1 月 1 日起。","From 1 January 2028."));
  for(const [body,sentence] of [["1 January 2028.","2028年1月2日。"],["1 January 2028.","2028年2月1日。"],["1 January 2028.","2030年1月1日。"],["1 January 20281.","2028年1月1日。"],["1 January.","2028年1月1日。"],["1 January 2028.","2028年。"],["1 January 2028; quota 10 tonnes.","2028年1月1日配额10美元。"],["1 January 2028; -10 tonnes.","2028年1月1日配额10 tonnes."]]) assert.throws(()=>check(body,sentence),/Calendar date|Numeric value/);
  assert.doesNotThrow(()=>check("整数20281。","整数20281。"));assert.throws(()=>check("整数20281。","整数2028。"),/Numeric value/);
  const input=idTestInput("1 January\n2028"),evidence=[{quote:"1 January",paragraph:1,page:null},{quote:"2028",paragraph:2,page:null}];
  assert.throws(()=>validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence:"2028年1月1日。",evidence}]}),/Calendar date/);
});

test("server-selected manual revision supports twelve IDs while generation stays capped at four",()=>{
  const body=Array.from({length:13},(_,i)=>`原文事实${String.fromCharCode(65+i)}。`).join("\n"),input=idTestInput(body),catalog=buildEvidenceCatalog(input),ids=catalog.spans.map(s=>s.id);
  const wire={...idTestDraft(),summaryZh:[{sentence:"原文事实A。",evidence:ids.slice(0,12)}]};
  assert.equal(fisheryDraftWireSchema(catalog).safeParse(wire).success,false);
  const manual=parseFisheryManualRevision(input,wire);
  assert.equal(manual.draft.summaryZh[0]!.evidence.length,12);assert.throws(()=>validateFisheryDraft(input,manual.draft),/server-selected/);
  assert.doesNotThrow(()=>validateFisheryDraft(input,manual.draft,{mode:"manual_revision"}));
  assert.equal(fisheryDraftWireSchema(catalog,{mode:"manual_revision"}).safeParse({...wire,summaryZh:[{sentence:"原文事实A。",evidence:ids}]}).success,false);
  const review=buildFisheryReviewRequest(input,manual.draft,"mock",{mode:"manual_revision"});
  assert.equal(review.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic binding only",evidence:ids.slice(0,12)}]}).success,true);
  assert.equal(review.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic forbidden extra",evidence:[ids[12]]}]}).success,false);
});
