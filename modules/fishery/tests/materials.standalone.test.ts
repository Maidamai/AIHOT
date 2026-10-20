import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareOfficial, sha256, type ArchiveReceipt } from "../backend/source-adapters.ts";
import { assertCaptureExportable } from "../backend/export.ts";
import { canExportSummary, dateSchema, effectiveState, linkSchema, observationSchema, sourceSchema } from "../contracts.ts";
import { observationFixture, sourceFixture, unknownDate } from "./fixtures.ts";
import { extractPdf } from "../backend/pdf-text.ts";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";

test("date precision never supplies missing days, times or legal applicability", () => {
  assert.deepEqual(dateSchema.parse(unknownDate), unknownDate);
  const month = dateSchema.parse({ precision: "month", value: "2026-10" });
  assert.equal(month.value, "2026-10");
  assert.equal(effectiveState(month, "2026-10-20"), "unknown");
  assert.equal(effectiveState(month, "2026-09-20"), "future");
  assert.equal(effectiveState(unknownDate, "2026-10-20"), "unknown");
  assert.equal(effectiveState({ precision: "day", value: "2028-01-01" }, "2026-10-20"), "future");
  assert.equal(effectiveState({ precision: "day", value: "2026-10-20" }, "2026-10-20"), "reached");
  for (const value of ["2026-02-30", "2026-13-01", "2026-04-17T00:00:00Z"])
    assert.equal(dateSchema.safeParse({ precision: "day", value }).success, false);
});

test("unknown rights fail closed, and expired or future rights cannot authorize an export", () => {
  const unknown = sourceSchema.parse({ expectedRevision: 0 });
  assert.equal(unknown.allowedFulltextExport, false);
  assert.equal(canExportSummary(unknown, Date.parse("2026-10-20")), false);
  assert.equal(sourceSchema.safeParse({ expectedRevision: 0, allowedSummary: true }).success, false);
  assert.equal(sourceSchema.safeParse({ ...sourceFixture, evidenceUrl: null }).success, false);
  const allowed = sourceSchema.parse(sourceFixture);
  assert.equal(canExportSummary(allowed, Date.parse("2026-10-20")), true);
  assert.equal(canExportSummary({ ...allowed, reviewDueAt: "2026-10-20T00:00:00Z" }, Date.parse("2026-10-20")), false);
  assert.equal(canExportSummary({ ...allowed, rightsCheckedAt: "2026-10-21T00:00:00Z" }, Date.parse("2026-10-20")), false);
});

test("observation contracts refuse raw bodies and ambiguous empty scopes", () => {
  assert.equal(observationSchema.safeParse(observationFixture).success, true);
  for (const extra of [{ fulltext: "forbidden" }, { body: "forbidden" }, { translation: "forbidden" }])
    assert.equal(observationSchema.safeParse({ ...observationFixture, ...extra }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, scope: { ...observationFixture.scope, unknownFields: [] } }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, rawSha256: "not-a-hash" }).success, false);
});

test("metadata links cannot carry credentials, query secrets or private literal destinations", () => {
  for (const url of ["http://example.org/policy", "https://user:secret@example.org/", "https://example.org/?token=secret", "https://127.0.0.1/policy", "https://[::1]/", "https://localhost/policy", "https://secret.internal/policy", "file:///tmp/policy"])
    assert.equal(linkSchema.safeParse(url).success, false, url);
  assert.equal(linkSchema.safeParse("https://example.org/policy.pdf").success, true);
});

