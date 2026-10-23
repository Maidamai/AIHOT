// Production SSR/browser verification against a synthetic API. No real login or model provider.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { fakeApi, startWebServer, visit, type WebServer } from "../../../../apps/web/tests/web-server.ts";
import type { BusinessGuideReaderItem } from "../../business-contracts.ts";
const item={id:"synthetic-policy",source:{name:"合成官方来源 · 仅用于界面验收",originalTitle:"Synthetic material source",url:"https://example.org/synthetic-policy"}};
const syntheticUnknown={state:"unknown" as const,value:null,evidence:[] as []};
const syntheticDate={value:{precision:"unknown" as const,value:null},evidence:[] as string[]};
const businessItem:Pick<BusinessGuideReaderItem,"id"|"documentId"|"payload"|"source"|"snapshot"|"verifiedAt">={id:"synthetic-guide",documentId:item.id,payload:{relations:[],topicId:"funding",kind:"business_guide",title:{value:"合成业务指南 · 仅供界面验收",evidence:["p1s1"]},summary:[{value:"此合成指南不代表真实业务批准。",evidence:["p1s1"]}],audience:syntheticUnknown,opportunity:syntheticUnknown,restrictions:syntheticUnknown,materials:syntheticUnknown,applicability:{countriesOrRegions:syntheticUnknown,flagStates:syntheticUnknown,species:syntheticUnknown,fishingMethods:syntheticUnknown},documentStatus:syntheticUnknown,dates:{published:{value:{precision:"day",value:"2026-04-17"},evidence:["p1s1"]},effectiveFrom:syntheticDate,deadline:syntheticDate,expiresAt:syntheticDate},serviceEntry:{state:"unknown",label:null,url:null,evidence:[]}},source:{...item.source,published:{precision:"day",value:"2026-04-17"},publishedAt:null,publicationLiteral:"2026-04-17",capturedAt:"2026-10-20T00:00:00Z"},snapshot:{version:"fishery-business-guide/1",articleId:"synthetic-article",canonicalUrl:item.source.url,documentId:item.id,sourceId:"synthetic",sourceRevision:1,sourceProfileHash:"a".repeat(64),observationRevision:1,observationHash:"a".repeat(64),rawSha256:"a".repeat(64),bodySha256:"b".repeat(64),materialReviewId:1,materialReviewHash:"a".repeat(64),catalogHash:"c".repeat(64),catalogVersion:"synthetic"},verifiedAt:"2026-10-21T00:00:00Z"};
const businessRecord=()=>({id:businessItem.id,documentId:item.id,revision:1,status:aiFixture==="missing"?"approved":"draft",aiReview:{current:aiFixture!=="stale"&&aiFixture!=="missing",pass:aiFixture==="passed",status:aiFixture,reviewHash:aiFixture==="missing"?null:"e".repeat(64),receiptId:aiFixture==="missing"?null:123,guideRevision:aiFixture==="stale"?0:1,confirmedConflict:aiFixture==="conflict"},snapshot:businessItem.snapshot,snapshotHash:"a".repeat(64),payload:businessItem.payload,payloadHash:"b".repeat(64),createdAt:businessItem.verifiedAt,updatedAt:businessItem.verifiedAt,verifiedAt:null,readable:false,blockedReason:"未批准",humanDecision:null});
let mode:"ready"|"unauthorized"|"failure"="ready";
const apiPaths:string[]=[];let unapprovedSupportedFlow=false;let runningReconcileFixture=false;let unavailableBusinessContext=false;let aiFixture:"passed"|"missing"|"stale"|"conflict"|"failed"="passed";
const apiCookies:{path:string;cookie:string}[]=[];
const api=fakeApi((url,res,request)=>{
  apiPaths.push(url.pathname);
  if(url.pathname.startsWith("/api/admin/"))apiCookies.push({path:url.pathname,cookie:request.headers.cookie??""});
  if(url.pathname==="/api/admin/me") {if(mode!=="ready"){res.statusCode=mode==="unauthorized"?401:503;return {detail:"Synthetic identity unavailable"};}return {name:"synthetic-admin",csrf:"synthetic-test-only",dev:false};}
  if(url.pathname==="/api/admin/nav-counts")return {};
  if(url.pathname==="/api/admin/fishery/batches") {
    const batch=(id:string,status:string,states:string[])=>({id,status,startedAt:"2026-10-20T00:00:00Z",finishedAt:status==="complete"?"2026-10-20T00:01:00Z":null,sources:[],items:states.map((state,i)=>({archiveId:`${id}_${i}`,url:`https://example.org/${id}/${i}`,discoveryTitle:`Synthetic ${state} capture`,state,prepared:null,error:state==="failed"?"Synthetic unavailable capture":null}))});
    return {rows:[batch("synthetic-irrelevant","complete",["irrelevant"]),batch("synthetic-unavailable","complete",["failed"]),batch("synthetic-running","running",["irrelevant"]),batch("synthetic-empty","complete",[]),{id:"synthetic-unreadable",status:"unreadable",error:"Synthetic truncated manifest"}]};
  }
  if(url.pathname==="/api/admin/fishery/flows/synthetic-failed") {const unknown={precision:"unknown",value:null};return {id:"synthetic-failed",document_id:"synthetic-policy",identity:"synthetic-failed",status:runningReconcileFixture?"running":unapprovedSupportedFlow?"needs_human_review":"failed",stage:"generation",authoritative:true,materialRejected:false,materialApproved:runningReconcileFixture,stale:false,snapshotHash:"a".repeat(64),generation_attempt:1,review_attempt:1,draft:unapprovedSupportedFlow?{receiptId:999,promptVersion:"synthetic",model:"mock",draft:{relevance:{decision:"relevant"},summaryZh:[{sentence:"合成已核查候选，原素材仍未审核。",evidence:[]}]}}:null,quality_review:unapprovedSupportedFlow?{receiptId:999,promptVersion:"synthetic",model:"mock",status:"needs_human_review",review:{decision:"supported",coverage:"complete_input",findings:[]},missingFields:[]}:null,reconciliation:runningReconcileFixture?{version:"synthetic-reconcile-fixture",eligible:true,reasons:[],executionFingerprint:"b".repeat(64),snapshotHash:"a".repeat(64),status:"running",stage:"generation",currentSourceRevision:1,currentObservationRevision:1,currentMaterialApproved:true,stageRequestCount:0,candidateHash:"c".repeat(64),reusableGenerationReceiptId:null,newCallsOnResume:2,ledger:{id:"synthetic-only",valid:true,entryCount:0,reservedMicroCny:0,states:[]},receipts:[],jobs:[],activeJobId:null}:undefined,human_decision:null,internalArticle:null,error:{stage:"generation",reason:"Synthetic failure",receiptId:null},timeline:{label:"合成失败任务",referenceDate:"2026-10-20",originalAgeDays:null,sourcePublished:unknown,sourceEvent:unknown,candidateEvent:unknown,taskCreatedAt:"2026-10-20T00:00:00Z",taskUpdatedAt:"2026-10-20T00:00:00Z"}};}
  if(url.pathname==="/api/admin/fishery/manual-sources"){
    if(mode==="unauthorized"){res.statusCode=401;return {code:"unauthorized"};}
    return {rows:[1,2,3,4].map(i=>({id:"synthetic-manual-"+i,title:"合成人工归档 "+i+" · 仅用于界面验收",url:"https://example.org/synthetic-manual-"+i,name:"合成官方来源",attribution:"合成归属",parser:"manual-official-html/v1",pages:null,bodySha256:"a".repeat(64),published:{precision:"day",value:"2026-04-17"},publishedAt:null,publicationLiteral:"2026-04-17",capturedAt:"2026-10-21T00:00:00Z",importable:i!==4,error:i===4?"Synthetic archive hash mismatch":null}))};
  }
  if(url.pathname.startsWith("/api/admin/fishery/business-")) {
    if(mode==="unauthorized"){res.statusCode=401;return {code:"unauthorized"};}
    if(mode==="failure"){res.statusCode=503;return {detail:"Synthetic failure"};}
    if(url.pathname==="/api/admin/fishery/business-guides")return {rows:[1,2,3,4].map(i=>({...businessRecord(),id:i===1?businessItem.id:"synthetic-guide-"+i}))};
    if(url.pathname==="/api/admin/fishery/business-guides/synthetic-guide")return businessRecord();
    if(url.pathname.startsWith("/api/admin/fishery/business-guides/context/")&&unavailableBusinessContext){res.statusCode=409;return {detail:"Synthetic withdrawn material"};}
    if(url.pathname.startsWith("/api/admin/fishery/business-guides/context/"))return {documentId:item.id,snapshot:businessItem.snapshot,snapshotHash:"a".repeat(64),source:businessItem.source,catalog:{version:"synthetic",hash:"c".repeat(64),bodySha256:"b".repeat(64),observationRevision:1,spans:[{id:"p1s1",quote:"Synthetic editorial evidence only.",paragraph:1,page:null,start:0,end:33}],pages:[]}};
    res.statusCode=404;return {code:"not_found"};
  }
  if(url.pathname.startsWith("/api/admin/fishery/reader-target/")) {
    if(mode==="unauthorized") {res.statusCode=401;return {code:"unauthorized"};}
    if(mode==="failure") {res.statusCode=503;return {detail:"Synthetic target unavailable"};}
    if(url.pathname==="/api/admin/fishery/reader-target/article/synthetic-policy")return {url:"/items/synthetic-public-article"};
    if(url.pathname==="/api/admin/fishery/reader-target/business_guide/synthetic-guide")return {url:"/items/synthetic-public-guide"};
    res.statusCode=404;return {code:"not_found"};
  }
  if(url.pathname==="/api/site/timeline")return {filters:{channel:"all",category:null,tag:null},cards:[],nextCursor:null,dayCounts:[],hot:null};
  if(url.pathname==="/api/site/hot")return {entries:[]};
});
let web:WebServer,browser:Browser;
before(async()=>{await mkdir(process.env.FISHERY_SCREENSHOT_DIR??"/tmp/fishery-reader-preview",{recursive:true});web=await startWebServer(api);browser=await chromium.launch({channel:"chromium"});});
after(async()=>{await browser?.close();await web?.stop();});
test("legacy reader collections authenticate and redirect supported filters into main-site routes",async()=>{
  mode="ready";const start=apiCookies.length;
  const destinations=[
    ["/fishery","/all"],
    ["/fishery?category=policy&page=2&q=%20配额%20&tag=%20政策%20&channel=firstParty&tab=relevance&kind=business_guide","/all?channel=firstParty&category=policy&tag=政策&q=配额&tab=relevance&page=2"],
    ["/fishery?category=obsolete&channel=invalid&page=-1&tab=invalid","/all"],
    ["/fishery/topics","/topics"],
    ["/fishery/topics?topicId=funding&kind=business_guide&page=2","/topics/funding"],
    ["/fishery/topics?topicId=missing","/topics"],
  ];
  for(const [route,target] of destinations){
    const response=await fetch(web.origin+route,{redirect:"manual",headers:{cookie:"admin_session=synthetic-reader"}});
    assert.equal(response.status,302,route);
    assert.equal(response.headers.get("location"),new URL(target,web.origin).pathname+new URL(target,web.origin).search);
    assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
    assert.match(response.headers.get("x-robots-tag")??"",/noindex/);
  }
  for(const category of ["policy","safety","market","research","equipment","operations","reference"]){
    const response=await fetch(web.origin+"/fishery?category="+category,{redirect:"manual"});
    assert.equal(response.status,302);assert.equal(response.headers.get("location"),"/all?category="+category);
  }
  assert.ok(apiCookies.slice(start,start+destinations.length).every(read=>read.path==="/api/admin/me"&&read.cookie==="admin_session=synthetic-reader"));
  assert.equal(apiPaths.some(p=>p==="/api/admin/fishery/reader"||p==="/api/admin/fishery/business-reader"),false);
});

