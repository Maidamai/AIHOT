// Production SSR/browser verification against a synthetic API. No real login or model provider.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { fakeApi, startWebServer, visit, type WebServer } from "../../../../apps/web/tests/web-server.ts";
import type { FisheryReaderItem, FisheryReaderPage } from "../../ui-contracts.ts";
const item:FisheryReaderItem={id:"synthetic-policy",title:"此合成资料用于检查内部摘要、原文日期及来源证据的呈现，不代表真实政策或业务审核。",source:{name:"合成官方来源 · 仅用于界面验收",originalTitle:"配额增100%（合成未核查原标题）",url:"https://example.org/synthetic-policy"},category:{id:"policy",label:"政策监管"},summary:[{sentence:"此合成资料用于检查内部摘要、原文日期及来源证据的呈现，不代表真实政策或业务审核。",evidence:[{quote:"This synthetic source excerpt is for interface verification only. It does not describe an actual conservation measure or authorize fishing operations.",paragraph:12,page:2,url:"https://example.org/synthetic-policy.pdf"}]}],dates:{published:{precision:"day",value:"2026-04-17"},event:{precision:"unknown",value:null}},age:{referenceDate:"2026-10-20",days:186,historical:true,label:"7日及更早原文资料"},verification:{status:"internally_qualified",label:"摘要已完成内部核对",legalApplicability:"未完成法律适用性核验"}};
const unknown:FisheryReaderItem={...item,id:"synthetic-pubunknown",title:"此合成日期未知资料仅用于界面验收。",summary:[{...item.summary[0]!,sentence:"此合成日期未知资料仅用于界面验收。"}],dates:{...item.dates,published:{precision:"unknown",value:null}},age:{referenceDate:"2026-10-20",days:null,historical:false,label:"原文资料 · 发布日期未知"}};
let mode:"ready"|"empty"|"unauthorized"|"failure"="ready";
const apiPaths:string[]=[];let unapprovedSupportedFlow=false;let runningReconcileFixture=false;
const api=fakeApi((url,res)=>{
  apiPaths.push(url.pathname);
  if(url.pathname==="/api/admin/me") {if(mode==="unauthorized")res.statusCode=401;return {name:"synthetic-admin",csrf:"synthetic-test-only",dev:false};}
  if(url.pathname==="/api/admin/nav-counts")return {};
  if(url.pathname==="/api/admin/fishery/batches") {
    const batch=(id:string,status:string,states:string[])=>({id,status,startedAt:"2026-10-20T00:00:00Z",finishedAt:status==="complete"?"2026-10-20T00:01:00Z":null,sources:[],items:states.map((state,i)=>({archiveId:`${id}_${i}`,url:`https://example.org/${id}/${i}`,discoveryTitle:`Synthetic ${state} capture`,state,prepared:null,error:state==="failed"?"Synthetic unavailable capture":null}))});
    return {rows:[batch("synthetic-irrelevant","complete",["irrelevant"]),batch("synthetic-unavailable","complete",["failed"]),batch("synthetic-running","running",["irrelevant"]),batch("synthetic-empty","complete",[]),{id:"synthetic-unreadable",status:"unreadable",error:"Synthetic truncated manifest"}]};
  }
  if(url.pathname==="/api/admin/fishery/flows/synthetic-failed") {const unknown={precision:"unknown",value:null};return {id:"synthetic-failed",document_id:"synthetic-policy",identity:"synthetic-failed",status:runningReconcileFixture?"running":unapprovedSupportedFlow?"needs_human_review":"failed",stage:"generation",authoritative:true,materialRejected:false,materialApproved:runningReconcileFixture,stale:false,snapshotHash:"a".repeat(64),generation_attempt:1,review_attempt:1,draft:unapprovedSupportedFlow?{receiptId:999,promptVersion:"synthetic",model:"mock",draft:{relevance:{decision:"relevant"},summaryZh:[{sentence:"合成已核查候选，原素材仍未审核。",evidence:[]}]}}:null,quality_review:unapprovedSupportedFlow?{receiptId:999,promptVersion:"synthetic",model:"mock",status:"needs_human_review",review:{decision:"supported",coverage:"complete_input",findings:[]},missingFields:[]}:null,reconciliation:runningReconcileFixture?{version:"synthetic-reconcile-fixture",eligible:true,reasons:[],executionFingerprint:"b".repeat(64),snapshotHash:"a".repeat(64),status:"running",stage:"generation",currentSourceRevision:1,currentObservationRevision:1,currentMaterialApproved:true,stageRequestCount:0,candidateHash:"c".repeat(64),reusableGenerationReceiptId:null,newCallsOnResume:2,ledger:{id:"synthetic-only",valid:true,entryCount:0,reservedMicroCny:0,states:[]},receipts:[],jobs:[],activeJobId:null}:undefined,human_decision:null,internalArticle:null,error:{stage:"generation",reason:"Synthetic failure",receiptId:null},timeline:{label:"合成失败任务",referenceDate:"2026-10-20",originalAgeDays:null,sourcePublished:unknown,sourceEvent:unknown,candidateEvent:unknown,taskCreatedAt:"2026-10-20T00:00:00Z",taskUpdatedAt:"2026-10-20T00:00:00Z"}};}
  if(url.pathname.startsWith("/api/admin/fishery/reader")) {
    if(mode==="unauthorized") {res.statusCode=401;return {code:"unauthorized"};}
    if(mode==="failure") {res.statusCode=503;return {detail:"Reader temporarily unavailable"};}
    if(url.pathname==="/api/admin/fishery/reader") return {rows:mode==="empty"?[]:[item,unknown],categories:mode==="empty"?[]:[{id:"policy",label:"政策监管",count:2}],total:mode==="empty"?0:2,filteredTotal:mode==="empty"?0:2,page:1,limit:20,selectedCategory:null,internalOnly:true,referenceDate:"2026-10-20"} satisfies FisheryReaderPage;
    if(url.pathname.endsWith("/synthetic-policy"))return item;
    res.statusCode=404;return {code:"not_found"};
  }
  if(url.pathname==="/api/site/timeline")return {filters:{channel:"all",category:null,tag:null},cards:[],nextCursor:null,dayCounts:[],hot:null};
  if(url.pathname==="/api/site/hot")return {entries:[]};
});
let web:WebServer,browser:Browser;
before(async()=>{web=await startWebServer(api);browser=await chromium.launch({channel:"chromium"});});
after(async()=>{await browser?.close();await web?.stop();});
const noPublicNavigation=(html:string)=>{assert.doesNotMatch(html,/href="\/(?:all|hot|daily|weekly|topics|more)(?:[?"/])/);assert.doesNotMatch(html,/application\/rss\+xml/);};

