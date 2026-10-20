// Two inspected official columns. Discovery uses their current lists, never a fixed article list.
import * as cheerio from "cheerio";
import { z } from "zod";
import { readPublicationDate } from "@aihot/backend/sources/dates";
import { beijingDate } from "@aihot/contracts/time";
import { captureSchema, dateSchema, linkSchema } from "../contracts.ts";
import { archiveReceiptSchema, sha256 } from "./source-adapters.ts";

export const COLUMNS = {
  moa: {
    name: "农业农村部渔业渔政管理局 · 工作动态", url: "https://yyj.moa.gov.cn/gzdt/",
    list: ".sj_e_tonzhi_list li a", body: ".sj_arc_body .TRS_Editor", issuer: "农业农村部渔业渔政管理局",
  },
  fujian: {
    name: "福建省海洋与渔业局 · 省局动态", url: "https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/",
    list: ".xw-list-1.gl_list li a", body: "#detailCont", issuer: "福建省海洋与渔业局",
  },
} as const;
export const columnIdSchema = z.enum(["moa", "fujian"]);
export type ColumnId = z.infer<typeof columnIdSchema>;
export const unknownDate = () => ({ precision: "unknown" as const, value: null });
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const direct = /远洋|公海|境外入渔|南极磷虾|国际渔业|IOTC|NPFC|SPRFMO|WCPFC|CCAMLR/i;
const contextual = /渔业法|渔业发展|渔业支持|渔业委员会|渔业合作/;

export interface Candidate { url: string; title: string; listDate: string | null; priority: "direct" | "context"; }
export function titlePriority(title: string): Candidate["priority"] | null {
  if (direct.test(title)) return "direct";
  // Aquaculture, fish names and generic ocean-economy stories are not DWF evidence.
  if (/养殖|增殖放流|伏季休渔|近海|海洋经济|职工|党课|离退休/.test(title)) return null;
  return contextual.test(title) ? "context" : null;
}

export function discoverColumn(id: ColumnId, html: string): { candidates: Candidate[]; rejected: number; listed: number } {
  const column = COLUMNS[id], base = new URL(column.url), $ = cheerio.load(html), seen = new Set<string>();
  const candidates: Candidate[] = []; let rejected = 0, listed = 0;
  for (const anchor of $(column.list).toArray()) {
    const node = $(anchor), href = node.attr("href");
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, column.url); } catch { continue; }
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !/\/t\d{8}_\d+\.s?html?$/.test(url.pathname) || !linkSchema.safeParse(url.href).success || seen.has(url.href)) continue;
    seen.add(url.href); listed++;
    const title = collapse(node.attr("title") || node.text()), priority = titlePriority(title);
    if (!priority) { rejected++; continue; }
    const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(node.closest("li").text())?.[0] ?? null;
    candidates.push({ url: url.href, title, listDate: date, priority });
  }
  return { candidates, rejected, listed };
}

export function relevanceEvidence(body: string): string[] {
  // These are retrieval cues, not AI scores or factual approval. Keep the source text as evidence.
  return body.split(/\n+/).map(collapse).flatMap(p => {
    const match = direct.exec(p);
    return match ? [p.slice(Math.max(0, match.index - 150), match.index + 350)] : [];
  }).slice(0, 8);
}

export function prepareColumnArticle(id: ColumnId, receiptInput: unknown, raw: Buffer, acquisitionMode: "live_capture" | "archive_replay" = "live_capture") {
  const receipt = archiveReceiptSchema.parse(receiptInput), column = COLUMNS[id], origin = new URL(column.url).origin;
  const conflicts: string[] = [], warnings: string[] = [];
  if (sha256(raw) !== receipt.sha256) conflicts.push("Raw bytes differ from the HTTP receipt");
  if ([receipt.requestedUrl, receipt.finalUrl].some(u => new URL(u).origin !== origin)) conflicts.push("Unexpected official source origin");
  if ([receipt.requestedUrl, receipt.finalUrl].some(u => !new URL(u).pathname.startsWith(new URL(column.url).pathname) || !/\/t\d{8}_\d+\.s?html?$/.test(new URL(u).pathname))) conflicts.push("Unexpected official article path");
  let title: string | null = null, body: string | null = null, publicationLiteral: string | null = null, publishedAt: string | null = null;
  let published: z.infer<typeof dateSchema> = unknownDate();
  let parseStatus: "parsed" | "missing" | "failed" | "unverified" = receipt.status === 200 ? "missing" : "failed";
  if (receipt.status !== 200) warnings.push(`HTTP ${receipt.status}: no article body; never fill with search/cache text`);
  else if (conflicts.length) parseStatus = "unverified";
  else {
    let html: string | null = null;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { parseStatus = "unverified"; warnings.push("Invalid UTF-8; no guessed decoding"); }
    if (html !== null) {
      const $ = cheerio.load(html);
      title = collapse($("meta[name=ArticleTitle]").attr("content") || $("h1").first().text()) || null;
      publicationLiteral = collapse($("meta[name=PubDate]").attr("content") || "") || null;
      if (publicationLiteral) {
        const date = readPublicationDate(publicationLiteral, "+08:00");
        if (date.publishedAt) {
          const day = beijingDate(date.publishedAt);
          published = { precision: "day", value: day };
          if (/\d{1,2}:\d{2}/.test(publicationLiteral)) publishedAt = new Date(date.publishedAt).toISOString();
        } else conflicts.push("Visible publication metadata is invalid");
      } else warnings.push("Publication metadata missing; list/URL/event/capture dates are not substitutes");
      const content = $(column.body).first().clone();
      content.find("script,style,iframe,form,noscript").remove();
      // #detailCont keeps all TRS blocks, including text outside nested .TRS_Editor nodes.
      content.find("p,br,div,li,tr,h2,h3").append("\n");
      const text = content.text().split(/\n+/).map(collapse).filter(Boolean).join("\n");
      if (title && text.length >= 40) { body = text; parseStatus = "parsed"; }
      else warnings.push("Expected official article title/body selector missing or empty");
      if (conflicts.length) { parseStatus = "unverified"; body = null; }
    }
  }
  const evidence = body ? relevanceEvidence(body) : [];
  if (body && !evidence.length) warnings.push("No explicit DWF evidence in the article body; do not import as a DWF material");
  const capture = captureSchema.parse({ adapter: id, acquisitionMode, sourceUrl: receipt.finalUrl, capturedAt: receipt.finishedAt,
    httpStatus: receipt.status, rawSha256: sha256(raw), bodySha256: body ? sha256(body) : null,
    parser: `official-column/${id}/v1`, parseStatus, attachmentSha256: null,
    publishedAt, publicationLiteral, conflicts });
  return { title, body, dates: { published, event: unknownDate(), adopted: unknownDate(), effectiveFrom: unknownDate(), effectiveUntil: unknownDate() },
    sourceCapture: capture, readyForReview: parseStatus === "parsed" && !!body && !!evidence.length,
    relevance: { decision: evidence.length ? "candidate" as const : "not_proven" as const, method: "explicit_dwf_terms" as const, evidence }, warnings };
}