test("legacy reader details redirect only to the current server-mapped main-site item",async()=>{
  mode="ready";const start=apiCookies.length;
  for(const [route,target] of [["/fishery/synthetic-policy","/items/synthetic-public-article"],["/fishery/guides/synthetic-guide","/items/synthetic-public-guide"]]){
    const response=await fetch(web.origin+route,{redirect:"manual",headers:{cookie:"admin_session=synthetic-reader"}});
    assert.equal(response.status,302,route);assert.equal(response.headers.get("location"),target);
    assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
    assert.match(response.headers.get("x-robots-tag")??"",/noindex/);
  }
  assert.deepEqual(apiCookies.slice(start).map(read=>read.path),["/api/admin/fishery/reader-target/article/synthetic-policy","/api/admin/fishery/reader-target/business_guide/synthetic-guide"]);
  assert.ok(apiCookies.slice(start).every(read=>read.cookie==="admin_session=synthetic-reader"));
});

test("legacy reader authentication and target failures preserve login or error responses",async()=>{
  const routes=["/fishery","/fishery/topics?topicId=funding","/fishery/synthetic-policy","/fishery/guides/synthetic-guide","/fishery/unknown/deeper"];
  try{
    mode="unauthorized";
    for(const route of routes){
      const response=await fetch(web.origin+route,{redirect:"manual"});
      assert.equal(response.status,302,route);assert.equal(response.headers.get("location"),"/api/auth/login?"+new URLSearchParams({return:route}));
      assert.match(response.headers.get("cache-control")??"",/no-store/);
    }
    mode="failure";
    for(const route of routes){
      const response=await fetch(web.origin+route,{redirect:"manual"});
      assert.equal(response.status,503,route);assert.equal(response.headers.get("location"),null);
      assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
    }
    mode="ready";
    for(const route of ["/fishery/missing","/fishery/guides/missing","/fishery/unknown/deeper","/fishery/missing.data","/fishery/guides/missing.data","/fishery/unknown/deeper.data"]){
      const response=await fetch(web.origin+route,{redirect:"manual"});
      assert.equal(response.status,404,route);assert.equal(response.headers.get("location"),null);
      assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
    }
  }finally{mode="ready";}
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

test("manual business guide editor sends normal CSRF and version-bound save and decision commands",async()=>{
  mode="ready";const page=await browser.newPage({viewport:{width:393,height:900}}),commands:{method:string;body:any;csrf:string|undefined}[]=[];
  await page.route("**/api/admin/fishery/business-guides/synthetic-guide",async route=>{commands.push({method:route.request().method(),body:route.request().postDataJSON(),csrf:route.request().headers()["x-csrf-token"]});await route.fulfill({json:{id:businessItem.id}});});
  await page.route("**/api/admin/fishery/business-guides/synthetic-guide/decision",async route=>{commands.push({method:route.request().method(),body:route.request().postDataJSON(),csrf:route.request().headers()["x-csrf-token"]});await route.fulfill({json:{id:businessItem.id}});});
  try{
    await visit(page,web.origin+"/admin/fishery/guides/synthetic-guide");await expect(page.getByRole("heading",{name:"业务指南编审",exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole("button",{name:"最终批准（须AI核查通过）",exact:true}).click();let dialog=page.getByRole("dialog");await dialog.getByRole("textbox").fill("Synthetic evidence reviewed");await dialog.getByLabel("本次审核执行身份",{exact:true}).selectOption("authorized_agent");await dialog.getByRole("checkbox").check();await dialog.getByRole("button",{name:"保存决定",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(commands[0]!.csrf,"synthetic-test-only");assert.equal(commands[0]!.body.expectedRevision,1);assert.equal(commands[0]!.body.payloadHash,"b".repeat(64));assert.equal(commands[0]!.body.snapshotHash,"a".repeat(64));assert.equal(commands[0]!.body.decision,"approved");assert.equal(commands[0]!.body.executorKind,"authorized_agent");assert.equal(commands[0]!.body.approvalMode,"final");assert.equal(commands[0]!.body.aiReviewHash,"e".repeat(64));
    const payload={...businessItem.payload,title:{...businessItem.payload.title,value:"合成编辑稿"}};await page.getByRole("textbox",{name:"指南 JSON",exact:true}).fill(JSON.stringify(payload));await expect(page.getByRole("button",{name:"最终批准（须AI核查通过）",exact:true})).toBeDisabled();await page.getByRole("textbox",{name:"编修原因",exact:true}).fill("Synthetic correction");await page.getByRole("button",{name:"保存编审草稿",exact:true}).click();await expect(page.getByRole("button",{name:"保存编审草稿",exact:true})).toBeEnabled();assert.equal(commands[1]!.method,"PUT");assert.equal(commands[1]!.csrf,"synthetic-test-only");assert.equal(commands[1]!.body.expectedRevision,1);assert.equal(commands[1]!.body.payload.title.value,"合成编辑稿");assert.equal(apiPaths.some(p=>/business.*(?:run|generate|process)/.test(p)),false);
  }finally{await page.close();}
});

test("administrator creates a manual guide from a current material evidence catalog",async()=>{
  mode="ready";const page=await browser.newPage({viewport:{width:320,height:900}}),requests:any[]=[];
  await page.route("**/api/admin/fishery/business-guides",async route=>{requests.push({body:route.request().postDataJSON(),csrf:route.request().headers()["x-csrf-token"]});await route.fulfill({json:{id:businessItem.id}});});
  try{
    await visit(page,web.origin+"/admin/fishery/guides/new?documentId="+item.id);await page.getByRole("textbox",{name:"指南 JSON",exact:true}).fill(JSON.stringify(businessItem.payload));await page.getByRole("textbox",{name:"编修原因",exact:true}).fill("Synthetic new editorial guide");assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole("button",{name:"保存编审草稿",exact:true}).click();await expect(page).toHaveURL(web.origin+"/admin/fishery/guides/"+businessItem.id);assert.equal(requests.length,1);assert.equal(requests[0].csrf,"synthetic-test-only");assert.equal(requests[0].body.documentId,item.id);assert.equal(requests[0].body.snapshotHash,"a".repeat(64));assert.equal(requests[0].body.payload.kind,"business_guide");await page.screenshot({path:path.join(process.env.FISHERY_SCREENSHOT_DIR??"/tmp/fishery-reader-preview","business-admin-320.png"),fullPage:true});
  }finally{await page.close();}
});


test("unavailable current evidence blocks editing but preserves withdrawal of an old guide",async()=>{
  mode="ready";unavailableBusinessContext=true;const page=await browser.newPage(),requests:any[]=[];
  await page.route("**/api/admin/fishery/business-guides/synthetic-guide/decision",async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:{id:businessItem.id}});});
  try{await visit(page,web.origin+"/admin/fishery/guides/synthetic-guide");await expect(page.getByRole("heading",{name:"当前证据不可编辑",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"保存编审草稿",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"最终批准（须AI核查通过）",exact:true})).toHaveCount(0);await page.getByRole("button",{name:"撤销批准",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByRole("textbox").fill("Synthetic withdrawn source");await dialog.getByLabel("本次审核执行身份",{exact:true}).selectOption("authorized_agent");await dialog.getByRole("checkbox").check();await dialog.getByRole("button",{name:"保存决定",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);assert.equal(requests[0].decision,"withdrawn");assert.equal(requests[0].snapshotHash,"a".repeat(64));}finally{await page.close();unavailableBusinessContext=false;}
});


test("manual archive import uses existing login and CSRF then links to normal material review",async()=>{
  mode="unauthorized";const denied=await fetch(web.origin+"/admin/fishery/manual-sources",{redirect:"manual"});assert.equal(denied.status,302);assert.equal(denied.headers.get("location"),"/api/auth/login?return=%2Fadmin%2Ffishery%2Fmanual-sources");mode="ready";
  const page=await browser.newPage({viewport:{width:320,height:900}}),commands:any[]=[];
  await page.route("**/api/admin/fishery/manual-sources/synthetic-manual-1/import",async route=>{commands.push({method:route.request().method(),csrf:route.request().headers()["x-csrf-token"],body:route.request().postDataJSON()});await route.fulfill({json:{archiveId:"synthetic-manual-1",rows:[{id:"synthetic-imported-material",revision:1,unchanged:false}],reviewState:"unreviewed",modelCalls:0,published:false}});});
  try{await visit(page,web.origin+"/admin/fishery/manual-sources");await expect(page.getByRole("heading",{level:1,name:"人工来源导入",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:/合成人工归档/})).toHaveCount(4);await expect(page.getByText("Synthetic archive hash mismatch",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"导入素材",exact:true}).last()).toBeDisabled();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole("button",{name:"导入素材",exact:true}).first().click();await expect(page.getByRole("link",{name:/打开素材，查看当前审核状态/})).toHaveAttribute("href","/admin/fishery/synthetic-imported-material");await expect(page.getByText("导入完成，当前审核状态见素材详情。未公开发布 · 模型调用 0 次",{exact:true})).toBeVisible();assert.deepEqual(commands,[{method:"POST",csrf:"synthetic-test-only",body:{}}]);await page.screenshot({path:path.join(process.env.FISHERY_SCREENSHOT_DIR??"/tmp/fishery-reader-preview","manual-sources-320.png"),fullPage:true});}finally{await page.close();mode="ready";}
});


test("administrator pending list separates old human approval from AI-gated final approval",async()=>{
  mode="ready";aiFixture="missing";const page=await browser.newPage({viewport:{width:393,height:900}});
  try{
    await visit(page,web.origin+"/admin/fishery/guides");await expect(page.getByRole("heading",{level:1,name:"业务指南待核查",exact:true})).toBeVisible();await expect(page.getByText("旧审核批准，AI核查待补，未完成完整审核链",{exact:true})).toHaveCount(4);await expect(page.getByRole("link",{name:"打开指南与审核链 →",exact:true})).toHaveCount(4);await expect(page.getByRole("button",{name:/创建核查|排队|运行/})).toHaveCount(0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const fixture of ["missing","stale","conflict","failed","passed"] as const){
      aiFixture=fixture;await page.goto(web.origin+"/admin/fishery/guides/synthetic-guide");const final=page.getByRole("button",{name:"最终批准（须AI核查通过）",exact:true});if(fixture==="passed")await expect(final).toBeEnabled();else await expect(final).toBeDisabled();await expect(page.getByRole("button",{name:"保存编审草稿",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/AI待补|人工参考/})).toHaveCount(0);
    }
    assert.equal(apiPaths.some(p=>/business.*(?:run|generate|process)/.test(p)),false);
  }finally{aiFixture="passed";await page.close();}
});
