import { useEffect } from "react";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Time } from "@aihot/web/features/admin/ui";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import type { ArchiveStatus } from "../backend/archive-worker.ts";
import type { BatchListEntry } from "../backend/column-batches.ts";
import type {listColumnProgress,listColumnRounds} from "../backend/column-progress.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export async function loader({request}:LoaderArgs) { return adminGet<{rows:BatchListEntry[];archiveStatus?:ArchiveStatus;archiveSources?:ArchiveStatus[];progress?:Awaited<ReturnType<typeof listColumnProgress>>;rounds?:Awaited<ReturnType<typeof listColumnRounds>>}>(request,"/api/admin/fishery/batches"); }
const COVERAGE: Record<string, string> = { more_pages: "尚有后续页", cycle_complete: "本轮页循环完成（非全站覆盖）", pagination_unverified: "分页待核验", current_page_only: "仅本页", blocked: "范围受阻" };

function ArchiveHealth({ status }: { status: ArchiveStatus | undefined }) {
  const name=status?.sourceName??"Moa";
  return <section aria-label={`${name} 受控归档状态`} className="mb-5"><Card title={`${name} 受控归档`} right={<div className="flex flex-wrap gap-3"><Link to="/admin/runs" className="text-accent">运行记录</Link><Link to={`/admin/sources/${status?.sourceId??"fishery-column-moa"}`} className="text-accent">核心信源</Link></div>}>
    {!status ? <p className="text-[13px] text-ink-3">受控归档状态尚未提供，请刷新或查看运行记录；不能据此判断归档是否开启。</p> : <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span>受控归档：</span><Badge tone={status.enabled ? "ok" : status.pausedReason ? "warn" : "muted"}>{status.enabled ? "已启用" : status.pausedReason ? "已暂停" : "未启用"}</Badge>
        <span className="ml-2">核心信源：</span><Badge tone={status.coreSourceEnabled === false ? "muted" : status.coreSourceEnabled === true ? "warn" : "muted"}>{status.coreSourceEnabled === null ? "未知" : status.coreSourceEnabled ? "已启用" : "已停用"}</Badge>
        <span className="text-ink-3">{status.mode === "hourly" ? "小时节奏" : status.mode === "six_hourly" ? "每 6 小时" : status.mode === "validation" ? "有界验证" : "模式未记录"}</span>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-3">核心信源与受控归档是两项独立状态。核心信源停用不代表受控归档关闭；实际执行以下次时间和当前轮记录为准。每轮最多 {status.maxPages} 个列表页、{status.maxArticles} 篇文章，不代表全站覆盖。</p>
      <dl className="grid gap-x-6 gap-y-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="mb-1 text-ink-3">最后心跳</dt><dd><Time at={status.heartbeatAt} /></dd></div>
        <div><dt className="mb-1 text-ink-3">最近成功</dt><dd><Time at={status.lastSuccessAt} /></dd></div>
        <div><dt className="mb-1 text-ink-3">最近失败</dt><dd><Time at={status.lastFailureAt} /></dd></div>
        <div><dt className="mb-1 text-ink-3">下次执行</dt><dd><Time at={status.nextRunAt} /></dd></div>
        <div><dt className="mb-1 text-ink-3">当前轮</dt><dd className="break-all">{status.currentRound ?? "未记录"}</dd></div>
        <div><dt className="mb-1 text-ink-3">上一轮</dt><dd className="break-all">{status.lastRound ?? "未记录"}</dd></div>
        <div><dt className="mb-1 text-ink-3">剩余候选</dt><dd>{status.pendingCandidates ?? "未知"}</dd></div>
        <div><dt className="mb-1 text-ink-3">连续失败</dt><dd className={status.consecutiveFailures ? "text-hot" : ""}>{status.consecutiveFailures}</dd></div>
        <div className="sm:col-span-2"><dt className="mb-1 text-ink-3">列表游标与页范围</dt><dd className="break-all">{status.cursorUrl ?? "未知"}</dd><dd className="mt-1 text-ink-3">{status.coverage ? `${COVERAGE[status.coverage] ?? status.coverage}（${status.coverage}）` : "覆盖范围未知"}</dd></div>
        <div className="sm:col-span-2"><dt className="mb-1 text-ink-3">归档授权批号</dt><dd className="break-all">{status.runId ?? "未记录"}</dd>{status.mode === "validation" && <dd className="mt-1 text-ink-3">验证轮次已认领 {status.validationClaimed ?? "未知"}/{status.validationLimit ?? "未知"}</dd>}</div>
        <div className="sm:col-span-2"><dt className="mb-1 text-ink-3">最近错误</dt><dd className={`break-words ${status.lastError ? "text-hot" : "text-ink-3"}`}>{status.lastError ?? "无已记录错误"}</dd></div>
        <div className="sm:col-span-2"><dt className="mb-1 text-ink-3">暂停原因</dt><dd className={`break-words ${status.pausedReason ? "text-hot" : "text-ink-3"}`}>{status.pausedReason ?? "无已记录暂停原因"}</dd></div>
      </dl>
    </>}
  </Card></section>;
}

