import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Button, Card, Empty } from "@aihot/web/features/admin/ui";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import type { BatchListEntry } from "../backend/column-batches.ts";
import type {listColumnProgress,listColumnRounds} from "../backend/column-progress.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export async function loader({request}:LoaderArgs) { return adminGet<{rows:BatchListEntry[];progress?:Awaited<ReturnType<typeof listColumnProgress>>;rounds?:Awaited<ReturnType<typeof listColumnRounds>>}>(request,"/api/admin/fishery/batches"); }
export default function Batches({loaderData:data}:ComponentProps<typeof loader>) {
  const {run,busy}=useAdminAction(), fresh=useFreshMaterial();
  return <AdminPage title="采集批次" subtitle={<Link to="/admin/fishery" className="text-accent">← 返回素材</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>刷新记录</Button>}>
    <p className="mb-5 text-[13px] text-ink-3">展示操作员手动运行的少量官方栏目采集及已有归档重解析记录。导入会核对原始归档；新材料待审，内容变化使旧审核失效。转载权保持未知，不触发模型、定时采集或发布。</p>
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
