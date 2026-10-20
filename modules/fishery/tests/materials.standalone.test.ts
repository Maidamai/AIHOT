import assert from "node:assert/strict";
import { test } from "node:test";
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
