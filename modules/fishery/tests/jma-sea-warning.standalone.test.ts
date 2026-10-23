import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedJmaGet } from "../backend/jma-cache.ts";
import { currentJmaMetadata, jmaFeeds, jmaHash, parseJmaFeed } from "../backend/jma-marine.ts";
import { jmaSeaWarningProducts, parseJmaSeaWarning, selectJmaSeaWarnings } from "../backend/jma-sea-warning.ts";

// Generated structural fixtures only: numeric sentinels below are not official forecasts.
const url = (code = "VPCU51", flag = "0") => `https://www.data.jma.go.jp/developer/xml/data/20261023000000_${flag}_${code}_471000.xml`;
function fixture(o: Record<string, string | undefined> = {}) {
  const code = (o.product ?? "VPCU51") as keyof typeof jmaSeaWarningProducts;
  const p = jmaSeaWarningProducts[code]; const local = code === "VPCU51";
  const notice = o.notice === "release";
  const name = o.name ?? (local ? "沖縄南方海上" : notice ? "全般海上予報区" : "低気圧");
  const area = `<Name>${name}</Name>${local ? `<Code>${o.zone ?? "6030"}</Code>` : notice ? "" : '<jmx_eb:Circle type="影響範囲"><jmx_eb:BasePoint type="実況位置（度）">+50.0+150.0/</jmx_eb:BasePoint><jmx_eb:Axes><jmx_eb:Axis><jmx_eb:Radius unit="海里">011.50</jmx_eb:Radius></jmx_eb:Axis></jmx_eb:Axes></jmx_eb:Circle>'}`;
  const warningName = notice ? local ? "海上警報解除" : "海上警報なし" : "海上強風警報";
  const kinds = `<Kind><Name>${warningName}</Name>${notice && !local ? "" : "<Code>21</Code>"}</Kind>`;
  const subareas = '<Kind><Property><Type>風</Type><WindPart><SubArea><AreaName>合成小海域A</AreaName><Sentence>  合成試験値 A  </Sentence><Base><jmx_eb:WindSpeed type="最大風速" unit="m/s">012.50</jmx_eb:WindSpeed></Base></SubArea><SubArea><AreaName>合成小海域B</AreaName><Base><jmx_eb:WindSpeed type="最大風速" unit="ノット">000.75</jmx_eb:WindSpeed></Base></SubArea></WindPart></Property></Kind>';
  const body = o.body === "missing" ? "" : local
    ? `<Warning type="地方海上警報"><Item>${kinds}${notice ? "" : subareas}<Area>${area}</Area></Item></Warning>`
    : `<MeteorologicalInfos type="全般海上警報"><MeteorologicalInfo><DateTime>2026-10-23T09:00:00+09:00</DateTime><Item>${kinds}${subareas}<Area>${area}</Area></Item></MeteorologicalInfo></MeteorologicalInfos>`;
  return Buffer.from(`<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/"><Control><Title>${o.title ?? p.title}</Title><DateTime>${o.sent ?? "2026-10-23T00:00:00Z"}</DateTime><Status>${o.status ?? "通常"}</Status><EditorialOffice>${o.office ?? "沖縄気象台"}</EditorialOffice><PublishingOffice>合成試験官署</PublishingOffice></Control><Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>合成試験海上気象</Title><ReportDateTime>2026-10-23T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-10-23T09:00:00+09:00</TargetDateTime>${o.expiry === "missing" ? "" : `<ValidDateTime>${o.expiry ?? "2026-10-24T09:00:00+09:00"}</ValidDateTime>`}<EventID/><InfoType>${o.info ?? "発表"}</InfoType><Serial/><InfoKind>${p.kind}</InfoKind><InfoKindVersion>${o.version ?? p.version}</InfoKindVersion><Headline><Text/><Information type="${p.kind}"><Item>${kinds}<Areas codeType="${o.codeType ?? p.codeType}"><Area>${area}</Area></Areas></Item></Information></Headline></Head><Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">${body}</Body></Report>`);
}
const parse = (o: Record<string, string | undefined> = {}) => parseJmaSeaWarning(fixture(o), url(o.product));

