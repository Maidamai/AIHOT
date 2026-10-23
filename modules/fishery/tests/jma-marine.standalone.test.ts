import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedJmaGet } from "../backend/jma-cache.ts";
import { currentJmaMetadata, jmaFeeds, jmaHash, jmaRecoveryStatus, jmaUrl, parseJmaBulletin, parseJmaFeed } from "../backend/jma-marine.ts";

const url = "https://www.data.jma.go.jp/developer/xml/data/20261023000000_0_TEST_010000.xml";
const now = "2026-10-23T01:00:00Z";
// Synthetic XML only; no live fixtures and no network in tests.
function xml(o: Record<string, string> = {}) {
  return `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control><Title>海上テスト</Title><DateTime>${o.sent ?? "2026-10-23T00:00:00Z"}</DateTime><Status>${o.status ?? "通常"}</Status><EditorialOffice>${o.office ?? "気象庁本庁"}</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>テスト</Title><ReportDateTime>${o.published ?? "2026-10-23T09:00:00+09:00"}</ReportDateTime><TargetDateTime>${o.target ?? "2026-10-24T09:00:00+09:00"}</TargetDateTime>${o.valid ? `<ValidDateTime>${o.valid}</ValidDateTime>` : ""}<EventID>${o.event ?? ""}</EventID><InfoType>${o.info ?? "発表"}</InfoType><Serial>${o.serial ?? ""}</Serial><InfoKind>テスト</InfoKind><InfoKindVersion>1.0</InfoKindVersion>
  <Headline><Information><Item><Areas codeType="海域表"><Area><Name>海区A</Name><Code>001</Code></Area></Areas></Item></Information></Headline></Head>
  <Body><Warning type="陸域"><Item><Area><Name>県A</Name><Code>001</Code></Area><Kind><Status>解除</Status></Kind></Item></Warning></Body></Report>`;
}
const report = (o: Record<string, string> = {}) => parseJmaBulletin(xml(o), url);
const state = (rs: ReturnType<typeof report>[], at = now) => currentJmaMetadata(rs, at, 6 * 3_600_000);

