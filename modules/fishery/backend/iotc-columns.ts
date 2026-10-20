// Current CMM identities and attachments only. No legal applicability is inferred from Active.
import * as cheerio from "cheerio";
import { linkSchema } from "../contracts.ts";
import { archiveReceiptSchema, prepareOfficial, sha256 } from "./source-adapters.ts";
import type { Candidate } from "./official-columns.ts";

export const IOTC_LIST = "https://iotc.org/cmms/basic";
export const IOTC_ROBOTS_SHA256 = "278e83bcf567badfebcdea4d5d20ca9898e4449fe4eb2e3b5a08227b4ca9b762";
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
export interface IotcCandidate extends Candidate { number: string; status: string; adoptionYear: string; }
export function assertIotcRobots(receiptInput: unknown, raw: Buffer) {
  const receipt = archiveReceiptSchema.parse(receiptInput);
  if (receipt.status !== 200 || receipt.requestedUrl !== "https://iotc.org/robots.txt" || receipt.finalUrl !== receipt.requestedUrl ||
    receipt.sha256 !== IOTC_ROBOTS_SHA256 || sha256(raw) !== receipt.sha256)
    throw new Error("IOTC robots policy unavailable or changed; stop for policy inspection");
}

export function discoverIotc(html: string) {
  const $ = cheerio.load(html), candidates: IotcCandidate[] = [], seen = new Set<string>();
  let rejected = 0;
  for (const row of $("table.views-table tbody tr").toArray()) {
    const node = $(row);
    const status = collapse(node.find("td.views-field-nothing > b").first().text());
    const adoptionYear = collapse(node.find("td.views-field-field-cmm-adoption-date .date-display-single").first().text());
    // Supersedes links in the status cell identify older measures, not current-list rows.
    for (const anchor of node.find('td.views-field-title-1 > a[href]').toArray()) {
      const a = $(anchor); let url: URL;
      try { url = new URL(a.attr("href")!, IOTC_LIST); } catch { continue; }
      if (url.origin !== new URL(IOTC_LIST).origin || !/^\/cmm\/[a-z0-9-]+\/?$/i.test(url.pathname) || !linkSchema.safeParse(url.href).success || url.hash) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const label = collapse(a.text());
      const number = /\b(\d{2}\/\d{2})\b/.exec(label)?.[1] ?? /(?:resolution|recommendation)-(\d{2})(\d{2})(?:-|$)/i.exec(url.pathname)?.slice(1).join("/");
      if (!number || !/^(19|20|21)\d{2}$/.test(adoptionYear) || !/^(Pending|Active(?:\s*&\s*supersedes)?)$/i.test(status)) { rejected++; continue; }
      candidates.push({ url: url.href, title: label || number, listDate: null, priority: "direct", number, status, adoptionYear });
    }
  }
  return { candidates, rejected, listed: seen.size };
}

export function iotcAttachment(raw: Buffer, pageUrl: string): string {
  const $ = cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  const href = $("#content .node-cmm a[href]").toArray().map(e => new URL($(e).attr("href")!, pageUrl).href)
    .find(url => /^https:\/\/iotc\.org\/sites\/default\/files\/.*\.pdf$/.test(url) && linkSchema.safeParse(url).success);
  if (!href) throw new Error("IOTC same-origin PDF attachment missing; landing metadata is not full text");
  return href;
}

export function prepareIotc(candidate: IotcCandidate, receipt: unknown, raw: Buffer, pdf: Parameters<typeof prepareOfficial>[3], acquisitionMode:"live_capture"|"archive_replay"="live_capture") {
  const result = prepareOfficial("iotc", receipt, raw, pdf, acquisitionMode);
  const $ = cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  const status = collapse($("#content .node-cmm .field-name-field-cmm-status").text());
  const number = /\b(\d{2}\/\d{2})\b/.exec(result.title ?? "")?.[1];
  if (result.sourceCapture.sourceUrl !== candidate.url || number !== candidate.number || status.toLowerCase() !== candidate.status.toLowerCase() || result.dates.adopted.value !== candidate.adoptionYear) {
    result.sourceCapture.conflicts.push("Current listing and landing measure identity, adoption year or status disagree");
    result.sourceCapture.parseStatus = "unverified"; result.readyForReview = false; result.body = null; result.sourceCapture.bodySha256 = null;
  }
  return result;
}