test("official other_l discovery selects only bounded current warning editions and preserves duplicate URLs for cache dedup", () => {
  assert.equal(jmaFeeds[2], "https://www.data.jma.go.jp/developer/xml/feed/other_l.xml");
  const entries = [...Object.entries(jmaSeaWarningProducts), ["VPCY51", { title: "地方海上予報（Ｈ２８）" }] as const]
    .map(([code, p]) => `<entry><id>${url(code)}</id><title>${p.title}</title><updated>2026-10-23T00:00:00Z</updated></entry>`).join("");
  const feed = parseJmaFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><updated>2026-10-23T00:00:00Z</updated>${entries}</feed>`);
  const selected = selectJmaSeaWarnings(feed);
  assert.equal(selected.length, 4);
  assert.equal(selectJmaSeaWarnings({ ...feed, entries: [selected[0], selected[0]] }).length, 2);
  assert.throws(() => parseJmaSeaWarning(fixture(), url("VPCY51")), /Unsupported marine warning product/);
});
test("all four verified warning editions parse; R08 stays distinct from old H29 and interim products", () => {
  const reports = Object.keys(jmaSeaWarningProducts).map(product => parse({ product }));
  assert.equal(new Set(reports.map(r => r.metadata.groupKey)).size, 4);
  assert.equal(reports[0].metadata.infoKindVersion, "1.0_3");
  assert.equal(reports.every(r => !r.navigationWarningComplete && !r.replacesVesselWarningSystem && r.effectiveAt === null), true);
});
test("raw bytes, whitespace, numeric precision, units, SubArea names and their hierarchy are preserved without derivation", () => {
  const bytes = fixture(); const r = parseJmaSeaWarning(bytes, url());
  assert.deepEqual(r.official.rawBytes, bytes); assert.equal(r.official.sha256, jmaHash(bytes));
  const sub = r.official.body.Warning.Item.Kind[1].Property.WindPart.SubArea;
  assert.equal(sub[0].AreaName, "合成小海域A");
  assert.equal(sub[0].Sentence, "  合成試験値 A  ");
  assert.deepEqual(sub[0].Base["jmx_eb:WindSpeed"], { "#text": "012.50", "@_type": "最大風速", "@_unit": "m/s" });
  assert.equal(sub[1].AreaName, "合成小海域B");
  assert.equal(sub[1].Base["jmx_eb:WindSpeed"]["#text"], "000.75");
  bytes.fill(0); assert.notDeepEqual(r.official.rawBytes, bytes);
});
test("local codes are checked with the correct official table; missing, foreign-system and mismatched names stop review", () => {
  assert.deepEqual(parse().areaBindings[0], { codeType: "地方海上予報区", code: "6030", name: "沖縄南方海上", scope: "official_named_zone_geometry_not_resolved" });
  for (const bad of [{ zone: "9999" }, { zone: "9050" }, { name: "誤った海区名" }, { codeType: "気象情報／府県予報区・細分区域等" }]) assert.throws(() => parse(bad));
  assert.throws(() => parseJmaSeaWarning(Buffer.from(fixture().toString().replaceAll("<Code>6030</Code>", "")), url()), /Missing local marine zone code/);
});
test("dynamic global geometry remains original coordinates/radii; it is never reduced to a named maritime zone", () => {
  const r = parse({ product: "VPZU54" });
  assert.equal(r.areaBindings[0].scope, "original_dynamic_geometry_not_evaluated");
  assert.equal(r.areaBindings[0].code, null);
  const area = r.official.headline.Information.Item.Areas.Area;
  assert.equal(area["jmx_eb:Circle"]["jmx_eb:BasePoint"]["#text"], "+50.0+150.0/");
  assert.equal(area["jmx_eb:Circle"]["jmx_eb:Axes"]["jmx_eb:Axis"]["jmx_eb:Radius"]["#text"], "011.50");
});
test("active warning must carry an explicit valid expiry; publication/target are not inferred legal effective times", () => {
  assert.throws(() => parse({ expiry: "missing" }), /Missing official warning expiry/);
  assert.throws(() => parse({ expiry: "2026-10-22T00:00:00Z" }), /expiry does not follow/);
  const r = parse().metadata;
  assert.equal(currentJmaMetadata([r], "2026-10-24T00:00:00Z", 48 * 3_600_000)[0].state, "expired");
});
test("official local release without expiry is a notice, not InfoType cancellation; global no-warning still needs official expiry", () => {
  const r = parse({ notice: "release", expiry: "missing" });
  assert.equal(r.notice, "official_release_notice");
  assert.equal(r.metadata.infoType, "発表"); assert.equal(r.metadata.validUntil, null);
  assert.equal(parse({ product: "VPZU54", notice: "release" }).notice, "official_no_warning_notice");
  assert.throws(() => parse({ product: "VPZU54", notice: "release", expiry: "missing" }), /Missing official warning expiry/);
  assert.throws(() => parse({ info: "取消" }), /Unsupported marine lifecycle/);
});
test("marine corrections replace only their XML office group; shared publisher never merges different editorial offices", () => {
  const first = parse().metadata, corrected = parse({ info: "訂正", sent: "2026-10-23T00:10:00Z" }).metadata;
  const other = parse({ office: "函館地方気象台" }).metadata;
  const current = currentJmaMetadata([first, other, corrected], "2026-10-23T01:00:00Z", 6 * 3_600_000);
  assert.equal(current.length, 2); assert.equal(current.some(r => r.report.sha256 === corrected.sha256), true);
  assert.equal(current.some(r => r.report.sha256 === first.sha256), false);
  assert.equal(currentJmaMetadata([parse({ status: "訓練" }).metadata], "2026-10-23T01:00:00Z", 3_600_000)[0].state, "non_operational");
});
test("unsupported version/title, missing body and changed body namespace fail closed", () => {
  for (const o of [{ version: "1.0_99" }, { title: "地方海上予報（Ｈ２８）" }, { body: "missing" }, { body: "missing", product: "VPZU54" }]) assert.throws(() => parse(o));
  assert.throws(() => parseJmaSeaWarning(Buffer.from(fixture().toString().replace("body/meteorology1/", "body/unknown/")), url()), /body namespace/);
});
test("formal-warning XML is cached across restart and parsed again without a second request or changed official bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jma-sea-test-")); let calls = 0;
  const transport = async () => { calls++; return new Response(fixture()); };
  try {
    const first = await cachedJmaGet(dir, url(), { now: "2026-10-23T01:00:00Z", transport });
    const resumed = await cachedJmaGet(dir, url(), { now: "2026-10-24T01:00:00Z", transport });
    assert.equal(calls, 1); assert.equal(resumed.acquisition, "cache");
    assert.deepEqual(parseJmaSeaWarning(resumed.bytes, url()).official.rawBytes, first.bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
