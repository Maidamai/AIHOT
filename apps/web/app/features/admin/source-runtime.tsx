import type { AdminSourceRow } from "@aihot/contracts/admin";
import { Link } from "react-router";
import { HEALTH_LABEL } from "./labels";
import { Dot, healthTone } from "./ui";

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
      {unknown ? "待核实" : enabled ? HEALTH_LABEL[health] ?? health : "已暂停"}
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
