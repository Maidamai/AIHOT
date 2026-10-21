// Clearly synthetic API data: exercise the original reading routes, never a production source or approval.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import type { BusinessGuideReaderItem } from "../../../modules/fishery/business-contracts.ts";
import { fakeApi, feedItem, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

const at = "2026-10-04T08:00:00.000Z";
const unknown = { state: "unknown" as const, value: null, evidence: [] as [] };
const unknownDate = { value: { precision: "unknown" as const, value: null }, evidence: [] };
const guide = {
  id: "synthetic-guide", documentId: "synthetic-document", revision: 1,
  payload: {
    topicId: "compliance", kind: "business_guide",
    title: { value: "合成测试：履约资料指南", evidence: ["p1s1"] },
    summary: [{ value: "这是浏览器测试合成资料，不是真实办理依据。", evidence: ["p1s1"] }],
    audience: { state: "documented", value: "仅限合成测试对象", evidence: ["p1s1"] }, opportunity: unknown, restrictions: unknown, materials: unknown,
    applicability: { countriesOrRegions: unknown, flagStates: unknown, species: unknown, fishingMethods: unknown },
    documentStatus: unknown, dates: { published: unknownDate, effectiveFrom: unknownDate, deadline: { value: { precision: "day", value: "2020-01-01" }, evidence: ["p1s1"] }, expiresAt: unknownDate },
    serviceEntry: { state: "documented", label: "合成测试官方信息入口", url: "https://example.org/synthetic-service", evidence: ["p1s1"] }, relations: [],
  },
  source: { name: "Synthetic source", url: "https://example.org/synthetic", originalTitle: "Synthetic guide source", published: { precision: "unknown", value: null }, publishedAt: null, publicationLiteral: null, capturedAt: at },
  snapshot: { version: "fishery-business-guide/1", documentId: "synthetic-document", sourceId: "synthetic-source", articleId: "synthetic-guide", canonicalUrl: "https://example.org/synthetic", sourceRevision: 1, sourceProfileHash: "a".repeat(64), observationRevision: 1, observationHash: "a".repeat(64), rawSha256: "a".repeat(64), bodySha256: "b".repeat(64), materialReviewId: 1, materialReviewHash: "c".repeat(64), catalogHash: "d".repeat(64), catalogVersion: "synthetic" },
  evidence: { p1s1: { quote: "合成证据：本测试只用于验证阅读界面。", paragraph: 1, page: null, url: "https://example.org/synthetic" } },
  verifiedAt: at, timeliness: { checkedAt: at, timeZone: "Asia/Shanghai", deadline: { state: "elapsed", lastDate: "2020-01-01" }, expiry: { state: "unknown", lastDate: null }, label: "已截止（按原文日期）；可申请状态未知/待核实" },
  qualification: { status: "qualified", label: "合成测试资格" }, verification: { executorKind: "authorized_agent", origin: "human_editorial", aiStatus: "passed", label: "合成审核链", legalApplicability: "not_determined" },
  eligibility: { canApply: null, canFish: null }, internalOnly: true,
} satisfies BusinessGuideReaderItem;
const article = feedItem({ id: "synthetic-article", title: "合成测试：历史政策资料", category: "policy", tags: ["政策"], publishedAt: "2020-01-01T00:00:00.000Z", selected: false, score: null, reason: null });
const guideCard = feedItem({ id: "synthetic-guide", title: guide.payload.title.value, category: "reference", tags: ["办事指南", "许可配额履约"], publishedAt: null, selected: false, score: null, reason: null, reference: { kind: "business_guide", checkedAt: "2026-10-21T02:00:00Z", deadlineDate: "2020-01-01", expiryDate: null } });
const hits: string[] = [];
let browser: Browser;
let web: WebServer;
const api = fakeApi(url => {
  hits.push(url.pathname + url.search);
  const category = url.searchParams.get("category");
  const filters = { category, channel: "all", tag: null };
  if (url.pathname === "/api/site/timeline") return { filters, cards: category === "equipment" ? [{ key: "real-selected", anchorAt: at, item: feedItem({ id: "real-selected", title: "合成测试：已有精选", category: "equipment" }), group: null }] : [], nextCursor: null, hot: null, dayCounts: {} };
  if (url.pathname === "/api/site/pool") {
    const q = url.searchParams.get("q");
    const midnight = url.searchParams.get("tag") === "synthetic-midnight";
    const timedGuide = midnight ? { ...guideCard, reference: { ...guideCard.reference!, checkedAt: "2026-11-01T15:59:59Z", deadlineDate: "2026-11-01" } } : guideCard;
    const items = (q || url.searchParams.get("tag")) ? [timedGuide] : category === "policy" ? [article] : [article, guideCard];
    return { filters: { ...filters, q, tab: "time" }, items, page: 1, pageCount: 1, total: items.length, todayCount: 0, freshness: at };
  }
  if (url.pathname === "/api/site/items/synthetic-guide") return itemDetail({ ...guideCard, x: null, discoveredAt: at, links: { original: guide.source.url }, readingMode: "summary-only", body: null, hasTranslation: false, markdownAvailable: false, moduleDetails: { fishery: { kind: "business_guide", guide } } });
  if (url.pathname === "/api/site/items/synthetic-article") return itemDetail({ ...article, x: null, discoveredAt: at });
  if (url.pathname === "/api/site/topics/compliance") return {
    topic: { slug: "compliance", name: "许可配额履约", group: "field", groupName: "业务主题", definition: "合成测试主题", brand: null,
      total: 0, recent: 0, indexable: false, latest: null, poolTotal: 1, poolHref: "/all?tag=" + encodeURIComponent("许可配额履约") },
    modules: {}, items: [], page: 1, pageCount: 1, pageSize: 20,
  };
  if (url.pathname === "/api/site/topics") return { groups: [{ key: "field", name: "业务主题" }], topics: [{ slug: "compliance", name: "许可配额履约", group: "field", definition: "合成测试主题", brand: null, total: 0, recent: 0, indexable: false, latest: null, poolTotal: 1 }] };
  if (url.pathname === "/api/site/hot") return { computedAt: null, windowHours: 48, entries: [] };
  if (url.pathname === "/api/site/reports/daily/latest-page") return { index: [], report: null };
  if (url.pathname === "/api/site/items/availability") return {};
});
before(async () => { browser = await chromium.launch({ channel: "chromium" }); web = await startWebServer(api); });
after(async () => { await browser?.close(); await web?.stop(); });

test("original desktop home falls back honestly, filters and searches into core item details", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await visit(page, web.origin + "/");
    await expect(page.getByRole("heading", { name: "行业动态与资料", exact: true })).toBeVisible();
    await expect(page.getByText("按实际收录展示，尚未标为精选。", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: article.title, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "行业文章", exact: true })).toContainText(article.title);
    await expect(page.getByRole("region", { name: "参考资料", exact: true })).toContainText(guideCard.title);
    await expect(page.getByRole("status", { name: "文载时效" })).toHaveText("已截止（按原文日期）· 仅供历史参考");
    await expect(page.getByText("历史原文 · 原文发布于 2020-01-01", { exact: true })).toBeVisible();
    await expect(page.getByText("参考资料 · 原文发布日期未知 · 适用与截止状态请核对文载证据", { exact: true })).toBeVisible();
    await expect(page.getByText("收录日期 · 不代表原文发布或更新", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: "/tmp/original-reading-synthetic-home-desktop.png", fullPage: true });
    await page.getByRole("link", { name: "政策", exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/category=policy/);
    await expect(page.getByRole("link", { name: article.title, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: guideCard.title, exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: article.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: article.title, exact: true })).toBeVisible();
    await expect(page.getByText("2020-01-01", { exact: false }).filter({ visible: true }).first()).toBeVisible();
    await visit(page, web.origin + "/all?q=履约");
    await page.getByRole("link", { name: guideCard.title, exact: true }).click();
    await expect(page).toHaveURL(/\/items\/synthetic-guide$/);
    await expect(page.getByRole("heading", { name: "材料清单", exact: true })).toBeVisible();
    await expect(page.getByText("授权代理审核（声明）", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "文载状态", exact: true }).locator("..")).toContainText("未知，待确认");
    await page.getByText("查看原文短引与证据（1）", { exact: true }).first().click();
    await expect(page.getByText("合成证据：本测试只用于验证阅读界面。", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "合成测试官方信息入口", exact: false })).toHaveAttribute("href", "https://example.org/synthetic-service");
    await expect(page.getByText("收录于", { exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/original-reading-synthetic-guide-desktop.png", fullPage: true });
    await visit(page, web.origin + "/topics");
    await expect(page.getByRole("link", { name: /许可配额履约/ })).toContainText("合格收录 1 条");
    await page.getByRole("link", { name: /许可配额履约/ }).click();
    await expect(page.getByRole("region", { name: "本主题已收录内容" })).toContainText(guideCard.title);
    await expect(page.getByText("本主题尚无精选，以下为已收录的合格资料与报道；收录不代表近期发布或当前有效。", { exact: true })).toBeVisible();
    await expect(page.getByText("这个主题暂时还没有精选内容", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: "/tmp/original-reading-synthetic-topic-clarity.png", fullPage: true });
    await page.getByRole("link", { name: "查看已收录资料（1） →", exact: true }).click();
    await expect(page).toHaveURL(/tag=/);
    assert.equal(new URL(page.url()).searchParams.get("tag"), "许可配额履约");
    await expect(page.getByRole("link", { name: guideCard.title, exact: true })).toBeVisible();
    assert.ok(hits.some(h => h.startsWith("/api/site/pool?category=policy")));
    assert.ok(!hits.some(h => h.startsWith("/api/admin/")));
  } finally { await context.close(); }
});

