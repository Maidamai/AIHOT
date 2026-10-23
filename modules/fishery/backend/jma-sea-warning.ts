// Bounded official-warning reference adapter. No AI forecasting, publication or vessel safety judgment.
import { XMLParser } from "fast-xml-parser";
import { jmaMarineZoneCatalog } from "./jma-marine-zones.ts";
import { jmaHash, parseJmaBulletin, parseJmaFeed } from "./jma-marine.ts";

// Product codes/titles: JMA 20260806 table 1.1; versions: official product manuals.
export const jmaSeaWarningProducts = {
  VPZU54: { title: "全般海上警報（定時）（Ｒ０８）", kind: "全般海上警報", version: "1.0_3", codeType: "全般海上海域名" },
  VPZU52: { title: "全般海上警報（定時）（Ｈ２９）", kind: "全般海上警報", version: "1.0_2", codeType: "全般海上海域名" },
  VPZU53: { title: "全般海上警報（臨時）（Ｈ２９）", kind: "全般海上警報", version: "1.0_2", codeType: "全般海上海域名" },
  VPCU51: { title: "地方海上警報（Ｈ２８）", kind: "地方海上警報", version: "1.0_2", codeType: "地方海上予報区" },
} as const;
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
  const warningNames = headlineItems.flatMap(i => array(i.Kind).map(k => value(k.Name)));
  if (warningNames.some(name => !name)) throw new Error("Missing marine warning name");
  const releaseNotice = code === "VPCU51" && warningNames.every(n => n === "海上警報解除");
  const noWarningNotice = code !== "VPCU51" && warningNames.every(n => n === "海上警報なし");
  if (!metadata.validUntil && !releaseNotice) throw new Error("Missing official warning expiry; local TTL cannot substitute");
  if (metadata.validUntil && Date.parse(metadata.validUntil) <= Date.parse(metadata.publishedAt)) throw new Error("Marine expiry does not follow publication");

  const bindings: Array<{ codeType: string; code: string | null; name: string; scope: string }> = [];
  const headlineSignatures = new Set<string>();
  const checkArea = (area: any, codeType: string) => {
    const name = value(area?.Name), areaCode = value(area?.Code);
    if (!name) throw new Error("Missing marine area name");
    if (areaCode) {
      const catalog = jmaMarineZoneCatalog.codeTypes[codeType as keyof typeof jmaMarineZoneCatalog.codeTypes] as Record<string, string> | undefined;
      if (!catalog || catalog[areaCode] !== name) throw new Error("Unknown or mismatched marine area code/name");
      bindings.push({ codeType, code: areaCode, name, scope: "official_named_zone_geometry_not_resolved" });
    } else {
      if (code === "VPCU51") throw new Error("Missing local marine zone code");
      const geometry = Object.keys(area).some(k => /(?:^|:)(Circle|Polygon)$/.test(k));
      if (!geometry && !(noWarningNotice && name === "全般海上予報区")) throw new Error("Unresolved marine area without named code or original geometry");
      bindings.push({ codeType, code: null, name, scope: geometry ? "original_dynamic_geometry_not_evaluated" : "official_general_area_notice" });
    }
  };
  for (const item of headlineItems) {
    const groups = array(item.Areas);
    if (!groups.length) throw new Error("Missing marine area bindings");
    for (const group of groups) {
      if (group["@_codeType"] !== product.codeType || !array(group.Area).length) throw new Error("Unsupported marine area code system");
      for (const area of array(group.Area)) {
        checkArea(area, product.codeType);
        if (code === "VPCU51") for (const kind of array(item.Kind)) headlineSignatures.add(JSON.stringify([value(area.Code), value(kind.Name), value(kind.Code)]));
      }
    }
  }
  if (code === "VPCU51") {
    const warnings = array(r.Body.Warning);
    if (!warnings.length || warnings.some(w => w["@_type"] !== product.kind || !array(w.Item).length)) throw new Error("Missing local warning body");
    const bodySignatures = new Set<string>();
    for (const warning of warnings) for (const item of array(warning.Item)) {
      if (array(item.Area).length !== 1) throw new Error("Missing local body area binding");
      checkArea(item.Area, product.codeType);
      for (const kind of array(item.Kind)) if (value(kind.Name)) bodySignatures.add(JSON.stringify([value(item.Area.Code), value(kind.Name), value(kind.Code)]));
    }
    if (headlineSignatures.size !== bodySignatures.size || [...headlineSignatures].some(s => !bodySignatures.has(s))) throw new Error("Local headline/body warning-area mismatch");
  }
  if (code !== "VPCU51" && !noWarningNotice && !array(r.Body.MeteorologicalInfos).some(i => i["@_type"] === product.kind && array(i.MeteorologicalInfo).length)) throw new Error("Missing general warning body");
  return {
    metadata, productCode: code,
    effectiveAt: null, // TargetDateTime is the bulletin baseline, not a separately stated legal start.
    notice: releaseNotice ? "official_release_notice" : noWarningNotice ? "official_no_warning_notice" : "official_warning_reference",
    areaBindings: [...new Map(bindings.map(a => [JSON.stringify(a), a])).values()],
    // Original nesting binds warning kinds, areas, SubArea/AreaName and all values/units/times.
    // This tree is an aid to inspection, never a re-serialized replacement for the original XML.
    official: { headline: r.Head.Headline, body: r.Body, rawBytes: Buffer.from(input), sha256: jmaHash(input), url },
    zoneCatalog: { sourceUrl: jmaMarineZoneCatalog.bundleUrl, sha256: jmaMarineZoneCatalog.bundleSha256, workbook: jmaMarineZoneCatalog.workbook },
    intendedUse: "official_warning_reference_review" as const,
    navigationWarningComplete: false as const, replacesVesselWarningSystem: false as const,
  };
}