test("reader HTML, data and errors remain private, and signed-out readers use the existing login redirect",async()=>{
  mode="ready";
  for(const route of ["/fishery","/fishery/synthetic-policy","/fishery.data","/fishery/synthetic-policy.data","/fishery/missing/deeper","/fishery/missing/deeper.data"]) {
    const response=await fetch(web.origin+route,{redirect:"manual"});
    assert.match(response.headers.get("cache-control")??"",/private.*no-store/);assert.match(response.headers.get("x-robots-tag")??"",/noindex/,route+" "+JSON.stringify([...response.headers]));
    const html=await response.text();if(!route.includes(".data"))noPublicNavigation(html);
    if(route.includes("missing")) {assert.equal(response.status,404);if(!route.includes(".data")) assert.match(html,/返回资料列表/);}
  }
  mode="failure";const failure=await fetch(web.origin+"/fishery");assert.equal(failure.status,503);assert.match(failure.headers.get("cache-control")??"",/no-store/);noPublicNavigation(await failure.text());
  mode="unauthorized";const signedOut=await fetch(web.origin+"/fishery",{redirect:"manual"});assert.equal(signedOut.status,302);assert.equal(signedOut.headers.get("location"),"/api/auth/login?return=%2Ffishery");
  mode="ready";const normal=await fetch(web.origin+"/");const normalHtml=await normal.text();assert.match(normalHtml,/application\/rss\+xml/);assert.match(normalHtml,/href="\/all/);
});

test("reader list, complete citation detail and empty/error states fit 320, 393 and 1024 screens",async()=>{
  mode="ready";const folder=process.env.FISHERY_SCREENSHOT_DIR??"/tmp/fishery-reader-preview";await mkdir(folder,{recursive:true});
  for(const width of [320,393,1024]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    await visit(page,web.origin+"/fishery");await expect(page.getByRole("heading",{name:"已核对资料",exact:true})).toBeVisible();
    await expect(page.getByText("已核对摘要",{exact:true})).toHaveCount(2);await expect(page.getByText("摘要已完成内部核对",{exact:true})).toHaveCount(2);
    await expect(page.getByText(item.source.originalTitle,{exact:true})).toHaveCount(0);
    await expect(page.getByText("历史资料",{exact:true})).toBeVisible();await expect(page.getByText("原文发布日期未知",{exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await expect(page.getByRole("link",{name:"模型",exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(folder,`list-${width}.png`),fullPage:true});
    await page.getByRole("link",{name:item.title,exact:true}).click();await expect(page.getByRole("heading",{name:"原文引证",exact:true})).toBeVisible();await expect(page.getByText(item.summary[0]!.evidence[0]!.quote,{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{level:1,name:item.title,exact:true})).toBeVisible();assert.ok(!(await page.title()).includes("100%"));await expect(page.getByText(item.source.originalTitle,{exact:true})).toBeVisible();await expect(page.getByText("原来源标题（未作为独立事实核查）",{exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole("link",{name:/原文第 12 段/}).getAttribute("rel"),"noopener noreferrer");
    await page.screenshot({path:path.join(folder,`detail-${width}.png`),fullPage:true});
    await page.goto(web.origin+"/fishery/missing/deeper");await expect(page.getByRole("heading",{name:"这份资料暂不可读",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"回到精选",exact:true})).toHaveCount(0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(folder,`error-${width}.png`),fullPage:true});await page.close();
  }
  mode="empty";const empty=await browser.newPage({viewport:{width:393,height:852}});await visit(empty,web.origin+"/fishery");await expect(empty.getByRole("heading",{name:"暂无可读资料",exact:true})).toBeVisible();await expect(empty.getByRole("link",{name:/政策监管/})).toHaveCount(0);await empty.screenshot({path:path.join(folder,"empty-393.png"),fullPage:true});await empty.close();
  assert.equal(apiPaths.some(p=>/model|generate|process|receipts/.test(p)),false);
});


test("failed administrator flow cannot offer internal qualification without a reviewed relevant draft",async()=>{
  mode="ready";const page=await browser.newPage();try{await visit(page,web.origin+"/admin/fishery/flows/synthetic-failed");await expect(page.getByRole("heading",{name:"内部文章审核",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"记录内部合格",exact:true})).toBeDisabled();unapprovedSupportedFlow=true;await page.reload();await expect(page.getByText(/当前素材观察及信源版本尚未审核通过/)).toBeVisible();await expect(page.getByRole("button",{name:"记录内部合格",exact:true})).toBeDisabled();}finally{unapprovedSupportedFlow=false;await page.close();}
});

test("administrator saves synthetic manual revision separately from explicit model review queue",async()=>{
  mode="ready";const page=await browser.newPage({viewport:{width:393,height:852}}),requests:{method:string;body:any}[]=[];
  await page.route("**/api/admin/fishery/flows/synthetic-failed/revision",async route=>{
    const request=route.request();requests.push({method:request.method(),body:request.postDataJSON()});
    await route.fulfill({json:request.method()==="GET"?{snapshotHash:"a".repeat(64),evidenceCatalog:{hash:"b".repeat(64),spans:[{id:"p1s1",quote:"Synthetic source only"}]},candidate:{synthetic:"editable fixture"},originalContent:'{"synthetic":"original fixture"}'}:{id:"synthetic-revision"}});
  });
  try {
    await visit(page,web.origin+"/admin/fishery/flows/synthetic-failed");
    await page.getByRole("button",{name:"载入当前证据与可编辑候选",exact:true}).click();
    await expect(page.getByLabel("人工修订候选 JSON")).toHaveValue(/editable fixture/);
    await page.getByLabel("修订原因",{exact:false}).fill("Synthetic revision reason");
    await page.getByRole("button",{name:"零调用校验并保存为新任务",exact:true}).click();
    await expect(page.getByRole("link",{name:/打开新修订任务/})).toHaveAttribute("href","/admin/fishery/flows/synthetic-revision");
    assert.deepEqual(requests.map(r=>r.method),["GET","POST"]);assert.equal(requests[1]!.body.evidenceHash,"b".repeat(64));
    assert.equal(requests[1]!.body.reason,"Synthetic revision reason");assert.equal(apiPaths.some(p=>p.endsWith("/run")),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  } finally {await page.close();}
});


test("administrator can record an irrelevant-only or failed-only capture without enabling incomplete or unreadable batches",async()=>{
  mode="ready";const page=await browser.newPage(),imports:string[]=[];
  await page.route("**/api/admin/fishery/batches/*/import",async route=>{imports.push(route.request().url());await route.fulfill({json:{rows:[],evidenceUpdates:[],acquisitions:[],published:false}});});
  try {
    await visit(page,web.origin+"/admin/fishery/collect");
    const card=(id:string)=>page.locator("section").filter({has:page.getByRole("heading",{name:id,exact:true})});
    for(const id of ["synthetic-irrelevant","synthetic-unavailable"]) {
      const action=card(id).getByRole("button",{name:"导入或记录采集结果",exact:true});
      await expect(action).toBeEnabled();await action.click();
      await expect(action).toBeEnabled();
    }
    for(const id of ["synthetic-running","synthetic-empty"]) await expect(card(id).getByRole("button",{name:"导入或记录采集结果",exact:true})).toBeDisabled();
    await expect(card("synthetic-unreadable").getByRole("button")).toHaveCount(0);
    assert.equal(imports.length,2);assert.ok(imports[0]!.endsWith("/synthetic-irrelevant/import"));assert.ok(imports[1]!.endsWith("/synthetic-unavailable/import"));
  } finally {await page.close();}
});


test("synthetic interruption recovery requires stopped-runner acknowledgement and only submits zero-call reconciliation",async()=>{
  mode="ready";runningReconcileFixture=true;const page=await browser.newPage({viewport:{width:393,height:852}}),requests:any[]=[];
  await page.route("**/api/admin/fishery/flows/synthetic-failed/reconcile",async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{id:"synthetic-failed",status:"failed",modelCalls:0,published:false}});});
  try {
    await visit(page,web.origin+"/admin/fishery/flows/synthetic-failed");
    await page.getByRole("button",{name:"人工核对请求前中断（零调用）",exact:true}).click();
    const dialog=page.getByRole("dialog");await dialog.getByRole("textbox").fill("Synthetic old runner stopped and all states checked");
    await dialog.getByRole("button",{name:"零调用标记失败",exact:true}).click();assert.equal(requests.length,0);
    await dialog.getByRole("checkbox").check();await dialog.getByRole("button",{name:"零调用标记失败",exact:true}).click();
    await expect.poll(()=>requests.length).toBe(1);assert.equal(requests[0].acknowledgeRunnerStopped,true);assert.equal(requests[0].executionFingerprint,"b".repeat(64));assert.equal(requests[0].expectedStatus,"running");
    assert.equal(apiPaths.some(p=>p.endsWith("/run")),false);
  }finally{runningReconcileFixture=false;await page.close();}
});
