import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Button, Card, Empty } from "@aihot/web/features/admin/ui";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import type { ColumnBatch } from "../backend/column-batches.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export async function loader({request}:LoaderArgs) { return adminGet<{rows:ColumnBatch[]}>(request,"/api/admin/fishery/batches"); }
export default function Batches({loaderData:data}:ComponentProps<typeof loader>) {
  const {run,busy}=useAdminAction(), fresh=useFreshMaterial();
  return <AdminPage title="采集批次" subtitle={<Link to="/admin/fishery" className="text-accent">← 返回素材</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>刷新记录</Button>}>
    <p className="mb-5 text-[13px] text-ink-3">仅展示操作员手动运行的少量官方栏目采集。导入会核对原始归档；新材料待审，内容变化使旧审核失效。转载权保持未知，不触发模型、定时采集或发布。</p>
    <div className="space-y-5">{data.rows.map(b=><Card key={b.id} title={b.id}>
      <p className="text-[13px] text-ink-3">{b.startedAt} · {b.status} · 已尝试 {b.items.length}，待审候选 {b.items.filter(i=>i.state==="ready").length}，失败 {b.items.filter(i=>i.state==="failed").length}，不相关 {b.items.filter(i=>i.state==="irrelevant").length}</p>
      <ul className="my-3 space-y-2 text-[13px]">{b.sources.map(s=><li key={s.id}>{s.id}：栏目链接 {s.listed}，标题排除 {s.titleFiltered}，文章请求 {s.attempted}{s.error&&<span className="text-hot"> · {s.error}</span>}</li>)}</ul>
      <ul className="mb-4 space-y-3 text-[13px]">{b.items.map(i=><li key={i.archiveId}><a href={i.url} target="_blank" rel="noreferrer" className="text-accent">{i.discoveryTitle}</a> · {i.state} · 发布 {i.prepared?.dates.published.value??"未知"} · 地域待核{i.error&&<p className="break-words text-hot">{i.error}</p>}</li>)}</ul>
      <Button disabled={busy||b.status!=="complete"||!b.items.some(i=>i.state==="ready")} onClick={()=>run("POST",`/api/admin/fishery/batches/${b.id}/import`,{}, {success:"已导入；新材料待审，相同证据不重复入库"})}>导入待审材料</Button>
    </Card>)}{!data.rows.length&&<Empty>尚无手动采集批次。</Empty>}</div>
  </AdminPage>;
}
