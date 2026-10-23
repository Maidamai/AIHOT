// Synthetic status DTOs only: loading the existing admin page must never start an archive/model job.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import type { ArchiveStatus } from "../../../modules/fishery/backend/archive-worker.ts";
import type { BatchListEntry } from "../../../modules/fishery/backend/column-batches.ts";
import { fakeApi, startWebServer, visit, type WebServer } from "./web-server.ts";

const initial: ArchiveStatus = {
  enabled: true, coreSourceEnabled: false, mode: "hourly", runId: "synthetic-authorization",
  heartbeatAt: "2026-10-21T10:00:00Z", lastSuccessAt: "2026-10-21T09:58:00Z", lastFailureAt: null, lastError: null,
  currentRound: "synthetic-current-round", lastRound: "synthetic-previous-round", pendingCandidates: 17,
  cursorUrl: "https://example.org/synthetic/list_3.htm", coverage: "more_pages", maxPages: 1, maxArticles: 5,
  nextRunAt: "2026-10-21T11:00:00Z", consecutiveFailures: 0, pausedReason: null, validationClaimed: null, validationLimit: null,
};
const batches: BatchListEntry[] = [
  { version: "fishery-column-batch/0.1", id: "synthetic-existing-batch", startedAt: "2026-10-20T09:00:00Z", finishedAt: "2026-10-20T09:01:00Z", status: "complete", sources: [], items: [] },
  { id: "synthetic-unreadable-batch", status: "unreadable", error: "Synthetic unreadable archive record" },
];
let status: ArchiveStatus | undefined = initial;
let sourceStatuses:ArchiveStatus[]|undefined;
let browser: Browser;
let web: WebServer;
const reads: Array<{ path: string; method: string; cookie: string }> = [];
const createdSelections:Array<{identity:string;selection:boolean}>=[];
const syntheticDate={precision:'unknown',value:null};
const selectionMaterial={
 id:'synthetic-selection-material',sourceId:'synthetic',title:'合成测试：单任务选材',issuer:'Synthetic',sourceAttribution:'Synthetic',canonicalUrl:'https://example.org/synthetic',documentNumber:null,articleId:null,withdrawnReason:null,
 state:'pending',testOnly:true,blockers:[{code:'synthetic',message:'仅供隔离浏览器测试'}],
 source:{id:'synthetic',name:'Synthetic',revision:1,enabled:false,participationMode:'editorial',testOnly:true,profile:{rightsStatus:'unknown',allowedSummary:false,allowedPublication:false,rightsCheckedAt:null,reviewDueAt:null,evidenceUrl:null}},
 latest:{revision:1,observedAt:'2026-10-21T10:00:00Z',actor:'synthetic',contentHash:'a'.repeat(64),payload:{originalTitle:'Synthetic original',title:'合成测试',summaryZh:'合成素材，不能当真实报道。',rawSha256:'a'.repeat(64),language:'zh',policyStatus:'unknown',dates:{published:syntheticDate,adopted:syntheticDate,effectiveFrom:syntheticDate,effectiveUntil:syntheticDate},scope:{regions:[],species:[],flags:[],activities:[],unknownFields:[]},evidence:[]}},
 review:null,observations:[],reviews:[],text:{body:'合成远洋渔业测试正文。',truncated:false,hashMatches:true,acquisitionMode:'archive_replay'}
};
const api = fakeApi(async(url, response, request) => {
  if (!url.pathname.startsWith("/api/admin/")) return;
  const cookie = request.headers.cookie ?? "";
  reads.push({ path: url.pathname, method: request.method ?? "", cookie });
  if (!cookie.includes("admin_session=synthetic-archive")) { response.statusCode = 401; return { code: "unauthorized" }; }
  if (url.pathname === "/api/admin/me") return { name: "Synthetic admin", csrf: "synthetic-csrf", dev: false };
  if (url.pathname === "/api/admin/nav-counts") return {};
  if (url.pathname === "/api/admin/fishery/batches") return { rows: batches, archiveStatus: status, archiveSources:sourceStatuses, progress: [], rounds: [] };
  if(url.pathname==='/api/admin/fishery/documents/synthetic-selection-material/detail')return selectionMaterial;
  if(url.pathname==='/api/admin/fishery/documents/synthetic-selection-material/flows'){
   if(request.method==='GET')return {rows:[]};
   assert.equal(request.method,'POST');assert.equal(request.headers['x-csrf-token'],'synthetic-csrf');
   let body='';for await(const chunk of request)body+=chunk.toString();createdSelections.push(JSON.parse(body));response.statusCode=201;return {id:'synthetic-task',status:'queued'};
  }
});
before(async () => { browser = await chromium.launch({ channel: "chromium" }); web = await startWebServer(api); });
after(async () => { await browser?.close(); await web?.stop(); });

