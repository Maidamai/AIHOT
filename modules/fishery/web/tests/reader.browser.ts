// Production SSR/browser verification against a synthetic API. No real login or model provider.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { fakeApi, startWebServer, visit, type WebServer } from "../../../../apps/web/tests/web-server.ts";
import type { FisheryReaderItem, FisheryReaderPage } from "../../ui-contracts.ts";
const item:FisheryReaderItem={id:"synthetic-policy",title:"[合成界面验收，非真实资讯] 印度洋远洋捕捞配额核对资料",source:{name:"合成官方来源 · 仅用于界面验收",url:"https://example.org/synthetic-policy"},category:{id:"policy",label:"政策监管"},summary:[{sentence:"此合成资料用于检查内部摘要、原文日期及来源证据的呈现，不代表真实政策或业务审核。",evidence:[{quote:"This synthetic source excerpt is for interface verification only. It does not describe an actual conservation measure or authorize fishing operations.",paragraph:12,page:2,url:"https://example.org/synthetic-policy.pdf"}]}],dates:{published:{precision:"day",value:"2026-04-17"},event:{precision:"unknown",value:null}},age:{referenceDate:"2026-10-20",days:186,historical:true,label:"7日及更早原文资料"},verification:{status:"internally_qualified",label:"内部核对完成",legalApplicability:"未完成法律适用性核验"}};
const unknown:FisheryReaderItem={...item,id:"synthetic-pubunknown",title:"[合成界面验收] 发布日期未知的原文资料",dates:{...item.dates,published:{precision:"unknown",value:null}},age:{referenceDate:"2026-10-20",days:null,historical:false,label:"原文资料 · 发布日期未知"}};
let mode:"ready"|"empty"|"unauthorized"|"failure"="ready";
const apiPaths:string[]=[];
const api=fakeApi((url,res)=>{
  apiPaths.push(url.pathname);
  if(url.pathname==="/api/admin/me") {if(mode==="unauthorized")res.statusCode=401;return {};}
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
    await expect(page.getByText("历史资料",{exact:true})).toBeVisible();await expect(page.getByText("原文发布日期未知",{exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await expect(page.getByRole("link",{name:"模型",exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(folder,`list-${width}.png`),fullPage:true});
    await page.getByRole("link",{name:item.title,exact:true}).click();await expect(page.getByRole("heading",{name:"原文引证",exact:true})).toBeVisible();await expect(page.getByText(item.summary[0]!.evidence[0]!.quote,{exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole("link",{name:/原文第 12 段/}).getAttribute("rel"),"noopener noreferrer");
    await page.screenshot({path:path.join(folder,`detail-${width}.png`),fullPage:true});
    await page.goto(web.origin+"/fishery/missing/deeper");await expect(page.getByRole("heading",{name:"这份资料暂不可读",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"回到精选",exact:true})).toHaveCount(0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(folder,`error-${width}.png`),fullPage:true});await page.close();
  }
  mode="empty";const empty=await browser.newPage({viewport:{width:393,height:852}});await visit(empty,web.origin+"/fishery");await expect(empty.getByRole("heading",{name:"暂无可读资料",exact:true})).toBeVisible();await expect(empty.getByRole("link",{name:/政策监管/})).toHaveCount(0);await empty.screenshot({path:path.join(folder,"empty-393.png"),fullPage:true});await empty.close();
  assert.equal(apiPaths.some(p=>/model|generate|process|receipts/.test(p)),false);
});
