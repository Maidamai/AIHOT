// A current-time date comparison, never an application entitlement or legal-validity decision.
import { beijingDate, BEIJING_TIMEZONE } from "@aihot/contracts/time";
import type { BusinessDateBoundary, BusinessGuidePayload, BusinessTimeliness } from "./business-contracts.ts";

type SourceDate = BusinessGuidePayload["dates"]["deadline"]["value"];

function lastDate(date: SourceDate): string | null {
  if (date.precision === "unknown" || !date.value) return null;
  const pattern = { year: /^\d{4}$/, month: /^\d{4}-(0[1-9]|1[0-2])$/, day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/ };
  if (!pattern[date.precision].test(date.value)) return null;
  const [year, month, day] = date.value.split("-").map(Number);
  if (date.precision === "year") return `${date.value}-12-31`;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (date.precision === "month") return `${date.value}-${days}`;
  return day <= days ? date.value : null;
}

/** Recompute using the supplied current clock; publication and human verification times are unrelated. */
export function projectBusinessTimeliness(
  dates: Pick<BusinessGuidePayload["dates"], "deadline" | "expiresAt">,
  now = new Date(),
): BusinessTimeliness {
  const checkedAt = now.toISOString(), today = beijingDate(now);
  const boundary = (date: SourceDate): BusinessDateBoundary => {
    const end = lastDate(date);
    return { state: end === null ? "unknown" : end < today ? "elapsed" : "date_not_elapsed", lastDate: end };
  };
  const deadline = boundary(dates.deadline.value), expiry = boundary(dates.expiresAt.value);
  const notices = [expiry.state === "elapsed" ? "已过文载失效日期" : null, deadline.state === "elapsed" ? "已截止（按原文日期）" : null].filter(Boolean);
  return { checkedAt, timeZone: BEIJING_TIMEZONE, deadline, expiry, label: [...notices, "可申请状态未知/待核实"].join("；") };
}
