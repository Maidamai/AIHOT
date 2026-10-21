// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { chromium, expect } from "@playwright/test";
import { UNSAFE_decodeViaTurboStream } from "react-router";
import { fakeApi, feedItem, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

let web: WebServer;
let origin: string;
let deadline: number;
/** Root metadata answers only after the selected deadline has passed: a slow sibling loader. */
let metaAfterDeadline = false;
const apiCookies: Array<string | undefined> = [];
const api = fakeApi(async (url, res, req) => {
  apiCookies.push(req.headers.cookie);
  if (url.pathname === "/api/site/meta") {
    // Past the deadline on the wall clock the server reads: timers run on another clock, and a CI VM
    // stepping its wall clock back mid-wait would otherwise answer before the deadline.
    while (metaAfterDeadline && Date.now() < deadline * 1000 + 50) await new Promise((resolve) => setTimeout(resolve, deadline * 1000 + 50 - Date.now()));
    return { changelogVersion: "2026-09-28T12:00" };
  }
  if (url.pathname === "/api/site/timeline") {
    const filters = { channel: "all", category: url.searchParams.get("category"), tag: null };
    res.setHeader("X-Accel-Expires", `@${deadline}`);
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");
    return { filters, cards: [], nextCursor: null, dayCounts: [], hot: null };
  }
  if (url.pathname === "/api/site/pool") {
    res.setHeader("X-Accel-Expires", `@${deadline}`);
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");
    return { filters: { channel: "all", category: url.searchParams.get("category"), tag: null, q: null, tab: "time" }, items: [], page: 1, pageCount: 1, total: 0, todayCount: 0, freshness: "2026-10-04T08:00:00.000Z" };
  }
  if (url.pathname === "/api/site/hot") return { entries: [] };
  if (url.pathname === "/api/site/echo-client") return { forwarded: req.headers["x-forwarded-for"], real: req.headers["x-real-ip"] };
  if (url.pathname === "/api/site/download") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="article.md"');
    return res.end("# Article");
  }
  if (url.pathname === "/api/site/items/long-lived") return { id: "long-lived", title: "t" };
  if (url.pathname === "/api/site/contact") return { wechatQr: "/qr.png", feishuQr: "/qr.png" };
  if (url.pathname === "/api/site/stories/merged") {
    res.statusCode = 308;
    return { mergedInto: "surviving-story" };
  }
  if (url.pathname.startsWith("/api/admin/")) {
    res.statusCode = 401;
    return { code: "not_found" };
  }
});

before(async () => {
  deadline = Math.floor(Date.now() / 1000) + 20;
  web = await startWebServer(api);
  origin = web.origin;
});
after(() => web.stop());

