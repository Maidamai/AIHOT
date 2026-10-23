import { BUSINESS_EXECUTOR_LABELS, type BusinessExecutorKind } from "../business-contracts.ts";
import { guideReviewLabel } from "./business-admin-list.tsx";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, KV, ReasonDialog } from "@aihot/web/features/admin/ui";
import type { BusinessGuideAdminRecord, BusinessGuideContext, BusinessGuidePayload } from "../business-contracts.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";
import { SafeSource } from "./business-shared.tsx";
export const headers=noStore;
export async function loader({request,params}:LoaderArgs){
  if(params.id==="new"){
    const documentId=new URL(request.url).searchParams.get("documentId");
    if(!documentId){await adminGet(request,"/api/admin/me");return {record:null,context:null,contextError:null};}
    return {record:null,context:await adminGet<BusinessGuideContext>(request,"/api/admin/fishery/business-guides/context/"+encodeURIComponent(documentId)),contextError:null};
  }
  const record=await adminGet<BusinessGuideAdminRecord>(request,"/api/admin/fishery/business-guides/"+encodeURIComponent(params.id!));
  try{return {record,context:await adminGet<BusinessGuideContext>(request,"/api/admin/fishery/business-guides/context/"+encodeURIComponent(record.documentId)),contextError:null};}
  catch(error){
    const status=(error as {status?:number;init?:{status?:number}})?.status??(error as {init?:{status?:number}})?.init?.status;
    if(!status||![400,403,404,409].includes(status))throw error;
    return {record,context:null,contextError:"当前素材未批准、已撤销或证据不可编辑。可拒绝或撤销旧指南；恢复素材正常审核后再编辑。"};
  }
}
function initialPayload():BusinessGuidePayload {
  const unknown=()=>({state:"unknown" as const,value:null,evidence:[] as []}),date=()=>({value:{precision:"unknown" as const,value:null},evidence:[] as string[]});
  return {relations:[],topicId:"funding",kind:"business_guide",title:{value:"",evidence:[]},summary:[{value:"",evidence:[]}],audience:unknown(),opportunity:unknown(),restrictions:unknown(),materials:unknown(),applicability:{countriesOrRegions:unknown(),flagStates:unknown(),species:unknown(),fishingMethods:unknown()},documentStatus:unknown(),dates:{published:date(),effectiveFrom:date(),deadline:date(),expiresAt:date()},serviceEntry:{state:"unknown",label:null,url:null,evidence:[]}};
}
export default function BusinessAdmin({loaderData:d}:ComponentProps<typeof loader>){return <BusinessEditor key={(d.record?.id??"new")+":"+(d.record?.revision??0)+":"+(d.context?.snapshotHash??"")} data={d}/>;}
function BusinessEditor({data:d}:{data:Awaited<ReturnType<typeof loader>>}){
  const fresh=useFreshMaterial(),navigate=useNavigate(),{run,busy}=useAdminAction();
  const [text,setText]=useState(JSON.stringify(d.record?.payload??initialPayload(),null,2)),[reason,setReason]=useState(""),[error,setError]=useState(""),[documentId,setDocumentId]=useState(""),[decision,setDecision]=useState<"approved"|"rejected"|"withdrawn"|null>(null),[ack,setAck]=useState(false),[executorKind,setExecutorKind]=useState<BusinessExecutorKind>("unspecified");
  const r=d.record,c=d.context,dirty=text!==JSON.stringify(r?.payload??initialPayload(),null,2),stale=!!r&&r.snapshotHash!==c?.snapshotHash;
  const canFinal=!!r&&r.aiReview.current&&r.aiReview.pass&&!r.aiReview.confirmedConflict&&r.aiReview.guideRevision===r.revision&&!!r.aiReview.reviewHash&&!dirty&&!stale;
  async function saveDraft(){
    if(!c)return;
    setError("");
    let payload:unknown;
    try{payload=JSON.parse(text);}catch{setError("JSON 格式无效，请检查后保存。");return;}
    try{
      const result=await run<{id:string}>(r?"PUT":"POST","/api/admin/fishery/business-guides"+(r?"/"+r.id:""),{...r?{expectedRevision:r.revision}:{documentId:c.documentId},snapshotHash:c.snapshotHash,payload,reason},{success:"编审草稿已保存，须完成AI核查与最终批准后才可阅读",revalidate:!!r});
      if(!result)setError("未能确认保存成功，请查看错误提示并重新核对当前版本。");
      else if(!r)navigate("/admin/fishery/guides/"+result.id);
    }catch{setError("保存结果未确认，请重新核对当前版本后再操作。");}
  }
  return <AdminPage title="业务指南编审" subtitle={<Link to="/admin/fishery/guides" className="text-accent">← 返回业务指南待核查</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>重新核对</Button>}>
    <p className="business-notice">编审整理当前素材证据；保存草稿不调用模型，也不构成最终批准。当前版本必须完成AI核查并由最终批准后才可阅读；旧审核批准不自动沿用。来源版本变化后审核链须重新核对。缺值字段须区分未核实、提取失败、原文未载明和不适用；不得凭缺值判断不适用。</p>
    {!c&&r?<Card title="当前证据不可编辑"><p role="alert" className="text-[13px] text-hot">{d.contextError}</p><p className="mt-3 text-[13px]">指南 {r.id} · 版本 {r.revision} · {r.blockedReason??r.status}</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>{setAck(false);setExecutorKind("unspecified");setDecision("rejected");}}>拒绝</Button><Button disabled={busy} onClick={()=>{setAck(false);setExecutorKind("unspecified");setDecision("withdrawn");}}>撤销批准</Button></div></Card>:!c?<Card title="从现有素材创建"><label className="block text-[13px]">素材 ID<input className="mt-2 block w-full rounded-control border border-line p-2" value={documentId} onChange={e=>setDocumentId(e.target.value)}/></label><Button disabled={!documentId.trim()} onClick={()=>navigate("/admin/fishery/guides/new?documentId="+encodeURIComponent(documentId.trim()))}>载入素材证据</Button></Card>:<div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] business-admin-editor"><div className="min-w-0 space-y-5"><Card title="当前素材与证据目录"><p className="text-[13px]">{c.source.name} · {c.source.originalTitle}</p><p className="mt-2 text-[13px] text-accent"><SafeSource url={c.source.url}>查看来源原文</SafeSource> · <Link to={"/admin/fishery/"+c.documentId}>打开素材审核</Link></p><details className="mt-4 text-[12px]"><summary>当前完整证据目录（复制原 ID）</summary><pre className="mt-3 max-h-96 overflow-auto">{JSON.stringify(c.catalog,null,2)}</pre></details></Card>
      <Card title="指南内容 JSON"><div className="mb-3 space-y-2 text-[13px] text-ink-3">
        <p>title 与 summary 每项均需 evidence ID。documented 字段须有原文依据；unknown 保留原义，使用 null 与空 evidence，不自动转为原文未载明或不适用。类型选择 business_guide 或 policy_reference。</p>
        <p>文本字段、documentStatus 和 serviceEntry 的缺值状态可填 unverified（未核实）、extraction_failed（提取失败）、not_stated（原文未载明）、not_applicable（不适用），均须填写非空 reason。value 保持 null；serviceEntry 的 label 与 url 均为 null。not_applicable 必须有原文 evidence ID，其余缺值状态的 evidence 为空。</p>
        <p>日期保留原精度；只有 precision 为 unknown 时可补充上述缺值 state 与 reason，日期 value 仍为 null。已知日期须有证据，不增加缺值状态。入口 URL 必须原文明确记载。变更状态或原因后，当前版本仍须完成AI核查与最终审核。</p>
        <p>材料字段示例（已检查原文，未载明材料要求）：</p><pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-2 text-[12px]">{'{"state":"not_stated","value":null,"evidence":[],"reason":"已检查原文，未载明材料要求"}'}</pre>
      </div><label className="block text-[13px]">指南 JSON<textarea aria-label="指南 JSON" className="mt-2 min-h-96 rounded-control border border-line bg-bg-sunk p-3 font-mono text-[12px]" spellCheck={false} value={text} onChange={e=>setText(e.target.value)}/></label><label className="mt-4 block text-[13px]">编修原因<textarea className="mt-2 rounded-control border border-line p-2" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="mt-3 text-hot">{error}</p>}<div className="mt-4"><Button tone="primary" disabled={busy||!reason.trim()} onClick={saveDraft}>保存编审草稿</Button></div></Card></div>
      <aside className="min-w-0 space-y-5"><Card title="版本与审核决定"><div className="mb-3 flex flex-wrap gap-2"><Badge>{r?guideReviewLabel(r):"未保存"}</Badge><Badge>编审</Badge></div><KV items={[["素材",c.documentId],["指南版本",r?.revision??"未保存"],["内容编写","编审整理"],["审核记录日期",r?.verifiedAt??"未记录"],["AI核查状态",r?.aiReview.status??"待核查"],["AI绑定当前版本",r?.aiReview.current?"是":"否"],["AI核查结果",r?.aiReview.current&&r.aiReview.pass?"通过":"未通过或待核查"],["当前AI回执",r?.aiReview.receiptId??"无"],["阅读状态",r?.readable?"完整审核链已完成":r?.blockedReason??"未批准"]]}/>{stale&&<p role="alert" className="my-3 text-[13px] text-hot">证据快照已变化。请对照当前证据修改并保存草稿，再作批准。</p>}{dirty&&<p className="my-3 text-[13px] text-ink-3">编辑尚未保存。请先保存，再核对并批准。</p>}<div className="mt-4 flex flex-wrap gap-2">{(["approved","rejected","withdrawn"] as const).map(kind=><Button key={kind} disabled={busy||!r||dirty||kind==="approved"&&!canFinal} onClick={()=>{setAck(false);setExecutorKind("unspecified");setDecision(kind);}}>{({approved:"最终批准（须AI核查通过）",rejected:"拒绝",withdrawn:"撤销批准"})[kind]}</Button>)}</div>{r?.readable&&<Link className="mt-4 block text-[13px] text-accent" to={"/fishery/guides/"+r.id}>打开当前指南 →</Link>}{r?.humanDecision&&<p className="mt-4 whitespace-pre-wrap break-words text-[12px] text-ink-3">{r.humanDecision.actor} · {r.humanDecision.at}<br/>{BUSINESS_EXECUTOR_LABELS[r.humanDecision.executorKind??"unspecified"]}<br/>{r.humanDecision.reason}</p>}<p className="business-evidence-meta">当前快照 {c.snapshotHash}</p></Card></aside></div>}
    <ReasonDialog open={!!decision} title="记录编审决定" confirmLabel="保存决定" busy={busy} danger={decision!=="approved"} onClose={()=>setDecision(null)} description="最终批准须绑定当前版本通过的AI核查回执，并另行完成最终审核；旧审核记录不能替代。决定不授予转载权或确定具体经营者法律适用性。" onSubmit={async reason=>{if(!r||!decision||!ack||dirty||decision==="approved"&&!canFinal)return false;return !!await run("POST",`/api/admin/fishery/business-guides/${r.id}/decision`,{expectedRevision:r.revision,payloadHash:r.payloadHash,snapshotHash:r.snapshotHash,decision,executorKind,...decision==="approved"?{approvalMode:"final",aiReviewHash:r.aiReview.reviewHash}:{},reason},{success:"审核决定已保存，正在重新核对"});}}><label className="mb-3 block text-[13px]">本次审核执行身份（主动声明，不由账号或角色推断）<select aria-label="本次审核执行身份" value={executorKind} onChange={e=>setExecutorKind(e.target.value as BusinessExecutorKind)}>{Object.entries(BUSINESS_EXECUTOR_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/>我已逐项核对原文证据、日期、未知字段与适用边界。</label></ReasonDialog>
  </AdminPage>;
}
