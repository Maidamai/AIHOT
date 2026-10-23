// Bounded official-warning reference adapter. No AI forecasting, publication or vessel safety judgment.
import { XMLParser } from "fast-xml-parser";
import { jmaLocalMarineSubdivisions, jmaMarineZoneCatalog } from "./jma-marine-zones.ts";
import { jmaHash, parseJmaBulletin, parseJmaFeed } from "./jma-marine.ts";

export const jmaSeaWarningAdapterVersion = "jma-sea-warning/2";

// Product codes/titles: JMA 20260806 table 1.1; versions: official product manuals.
export const jmaSeaWarningProducts = {
  VPZU54: { title: "全般海上警報（定時）（Ｒ０８）", kind: "全般海上警報", version: "1.0_3", codeType: "全般海上海域名" },
  VPZU52: { title: "全般海上警報（定時）（Ｈ２９）", kind: "全般海上警報", version: "1.0_2", codeType: "全般海上海域名" },
  VPZU53: { title: "全般海上警報（臨時）（Ｈ２９）", kind: "全般海上警報", version: "1.0_2", codeType: "全般海上海域名" },
  VPCU51: { title: "地方海上警報（Ｈ２８）", kind: "地方海上警報", version: "1.0_2", codeType: "地方海上予報区" },
} as const;
// Official code.MarineWarning, 警報等情報要素コード管理表!E105:F112.
export const jmaMarineWarningCodes = {
  sourceUrl: "https://xml.kishou.go.jp/jmaxml_20261019_code.xlsx",
  sha256: "6d9a8a4d2ecef87761f0e0dfc2c47c131e0dd7ae8cd9dea798a50918d08bc8d0",
  names: { "00": "海上警報解除", "10": "海上着氷警報", "11": "海上濃霧警報", "12": "海上うねり警報",
    "20": "海上風警報", "21": "海上強風警報", "22": "海上暴風警報", "23": "海上台風警報" } as Record<string, string>,
};
type ProductCode = keyof typeof jmaSeaWarningProducts;
const array = (v: any): any[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const value = (v: any): string => typeof v === "string" ? v : v?.["#text"] ?? "";
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false });
const codeFromUrl = (url: string) => new URL(url).pathname.match(/_\d+_([A-Z0-9]+)_\d+\.xml$/)?.[1];
function productFor(url: string) {
  const code = codeFromUrl(url);
  if (!code || !Object.hasOwn(jmaSeaWarningProducts, code)) throw new Error("Unsupported marine warning product");
  return { code: code as ProductCode, product: jmaSeaWarningProducts[code as ProductCode] };
}

export function selectJmaSeaWarnings(feed: ReturnType<typeof parseJmaFeed>) {
  return feed.entries.filter(entry => {
    const code = codeFromUrl(entry.url);
    return !!code && Object.hasOwn(jmaSeaWarningProducts, code) && entry.title === jmaSeaWarningProducts[code as ProductCode].title;
  });
}