async function authorizedPage(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addCookies([{ name: "admin_session", value: "synthetic-archive", url: web.origin }]);
  return { context, page: await context.newPage() };
}

test("existing collection page distinguishes controlled archive from disabled core source and refreshes failures", async () => {
  status = { ...initial };
  const { context, page } = await authorizedPage();
  try {
    await page.clock.install();
    await visit(page, web.origin + "/admin/fishery/collect");
    const card = page.getByRole("region", { name: "Moa 受控归档状态" });
    await expect(card.getByText("已启用", { exact: true })).toBeVisible();
    await expect(card.getByText("已停用", { exact: true })).toBeVisible();
    await expect(card.getByText("synthetic-current-round", { exact: true })).toBeVisible();
    await expect(card.getByText("synthetic-previous-round", { exact: true })).toBeVisible();
    await expect(card.getByText("剩余候选", { exact: true }).locator("..")).toContainText("17");
    await expect(card.locator('time[datetime="2026-10-21T10:00:00Z"]')).toBeVisible();
    await expect(card.locator('time[datetime="2026-10-21T09:58:00Z"]')).toBeVisible();
    await expect(card.locator('time[datetime="2026-10-21T11:00:00Z"]')).toBeVisible();
    await expect(card.getByText(initial.cursorUrl!, { exact: true })).toBeVisible();
    await expect(card.getByText("尚有后续页（more_pages）", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "运行记录", exact: true })).toHaveAttribute("href", "/admin/runs");
    await expect(card.getByRole("link", { name: "核心信源", exact: true })).toHaveAttribute("href", "/admin/sources/fishery-column-moa");
    await expect(page.getByText("synthetic-existing-batch", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic unreadable archive record", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "导入或记录采集结果", exact: true })).toBeDisabled();
    await expect(page.getByText("归档不自动进行付费加工、审核或发布", { exact: false })).toBeVisible();
    await page.screenshot({ path: "/tmp/archive-status-synthetic-desktop.png", fullPage: true });
    status = { ...initial, enabled: false, currentRound: null, lastRound: "synthetic-current-round", lastFailureAt: "2026-10-21T10:01:00Z", lastError: "Synthetic gateway failure", nextRunAt: null, consecutiveFailures: 3, pausedReason: "Three synthetic failures; inspect before reauthorization" };
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await expect(card.getByText("已暂停", { exact: true })).toBeVisible();
    await expect(card.getByText("连续失败", { exact: true }).locator("..")).toContainText("3");
    await expect(card.getByText("Synthetic gateway failure", { exact: true })).toBeVisible();
    await expect(card.getByText(status.pausedReason!, { exact: true })).toBeVisible();
    await expect(card.getByText("当前轮", { exact: true }).locator("..")).toContainText("未记录");
    await expect(card.getByText("下次执行", { exact: true }).locator("..")).toContainText("—");
    await expect(card.locator('time[datetime="2026-10-21T10:01:00Z"]')).toBeVisible();
    const beforeRefresh = reads.filter(read => read.path === "/api/admin/fishery/batches").length;
    await page.clock.fastForward(20_000);
    await expect.poll(() => reads.filter(read => read.path === "/api/admin/fishery/batches").length).toBeGreaterThan(beforeRefresh);
    assert.ok(reads.some(read => read.path === "/api/admin/fishery/batches" && read.cookie.includes("admin_session=synthetic-archive")));
    assert.ok(reads.every(read => read.method === "GET"), "viewing and refreshing only read authenticated status");
  } finally { await context.close(); }
});

test("missing archive state and null health stay unknown on the existing phone admin page", async () => {
  status = undefined;
  const { context, page } = await authorizedPage(390);
  try {
    await visit(page, web.origin + "/admin/fishery/collect");
    const card = page.getByRole("region", { name: "Moa 受控归档状态" });
    await expect(card.getByText("受控归档状态尚未提供", { exact: false })).toBeVisible();
    await expect(card.getByText("已启用", { exact: true })).toHaveCount(0);
    status = { ...initial, enabled: false, coreSourceEnabled: null, mode: "validation", runId: null, heartbeatAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null, currentRound: null, lastRound: null, pendingCandidates: null, cursorUrl: null, coverage: null, nextRunAt: null, validationClaimed: 0, validationLimit: 2 };
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await expect(card.getByText("未启用", { exact: true })).toBeVisible();
    await expect(card.getByText("最后心跳", { exact: true }).locator("..")).toContainText("—");
    await expect(card.getByText("剩余候选", { exact: true }).locator("..")).toContainText("未知");
    await expect(card.getByText("覆盖范围未知", { exact: true })).toBeVisible();
    await expect(card.getByText("验证轮次已认领 0/2", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-existing-batch", { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: "/tmp/archive-status-synthetic-phone.png", fullPage: true });
  } finally { await context.close(); }
});

test("collection status uses the original admin authentication redirect and never serves anonymous status", async () => {
  const response = await fetch(web.origin + "/admin/fishery/collect", { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.ok(response.headers.get("Location")?.startsWith("/api/auth/login?"));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.ok(!(await response.text()).includes("synthetic-authorization"));
});
test("existing health page separates NPFC failures and six-hour cadence from healthy MARA",async()=>{
 sourceStatuses=[{...initial,sourceId:'fishery-column-moa',sourceName:'MARA'},{...initial,sourceId:'fishery-column-npfc',sourceName:'NPFC',mode:'six_hourly',maxArticles:1,enabled:false,lastError:'Synthetic NPFC unavailable',consecutiveFailures:3,pausedReason:'Inspect NPFC before resuming',coverage:'current_page_only'}];
 const {context,page}=await authorizedPage(390);
 try{await visit(page,web.origin+'/admin/fishery/collect');const m=page.getByRole('region',{name:'MARA 受控归档状态'}),n=page.getByRole('region',{name:'NPFC 受控归档状态'});await expect(m.getByText('已启用',{exact:true})).toBeVisible();await expect(n.getByText('已暂停',{exact:true})).toBeVisible();await expect(n.getByText('每 6 小时',{exact:true})).toBeVisible();await expect(n.getByText('Synthetic NPFC unavailable',{exact:true})).toBeVisible();await expect(n.getByText('仅本页（current_page_only）',{exact:true})).toBeVisible();await expect(n.getByRole('link',{name:'核心信源'})).toHaveAttribute('href','/admin/sources/fishery-column-npfc');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 finally{sourceStatuses=undefined;await context.close();}
});

test('single-task selection is opt-in, persists only the explicit choice and never starts model processing on creation',async()=>{
 const {context,page}=await authorizedPage(390);createdSelections.length=0;
 try{
  await visit(page,web.origin+'/admin/fishery/synthetic-selection-material');
  const choice=page.getByRole('checkbox',{name:/本任务先做预筛和双评分/});
  await expect(choice).not.toBeChecked();await expect(page.getByText(/最多新增3次调用/)).toBeVisible();
  await page.getByLabel('任务尝试名称').fill('synthetic-default-off');
  await page.getByRole('button',{name:'创建内部审核任务',exact:true}).click();
  await expect.poll(()=>createdSelections.length).toBe(1);assert.equal(createdSelections[0].selection,false);
  await choice.check();await page.getByLabel('任务尝试名称').fill('synthetic-explicit-choice');
  await page.getByRole('button',{name:'创建内部审核任务',exact:true}).click();
  await expect.poll(()=>createdSelections.length).toBe(2);assert.equal(createdSelections[1].selection,true);
  assert.ok(!reads.some(r=>r.method==='POST'&&/\/flows\/[^/]+\/run/.test(r.path)));
  await page.reload();await expect(choice).not.toBeChecked();
 }finally{await context.close();}
});