test("original phone filters, guide fields and local favorites remain usable without a reader shell", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await visit(page, web.origin + "/");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await page.getByRole("link", { name: "政策", exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/category=policy/);
    await visit(page, web.origin + "/items/synthetic-guide");
    await expect(page.getByRole("heading", { name: guide.payload.title.value })).toBeVisible();
    await expect(page.getByRole("heading", { name: "适用对象" })).toBeVisible();
    await expect(page.getByText("收录于", { exact: true })).toBeVisible();
    assert.equal(await page.locator(".reader-shell").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: "/tmp/original-reading-synthetic-guide-phone.png", fullPage: true });
    const star = page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true });
    await star.click();
    await expect(page.getByRole("button", { name: "已收藏", exact: true }).filter({ visible: true })).toBeVisible();
  } finally { await context.close(); }
});

test("a real selected timeline remains selected and does not read the fallback pool", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const start = hits.length;
    await visit(page, web.origin + "/?category=equipment");
    await expect(page.getByRole("link", { name: "合成测试：已有精选", exact: true })).toBeVisible();
    assert.ok(!hits.slice(start).some(h => h.startsWith("/api/site/pool")));
    await expect(page.getByRole("heading", { name: "行业动态与资料", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});


test("synthetic guide card crosses Beijing deadline midnight and empty summaries return to readable content", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.clock.install({ time: new Date("2026-11-01T15:59:59Z") });
    await visit(page, web.origin + "/?tag=synthetic-midnight");
    await expect(page.getByRole("status", { name: "文载时效" })).toHaveText("可申请状态未知／待核实");
    await page.clock.runFor(2100);
    await expect(page.getByRole("status", { name: "文载时效" })).toHaveText("已截止（按原文日期）· 仅供历史参考");
    await visit(page, web.origin + "/hot");
    await expect(page.getByText("热度榜尚未启用", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("实时热度", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "阅读行业动态与资料 →", exact: true }).click();
    await expect(page.getByRole("link", { name: article.title, exact: true })).toBeVisible();
    await visit(page, web.origin + "/daily");
    await expect(page.getByText("此汇总入口尚未启用，暂无已发布期刊。", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "阅读行业动态与资料 →", exact: true }).click();
    await expect(page.getByRole("link", { name: guideCard.title, exact: true })).toBeVisible();
  } finally { await context.close(); }
});
