import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { Badge } from "@aihot/web/features/admin/ui";
import { ACQUISITION_MODES, MATERIAL_STATES, type MaterialRow } from "../ui-contracts.ts";

export const noStore = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
export const acquisitionLabel = (value: string | undefined | null) => ACQUISITION_MODES[(value === "offline_archive_replay" ? "archive_replay" : value) as keyof typeof ACQUISITION_MODES] ?? ACQUISITION_MODES.unknown;
export const dateLabel = (date: { precision: string; value: string | null }) => date.value ? `${date.value}（${({ year: "年", month: "月", day: "日" } as Record<string, string>)[date.precision] ?? date.precision}精度）` : "未知";
export function StateBadge({ row }: { row: Pick<MaterialRow, "state"> }) {
  return <Badge tone={row.state === "failed" || row.state === "withdrawn" ? "bad" : row.state === "approved" ? "ok" : row.state === "stale" || row.state === "unverified" ? "warn" : "muted"}>{MATERIAL_STATES[row.state]}</Badge>;
}
export function TrialNotice({ testOnly = false }: { testOnly?: boolean }) {
  return <div className="mb-5 rounded-card bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink-2 ring-1 ring-amber/25">
    {testOnly ? <><strong>测试演练副本 · 合成许可与测试审批</strong><br />不可当作真实业务审核或转载授权。</> : <><strong>内部素材工作台</strong><br />真实素材与测试演练分开查看。打开页面不触发采集或模型；显式任务操作需后台受控处理，仍不自动发布。隔离测试导出不代表正式业务批准。</>}
  </div>;
}
export function useFreshMaterial() {
  const revalidator = useRevalidator();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") revalidator.revalidate(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [revalidator]);
  return revalidator;
}
