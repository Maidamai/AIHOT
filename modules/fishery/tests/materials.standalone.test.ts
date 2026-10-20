import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareOfficial, sha256, type ArchiveReceipt } from "../backend/source-adapters.ts";
import { assertCaptureExportable } from "../backend/export.ts";
import { canExportSummary, dateSchema, effectiveState, linkSchema, observationSchema, sourceSchema } from "../contracts.ts";
import { observationFixture, sourceFixture, unknownDate } from "./fixtures.ts";

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
