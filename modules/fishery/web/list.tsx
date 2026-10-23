import { SITE } from "@aihot/site";
import { Form, Link, useSearchParams } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import { AdminPage, Badge, Button, Card, Empty, Input, Select, Stat } from "@aihot/web/features/admin/ui";
import { bj } from "@aihot/web/features/admin/format";
import { MATERIAL_STATES, type Workbench } from "../ui-contracts.ts";
import { acquisitionLabel, dateLabel, noStore, StateBadge, TrialNotice, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export const meta: MetaFunction = () => [{ title: `渔业素材 · ${SITE.name} 后台` }];
export async function loader({ request }: LoaderArgs) { return adminGet<Workbench>(request, `/api/admin/fishery/workbench${new URL(request.url).search}`); }

export default function Materials({ loaderData: data }: ComponentProps<typeof loader>) {
  const [params] = useSearchParams(), refresh = useFreshMaterial();
  const scope = params.get("scope") ?? "real", state = params.get("state") ?? "", rows = data.rows;
  const pageLink = (page: number) => { const p = new URLSearchParams(params); p.set("page",String(page)); return `?${p}`; };
  const sources = data.sources.filter(s => scope === "all" || s.testOnly === (scope === "test"));
  return <AdminPage title="渔业素材" subtitle="先核对原始证据，再记录审核。导出始终检查最新版本、来源许可与撤回状态。"
    actions={<><Link to="/admin/fishery/collect" className="text-[13px] text-accent">采集批次</Link><Button busy={refresh.state === "loading"} onClick={() => refresh.revalidate()}>重新核对</Button></>}>
    <TrialNotice />
    <nav aria-label="素材范围" className="mb-5 flex flex-wrap gap-2">
      {[["real", "真实素材"], ["test", "测试演练"], ["all", "全部"]].map(([value, label]) => <Link key={value} to={`?${new URLSearchParams({ scope: value })}`}
        aria-current={scope === value ? "page" : undefined} className={`rounded-control px-3 py-2 text-[13px] ${scope === value ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line"}`}>{label} · {data.scopeCounts[value as keyof typeof data.scopeCounts]}</Link>)}
    </nav>
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label="待审核" value={data.counts.pending} />
      <Stat label="获取失败 / 待核验" value={data.counts.failed+data.counts.unverified} tone="warn" />
      <Stat label="审核已失效" value={data.counts.stale} tone="warn" />
      <Stat label="已撤回" value={data.counts.withdrawn} />
    </div>
    <details className="mb-5 rounded-panel bg-surface p-4 ring-1 ring-line">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink">来源最近归档获取状态 · {sources.length}</summary>
      <p className="mt-3 text-[12px] text-ink-3">汇总当前素材范围的已导入获取记录，不受本页分页或筛选影响；不代表连续健康监控或事实可靠。未导入的获取失败和批次错误请查看<Link to="/admin/fishery/collect" className="text-accent">采集批次</Link>。</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sources.map(s => {
        const capture = data.sourceCaptures[s.id];
        return <div key={s.id} className="min-w-0 rounded-control bg-bg-sunk/60 p-3 text-[12.5px]">
          <p className="break-words font-medium text-ink">{s.name}</p>
          <p className="mt-1 text-ink-3">{capture ? <Link to={`/admin/fishery/${capture.documentId}`} className="text-accent">{`HTTP ${capture.httpStatus} · ${capture.parseStatus} · ${bj(capture.capturedAt, true)} 北京时间 · 观察v${capture.observationRevision}`}</Link> : "当前素材范围尚无已导入归档获取记录"}</p>
          <p className="mt-1 text-ink-3">{acquisitionLabel(capture?.acquisitionMode)} · 许可{s.profile.rightsStatus === "permitted" ? "有记录，仍须核对用途与期限" : "未确认/受限"}</p>
          <p className="mt-1 text-ink-4">{s.enabled ? "常规来源配置已启用" : "自动采集关闭"} · 许可版本 {s.revision}</p>
        </div>;
      })}</div>
    </details>
    <Form method="get" className="mb-4 grid gap-3 sm:grid-cols-[minmax(160px,1fr)_180px_auto]">
      <input type="hidden" name="scope" value={scope} />
      <Input key={params.get("q") ?? ""} name="q" defaultValue={params.get("q") ?? ""} aria-label="搜索素材" placeholder="搜索标题、机构、文号或原文链接" />
      <Select key={state} name="state" defaultValue={state} aria-label="素材状态"><option value="">所有状态</option>{Object.entries(MATERIAL_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Button type="submit" tone="primary">筛选素材</Button>
    </Form>
    <Card pad={false} title={`材料列表 · 共 ${data.total} 条`} right={<span>第 {data.page} 页 · 每页 {data.limit} 条</span>}>
      {rows.length ? <ul className="divide-y divide-line">{rows.map(row => <li key={row.id} className="px-4 py-4 hover:bg-bg-sunk/40">
        <div className="flex flex-wrap items-start justify-between gap-2"><Link to={`/admin/fishery/${row.id}`} className="min-w-0 flex-1 break-words text-[14px] font-medium text-ink hover:text-accent">{row.title}</Link><StateBadge row={row} /></div>
        <div className="mt-2 flex flex-wrap gap-1.5">{row.testOnly && <Badge tone="warn">合成许可 / 测试审批</Badge>}<Badge>{row.timing?.kind==='news'?'近期资讯候选':'历史 / 日期待核参考'}</Badge><Badge>原文 {row.latest?dateLabel(row.latest.payload.dates.published):'未核实'}</Badge><Badge>观察 v{row.latest?.revision ?? 0} · 许可 v{row.source.revision}</Badge></div>
        <p className="mt-2 break-words text-[12.5px] text-ink-3">{row.issuer} · {row.latest?.payload.sourceCapture ? `${acquisitionLabel(row.latest.payload.sourceCapture.acquisitionMode)} · ${bj(row.latest.payload.sourceCapture.capturedAt, true)} 北京时间` : "未记录获取时间"}</p>
        <p className="mt-1 break-words text-[12px] text-ink-4">{row.blockers.length ? `不可导出：${row.blockers.map(b => b.message).join("；")}` : "可申请手动导出；提交时再次核对后端门禁"}</p>
      </li>)}</ul> : <Empty>当前条件下没有素材。调整关键词、状态或素材范围。</Empty>}
    </Card>
    <nav aria-label="素材分页" className="mt-4 flex justify-between text-[13px] text-accent">{data.page>1?<Link to={pageLink(data.page-1)}>上一页</Link>:<span />}{data.page*data.limit<data.total&&<Link to={pageLink(data.page+1)}>下一页</Link>}</nav>
  </AdminPage>;
}