test("public route subsets produce the same complete navigation data; filters still differ", async () => {
  const answers = await Promise.all(["", "?_routes=root", "?_routes=routes%2Fhome", "?_routes=unknown"].map(async (query) => {
    const res = await fetch(`${origin}/_.data${query}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control")!, /^public,/);
    assert.equal(res.headers.get("X-Accel-Expires"), `@${deadline}`);
    assert.doesNotMatch(res.headers.get("Cache-Control")!, /stale/);
    const body = await res.text();
    assert.ok(body.includes("root") && body.includes("routes/home"));
    return body;
  }));
  assert.ok(answers.every((body) => body === answers[0]));
  const category = CATEGORY_KEYS.at(-1)!;
  const filtered = await fetch(`${origin}/_.data?category=${category}&_routes=root`);
  const body = await filtered.text();
  assert.ok(body.includes(category));
  assert.notEqual(body, answers[0]);
});

test("navigation streams are plain text for download managers, including errors", async () => {
  for (const [pathname, status] of [["/_.data?_routes=root", 200], ["/items/missing.data", 404]] as const) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, status, pathname);
    assert.equal(res.headers.get("Content-Type"), "text/plain; charset=utf-8", pathname);
    assert.equal(res.headers.get("Content-Disposition"), null, pathname);
    assert.ok((await res.text()).length > 0, pathname);
  }
  const download = await fetch(origin + "/api/site/download");
  assert.equal(download.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(download.headers.get("Content-Disposition"), 'attachment; filename="article.md"');
  assert.equal(await download.text(), "# Article");
});

test("HTML and navigation share freshness; cookies do not personalize public results", async () => {
  const html = await fetch(`${origin}/`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("X-Accel-Expires"), `@${deadline}`);
  assert.match(await html.text(), /精选/);
  // The api's deadline also fixes the result's own expiry, so reads seconds apart compare byte for byte.
  const plain = await fetch(`${origin}/_.data`);
  const signedIn = await fetch(`${origin}/_.data?_routes=root`, { headers: { cookie: "admin_session=private; reader=returning" } });
  assert.match(plain.headers.get("Cache-Control")!, /^public,/);
  assert.equal(plain.headers.get("X-Accel-Expires"), `@${deadline}`);
  assert.equal(signedIn.headers.get("Set-Cookie"), null);
  assert.equal(await signedIn.text(), await plain.text());
  assert.ok(apiCookies.every((cookie) => !cookie));
});

test("missing routes cannot be hidden by a root-only request; errors and redirects stay uncached", async () => {
  for (const pathname of ["/items/missing.data?_routes=root", "/does-not-exist.data?_routes=root", "/items/missing"]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 404, pathname);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("X-Accel-Expires"), "0");
    await res.text();
  }
  for (const [pathname, target] of [["/story/merged.data?_routes=root", "/story/surviving-story"], ["/_.data?q=search&_routes=root", "/all?q=search"]]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 202);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.match(await res.text(), new RegExp(target.replace("?", "\\?")));
  }
});

test("admin data and actions never become public cache entries", async () => {
  const admin = await fetch(`${origin}/admin/sources.data?_routes=admin-layout`);
  assert.equal(admin.status, 202);
  assert.equal(admin.headers.get("Cache-Control"), "private, no-store");
  assert.equal(admin.headers.get("X-Accel-Expires"), "0");
  assert.match(await admin.text(), /api\/auth\/login/);
  const action = await fetch(`${origin}/hot.data`, { method: "POST" });
  assert.equal(action.status, 405);
  assert.equal(action.headers.get("Cache-Control"), "private, no-store");
  assert.equal(action.headers.get("X-Accel-Expires"), "0");
  await action.text();
});

test("browser freshness shares the selected deadline, including slow sibling loaders", async () => {
  const savedDeadline = deadline;
  try {
    deadline = Math.floor(Date.now() / 1000) + 20;
    for (const pathname of ["/", "/_.data?_routes=routes%2Fhome"]) {
      const res = await fetch(origin + pathname);
      const cc = res.headers.get("Cache-Control")!;
      const browser = Number(cc.match(/(?:^|,)\s*max-age=(\d+)/)![1]);
      const shared = Number(cc.match(/(?:^|,)\s*s-maxage=(\d+)/)![1]);
      assert.ok(browser > 0 && browser === shared);
      assert.ok(Date.parse(res.headers.get("Date")!) / 1000 + browser <= deadline);
      assert.equal(res.headers.get("X-Accel-Expires"), `@${deadline}`);
      assert.match(cc, /must-revalidate/);
      assert.doesNotMatch(cc, /stale/);
      await res.text();
    }
    // The selected loader initially grants a positive TTL (at least a whole second), but root metadata
    // finishes after it.
    deadline = Math.floor(Date.now() / 1000) + 2;
    metaAfterDeadline = true;
    await Promise.all(["/", "/_.data?_routes=routes%2Fhome"].map(async (pathname) => {
      const res = await fetch(origin + pathname);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Cache-Control"), "no-cache");
      assert.equal(res.headers.get("X-Accel-Expires"), "0");
      await res.text();
    }));
  } finally {
    deadline = savedDeadline;
    metaAfterDeadline = false;
  }
});

test("a shared cache may keep an item page longer than browsers", async () => {
  const res = await fetch(`${origin}/items/long-lived.data`);
  assert.equal(res.status, 200);
  const cc = res.headers.get("Cache-Control")!;
  assert.equal(Number(cc.match(/(?:^|,)\s*max-age=(\d+)/)![1]), 300);
  assert.ok(Number(cc.match(/(?:^|,)\s*s-maxage=(\d+)/)![1]) > 300);
  await res.text();
});

// A tab opened before a page lost its loader still asks for that page's result, and its router rejects
// a missing one before React's release recovery can run.
test("a page without a loader still answers navigation with an empty result", async () => {
  const res = await fetch(`${origin}/terms.data?_routes=routes%2Fterms`);
  assert.equal(res.status, 200);
  const { value } = await UNSAFE_decodeViaTurboStream(res.body!, globalThis);
  const result = value as Record<string, { data: unknown }>;
  assert.ok("routes/terms" in result, "an already open router must be able to unwrap its requested route");
  assert.equal(result["routes/terms"]!.data, null);
});

test("browser caching preserves noindex and private sign-in responses", async () => {
  const feedback = await fetch(origin + "/feedback");
  assert.equal(feedback.status, 200);
  assert.match(await feedback.text(), /name="robots" content="noindex/);
  assert.equal(feedback.headers.get("Cache-Control"), "public, max-age=300, s-maxage=300, must-revalidate");
  const login = await fetch(origin + "/admin/login");
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("Cache-Control"), "private, no-store");
  assert.equal(login.headers.get("X-Robots-Tag"), "noindex, nofollow");
  await login.text();
});

test("a visitor cannot name its own address to the api without a trusted proxy in front", async () => {
  const res = await fetch(`${origin}/api/site/echo-client`, { headers: { "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "6.6.6.6" } });
  assert.deepEqual(await res.json(), { forwarded: "127.0.0.1", real: "127.0.0.1" });
});

// The real listener must own its ephemeral port; reserving and releasing one before spawn races
// another CI process. Canonical URLs still have to identify the listener's actual address.
test("a web server assigned port zero serves its own canonical address", async () => {
  const ephemeral = await startWebServer(fakeApi(), { WEB_PORT: "0", SITE_URL: "http://127.0.0.1:0" });
  try {
    const response = await fetch(`${ephemeral.origin}/about`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(`rel="canonical" href="${ephemeral.origin}/about"`));
  } finally { await ephemeral.stop(); }
});

test("private preview marks HTML and navigation no-store with zero page reuse lifetime", async () => {
  const card = feedItem({ id: "private-http", title: "Private HTTP fixture" });
  const privateWeb = await startWebServer(fakeApi(url => {
    if (url.pathname === "/api/site/timeline") return { filters: { category: null, channel: "all", tag: null }, cards: [{ key: card.id, anchorAt: card.timelineAt, item: card, group: null }], hot: null, nextCursor: null, dayCounts: {} };
  }), { PRIVATE_PREVIEW: "true" });
  try {
    for (const path of ["/", "/_.data", "/terms", "/terms.data"]) {
      const response = await fetch(privateWeb.origin + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store", path);
      assert.equal(response.headers.get("X-Accel-Expires"), "0", path);
      if (path === "/") assert.match(await response.text(), /data-private-preview="true"/);
      else if (path === "/_.data") {
        const decoded = await UNSAFE_decodeViaTurboStream(response.body!, globalThis);
        const routes = decoded.value as Record<string, { data: { privatePreview?: boolean; expiresAt?: number } }>;
        assert.equal(routes.root!.data.privatePreview, true);
        assert.equal(routes["routes/home"]!.data.expiresAt, 0);
      } else await response.text();
    }
  } finally { await privateWeb.stop(); }
});

test("private preview back navigation discards saved lists and open groups while retaining favorites", async () => {
  const card = feedItem({ id: "private-return", title: "Private current report" });
  let withdrawn = false;
  let timelineReads = 0;
  const filters = { category: null, channel: "all", tag: null };
  const privateWeb = await startWebServer(fakeApi((url, res) => {
    if (url.pathname === "/api/site/timeline") {
      timelineReads++;
      return { filters, cards: withdrawn ? [] : [{ key: card.id, anchorAt: card.timelineAt, item: card, group: { factId: "private-fact", reportCount: 2, additionalSourceCount: 1 } }], hot: null, nextCursor: null, dayCounts: {} };
    }
    if (url.pathname === "/api/site/pool") return { filters: { ...filters, q: null, tab: "time" }, items: [], page: 1, pageCount: 1, total: 0, todayCount: 0, freshness: card.timelineAt };
    if (url.pathname === "/api/site/groups/private-fact/reports") return { factId: "private-fact", reports: withdrawn ? [] : [{ id: "private-other", title: "Private other report", source: { name: "Fixture" }, timelineAt: card.timelineAt, originalUrl: "https://example.org/other" }] };
    if (url.pathname === "/api/site/items/private-return") {
      if (withdrawn) { res.statusCode = 404; return { code: "not_found" }; }
      return itemDetail({ id: card.id, title: card.title });
    }
  }), { PRIVATE_PREVIEW: "true" });
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.addInitScript(card => {
      sessionStorage.setItem("aihot:list:default", JSON.stringify({ savedAt: Date.now(), data: { version: 2, cards: [{ key: card.id, anchorAt: card.timelineAt, item: card, group: null }], nextCursor: null, dayCounts: {}, collapsed: [], batches: 1, unreadOnly: false }, anchor: null, scrollY: 0 }));
      sessionStorage.setItem("aihot:open-groups:default", JSON.stringify({ savedAt: Date.now(), groups: { old: [{ title: "Private other report" }] } }));
      const originalFetch = window.fetch.bind(window);
      (window as unknown as { privateReads: Array<{ url: string; cache?: string }> }).privateReads = [];
      window.fetch = (input, init) => {
        if (String(input).startsWith("/api/site/")) (window as unknown as { privateReads: Array<{ url: string; cache?: string }> }).privateReads.push({ url: String(input), cache: init?.cache });
        return originalFetch(input, init);
      };
    }, card);
    await visit(page, privateWeb.origin + "/");
    const dataRequests: string[] = [];
    page.on("request", request => { if (request.url().includes(".data")) dataRequests.push(request.url()); });
    const link = page.getByRole("link", { name: card.title, exact: true });
    await link.dispatchEvent("pointerdown", { button: 0, pointerType: "mouse", isPrimary: true });
    await page.waitForTimeout(150);
    assert.deepEqual(dataRequests, [], "a press cannot prefetch private navigation data");
    await page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "另外 1 家也报道了", exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole("link", { name: "Private other report", exact: true })).toBeVisible();
    assert.ok((await page.evaluate(() => (window as unknown as { privateReads: Array<{ cache?: string }> }).privateReads)).every(read => read.cache === "no-store"), "direct reader requests bypass the HTTP cache");
    await link.click();
    await expect(page).toHaveURL(privateWeb.origin + "/items/" + card.id);
    await expect(page.getByRole("heading", { name: card.title, exact: true, level: 1 })).toBeVisible();
    withdrawn = true;
    const before = timelineReads;
    await page.goBack();
    await expect(page.getByRole("link", { name: card.title, exact: true })).toHaveCount(0);
    await expect(page.getByText("暂无相关资讯与资料", { exact: true })).toBeVisible();
    assert.ok(timelineReads > before, "back reads current qualification instead of a visited page");
    await expect(page.getByRole("link", { name: "Private other report", exact: true })).toHaveCount(0);
    const storage = await page.evaluate(() => ({ keys: Object.keys(sessionStorage).filter(key => /^aihot:(list|open-groups):/.test(key)), favorites: localStorage.getItem("aihot-starred-items") }));
    assert.deepEqual(storage.keys, [], "private content snapshots are neither restored nor written");
    assert.ok(storage.favorites?.includes(card.id), "favorites are not cleared");
    const reloadRead = timelineReads;
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })))]);
    assert.ok(timelineReads > reloadRead, "bfcache restoration reloads the private document");
  } finally { await browser.close(); await privateWeb.stop(); }
});

test("private preview never flashes a remembered phone summary before a withdrawn detail is rejected", async () => {
  const card = feedItem({ id: "private-phone", title: "Private stale phone card" });
  let detailRequested = false;
  const privateWeb = await startWebServer(fakeApi(async (url, res) => {
    if (url.pathname === "/api/site/timeline") return { filters: { category: null, channel: "all", tag: null }, cards: [{ key: card.id, anchorAt: card.timelineAt, item: card, group: null }], hot: null, nextCursor: null, dayCounts: {} };
    if (url.pathname === "/api/site/items/private-phone") {
      detailRequested = true;
      await new Promise(resolve => setTimeout(resolve, 200));
      res.statusCode = 404;
      return { code: "not_found" };
    }
  }), { PRIVATE_PREVIEW: "true" });
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await visit(page, privateWeb.origin + "/");
    await page.evaluate(() => {
      (window as unknown as { previewFlashes: string[] }).previewFlashes = [];
      new MutationObserver(() => {
        const preview = document.querySelector("article[aria-busy=true]");
        if (preview) (window as unknown as { previewFlashes: string[] }).previewFlashes.push(preview.textContent ?? "");
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await page.getByRole("link", { name: card.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: "找不到这个页面", exact: true })).toBeVisible();
    assert.equal(detailRequested, true);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { previewFlashes: string[] }).previewFlashes), []);
    await expect(page.getByText(card.title, { exact: true })).toHaveCount(0);
  } finally { await browser.close(); await privateWeb.stop(); }
});