test("publication, issue, forecast and expiry clocks remain distinct; area codes retain leading zeros and tables", () => {
  const r = report();
  assert.equal(r.sentAt, "2026-10-23T00:00:00Z");
  assert.equal(r.publishedAt, "2026-10-23T09:00:00+09:00");
  assert.equal(r.targetAt, "2026-10-24T09:00:00+09:00");
  assert.equal(r.validUntil, null);
  assert.deepEqual(r.areas, [{ name: "海区A", code: "001", codeType: "海域表", type: null }, { name: "県A", code: "001", codeType: null, type: "陸域" }]);
  assert.equal(r.navigationWarningComplete, false);
});
test("binary input retains the original byte hash including BOM, and rejects invalid UTF-8", () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml())]);
  assert.equal(parseJmaBulletin(bytes, url).sha256, jmaHash(bytes));
  assert.throws(() => parseJmaBulletin(Buffer.from([0xff, 0xff]), url));
});
test("correction replaces latest by Control.DateTime, never serial or delivery order", () => {
  const first = report({ serial: "999" });
  const corrected = report({ info: "訂正", sent: "2026-10-23T00:10:00Z", serial: "1" });
  assert.equal(state([corrected, first])[0].report.infoType, "訂正");
  assert.equal(state([first, corrected])[0].report.sha256, corrected.sha256);
});
test("cancellation remains a tombstone, including after TTL; older reports never revive", () => {
  const cancelled = report({ info: "取消", sent: "2026-10-23T00:10:00Z" });
  assert.equal(state([cancelled, report()])[0].state, "cancelled");
  assert.equal(state([cancelled, report()], "2026-11-01T00:00:00Z")[0].state, "cancelled");
});
test("event, office and operational status scope independent groups; body 解除 is not InfoType 取消", () => {
  const rs = [report(), report({ event: "TC2636" }), report({ office: "別官署" }), report({ status: "訓練" }), report({ status: "試験" })];
  assert.equal(state(rs).length, 5);
  assert.equal(state(rs).filter(r => r.state === "non_operational").length, 2);
  assert.equal(state([rs[0]])[0].state, "review_candidate");
});
test("same issuance time with different content fails closed, exact duplicates remain one candidate", () => {
  assert.equal(state([report(), report({ serial: "1" })])[0].state, "conflict");
  assert.equal(state([report(), report()])[0].state, "review_candidate");
});
test("official expiry is exclusive and local TTL never extends it; absent expiry is not official validity", () => {
  assert.equal(state([report({ valid: now })])[0].state, "expired");
  assert.equal(state([report()], "2026-10-23T06:00:00Z")[0].state, "expired");
  assert.equal(state([report()])[0].expiryBasis, "local_review_ttl_only");
  assert.equal(state([report({ valid: "2026-10-30T00:00:00Z" })])[0].expiresAt, "2026-10-23T06:00:00.000Z");
});
test("future publication is quarantined; nil forecast baseline remains unknown", () => {
  assert.equal(state([report({ published: "2026-10-24T00:00:00Z" })])[0].state, "future");
  const nil = xml().replace(/<TargetDateTime>.*?<\/TargetDateTime>/, '<TargetDateTime xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>');
  assert.equal(parseJmaBulletin(nil, url).targetAt, null);
});
test("malformed, DTD, missing/unknown lifecycle, namespaces and timezone-free clocks are rejected", () => {
  for (const bad of ["<Report>", "<!DOCTYPE x>" + xml(), xml({ status: "UNKNOWN" }), xml({ info: "UNKNOWN" }), xml({ sent: "2026-10-23T00:00:00" }), xml({ published: "2026-02-31T00:00:00Z" }), xml().replace("informationBasis1/", "unknown/"), xml().replace(/<ReportDateTime>.*?<\/ReportDateTime>/, "")]) {
    assert.throws(() => parseJmaBulletin(bad, url));
  }
});
test("Atom updated is discovery metadata, not the bulletin publication date; arbitrary links are rejected", () => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><updated>${now}</updated><entry><id>${url}</id><title>海上</title><updated>${now}</updated></entry></feed>`;
  assert.equal(parseJmaFeed(feed).entries[0].updatedAt, now);
  assert.throws(() => parseJmaFeed(feed.replace(url, "https://evil.example/a.xml")));
  for (const bad of ["http://www.data.jma.go.jp/developer/xml/data/a.xml", url + "?x=1", url + "#x", "https://www.data.jma.go.jp.evil.example/developer/xml/data/a.xml"]) assert.throws(() => jmaUrl(bad));
});
test("restart coverage records bootstrap, retention gaps and overlapping recovery without guaranteeing completeness", () => {
  assert.equal(jmaRecoveryStatus(null, now, now), "bootstrap_coverage_unknown");
  assert.equal(jmaRecoveryStatus("2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z", now), "retention_gap");
  assert.equal(jmaRecoveryStatus("2026-10-22T00:00:00Z", "2026-10-21T00:00:00Z", now), "overlap_requires_review");
  assert.equal(jmaRecoveryStatus(now, "2026-10-21T00:00:00Z", now), "overlap_only_not_delivery_guarantee");
});

async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "jma-test-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test("successful XML remains cached across restart, never downloaded twice; corruption stops without redownload", async () => temporary(async dir => {
  let calls = 0;
  const transport = async () => { calls++; return new Response(xml()); };
  assert.equal((await cachedJmaGet(dir, url, { now, transport })).acquisition, "download");
  assert.equal((await cachedJmaGet(dir, url, { now: "2026-11-01T00:00:00Z", transport })).acquisition, "cache");
  assert.equal(calls, 1);
  await writeFile(join(dir, `${jmaHash(url)}.xml`), "corrupted");
  await assert.rejects(cachedJmaGet(dir, url, { now, transport }), /integrity/);
  assert.equal(calls, 1);
}));
test("feeds respect hourly polling and validators; 304 does not replace or redownload XML", async () => temporary(async dir => {
  let calls = 0;
  const transport = async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(init.redirect, "error");
    if (calls === 1) return new Response("<feed/>", { headers: { etag: '"v1"' } });
    assert.equal((init.headers as Record<string, string>)["If-None-Match"], '"v1"');
    return new Response(null, { status: 304 });
  };
  await cachedJmaGet(dir, jmaFeeds[0], { now, transport });
  assert.equal((await cachedJmaGet(dir, jmaFeeds[0], { now, transport })).acquisition, "cache");
  assert.equal((await cachedJmaGet(dir, jmaFeeds[0], { now: "2026-10-23T02:00:00Z", transport })).acquisition, "not_modified");
  assert.equal(calls, 2);
}));
test("crash/network uncertainty persists a reservation before request and blocks replay", async () => temporary(async dir => {
  let calls = 0;
  const transport = async () => { calls++; throw new Error("connection lost"); };
  await assert.rejects(cachedJmaGet(dir, url, { now, transport }), /connection lost/);
  const checkpoint = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.entries[url].state, "pending");
  assert.equal(checkpoint.usage["2026-10-23"], 2_000_000);
  await assert.rejects(cachedJmaGet(dir, url, { now, transport }), /Uncertain prior request/);
  assert.equal(calls, 1);
}));
test("daily quota prevents a request, resets on JST day boundary; persistent writer lock blocks a second writer", async () => temporary(async dir => {
  let calls = 0;
  const transport = async () => { calls++; return new Response("x".repeat(1_100_000)); };
  await cachedJmaGet(dir, url, { now, transport, dailyBudgetBytes: 2_000_000 });
  const other = url.replace("TEST", "OTHER");
  await assert.rejects(cachedJmaGet(dir, other, { now, transport, dailyBudgetBytes: 2_000_000 }), /budget exhausted/);
  assert.equal(calls, 1);
  await cachedJmaGet(dir, other, { now: "2026-10-23T15:00:00Z", transport, dailyBudgetBytes: 2_000_000 });
  assert.equal(calls, 2);
  await writeFile(join(dir, "writer.lock"), "");
  await assert.rejects(cachedJmaGet(dir, url, { now, transport }), { code: "EEXIST" });
}));
test("HTTP error, redirect error, oversized and corrupt checkpoints fail closed", async () => {
  for (const transport of [async () => new Response("no", { status: 503 }), async () => { throw new Error("redirect blocked"); }, async () => new Response("x".repeat(2_000_001))]) {
    await temporary(async dir => {
      await assert.rejects(cachedJmaGet(dir, url, { now, transport }));
      await assert.rejects(cachedJmaGet(dir, url, { now, transport }), /Uncertain prior request/);
    });
  }
  await temporary(async dir => {
    await writeFile(join(dir, "checkpoint.json"), "{}");
    let calls = 0;
    await assert.rejects(cachedJmaGet(dir, url, { now, transport: async () => { calls++; return new Response(""); } }));
    assert.equal(calls, 0);
  });
});
test("an oversized stream charges the received chunk beyond its reservation before stopping", async () => temporary(async dir => {
  await assert.rejects(cachedJmaGet(dir, url, { now, transport: async () => new Response("x".repeat(2_000_001)) }), /cap exceeded/);
  const checkpoint = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.usage["2026-10-23"], 2_000_001);
  assert.equal(checkpoint.entries[url].state, "pending");
}));
