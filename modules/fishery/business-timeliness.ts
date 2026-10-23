// A current-time date comparison, never an application entitlement or legal-validity decision.
import { beijingDate, BEIJING_TIMEZONE } from "@aihot/contracts/time";
import type { BusinessDateBoundary, BusinessGuidePayload, BusinessTimeliness } from "./business-contracts.ts";

type SourceDate = BusinessGuidePayload["dates"]["deadline"]["value"];

const guidance: Record<string, [string, string]> = {
  funding: ["申报状态待核实", "办理截止不等于政策废止；申报前须核对本年度通知、对象、材料和受理窗口。"],
  crew: ["用工适用状态待核实", "聘用或换班前须核对船旗国及用工地规定、船员证书、岗位资质和劳动条件。"],
  compliance: ["许可与履约适用状态待核实", "出海前须核对船旗、海域、鱼种、渔法及许可与履约要求；本文不证明已有作业资格。"],
  vessels: ["船舶服务适用状态待核实", "购租、改造或检修前须核对船舶条件、检验要求和服务机构资质。"],
  preparation: ["备航服务适用状态待核实", "备航前须核对港口窗口、补给与保险条件及当前服务安排。"],
  fishing: ["作业范围适用状态待核实", "作业前须核对最新禁限捕范围、坐标、日期、鱼种与渔法。"],
  weather: ["预警状态待核实", "航行前须核对最新官方预警、适用海区及发布、更新和解除时间。"],
  traceability: ["转运追溯适用状态待核实", "转运前须核对适用海域、船旗、报告期限和追溯材料要求。"],
  sales: ["贸易通关适用状态待核实", "交易前须核对目的地、产品范围、通关材料及结算条件。"],
  return: ["回港服务适用状态待核实", "回港前须核对港口、船舶和船员条件及维修、换班、结算窗口。"],
};
export function businessTimelinessGuidance(topicId: string): string {
  return guidance[topicId]?.[1] ?? "日期仅按原文比较；采取业务行动前须向主管机关核实当前规则及适用条件。";
}

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
  topicId?: string,
): BusinessTimeliness {
  const checkedAt = now.toISOString(), today = beijingDate(now);
  const boundary = (date: SourceDate): BusinessDateBoundary => {
    const end = lastDate(date);
    return { state: end === null ? "unknown" : end < today ? "elapsed" : "date_not_elapsed", lastDate: end };
  };
  const deadline = boundary(dates.deadline.value), expiry = boundary(dates.expiresAt.value);
  const notices = [expiry.state === "elapsed" ? "已过文载失效日期" : null, deadline.state === "elapsed" ? "已截止（按原文日期）" : null].filter(Boolean);
  return { checkedAt, timeZone: BEIJING_TIMEZONE, deadline, expiry, label: [...notices, guidance[topicId ?? ""]?.[0] ?? "适用状态待核实"].join("；") };
}
