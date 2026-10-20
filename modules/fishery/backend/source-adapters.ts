// Source-scoped offline adapters. They never fetch, write a database, approve or publish.
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { z } from "zod";
import { beijingDate } from "@aihot/contracts/time";
import { readable } from "@aihot/backend/content/extract";
import { readPublicationDate } from "@aihot/backend/sources/dates";
import { captureSchema, dateSchema, linkSchema, policyContextSchema } from "../contracts.ts";

export const archiveReceiptSchema = z.object({
  requestedUrl: linkSchema, finalUrl: linkSchema, status: z.int().min(100).max(599),
  finishedAt: z.iso.datetime({ offset: true }), sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ArchiveReceipt = z.infer<typeof archiveReceiptSchema>;
export type Adapter = "jinjiang" | "iotc" | "fuzhou";
export type PdfText = { status: "parsed" | "missing" | "failed" | "unverified"; rawSha256: string; parser: string; text: string; pages: number; error?: string };
const unknown = () => ({ precision: "unknown" as const, value: null });
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function receiptProblems(source: Adapter, receipt: ArchiveReceipt, raw: Buffer): string[] {
  const hosts = source === "jinjiang" ? ["www.jinjiang.gov.cn"] : source === "iotc" ? ["iotc.org", "www.iotc.org"] : ["hyj.fuzhou.gov.cn"];
  return [
    ...(sha256(raw) !== receipt.sha256 ? ["Archived bytes do not match the request receipt hash"] : []),
    ...(!hosts.includes(new URL(receipt.finalUrl).hostname) || !hosts.includes(new URL(receipt.requestedUrl).hostname) ? ["Unexpected source host"] : []),
  ];
}

export function prepareOfficial(source: Adapter, input: unknown, raw: Buffer, pdf?: { receipt: unknown; bytes: Buffer; parsed: PdfText }, acquisitionMode: "live_capture" | "archive_replay" = "archive_replay") {
  const receipt = archiveReceiptSchema.parse(input);
  const conflicts = receiptProblems(source, receipt, raw);
  const warnings: string[] = [acquisitionMode === "live_capture"
    ? "Live HTTP acquisition receipt; extraction reads that archived response. A failed response is not article text. Receipts are not remote signatures; human review and current rights are still required"
    : "Offline archive replay; no new network acquisition. HTTP receipts are not remote signatures; human review and current rights are still required"];
  let parseStatus: "parsed" | "missing" | "failed" | "unverified" = receipt.status === 200 ? "missing" : "failed";
  let title: string | null = null, body: string | null = null, publishedAt: string | null = null, publicationLiteral: string | null = null;
  let parser = "none", attachmentSha256: string | null = null;
  let attachmentUrl: string | null = null, attachmentHttpStatus: number | null = null, attachmentCapturedAt: string | null = null, attachmentPages: number | null = null;
  let published: z.infer<typeof dateSchema> = unknown(), adopted: z.infer<typeof dateSchema> = unknown();
  let context: z.infer<typeof policyContextSchema> | null = null;
  const evidence: Array<{ url: string; sha256: string; page: number | null; section: string | null }> = [];
  if (receipt.status !== 200) warnings.push(`HTTP ${receipt.status}: response is acquisition evidence, never an article body`);
  else if (!conflicts.length && raw.length <= 6 * 1024 * 1024) {
    let html: string | null = null;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
    catch { warnings.push("HTML is not valid UTF-8; no guessed decoding"); parseStatus = "unverified"; }
    if (html !== null) {
      const $ = cheerio.load(html);
      if (source === "jinjiang") {
        parser = "readability+jinjiang.article_time/v1";
        title = collapse($("meta[name=ArticleTitle]").attr("content") ?? $("h1").first().text()) || null;
        const visible = collapse($(".article_time").first().text());
        const meta = $("meta[name=PubDate]").attr("content") ?? "";
        publicationLiteral = visible || meta || null;
        const v = readPublicationDate(visible, "+08:00"), m = readPublicationDate(meta, "+08:00");
        const visibleDay = v.publishedAt ? beijingDate(v.publishedAt) : null;
        if (visible && !v.publishedAt) conflicts.push("Visible publication time is invalid");
        if (visibleDay && m.publicationTime && visibleDay !== m.publicationTime.slice(0, 10)) conflicts.push("Visible publication date and PubDate disagree");
        if (!conflicts.length) {
          if (v.publishedAt && v.publicationTime?.includes("T")) { publishedAt = v.publicationTime; published = { precision: "day", value: visibleDay! }; }
          else if (m.publicationTime) published = { precision: "day", value: m.publicationTime.slice(0, 10) };
          else warnings.push("Publication date unknown; URL dates and event dates are not substitutes");
        }
        const got = readable(html, receipt.finalUrl, { utcOffset: "+08:00" });
        body = got?.text ?? null;
        parseStatus = title && body ? "parsed" : "missing";
      } else if (source === "iotc") {
        parser = pdf?.parsed.parser ?? "unavailable-pdf-parser";
        const node = $("#content .node-cmm").first();
        title = collapse($("h1").first().text()) || null;
        if (!node.length || !title) warnings.push("IOTC measure identity/metadata container missing");
        const status = collapse(node.find(".field-name-field-cmm-status").text());
        const remarks = collapse(node.find(".field-name-field-cmm-remarks").text());
        const year = collapse(node.find(".field-name-field-cmm-adoption-date .date-display-single").text());
        if (/^(19|20|21)\d{2}$/.test(year)) adopted = { precision: "year", value: year };
        else warnings.push("Adoption year unknown; hidden machine date is not a substitute");
        let deadline: z.infer<typeof dateSchema> = unknown();
        const deadlineLiteral = /objection deadline on (\d{1,2} [A-Za-z]+ \d{4})/i.exec(remarks)?.[1];
        if (deadlineLiteral) {
          const d = readPublicationDate(deadlineLiteral, "+00:00");
          if (d.publicationTime) deadline = { precision: "day", value: d.publicationTime.slice(0, 10) };
        }
        const pending = /^pending$/i.test(status);
        if (!pending) warnings.push("Entry-into-force status is not mapped; retained as unknown");
        if (pending && /entry into force[^.]*pending/i.test(remarks) === false) warnings.push("Pending status has no matching entry-into-force remark; review original");
        if (!pending && /entry into force[^.]*pending/i.test(remarks)) conflicts.push("IOTC status conflicts with pending entry-into-force remark");
        context = { entryIntoForce: pending ? "pending" : "unknown", objectionDeadline: deadline,
          nonApplicationMentioned: /does not apply to India and Somalia/i.test(remarks) ? ["India", "Somalia"] : [], provisionYears: [] };
        warnings.push("Publication date unknown; Last-Modified, adoption year and objection deadline are not publication dates");
        const link = node.find('a[href]').toArray().map(e => new URL($(e).attr("href")!, receipt.finalUrl).href).find(url => /\.pdf(?:$|[?#])/i.test(url));
        if (!pdf) { parseStatus = "missing"; warnings.push("PDF capture/text missing; landing metadata is not the full measure"); }
        else {
          const pr = archiveReceiptSchema.parse(pdf.receipt);
          attachmentSha256 = sha256(pdf.bytes);
          attachmentUrl = pr.finalUrl; attachmentHttpStatus = pr.status; attachmentCapturedAt = pr.finishedAt;
          attachmentPages = pdf.parsed.status === "parsed" && pdf.parsed.pages > 0 ? pdf.parsed.pages : null;
          conflicts.push(...receiptProblems("iotc", pr, pdf.bytes));
          if (!link || link !== pr.requestedUrl || link !== pr.finalUrl) conflicts.push("PDF receipt does not match the measure attachment link");
          if (pdf.parsed.rawSha256 !== attachmentSha256) conflicts.push("Parsed PDF refers to different original bytes");
          parseStatus = pr.status === 200 ? pdf.parsed.status : "failed";
          if (parseStatus === "parsed" && (!pdf.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !pdf.parsed.text.trim() || pdf.parsed.pages < 1)) parseStatus = "failed";
          if (parseStatus === "parsed") {
            body = pdf.parsed.text;
            const flat = collapse(body);
            const pageNumber = /(?:Resolution|Recommendation)\s+(\d{2}\/\d{2})/i.exec(title ?? "")?.[1];
            const pdfNumber = /(?:RESOLUTION|RECOMMENDATION)\s+(\d{2}\/\d{2})/i.exec(flat)?.[1];
            if (pageNumber && pdfNumber !== pageNumber) conflicts.push("PDF resolution number missing or differs from page");
            const pdfPending = /Entry into force pending extended objection deadline/i.test(flat);
            if (pdfPending !== pending) conflicts.push("PDF and landing page entry-into-force states disagree");
            const pdfDeadline = /objection deadline on (\d{1,2} [A-Za-z]+ \d{4})/i.exec(flat)?.[1];
            if (pdfDeadline && readPublicationDate(pdfDeadline, "+00:00").publicationTime !== (deadline.value ?? null)) conflicts.push("PDF and page objection deadlines disagree");
            const years = /total allowable catch[^.]*?\bin (20\d{2}) and (20\d{2})\b/i.exec(flat);
            if (years) context.provisionYears = [Number(years[1]), Number(years[2])];
            else warnings.push("Catch-limit provision years unverified; no inferred current-year limit");
            evidence.push({ url: pr.finalUrl, sha256: attachmentSha256, page: 1, section: "Status header; review full measure before legal use" });
          } else warnings.push(`PDF parsing ${parseStatus}: ${pdf.parsed.error ?? "text is not verified"}`);
        }
        if (!node.length || !title) parseStatus = "missing";
      } else { warnings.push("No Fuzhou content adapter: acquisition failures must not use cached search text"); parseStatus = "unverified"; }
    }
  } else if (raw.length > 6 * 1024 * 1024) { parseStatus = "unverified"; warnings.push("HTML exceeds offline size limit"); }
  if (conflicts.length) parseStatus = "unverified";
  const capture = captureSchema.parse({ adapter: source, sourceUrl: receipt.finalUrl, capturedAt: receipt.finishedAt, httpStatus: receipt.status,
    acquisitionMode, rawSha256: sha256(raw), bodySha256: body ? sha256(body) : null, parser, parseStatus, attachmentSha256, attachmentUrl, attachmentHttpStatus, attachmentCapturedAt, attachmentPages, conflicts, publishedAt, publicationLiteral });
  const readyForReview = parseStatus === "parsed" && conflicts.length === 0 && !!body && !!title;
  return { schemaVersion: "fishery-offline-capture/0.1", source, readyForReview, reviewState: "awaiting_human_review", title,
    dates: { published, adopted, effectiveFrom: unknown(), effectiveUntil: unknown() }, policyContext: context,
    sourceCapture: capture, evidence: [{ url: receipt.finalUrl, sha256: capture.rawSha256, page: null, section: "Archived page response" }, ...evidence],
    warnings, body: readyForReview ? body : null };
}