export function parseJmaSeaWarning(input: Uint8Array, url: string) {
  const metadata = parseJmaBulletin(input, url); // validates XML safety, encoding and envelope first
  const { code, product } = productFor(url);
  if (metadata.title !== product.title || metadata.infoKind !== product.kind || metadata.infoKindVersion !== product.version) throw new Error("Marine product/title/version mismatch");
  // These manuals specify 発表/訂正. Cancellation of an XML group is not 海上警報解除.
  if (!["発表", "訂正"].includes(metadata.infoType)) throw new Error("Unsupported marine lifecycle: quarantine source group, do not reuse old warnings");
  if (metadata.eventId !== null || metadata.serial !== null || metadata.targetAt === null) throw new Error("Unsupported marine header semantics");
  const r = parser.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)).Report;
  if (r.Body?.["@_xmlns"] !== "http://xml.kishou.go.jp/jmaxml1/body/meteorology1/") throw new Error("Unsupported marine body namespace");
  const information = array(r.Head.Headline?.Information);
  if (!information.length || information.some(i => i["@_type"] !== product.kind)) throw new Error("Missing or unsupported marine headline");
  const headlineItems = information.flatMap(i => array(i.Item));
  if (!headlineItems.length) throw new Error("Missing marine warning items");
  const checkKind = (kind: any) => {
    const name = value(kind?.Name), kindCode = value(kind?.Code);
    if (code !== "VPCU51" && name === "海上警報なし" && !kindCode) return;
    if (!name || jmaMarineWarningCodes.names[kindCode] !== name) throw new Error("Unknown or mismatched marine warning code/name");
    if (code !== "VPCU51" && kindCode === "00") throw new Error("Local release code in general warning");
  };
  if (headlineItems.some(i => !array(i.Kind).length)) throw new Error("Missing marine warning kind");
  for (const item of headlineItems) for (const kind of array(item.Kind)) checkKind(kind);
  const warningNames = headlineItems.flatMap(i => array(i.Kind).map(k => value(k.Name)));
  const releaseNotice = code === "VPCU51" && warningNames.every(n => n === "海上警報解除");
  const noWarningNotice = code !== "VPCU51" && warningNames.every(n => n === "海上警報なし");
  if ((!releaseNotice && warningNames.includes("海上警報解除")) || (!noWarningNotice && warningNames.includes("海上警報なし"))) throw new Error("Mixed release/no-warning and active warnings");
  if (!metadata.validUntil && !releaseNotice) throw new Error("Missing official warning expiry; local TTL cannot substitute");
  if (metadata.validUntil && Date.parse(metadata.validUntil) <= Date.parse(metadata.publishedAt)) throw new Error("Marine expiry does not follow publication");

  const bindings: Array<{ codeType: string; code: string | null; name: string; scope: string }> = [];
  const headlineSignatures = new Set<string>();
  const localSignatures = (area: any, kind: any) => (jmaLocalMarineSubdivisions.children[value(area.Code)] ?? [value(area.Code)])
    .map(zone => JSON.stringify([zone, value(kind.Name), value(kind.Code)]));
  const checkArea = (area: any, codeType: string, positionOnly = false) => {
    const name = value(area?.Name), areaCode = value(area?.Code);
    if (!name) throw new Error("Missing marine area name");
    if (noWarningNotice) {
      if (name !== "全般海上予報区" || area?.Code !== undefined || Object.keys(area).some(k => /(?:^|:)(Circle|Polygon|Coordinate)$/.test(k))) throw new Error("Invalid general no-warning area");
      bindings.push({ codeType, code: null, name, scope: "official_general_area_notice" });
      return;
    }
    if (areaCode) {
      const catalog = jmaMarineZoneCatalog.codeTypes[codeType as keyof typeof jmaMarineZoneCatalog.codeTypes] as Record<string, string> | undefined;
      if (!catalog || catalog[areaCode] !== name) throw new Error("Unknown or mismatched marine area code/name");
      bindings.push({ codeType, code: areaCode, name, scope: "official_named_zone_geometry_not_resolved" });
    } else {
      if (code === "VPCU51") throw new Error("Missing local marine zone code");
      const geometry = Object.keys(area).some(k => /(?:^|:)(Circle|Polygon)$/.test(k));
      const position = positionOnly && name === "熱帯低気圧" && Object.keys(area).some(k => /(?:^|:)Coordinate$/.test(k));
      if (!geometry && !position) throw new Error("Unresolved marine area without named code or original geometry");
      bindings.push({ codeType, code: null, name, scope: geometry ? "original_dynamic_geometry_not_evaluated"
        : "original_position_only_warning_extent_not_supplied" });
    }
  };
  for (const item of headlineItems) {
    const groups = array(item.Areas);
    if (!groups.length) throw new Error("Missing marine area bindings");
    for (const group of groups) {
      if (group["@_codeType"] !== product.codeType || !array(group.Area).length) throw new Error("Unsupported marine area code system");
      for (const area of array(group.Area)) {
        checkArea(area, product.codeType, array(item.Kind).every(k => value(k.Code) === "20"));
        if (code === "VPCU51") for (const kind of array(item.Kind)) for (const signature of localSignatures(area, kind)) headlineSignatures.add(signature);
      }
    }
  }
  if (code === "VPCU51") {
    const warnings = array(r.Body.Warning);
    if (!warnings.length || warnings.some(w => w["@_type"] !== product.kind || !array(w.Item).length)) throw new Error("Missing local warning body");
    const bodySignatures = new Set<string>();
    for (const warning of warnings) for (const item of array(warning.Item)) {
      if (array(item.Area).length !== 1) throw new Error("Missing local body area binding");
      if (!value(array(item.Kind)[0]?.Name)) throw new Error("Missing local body warning kind");
      checkArea(item.Area, product.codeType);
      for (const kind of array(item.Kind)) {
        if (releaseNotice && kind.Property !== undefined) throw new Error("Release notice contains warning properties");
        if (value(kind.Name)) { checkKind(kind); for (const signature of localSignatures(item.Area, kind)) bodySignatures.add(signature); }
      }
    }
    if (headlineSignatures.size !== bodySignatures.size || [...headlineSignatures].some(s => !bodySignatures.has(s))) throw new Error("Local headline/body warning-area mismatch");
  }
  if (code !== "VPCU51") {
    const infos = array(r.Body.MeteorologicalInfos).filter(i => i["@_type"] === product.kind);
    if (noWarningNotice && infos.length) throw new Error("No-warning headline contradicts warning body");
    if (!noWarningNotice && (!infos.length || infos.some(i => !array(i.MeteorologicalInfo).length))) throw new Error("Missing general warning body");
    const signature = (kind: any, area: any) => JSON.stringify([value(kind.Name), value(kind.Code), value(area.Name), value(area.Code)]);
    const head = headlineItems.flatMap(i => array(i.Kind).flatMap(k => array(i.Areas).flatMap(g => array(g.Area).map(a => signature(k, a))))).sort();
    const body: string[] = [];
    for (const info of infos) for (const details of array(info.MeteorologicalInfo)) {
      if (!array(details.Item).length) throw new Error("Missing general warning items");
      for (const item of array(details.Item)) {
        const kind = array(item.Kind)[0];
        checkKind(kind);
        if (array(item.Area).length !== 1) throw new Error("Missing general body area binding");
        checkArea(item.Area, product.codeType, value(kind.Code) === "20");
        body.push(signature(kind, item.Area));
      }
    }
    body.sort();
    if (!noWarningNotice && (head.length !== body.length || head.some((s, i) => s !== body[i]))) throw new Error("General headline/body warning-area mismatch");
  }
  return {
    metadata, productCode: code, adapterVersion: jmaSeaWarningAdapterVersion,
    effectiveAt: null, // TargetDateTime is the bulletin baseline, not a separately stated legal start.
    notice: releaseNotice ? "official_release_notice" : noWarningNotice ? "official_no_warning_notice" : "official_warning_reference",
    areaBindings: [...new Map(bindings.map(a => [JSON.stringify(a), a])).values()],
    // Original nesting binds warning kinds, areas, SubArea/AreaName and all values/units/times.
    // This tree is an aid to inspection, never a re-serialized replacement for the original XML.
    official: { headline: r.Head.Headline, body: r.Body, rawBytes: Buffer.from(input), sha256: jmaHash(input), url },
    zoneCatalog: { sourceUrl: jmaMarineZoneCatalog.bundleUrl, sha256: jmaMarineZoneCatalog.bundleSha256, workbook: jmaMarineZoneCatalog.workbook,
      workbookSha256: jmaMarineZoneCatalog.workbookSha256, hierarchySourceUrl: jmaLocalMarineSubdivisions.sourceUrl,
      hierarchyMappingSha256: jmaHash(JSON.stringify(jmaLocalMarineSubdivisions.children)) },
    warningCodeCatalog: { sourceUrl: jmaMarineWarningCodes.sourceUrl, sha256: jmaMarineWarningCodes.sha256 },
    intendedUse: "official_warning_reference_review" as const,
    navigationWarningComplete: false as const, replacesVesselWarningSystem: false as const,
  };
}
