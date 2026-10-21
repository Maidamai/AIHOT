import assert from "node:assert/strict";
import { test } from "node:test";
import { projectBusinessTimeliness } from "../business-timeliness.ts";
import type { BusinessGuidePayload } from "../business-contracts.ts";

type SourceDate = BusinessGuidePayload["dates"]["deadline"]["value"];
const unknown: SourceDate = { precision: "unknown", value: null };
const dates = (deadline: SourceDate = unknown, expiresAt: SourceDate = unknown) => ({ deadline: { value: deadline, evidence: [] }, expiresAt: { value: expiresAt, evidence: [] } });

test("past source dates are prominent while future and unknown dates never imply an open application", () => {
  const now = new Date("2026-10-21T02:00:00Z");
  const past = projectBusinessTimeliness(dates({ precision: "day", value: "2026-10-20" }), now);
  assert.deepEqual(past.deadline, { state: "elapsed", lastDate: "2026-10-20" });
  assert.equal(past.label, "已截止（按原文日期）；可申请状态未知/待核实");
  const expired = projectBusinessTimeliness(dates({ precision: "day", value: "2026-10-20" }, { precision: "day", value: "2026-10-19" }), now);
  assert.equal(expired.label, "已过文载失效日期；已截止（按原文日期）；可申请状态未知/待核实");
  const future = projectBusinessTimeliness(dates({ precision: "day", value: "2026-12-01" }), now);
  assert.equal(future.deadline.state, "date_not_elapsed"); assert.equal(future.label, "可申请状态未知/待核实");
  const missing = projectBusinessTimeliness(dates(), now);
  assert.deepEqual(missing.deadline, { state: "unknown", lastDate: null }); assert.deepEqual(missing.expiry, missing.deadline);
  assert.equal(missing.label, "可申请状态未知/待核实");
  for (const result of [past, expired, future, missing]) {
    assert.equal(result.checkedAt, now.toISOString()); assert.equal(result.timeZone, "Asia/Shanghai");
    assert.equal(Object.values(result).includes(true), false);
  }
});

test("a documented day elapses only after Beijing midnight, independent of machine timezone", () => {
  const input = dates({ precision: "day", value: "2026-10-21" });
  const before = projectBusinessTimeliness(input, new Date("2026-10-21T15:59:59.999Z"));
  const after = projectBusinessTimeliness(input, new Date("2026-10-21T16:00:00.000Z"));
  assert.equal(before.deadline.state, "date_not_elapsed"); assert.equal(after.deadline.state, "elapsed");
  assert.equal(before.deadline.lastDate, after.deadline.lastDate);
  assert.equal(projectBusinessTimeliness(input, new Date("2026-10-21T23:59:59+08:00")).deadline.state, "date_not_elapsed");
  assert.equal(projectBusinessTimeliness(input, new Date("2026-10-22T00:00:00+08:00")).deadline.state, "elapsed");
});

test("month and year precision use their last possible calendar day, including leap years", () => {
  const leap = dates({ precision: "month", value: "2024-02" });
  assert.deepEqual(projectBusinessTimeliness(leap, new Date("2024-02-29T23:59:59+08:00")).deadline, { state: "date_not_elapsed", lastDate: "2024-02-29" });
  assert.equal(projectBusinessTimeliness(leap, new Date("2024-03-01T00:00:00+08:00")).deadline.state, "elapsed");
  assert.equal(projectBusinessTimeliness(dates({ precision: "month", value: "2026-02" }), new Date("2026-03-01T00:00:00+08:00")).deadline.lastDate, "2026-02-28");
  const year = dates({ precision: "year", value: "2026" });
  assert.deepEqual(projectBusinessTimeliness(year, new Date("2026-12-31T23:59:59+08:00")).deadline, { state: "date_not_elapsed", lastDate: "2026-12-31" });
  assert.equal(projectBusinessTimeliness(year, new Date("2027-01-01T00:00:00+08:00")).deadline.state, "elapsed");
});

test("projection preserves source precision and invalid dates remain unknown", () => {
  const input = dates({ precision: "month", value: "2026-02" }), before = structuredClone(input);
  projectBusinessTimeliness(input, new Date("2026-02-14T00:00:00Z")); assert.deepEqual(input, before);
  for (const value of ["2026-02-30", "2026-13-01", "2026-1-1"]) assert.deepEqual(projectBusinessTimeliness(dates({ precision: "day", value }), new Date("2026-10-21T00:00:00Z")).deadline, { state: "unknown", lastDate: null });
});
