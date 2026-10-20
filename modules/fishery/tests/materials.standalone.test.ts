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
import { buildFisheryDraftRequest, fisheryDraftSchema, prepareFisheryDraft, validateFisheryDraft } from "../backend/ai-draft.ts";
import { TRIAL, installTrialTransport, trialCapacity, trialUsage } from "../backend/trial-transport.ts";
import {reviewFisheryDraft} from "../backend/ai-review.ts";
import { createHash } from "node:crypto";

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
  assert.throws(()=>validateFisheryDraft(input(first),corrected),/Numeric value/);
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
  const result=await prepareFisheryDraft(input,"mock",async options=>{assert.equal(options.purpose,"fishery_draft");return {data:options.schema.parse(output),receiptId:123,reused:false,model:"mock",usage:null};});
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
function pdfFixture(blank = false, encrypted = false): Buffer {
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
  let content = Buffer.from(blank ? "" : "BT /F1 12 Tf 40 100 Td (Synthetic fishery evidence) Tj ET");
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
  const invoke=async(options:any)=>{assert.equal(options.purpose,"fishery_quality_review");assert.deepEqual(Object.keys(JSON.parse(options.user)),["source","candidate"]);return {data:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"原文一致",evidence}]},receiptId:22,reused:false,model:"mock",usage:null} as any;};
  const result=await reviewFisheryDraft(input,draft,"mock",invoke);assert.equal(result.status,"needs_human_review");assert.equal(result.approved,false);assert.equal(result.receiptId,22);
  const missing=await reviewFisheryDraft(input,draft,"mock",async o=>{const a=await invoke(o);a.data.findings[0].field="other";return a;});assert.equal(missing.status,"needs_evidence");assert.deepEqual(missing.missingFields,["summaryZh.0"]);
  assert.throws(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence:"远洋渔船共10吨。",evidence}]}),/Numeric value\/unit/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,organizations:[{role:"page_publisher",value:"远洋渔船",evidence}]}),/publisher role/);
  assert.throws(()=>trialCapacity([{state:"received",reservedMicroCny:9_800_000}]),/hard request/);
  assert.doesNotThrow(()=>trialCapacity([{state:"received",reservedMicroCny:9_500_000}]));
});
