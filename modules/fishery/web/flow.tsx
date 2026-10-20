import { useState } from "react";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, KV, ReasonDialog } from "@aihot/web/features/admin/ui";
import { FLOW_STATES, type FlowView } from "../ui-contracts.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";
export const headers=noStore;
export async function loader({request,params}:LoaderArgs) {return adminGet<FlowView>(request,`/api/admin/fishery/flows/${encodeURIComponent(params.id!)}`);}
export default function Flow({loaderData:d}:ComponentProps<typeof loader>) {
  const {run,busy}=useAdminAction(),fresh=useFreshMaterial();
  const [command,setCommand]=useState<{kind:"retry"|"qualified"|"rejected";snapshotHash:string}|null>(null),[ack,setAck]=useState(false);
  const base=`/api/admin/fishery/flows/${d.id}`,canDecide=!d.stale&&["needs_human_review","qualified","rejected"].includes(d.status),changed=command?.snapshotHash!==d.snapshotHash;
  const open=(kind:"retry"|"qualified"|"rejected")=>{setAck(false);setCommand({kind,snapshotHash:d.snapshotHash});};
  return <AdminPage title="内部文章审核" subtitle={<Link className="text-accent" to={`/admin/fishery/${d.document_id}`}>← 返回原文与素材证据</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>重新核对</Button>}>
    <div className="mb-5 flex flex-wrap gap-2"><Badge>{FLOW_STATES[d.status]??d.status}</Badge><Badge>阶段 {d.stage}</Badge><Badge>仅内部 · 未公开发布</Badge></div>
    {d.stale&&<p role="alert" className="mb-5 rounded-card bg-hot-soft p-4 text-[13px] text-hot">版本已失效：{d.staleReason}。旧审核与预览停止使用，请返回素材新建当前版本任务。</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card title="候选文章与逐句证据">
          {d.draft?<><p className="mb-3 text-[12px] text-ink-3">生成回执 {d.draft.receiptId} · 配置模型别名 {d.draft.model} · {d.draft.promptVersion}</p><ol className="space-y-4">{d.draft.draft.summaryZh.map((fact,i)=><li key={i}><p className="text-[14px] leading-relaxed">{fact.sentence}</p>{fact.evidence.map((a,j)=><blockquote key={j} className="mt-2 border-l-2 border-line pl-3 text-[12px] text-ink-3">{a.quote}<footer className="mt-1">原段 {a.paragraph} · PDF页 {a.page??"未提供"}</footer></blockquote>)}</li>)}</ol><details className="mt-4 text-[12px]"><summary className="cursor-pointer text-accent">查看日期、机构角色、海域和全部生成字段</summary><pre className="mt-2 max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3">{JSON.stringify(d.draft.draft,null,2)}</pre></details></>:<p className="text-[13px] text-ink-3">尚无成功生成产物。</p>}
        </Card>
        <Card title="隔离第二遍证据核查">
          <p className="mb-3 text-[13px] text-ink-3">另一次模型调用核对公开原文和候选产物。同模型第二遍不代表独立信源或真值确认，也不完成法律适用性审核。</p>
          {d.quality_review?<><p className="text-[12px] text-ink-3">核查回执 {d.quality_review.receiptId} · 配置模型别名 {d.quality_review.model} · {d.quality_review.review.decision} · 输入覆盖 {d.quality_review.review.coverage}</p><ul className="mt-3 space-y-4">{d.quality_review.review.findings.map((f,i)=><li key={i} className="rounded-control bg-bg-sunk p-3 text-[13px]"><strong>{f.field} · {f.verdict}</strong><p className="mt-1">{f.reason}</p>{f.evidence.map((a,j)=><blockquote key={j} className="mt-2 border-l-2 border-line pl-3 text-[12px] text-ink-3">{a.quote}（原段 {a.paragraph}，PDF页 {a.page??"未提供"}）</blockquote>)}</li>)}</ul>{!!d.quality_review.missingFields.length&&<p className="mt-3 text-[13px] text-hot">缺少完整支持：{d.quality_review.missingFields.join("、")}</p>}</>:<p className="text-[13px] text-ink-3">尚无成功核查结果。</p>}
          {d.error&&<p role="alert" className="mt-4 break-words text-[13px] text-hot">失败阶段 {d.error.stage}：{d.error.reason}；回执 {d.error.receiptId??"未提供"}。不会自动重试。</p>}
        </Card>
        {d.internalArticle&&<Card title="当前内部合格文章预览"><div className="space-y-3 text-[14px] leading-relaxed">{d.internalArticle.summaryZh.map((s,i)=><p key={i}>{s.sentence}</p>)}</div><p className="mt-3 text-[12px] text-ink-3">审核者：{d.internalArticle.qualifiedBy}。仅当前快照内部预览，原许可保持不变。</p></Card>}
      </div>
      <aside className="space-y-5 xl:sticky xl:top-5">
        <Card title="人工决定"><p className="text-[13px] text-ink-3">核对原文、每条证据和适用边界后，记录内部决定。内部合格不会公开文章或开放全文导出。</p><div className="mt-4 flex flex-wrap gap-2"><Button tone="primary" disabled={busy||!canDecide} onClick={()=>open("qualified")}>记录内部合格</Button><Button tone="danger" disabled={busy||!canDecide} onClick={()=>open("rejected")}>拒绝 / 撤销内部合格</Button></div>{d.human_decision&&<div className="mt-4 text-[13px]"><p>{d.human_decision.actor} · {d.human_decision.at}</p><p className="mt-1 whitespace-pre-wrap break-words">{d.human_decision.note}</p></div>}</Card>
        <Card title="受控处理"><p className="text-[13px] text-ink-3">排队后由受控后台处理，开关关闭或预算不足不会发送请求。中断或未知扣费先核对账本，不自动重发。</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy||d.stale||d.status!=="queued"} onClick={()=>run("POST",base+"/run",{},{success:"任务已排队，等待受控后台处理"})}>排队处理</Button><Button disabled={busy||d.stale||!["failed","needs_evidence"].includes(d.status)} onClick={()=>open("retry")}>显式重试失败阶段</Button></div><KV items={[["尝试名称",d.identity],["生成 / 核查次数",`${d.generation_attempt} / ${d.review_attempt}`],["证据快照",<code className="break-all text-[11px]">{d.snapshotHash}</code>]]}/></Card>
      </aside>
    </div>
    <ReasonDialog open={!!command} title={command?.kind==="retry"?"显式重试失败阶段":"记录内部审核决定"} confirmLabel="保存决定" danger={command?.kind==="rejected"} busy={busy} description="决定绑定当前证据快照，不授予转载权或法律适用性。" onClose={()=>setCommand(null)} onSubmit={async note=>{
      if(!command||!ack||changed||d.stale)return false;
      const result=await run("POST",base+(command.kind==="retry"?"/retry":"/decision"),command.kind==="retry"?{note}:{decision:command.kind,snapshotHash:command.snapshotHash,note},{success:"决定已保存，正在重新核对"});return !!result;
    }}><label className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/>我已核对原文、当前快照和失败/费用状态，理解仅供内部使用。</label>{(changed||d.stale)&&<p role="alert" className="text-hot">快照已变化，请取消并重新核对。</p>}</ReasonDialog>
  </AdminPage>;
}
