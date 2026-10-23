// Offline metadata adapter. No database, publication, model calls or automatic collection.
import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const jmaFeeds = [
  "https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml",
  "https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml",
  // Official xmlpull.html, long-period その他 link (verified 2026-10-23).
  "https://www.data.jma.go.jp/developer/xml/feed/other_l.xml",
] as const;
const base = "http://xml.kishou.go.jp/jmaxml1/";
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });
type Node = Record<string, any>;
const list = (v: any): any[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const text = (v: any): string => typeof v === "string" ? v : v?.["#text"] ?? "";
const required = (v: any, field: string) => { const s = text(v); if (!s) throw new Error(`Missing ${field}`); return s; };
export const jmaHash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");

export function jmaUrl(value: string): string {
  const u = new URL(value);
  if (u.origin !== "https://www.data.jma.go.jp" || u.username || u.password || u.search || u.hash
    || (!jmaFeeds.includes(value as typeof jmaFeeds[number]) && !/^\/developer\/xml\/data\/[A-Za-z0-9_]+\.xml$/.test(u.pathname))) {
    throw new Error("Not an allowed JMA feed or bulletin URL");
  }
  return u.href;
}

function parse(xml: string, maxBytes: number): Node {
  if (Buffer.byteLength(xml) > maxBytes || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsafe or oversized XML");
  if (XMLValidator.validate(xml) !== true) throw new Error("Malformed XML");
  return parser.parse(xml);
}
function time(v: any, field: string, optional = false): string | null {
  const s = text(v);
  if (!s && optional) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s))
    || new Date(`${s.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== s.slice(0, 10)) throw new Error(`Invalid ${field}`);
  return s;
}

export function parseJmaFeed(xml: string) {
  const f = parse(xml, 8_000_000).feed;
  if (f?.["@_xmlns"] !== "http://www.w3.org/2005/Atom") throw new Error("Unsupported Atom namespace");
  return {
    updatedAt: time(f.updated, "feed.updated")!,
    entries: list(f.entry).map(e => {
      const url = jmaUrl(required(e.id, "entry.id"));
      if (jmaFeeds.includes(url as typeof jmaFeeds[number])) throw new Error("Bulletin id is a feed");
      return { url, title: required(e.title, "entry.title"), updatedAt: time(e.updated, "entry.updated")! };
    }),
  };
}

export type JmaBulletin = ReturnType<typeof parseJmaBulletin>;
export function parseJmaBulletin(input: string | Uint8Array, url: string) {
  jmaUrl(url);
  if (jmaFeeds.includes(url as typeof jmaFeeds[number])) throw new Error("Expected bulletin URL");
  if (typeof input !== "string" && input.byteLength > 2_000_000) throw new Error("Oversized XML");
  const xml = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  const r = parse(xml, 2_000_000).Report;
  const c = r?.Control, h = r?.Head;
  if (r?.["@_xmlns"] !== base || h?.["@_xmlns"] !== `${base}informationBasis1/` || !c) throw new Error("Unsupported JMAXML envelope");
  const status = required(c.Status, "Status"), infoType = required(h.InfoType, "InfoType");
  if (!["通常", "訓練", "試験"].includes(status) || !["発表", "訂正", "取消"].includes(infoType)) throw new Error("Unsupported lifecycle value");
  const sentAt = time(c.DateTime, "Control.DateTime")!;
  if (!sentAt.endsWith("Z")) throw new Error("Control.DateTime must be UTC");
  const title = required(c.Title, "Control.Title"), editorialOffice = required(c.EditorialOffice, "EditorialOffice");
  const areas: Array<{ name: string; code: string | null; codeType: string | null; type: string | null }> = [];
  const walk = (node: any, codeType: string | null = null, type: string | null = null) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, codeType, type); return; }
    codeType = node["@_codeType"] ?? codeType; type = node["@_type"] ?? type;
    for (const [key, value] of Object.entries(node)) {
      if (key === "Area") for (const a of list(value)) {
        areas.push({ name: text(a.Name), code: text(a.Code) || null, codeType: a.Code?.["@_type"] ?? codeType, type });
      }
      walk(value, codeType, type);
    }
  };
  walk(h); walk(r.Body);
  return {
    url, sha256: jmaHash(input), title, headlineTitle: required(h.Title, "Head.Title"), editorialOffice,
    publishingOffice: required(c.PublishingOffice, "PublishingOffice"), status, infoType,
    eventId: text(h.EventID) || null, serial: text(h.Serial) || null,
    infoKind: required(h.InfoKind, "InfoKind"), infoKindVersion: required(h.InfoKindVersion, "InfoKindVersion"),
    sentAt, publishedAt: time(h.ReportDateTime, "ReportDateTime")!,
    targetAt: time(h.TargetDateTime, "TargetDateTime", true), validUntil: time(h.ValidDateTime, "ValidDateTime", true),
    groupKey: JSON.stringify([title, editorialOffice, status, text(h.EventID) || null]),
    areas: [...new Map(areas.map(a => [JSON.stringify(a), a])).values()],
    // Geometry, individual warning kinds and forecast values remain in the linked XML.
    intendedUse: "internal_metadata_review" as const, navigationWarningComplete: false as const,
  };
}

// Cancellation tombstones remain in the history; expiration never revives an older bulletin.
export function currentJmaMetadata(reports: JmaBulletin[], now: string, maxAgeMs: number) {
  const at = Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("Invalid review clock/TTL");
  const groups = new Map<string, JmaBulletin[]>();
  for (const r of reports) groups.set(r.groupKey, [...(groups.get(r.groupKey) ?? []), r]);
  return [...groups.values()].map(rs => {
    rs.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
    const report = rs[0];
    const ambiguous = rs.some(r => Date.parse(r.sentAt) === Date.parse(report.sentAt) && r.sha256 !== report.sha256);
    const expiresAt = new Date(Math.min(Date.parse(report.publishedAt) + maxAgeMs, report.validUntil ? Date.parse(report.validUntil) : Infinity)).toISOString();
    const state = ambiguous ? "conflict" : report.status !== "通常" ? "non_operational"
      : report.infoType === "取消" ? "cancelled" : Date.parse(report.sentAt) > at || Date.parse(report.publishedAt) > at ? "future"
      : at >= Date.parse(expiresAt) ? "expired" : "review_candidate";
    return { report, state, expiresAt, expiryBasis: report.validUntil ? "official_and_local_ttl" : "local_review_ttl_only" };
  });
}

export function jmaRecoveryStatus(previousFeedUpdatedAt: string | null, oldestEntryUpdatedAt: string, now: string) {
  const oldest = time(oldestEntryUpdatedAt, "oldest entry")!;
  const at = time(now, "now")!;
  if (!previousFeedUpdatedAt) return "bootstrap_coverage_unknown";
  const previous = time(previousFeedUpdatedAt, "previous feed")!;
  if (Date.parse(previous) < Date.parse(oldest)) return "retention_gap";
  if (Date.parse(at) - Date.parse(previous) > 2 * 3_600_000) return "overlap_requires_review";
  return "overlap_only_not_delivery_guarantee";
}