// These are synthetic structures, not copies of third-party articles or PDFs.
const jjUrl = "https://www.jinjiang.gov.cn/xxgk/jjyw/202603/t20260321_fixture.htm";
const ioUrl = "https://iotc.org/cmm/fixture-measure";
const pdfUrl = "https://iotc.org/sites/default/files/fixture.pdf";
const paragraph = "合成企业报道，仅用于离线提取测试。船队从厦门出发，不据港口反推企业归属。".repeat(12);
const jjHtml = (time = "2026-03-21 19:36", meta = "2026-03-21", body = paragraph) => Buffer.from(`<html><head><title>合成测试</title><meta name="ArticleTitle" content="合成船队报道"><meta name="PubDate" content="${meta}"></head><body><article><h1>合成船队报道</h1><span class="article_time">${time}</span><div class="TRS_Editor"><p>${body}</p></div></article></body></html>`);
const ioHtml = (status = "Pending", deadline = "18 November 2026") => Buffer.from(`<html><body><h1>Synthetic Resolution 26/01</h1><div id="content"><div class="node-cmm"><a href="${pdfUrl}">PDF</a><div class="field-name-field-cmm-status">${status}</div><div class="field-name-field-cmm-remarks">Entry into force pending extended objection deadline on ${deadline}. Does not apply to India and Somalia.</div><div class="field-name-field-cmm-adoption-date"><span class="date-display-single" content="2026-01-01T00:00:00+04:00">2026</span></div></div></div></body></html>`);
const receipt = (raw: Buffer, url = jjUrl, status = 200): ArchiveReceipt => ({ requestedUrl: url, finalUrl: url, status, finishedAt: "2026-10-20T05:00:00Z", sha256: sha256(raw) });
const syntheticPdf = () => {
  const bytes = Buffer.from("%PDF- synthetic fixture bytes, not an actual third-party PDF");
  return { bytes, receipt: receipt(bytes, pdfUrl), parsed: { status: "parsed" as const, rawSha256: sha256(bytes), parser: "synthetic test parser", text: "RESOLUTION 26/01. Entry into force pending extended objection deadline on 18 November 2026. The total allowable catch is a synthetic amount in 2027 and 2028.", pages: 2 } };
};

test("Jinjiang reads visible source time at +08:00 and leaves the body geography untouched", () => {
  const raw = jjHtml(), result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(result.readyForReview, true);
  assert.equal(result.reviewState, "awaiting_human_review");
  assert.equal(result.sourceCapture.publishedAt, "2026-03-21T11:36:00.000Z");
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.ok(result.body?.includes("从厦门出发"));
  assert.equal("approved" in result, false);
});

test("live receipts and archive replay are labelled separately without upgrading a 404 to article text", () => {
  const raw = jjHtml();
  const archived = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(archived.sourceCapture.acquisitionMode, "archive_replay");
  assert.ok(archived.warnings.some(w => w.includes("no new network acquisition")));
  const live = prepareOfficial("jinjiang", receipt(raw), raw, undefined, "live_capture");
  assert.equal(live.sourceCapture.acquisitionMode, "live_capture");
  assert.ok(live.warnings.some(w => w.includes("Live HTTP acquisition receipt")));
  assert.equal(live.warnings.some(w => /Offline archive/i.test(w)), false);
  const missing = Buffer.from("404 error response");
  const failed = prepareOfficial("fuzhou", receipt(missing, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), missing, undefined, "live_capture");
  assert.equal(failed.sourceCapture.acquisitionMode, "live_capture");
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.readyForReview, false); assert.equal(failed.body, null);
});

test("missing source dates remain unknown despite a dated URL; day-only metadata stays day-only", () => {
  let raw = jjHtml("", "");
  let result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, unknownDate);
  assert.equal(result.sourceCapture.publishedAt, null);
  raw = jjHtml("", "2026-03-21"); result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.equal(result.sourceCapture.publishedAt, null);
});

test("conflicting or invalid publication fields block a prepared body", () => {
  for (const raw of [jjHtml("2026-03-22 19:36"), jjHtml("2026-02-30 19:36")]) {
    const result = prepareOfficial("jinjiang", receipt(raw), raw);
    assert.equal(result.readyForReview, false); assert.equal(result.body, null);
    assert.ok(result.sourceCapture.conflicts.length > 0);
    assert.deepEqual(result.dates.published, unknownDate);
  }
});

