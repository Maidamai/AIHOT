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
let browser: Browser;
let web: WebServer;
const reads: Array<{ path: string; method: string; cookie: string }> = [];
const api = fakeApi((url, response, request) => {
  if (!url.pathname.startsWith("/api/admin/")) return;
  const cookie = request.headers.cookie ?? "";
  reads.push({ path: url.pathname, method: request.method ?? "", cookie });
  if (!cookie.includes("admin_session=synthetic-archive")) { response.statusCode = 401; return { code: "unauthorized" }; }
  if (url.pathname === "/api/admin/me") return { name: "Synthetic admin", csrf: "synthetic-csrf", dev: false };
  if (url.pathname === "/api/admin/nav-counts") return {};
  if (url.pathname === "/api/admin/fishery/batches") return { rows: batches, archiveStatus: status, progress: [], rounds: [] };
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
