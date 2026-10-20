import { useState } from "react";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, KV, ReasonDialog } from "@aihot/web/features/admin/ui";
import { FLOW_STATES, type FlowTimeline, type FlowView } from "../ui-contracts.ts";
import { dateLabel, noStore, useFreshMaterial } from "./shared.tsx";
export const headers=noStore;
export async function loader({request,params}:LoaderArgs) {return adminGet<FlowView>(request,`/api/admin/fishery/flows/${encodeURIComponent(params.id!)}`);}
function Timeline({value:t}:{value:FlowTimeline}) {
  return <div className="mb-4 space-y-3 rounded-control bg-bg-sunk p-3 text-[12px] text-ink-3">
    <p><strong>{t.label}</strong> · 时效核对日 {t.referenceDate}（UTC）{t.originalAgeDays!==null&&t.originalAgeDays>=0?` · 原文距今${t.originalAgeDays}日`:""}</p>
    <KV items={[["原文发布日期（绑定观察）",dateLabel(t.sourcePublished)],["原始发布时刻",t.sourcePublishedAt??"未知"],["原文日期字面",t.publicationLiteral??"未知"],["原文事件日期（记录）",dateLabel(t.sourceEvent)],["候选事件日期（待核验）",dateLabel(t.candidateEvent)],["原文采集时间",t.sourceCapturedAt??"未记录"],["生成结果入库时间",t.generatedAt??"未记录"],["核查结果入库时间",t.checkedAt??"未记录"],["任务建立 / 最近更新",`${t.taskCreatedAt} / ${t.taskUpdatedAt}`]]}/>
    <p>采集、生成、核查和任务更新时间均不是新闻发生或原文发布日期。历史资料新生成不变成最新消息；日期未知保持未知，文载状态不代表独立核实现行有效或法律适用。</p>
  </div>;
}
function HumanRevision({flow}:{flow:FlowView}) {
  const {run,busy}=useAdminAction();
  const [context,setContext]=useState<{snapshotHash:string;evidenceCatalog:{hash:string;spans:unknown[]};candidate:unknown;originalContent:string|null}|null>(null),[text,setText]=useState(""),[reason,setReason]=useState(""),[error,setError]=useState(""),[created,setCreated]=useState<string|null>(null);
  return <Card title="人工修订候选（保存不调用模型）"><p className="text-[13px] text-ink-3">原任务与收到的回执保持不变。载入当前证据目录，编辑严格 ID JSON；旧版本锚不能迁移。保存后仍须另行明确排队核查及人工审核。</p>
    <Button disabled={busy} onClick={async()=>{setError("");try {const response=await fetch(`/api/admin/fishery/flows/${flow.id}/revision`,{credentials:"same-origin"});if(response.status===401){window.location.href=`/api/auth/login?return=${encodeURIComponent(window.location.pathname)}`;return;}const value=await response.json();if(!response.ok)throw new Error(value.detail??"无法载入当前证据");setContext(value);setText(JSON.stringify(value.candidate,null,2));}catch(e){setError((e as Error).message);}}}>载入当前证据与可编辑候选</Button>
    {context&&<div className="mt-4 space-y-3"><details><summary>原回执候选文本（不可修改）</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-[12px]">{context.originalContent??"原响应无候选文本"}</pre></details><details><summary>当前完整证据目录（按原 ID 选择）</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-[12px]">{JSON.stringify(context.evidenceCatalog,null,2)}</pre></details><label className="block text-[13px]">候选 JSON（evidence 为目录 ID 数组）<textarea aria-label="人工修订候选 JSON" className="mt-2 min-h-96 w-full rounded-control border border-line bg-bg-sunk p-3 font-mono text-[12px]" value={text} onChange={e=>setText(e.target.value)}/></label><label className="block text-[13px]">修订原因<textarea className="mt-2 w-full rounded-control border border-line p-2" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={busy||!reason.trim()||!!created} onClick={async()=>{setError("");try {const candidate=JSON.parse(text);const result=await run<{id:string}>("POST",`/api/admin/fishery/flows/${flow.id}/revision`,{identity:`revision-${crypto.randomUUID()}`,snapshotHash:context.snapshotHash,evidenceHash:context.evidenceCatalog.hash,reason,candidate},{success:"修订候选已保存，尚未排队模型核查"});if(result)setCreated(result.id);}catch(e){setError((e as Error).message);}}}>零调用校验并保存为新任务</Button></div>}
    {error&&<p role="alert" className="mt-3 text-hot">{error}</p>}{created&&<Link className="mt-3 block text-accent" to={`/admin/fishery/flows/${created}`}>打开新修订任务，另行排队核查 →</Link>}
  </Card>;
}
export default function Flow({loaderData:d}:ComponentProps<typeof loader>) {
  const {run,busy}=useAdminAction(),fresh=useFreshMaterial();
  const [command,setCommand]=useState<{kind:"resume"|"regenerate"|"qualified"|"rejected";snapshotHash:string}|null>(null),[ack,setAck]=useState(false);
  const base=`/api/admin/fishery/flows/${d.id}`,canDecide=d.authoritative&&!d.stale&&!d.materialRejected&&d.quality_review?.status==="needs_human_review"&&d.draft?.draft.relevance?.decision==="relevant"&&d.draft?.draft.summaryZh?.some(s=>s.sentence.trim())&&["needs_human_review","qualified","rejected"].includes(d.status),changed=command?.snapshotHash!==d.snapshotHash;
  const open=(kind:"resume"|"regenerate"|"qualified"|"rejected")=>{setAck(false);setCommand({kind,snapshotHash:d.snapshotHash});};
  return <AdminPage title="内部文章审核" subtitle={<Link className="text-accent" to={`/admin/fishery/${d.document_id}`}>← 返回原文与素材证据</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>重新核对</Button>}>
    <div className="mb-5 flex flex-wrap gap-2"><Badge>{FLOW_STATES[d.status]??d.status}</Badge><Badge>阶段 {d.stage}</Badge><Badge>仅内部 · 未公开发布</Badge>{!d.authoritative&&<Badge>历史任务，已有更新任务</Badge>}</div>
    {d.stale&&<p role="alert" className="mb-5 rounded-card bg-hot-soft p-4 text-[13px] text-hot">版本已失效：{d.staleReason}。旧审核与预览停止使用，请返回素材新建当前版本任务。</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card title="候选文章与逐句证据">
          <Timeline value={d.timeline}/>{d.draft?.provenance&&<p className="mb-3 text-[13px]">{d.status==="qualified"?"人工修订候选，经模型辅助核查与人工审核":"人工修订候选，等待模型辅助核查与人工审核"}。原任务 <Link className="text-accent" to={`/admin/fishery/flows/${d.draft.provenance.originalTaskId}`}>{d.draft.provenance.originalTaskId}</Link>；修订者 {d.draft.provenance.actor} · {d.draft.provenance.at}<br/>原因：{d.draft.provenance.reason}<details><summary>修订差异审计</summary><pre className="overflow-auto whitespace-pre-wrap break-words text-[12px]">{JSON.stringify(d.draft.provenance.diff,null,2)}</pre></details></p>}
          {d.draft?<><p className="mb-3 text-[12px] text-ink-3">{d.draft.provenance?"人工修订，无生成调用":"生成回执 "+d.draft.receiptId} · 配置模型别名 {d.draft.model} · {d.draft.promptVersion}</p><ol className="space-y-4">{d.draft.draft.summaryZh.map((fact,i)=><li key={i}><p className="text-[14px] leading-relaxed">{fact.sentence}</p>{fact.evidence.map((a,j)=><blockquote key={j} className="mt-2 border-l-2 border-line pl-3 text-[12px] text-ink-3">{a.quote}<footer className="mt-1">原段 {a.paragraph} · PDF页 {a.page??"未提供"}</footer></blockquote>)}</li>)}</ol><details className="mt-4 text-[12px]"><summary className="cursor-pointer text-accent">查看日期、机构角色、海域和全部生成字段</summary><pre className="mt-2 max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3">{JSON.stringify(d.draft.draft,null,2)}</pre></details></>:<p className="text-[13px] text-ink-3">尚无成功生成产物。</p>}
        </Card>
        <Card title="隔离第二遍证据核查">
          <p className="mb-3 text-[13px] text-ink-3">另一次模型调用核对公开原文和候选产物。同模型第二遍不代表独立信源或真值确认，也不完成法律适用性审核。</p>
          {d.quality_review?<><p className="text-[12px] text-ink-3">核查回执 {d.quality_review.receiptId} · 配置模型别名 {d.quality_review.model} · {d.quality_review.review.decision} · 输入覆盖 {d.quality_review.review.coverage}</p><ul className="mt-3 space-y-4">{d.quality_review.review.findings.map((f,i)=><li key={i} className="rounded-control bg-bg-sunk p-3 text-[13px]"><strong>{f.field} · {f.verdict}</strong><p className="mt-1">{f.reason}</p>{f.evidence.map((a,j)=><blockquote key={j} className="mt-2 border-l-2 border-line pl-3 text-[12px] text-ink-3">{a.quote}（原段 {a.paragraph}，PDF页 {a.page??"未提供"}）</blockquote>)}</li>)}</ul>{!!d.quality_review.missingFields.length&&<p className="mt-3 text-[13px] text-hot">缺少完整支持：{d.quality_review.missingFields.join("、")}</p>}</>:<p className="text-[13px] text-ink-3">尚无成功核查结果。</p>}
          {d.error&&<p role="alert" className="mt-4 break-words text-[13px] text-hot">失败阶段 {d.error.stage}：{d.error.reason}；回执 {d.error.receiptId??"未提供"}。不会自动重试。</p>}
        </Card>
        {(["failed","needs_evidence"].includes(d.status)||d.status==="rejected"&&!!d.draft?.provenance)&&<HumanRevision flow={d}/>}
        {d.internalArticle&&<Card title="当前快照内部合格文章预览"><Timeline value={d.internalArticle.timeline}/><div className="space-y-3 text-[14px] leading-relaxed">{d.internalArticle.summaryZh.map((s,i)=><p key={i}>{s.sentence}</p>)}</div><p className="mt-3 text-[12px] text-ink-3">审核者：{d.internalArticle.qualifiedBy}。仅当前快照内部预览，原许可保持不变。</p></Card>}
      </div>
      <aside className="space-y-5 xl:sticky xl:top-5">
        <Card title="人工决定"><p className="text-[13px] text-ink-3">核对原文、每条证据和适用边界后，记录内部决定。内部合格不会公开文章或开放全文导出。</p><div className="mt-4 flex flex-wrap gap-2"><Button tone="primary" disabled={busy||!canDecide} onClick={()=>open("qualified")}>记录内部合格</Button><Button tone="danger" disabled={busy||d.status==="running"} onClick={()=>open("rejected")}>拒绝 / 撤销内部合格</Button></div>{d.human_decision&&<div className="mt-4 text-[13px]"><p>{d.human_decision.actor} · {d.human_decision.at}</p><p className="mt-1 whitespace-pre-wrap break-words">{d.human_decision.note}</p></div>}</Card>
        <Card title="受控处理"><p className="text-[13px] text-ink-3">排队后由受控后台处理，开关关闭或预算不足不会发送请求。中断或未知扣费先核对账本，不自动重发。</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy||d.stale||!d.authoritative||d.status!=="queued"} onClick={()=>run("POST",base+"/run",{},{success:"任务已排队，等待受控后台处理"})}>{d.draft?.provenance?"仅排队核查修订候选（可能计费）":"排队处理"}</Button><Button disabled={busy||d.stale||!d.authoritative||!["failed","needs_evidence","running"].includes(d.status)} onClick={()=>open("resume")}>恢复同次处理（复用回执）</Button><Button disabled={busy||d.stale||!d.authoritative||!["failed","needs_evidence"].includes(d.status)||d.error?.phase==="persist"} onClick={()=>open("regenerate")}>{d.draft?.provenance?"重新核查修订候选（可能计费）":"重新生成失败阶段（可能计费）"}</Button></div><KV items={[["尝试名称",d.identity],["生成 / 核查次数",`${d.generation_attempt} / ${d.review_attempt}`],["证据快照",<code className="break-all text-[11px]">{d.snapshotHash}</code>]]}/></Card>
      </aside>
    </div>
    <ReasonDialog open={!!command} title={command?.kind==="resume"?"恢复同次处理":command?.kind==="regenerate"?"新尝试，可能新增模型费用":"记录内部审核决定"} confirmLabel="保存决定" danger={command?.kind==="rejected"} busy={busy} description="决定绑定当前证据快照，不授予转载权或法律适用性。" onClose={()=>setCommand(null)} onSubmit={async note=>{
      if(!command||!ack||changed||(d.stale&&command.kind!=="rejected"))return false;
      const result=await run("POST",base+(["resume","regenerate"].includes(command.kind)?"/retry":"/decision"),["resume","regenerate"].includes(command.kind)?{note,mode:command.kind,acknowledgeNewCharge:command.kind==="regenerate"}:{decision:command.kind,snapshotHash:command.snapshotHash,note},{success:"决定已保存，正在重新核对"});return !!result;
    }}><label className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/>我已核对原文、当前快照和失败/费用状态，理解仅供内部使用。</label>{(changed||(d.stale&&command?.kind!=="rejected"))&&<p role="alert" className="text-hot">快照已变化，请取消并重新核对。</p>}</ReasonDialog>
  </AdminPage>;
}