test("404, missing body, wrong host and hash mismatch never become article material", () => {
  const raw = Buffer.from("<title>404 missing</title>cached snippets must not be used");
  const failed = prepareOfficial("fuzhou", receipt(raw, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), raw);
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.sourceCapture.parseStatus, "failed");
  assert.equal(failed.body, null); assert.equal(failed.readyForReview, false);
  const empty = jjHtml("2026-03-21 19:36", "2026-03-21", "");
  assert.equal(prepareOfficial("jinjiang", receipt(empty), empty).readyForReview, false);
  const good = jjHtml();
  assert.equal(prepareOfficial("jinjiang", { ...receipt(good), sha256: "0".repeat(64) }, good).readyForReview, false);
  assert.equal(prepareOfficial("jinjiang", receipt(good, "https://example.org/"), good).readyForReview, false);
});

test("IOTC Pending keeps objection deadline separate and 2027–2028 provisions out of 2026", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  assert.equal(result.readyForReview, true);
  assert.deepEqual(result.dates.adopted, { precision: "year", value: "2026" });
  assert.deepEqual(result.dates.published, unknownDate);
  assert.deepEqual(result.dates.effectiveFrom, unknownDate);
  assert.equal(result.policyContext?.entryIntoForce, "pending");
  assert.deepEqual(result.policyContext?.objectionDeadline, { precision: "day", value: "2026-11-18" });
  assert.deepEqual(result.policyContext?.provisionYears, [2027, 2028]);
  assert.deepEqual(result.policyContext?.nonApplicationMentioned, ["India", "Somalia"]);
  assert.equal(result.sourceCapture.attachmentHttpStatus, 200);
  assert.equal(result.sourceCapture.attachmentSha256, sha256(syntheticPdf().bytes));
  assert.equal(effectiveState(result.dates.adopted, "2026-10-20"), "unknown");
});

test("IOTC missing/failed/unverified PDF and conflicting status or deadline stay blocked", () => {
  const raw = ioHtml();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw).readyForReview, false);
  for (const status of ["failed", "unverified", "missing"] as const) {
    const pdf = syntheticPdf();
    assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, status } }).readyForReview, false);
  }
  const conflict = ioHtml("In force");
  assert.equal(prepareOfficial("iotc", receipt(conflict, ioUrl), conflict, syntheticPdf()).readyForReview, false);
  const otherDeadline = ioHtml("Pending", "19 November 2026");
  assert.equal(prepareOfficial("iotc", receipt(otherDeadline, ioUrl), otherDeadline, syntheticPdf()).readyForReview, false);
  const pdf = syntheticPdf();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, text: pdf.parsed.text.replace("26/01", "26/02") } }).readyForReview, false);
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, receipt: { ...pdf.receipt, status: 404 } }).sourceCapture.attachmentHttpStatus, 404);
  // A parser claiming success must not turn empty bytes or an HTML error page into a verified PDF.
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>Upstream error pretending to be a PDF</html>")]) {
    const failed = prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, bytes, receipt: receipt(bytes, pdfUrl), parsed: { ...pdf.parsed, rawSha256: sha256(bytes) } });
    assert.equal(failed.readyForReview, false);
    assert.equal(failed.body, null);
    assert.equal(failed.sourceCapture.parseStatus, "failed");
  }
});

test("observation and export gates refuse pending-as-effective or failed capture, even after approval", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  const input = { ...observationFixture, rawSha256: sha256(raw), dates: result.dates, sourceCapture: result.sourceCapture, policyContext: result.policyContext! };
  const parsed = observationSchema.parse(input);
  assertCaptureExportable(parsed);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, attachmentHttpStatus: 404 }, { ...parsed.sourceCapture!, attachmentSha256: null }, { ...parsed.sourceCapture!, attachmentPages: null }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevents export/);
  assert.equal(observationSchema.safeParse({ ...input, dates: { ...input.dates, effectiveFrom: { precision: "day", value: "2026-11-18" } } }).success, false);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, httpStatus: 404 }, { ...parsed.sourceCapture!, parseStatus: "unverified" as const }, { ...parsed.sourceCapture!, bodySha256: null }, { ...parsed.sourceCapture!, conflicts: ["fields disagree"] }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevent export/);
  assert.equal(canExportSummary(sourceSchema.parse({ expectedRevision: 0 }), Date.now()), false);
  assert.deepEqual(dateSchema.parse({ precision: "year", value: "2026" }), { precision: "year", value: "2026" });
});