export default function Batches({loaderData:data}:ComponentProps<typeof loader>) {
  const {run,busy}=useAdminAction(), fresh=useFreshMaterial();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible" && fresh.state === "idle") fresh.revalidate(); }, 20_000);
    return () => clearInterval(timer);
  }, [fresh]);
  return <AdminPage title="采集批次" subtitle={<Link to="/admin/fishery" className="text-accent">← 返回素材</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>刷新记录</Button>}>
    <p className="mb-5 text-[13px] text-ink-3">展示手动与受控定时归档、已有归档重解析记录。每 20 秒在页面可见时刷新状态，也可手动刷新；查看页面不会发起采集。归档不自动进行付费加工、审核或发布；导入会核对原始归档，新材料待审，内容变化使旧审核失效，转载权保持未知。</p>
    {data.archiveSources?.length ? data.archiveSources.map(s=><ArchiveHealth key={s.sourceId} status={s} />) : <ArchiveHealth status={data.archiveStatus} />}
    {!!data.progress?.length&&<Card title="跨轮来源健康"><p className="mb-3 text-[13px] text-ink-3">成功表示本轮计划请求完成，不代表全站覆盖。游标只在归档落地后推进；失败、未知分页与未遍历范围分别保留。</p><ul className="space-y-3 text-[13px]">{data.progress.map(p=><li key={p.column}>{p.column}：{p.status==="unreadable"?<span className="text-hot">进度不可读，禁止自动重置 · {p.error}</span>:<><span>{p.state.health?.outcome??"尚未运行"}</span> · 最近成功 {p.state.health?.lastSuccessAt??"无"} · 待采 {p.state.pendingUrls.length} · 覆盖 {p.state.health?.coverage??"未知"}<p className="break-all text-ink-3">下次列表 {p.state.cursorUrl}</p>{p.state.health?.reason&&<p className="text-hot">{p.state.health.reason}</p>}</>}</li>)}</ul></Card>}
    {!!data.rounds?.length&&<div className="my-5"><Card title="有界跨轮运行"><ul className="space-y-2 text-[13px]">{data.rounds.map(r=><li key={r.id}>{r.id} · {r.status}{r.status==="unreadable"?<span className="text-hot"> · {r.error}</span>:<> · {r.outcome??"尚未结束"} · 每源最多 {r.limit} 文章/{r.maxPages} 列表页{r.status==="running"&&<span className="text-hot"> · 未完成；先确认旧执行者停止再对账</span>}</>}</li>)}</ul></Card></div>}
    <div className="space-y-5">{data.rows.map(b=>b.status==="unreadable"?<Card key={b.id} title={b.id}>
      <p className="text-[13px] text-hot">批次记录不可读取（unreadable），无法导入。</p>
      <p className="mt-2 break-words text-[13px] text-ink-3">{b.error}</p>
    </Card>:<Card key={b.id} title={b.id}>
      <p className="text-[13px] text-ink-3">{b.reparse?<>已有归档重解析 · 新网页请求 {b.reparse.networkRequests} · 重解析 {b.reparsedItems??b.items.length} 条 · 处理时间 {b.startedAt} · {b.status}</>:<>{b.startedAt} · {b.status} · 已尝试 {b.items.length}</>}，待审候选 {b.items.filter(i=>i.state==="ready").length}，失败 {b.items.filter(i=>i.state==="failed").length}，不相关 {b.items.filter(i=>i.state==="irrelevant").length}</p>
      {b.reparse&&<p className="mt-2 text-[13px] text-ink-3">处理时间不是原文获取时间；原获取时间保持不变。正文版本变化后需要重新审核。</p>}
      <ul className="my-3 space-y-2 text-[13px]">{b.sources.map(s=><li key={s.id}>{s.id}：{s.outcome??"旧批次未记录健康结论"} · 栏目链接 {s.listed}，标题排除 {s.titleFiltered}，文章请求 {s.attempted}{s.pagination&&<> · 列表页 {s.pagination.pageIndex+1} · {s.pagination.scope} · 本页待采 {s.remaining?.length??"未知"}</>}{s.error&&<span className="text-hot"> · {s.error}</span>}</li>)}</ul>
      <ul className="mb-4 space-y-3 text-[13px]">{b.items.map(i=><li key={i.archiveId}><a href={i.url} target="_blank" rel="noreferrer" className="text-accent">{i.discoveryTitle}</a> · {i.state} · 发布 {i.prepared?.dates.published.value??"未知"} · 地域待核{b.reparse&&<> · 原获取 {i.prepared?.sourceCapture.capturedAt??"未记录"}</>}{i.error&&<p className="break-words text-hot">{i.error}</p>}</li>)}</ul>
      <Button disabled={busy||b.status!=="complete"||!b.items.length} onClick={()=>run("POST",`/api/admin/fishery/batches/${b.id}/import`,{}, {success:"已记录采集结果；新材料待审，正文变化使旧审核失效，失败不等于撤稿"})}>导入或记录采集结果</Button>
    </Card>)}{!data.rows.length&&<Empty>尚无手动采集或归档重解析记录。</Empty>}</div>
  </AdminPage>;
}
