import type { AdminSourceRow } from "@aihot/contracts/admin";
import { Link } from "react-router";
import { HEALTH_LABEL } from "./labels";
import { Badge, Dot, healthTone } from "./ui";

type SourceStatus = Pick<AdminSourceRow, "enabled" | "health" | "fail_count" | "interval_minutes" | "runtime">;
type Runtime = NonNullable<AdminSourceRow["runtime"]>;

export function SourceHealth({ source }: { source: SourceStatus }) {
  const { runtime } = source;
  const health = runtime ? runtime.health : source.health;
  const enabled = runtime ? runtime.enabled : source.enabled;
  const unknown = runtime && health === "unknown";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Dot tone={enabled && !unknown ? healthTone(health) : "muted"} />
      {unknown ? "待核实" : enabled ? HEALTH_LABEL[health] ?? health : runtime ? "未启用" : "已暂停"}
      {!runtime && source.fail_count > 0 && <span className="num text-[11.5px] text-ink-4">×{source.fail_count}</span>}
    </span>
  );
}

export function sourceInterval(source: SourceStatus) {
  const minutes = source.runtime ? source.runtime.intervalMinutes : source.interval_minutes;
  return minutes === null ? "待核实" : `${minutes} 分`;
}

export function SourceRuntimeLink({ runtime }: { runtime: Runtime }) {
  return <Link to={runtime.detailPath} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>由{runtime.label}管理 · 查看运行状态</Link>;
}

export function SourceStages({ runtime }: { runtime: Runtime }) {
  return <div className="flex flex-wrap gap-1" aria-label="来源接入进度">
    <Badge tone={runtime.registered ? "ok" : "muted"}>{runtime.registered === undefined ? "收录待核实" : runtime.registered ? "已收录" : "未收录"}</Badge>
    <Badge tone={runtime.adapted ? "ok" : "muted"}>{runtime.adapted === undefined ? "适配待核实" : runtime.adapted ? "已适配" : "未适配"}</Badge>
    <Badge tone={runtime.enabled ? "ok" : "muted"}>{runtime.enabled ? "已启用" : "未启用"}</Badge>
    <Badge tone={runtime.normalCycleVerified ? "ok" : "muted"}>{runtime.normalCycleVerified === undefined ? "周期待核实" : runtime.normalCycleVerified ? "正常周期已验证" : "正常周期未验证"}</Badge>
  </div>;
}