// Generated PDF 1.4 fixtures: no third-party documents or persisted passwords.
function pdfFixture(blank = false, encrypted = false): Buffer {
  const md5 = (b: Buffer) => createHash("md5").update(b).digest();
  const rc4 = (key: Buffer, input: Buffer) => {
    const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; }
    let i = 0; j = 0;
    return Buffer.from(input.map(v => { i = (i + 1) % 256; j = (j + s[i]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; return v ^ s[(s[i]! + s[j]!) % 256]!; }));
  };
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (s: string) => Buffer.concat([Buffer.from(s), padding]).subarray(0, 32);
  const id = md5(Buffer.from("synthetic-fishery-test")), p = Buffer.alloc(4); p.writeInt32LE(-4);
  const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad("fixture-user"));
  const key = md5(Buffer.concat([pad("fixture-user"), owner, p, id])).subarray(0, 5);
  let content = Buffer.from(blank ? "" : "BT /F1 12 Tf 40 100 Td (Synthetic fishery evidence) Tj ET");
  if (encrypted) content = rc4(md5(Buffer.concat([key, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10), content);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [4 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
  ];
  if (encrypted) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`));
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets = [0]; let size = chunks[0]!.length;
  objects.forEach((body, i) => { offsets.push(size); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 6 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>]` : ""} >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test("PDF commands read a private snapshot and retain byte hash and page evidence", async () => {
  const original = pdfFixture(); const expected = Buffer.from(original); let snapshot = "";
  const parsed = await extractPdf(original, { platform: "linux", execute: async (program, args, options) => {
    assert.ok(options.timeout > 0 && options.timeout <= 60_000); assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
    snapshot = args.find(a => a.endsWith("original.pdf"))!;
    original.fill(0); assert.deepEqual(await readFile(snapshot), expected);
    return { stdout: program === "pdfinfo" ? "Pages: 2\nEncrypted: no\n" : "Verified synthetic page\n", stderr: "" };
  } });
  assert.equal(parsed.status, "parsed"); assert.equal(parsed.rawSha256, sha256(expected)); assert.equal(parsed.pages, 2);
  assert.match(parsed.text, /--- Page 2 ---/); assert.match(parsed.parser, /Poppler 25.03.0/);
  await assert.rejects(access(snapshot));
});

test("PDF missing tools, blank pages, diagnostics, encryption, page and output limits block text", async () => {
  const raw = pdfFixture();
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(result.status, code === "ENOENT" ? "unverified" : "failed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const scenario of ["blank", "encrypted", "pages", "diagnostic", "output", "aggregate"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async (program, args) => {
      if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
      if (program === "pdfinfo") return { stdout: `Pages: ${scenario === "pages" ? 201 : 2}\nEncrypted: ${scenario === "encrypted" ? "yes" : "no"}\n`, stderr: "" };
      return { stdout: scenario === "blank" ? " \n" : scenario === "output" ? "x".repeat(4 * 1024 * 1024 + 1) : scenario === "aggregate" ? "x".repeat(2200000) : "Text", stderr: scenario === "diagnostic" ? "Syntax Warning" : "" };
    } });
    assert.equal(result.status, scenario === "blank" ? "unverified" : "failed", scenario); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>404</html>"), Buffer.alloc(10 * 1024 * 1024 + 1)])
    assert.equal((await extractPdf(bytes)).status, "failed");
});

test("installed PDF parser accepts generated text and blocks blank, encrypted and corrupt PDFs", { skip: !["linux", "darwin"].includes(process.platform) }, async () => {
  const positive = await extractPdf(pdfFixture());
  assert.equal(positive.status, "parsed", positive.error ?? "Expected parsed PDF"); assert.equal(positive.pages, 1);
  assert.match(positive.text, /Synthetic fishery evidence/);
  for (const bytes of [pdfFixture(true), pdfFixture(false, true), Buffer.from("%PDF-1.4\ncorrupted")]) {
    const result = await extractPdf(bytes); assert.notEqual(result.status, "parsed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
});
