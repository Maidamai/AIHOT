import { SITE } from "@aihot/site";
import {beijingDate} from '@aihot/contracts/time';
import {noticeDeadlineState} from '../contracts.ts';
import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { AdminMe } from "@aihot/contracts/admin";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Field, Input, KV, ReasonDialog, Select, Textarea } from "@aihot/web/features/admin/ui";
import { bj } from "@aihot/web/features/admin/format";
import type { MaterialDetail, FlowView, ProcessingEligibility } from "../ui-contracts.ts";
import { acquisitionLabel, dateLabel, noStore, StateBadge, TrialNotice, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export const meta: MetaFunction = () => [{ title: `素材详情 · ${SITE.name} 后台` }];
export async function loader({ request, params }: LoaderArgs) { const base=`/api/admin/fishery/documents/${encodeURIComponent(params.id!)}`;const [detail,flows,eligibility]=await Promise.all([adminGet<MaterialDetail>(request,base+"/detail"),adminGet<{rows:FlowView[]}>(request,base+"/flows"),adminGet<ProcessingEligibility>(request,base+"/processing-eligibility")]);return {...detail,flows:flows.rows,eligibility}; }
type Command = { id: string; kind: "approved" | "rejected" | "withdraw"; revision: number; sourceRevision: number };
const actionNames = { approved: "记录审核通过", rejected: "拒绝材料", withdraw: "撤回材料" };
const nominationKinds = { policy: "政策资料", open_window: "申报窗口", regulation_change: "法规变化" } as const;
const nominationStatuses = { current: "当前版本申请", stale: "版本已失效", expired: "评估期限已到", revoked: "已撤销" } as const;

function ProcessingCandidate({ document: d }: { document: MaterialDetail & { eligibility: ProcessingEligibility } }) {
  const { run, busy } = useAdminAction(), fresh = useFreshMaterial();
  const [kind, setKind] = useState<keyof typeof nominationKinds>("policy"), [quote, setQuote] = useState(""), [reason, setReason] = useState(""), [expires, setExpires] = useState("");
  const [revoke, setRevoke] = useState(false), [error, setError] = useState<string | null>(null);
  const capture = d.latest?.payload.sourceCapture, nomination = d.eligibility.nomination;
  const ready = d.state === "approved" && d.text?.hashMatches && capture?.httpStatus === 200 && capture.parseStatus === "parsed" && !!capture.bodySha256 && !capture.conflicts.length;
  const snapshot = `${d.id}:${d.latest?.revision}:${d.source.revision}`;
  const [draftFor, setDraftFor] = useState(snapshot);
  if (draftFor !== snapshot) {
    setDraftFor(snapshot); setQuote(""); setReason(""); setExpires(""); setRevoke(false); setError(null);
  }
  const limit = new Date(Date.now() + 30 * 86400_000 + 8 * 3600_000).toISOString().slice(0, 16);
  const base = `/api/admin/fishery/documents/${d.id}/processing-eligibility`;
  return <Card title="有界业务审核候选">
    <p className="text-[13px] leading-relaxed text-ink-3">将已审核且正文完整核验的素材提为政策、申报窗口或法规变化的业务审核候选。只授予最长 30 天的处理评估期，不证明政策有效、窗口开放、事实通过或可以发布；全站最多保留 20 条活跃资格。</p>
    <p className="mt-3 text-[13px] text-ink-2">历史材料仍归历史参考，不计入近期资讯。后续事实核查、有效性审核和最终发布仍须分别完成。</p>
    <p className="mt-3 text-[13px]" role="status">{d.eligibility.eligible ? "当前已具备有界处理资格" : "当前无生效的有界处理资格"}：{d.eligibility.reason}</p>
    {nomination && <div className="mt-4 rounded-control bg-bg-sunk p-3 text-[12.5px]">
      <div className="flex flex-wrap gap-2"><Badge tone={nomination.status === "current" ? "ok" : "warn"}>{nominationStatuses[nomination.status]}</Badge><Badge>{nominationKinds[nomination.kind]}</Badge></div>
      <p className="mt-2">审计记录 #{nomination.id} · 处理评估截止 {bj(nomination.expiresAt, true)} 北京时间</p>
      <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line pl-3">{nomination.evidenceQuote}</blockquote>
      <p className="mt-2 whitespace-pre-wrap break-words">申请原因：{nomination.reason}</p>
      {nomination.status === "current" && <Button className="mt-3" tone="danger" disabled={busy} onClick={() => setRevoke(true)}>撤销候选资格</Button>}
    </div>}
    {!ready && <p className="mt-4 text-[13px] text-ink-3">暂不能申请：必须先核验当前完整正文，并通过当前观察及来源许可版本的素材审核。待审核、已拒绝、提取失败或旧版本批准均不能申请。</p>}
    <form className="mt-4 space-y-4" onSubmit={async event => {
      event.preventDefault(); setError(null);
      if (!ready || busy || draftFor !== snapshot) return;
      const expiresAt = new Date(`${expires}:00+08:00`);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 30 * 86400_000) { setError("处理评估截止时间须在未来 30 天内；该期限不是政策有效期。"); return; }
      const result = await run("POST", base, { revision: d.latest!.revision, sourceRevision: d.source.revision, kind, evidenceQuote: quote.trim(), reason: reason.trim(), expiresAt: expiresAt.toISOString() }, { success: "候选申请已记录；事实、效力和发布仍须审核" });
      if (result) { setQuote(""); setReason(""); setExpires(""); }
      else { setError("申请未保存，请重新核对当前审核、正文、版本和活跃资格上限。"); fresh.revalidate(); }
    }}>
      <fieldset disabled={!ready || busy} className="min-w-0 space-y-4">
        <Field label="候选类型"><Select aria-label="候选类型" value={kind} onChange={event => setKind(event.target.value as keyof typeof nominationKinds)}>{Object.entries(nominationKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Field label="原文证据" hint="逐条申请；每次引用一段支持此候选类型的连续原文（12–1500 字），不用标题、推断或改写替代。"><Textarea aria-label="候选原文证据" rows={4} required minLength={12} maxLength={1500} value={quote} onChange={event => setQuote(event.target.value)} /></Field>
        <Field label="申请原因（12–2000 字）"><Textarea aria-label="候选申请原因" rows={2} required minLength={12} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></Field>
        <Field label="处理评估截止时间（北京时间）" hint="最长 30 天，仅限本次业务审核处理，不是政策有效期或申报截止日。"><Input aria-label="处理评估截止时间（北京时间）" type="datetime-local" required max={limit} value={expires} onChange={event => setExpires(event.target.value)} /></Field>
        <Button type="submit" disabled={quote.trim().length < 12 || reason.trim().length < 12 || !expires || busy || !ready}>申请有界审核候选</Button>
      </fieldset>
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </form>
    <ReasonDialog open={revoke} title="撤销候选资格" confirmLabel="撤销资格" danger busy={busy} description="记录撤销原因并即时停止此候选资格，不删除素材、审核历史或原文证据。" onClose={() => setRevoke(false)} onSubmit={async reason => {
      const result = await run("DELETE", base, { reason }, { success: "候选资格已撤销" });
      if (!result) fresh.revalidate();
      return result !== null;
    }} />
  </Card>;
}

export default function Material({ loaderData: d }: ComponentProps<typeof loader>) {
  const o = d.latest?.payload, c = o?.sourceCapture, { run, busy } = useAdminAction(), fresh = useFreshMaterial();
  const me = (useRouteLoaderData("admin-layout") as { me: AdminMe }).me;
  const [flowIdentity,setFlowIdentity]=useState("");
  const newsSource=['moa','fujian','fujian-notices','jfa-press'].includes(c?.adapter??'');
  const [selection,setSelection]=useState(newsSource);
  const [command, setCommand] = useState<Command | null>(null), [ack, setAck] = useState(false), [downloading, setDownloading] = useState(false), [error, setError] = useState<string | null>(null);
  const base = `/api/admin/fishery/documents/${d.id}`, frozen = busy || downloading, terminal = !!d.withdrawnReason || !d.latest;
  const open = (kind: Command["kind"]) => { setAck(false); setError(null); setCommand({ id: d.id, kind, revision: d.latest!.revision, sourceRevision: d.source.revision }); };
  const changed = command && (command.id !== d.id || command.revision !== d.latest?.revision || command.sourceRevision !== d.source.revision);
  async function download(format: "json" | "markdown") {
    setDownloading(true); setError(null);
    try {
      const res = await fetch(`${base}/export`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": me.csrf }, body: JSON.stringify({ revision: d.latest!.revision, format }) });
      if (!res.ok) { const failure = await res.json(); throw new Error(failure.detail ?? `请求失败（${res.status}）`); }
      const blob = await res.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `fishery-${d.id}-r${d.latest!.revision}.${format === "json" ? "json" : "md"}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    finally { setDownloading(false); fresh.revalidate(); }
  }
  return <AdminPage title={d.title} subtitle={<Link to={`/admin/fishery?scope=${d.testOnly ? "test" : "real"}`} className="text-accent">← 返回{d.testOnly ? "测试演练" : "真实素材"}</Link>}
    actions={<Button busy={fresh.state === "loading"} onClick={() => fresh.revalidate()}>重新核对</Button>}>
    <TrialNotice testOnly={d.testOnly} />
    <div className="mb-4 flex flex-wrap gap-2"><StateBadge row={d} /><Badge>观察 v{d.latest?.revision ?? 0} · 来源许可 v{d.source.revision}</Badge><Badge>法律适用性未审核</Badge></div>
    <p className="mb-4 rounded-control bg-bg-sunk p-3 text-[13px]">{d.timing?.kind==='news'?'近期资讯候选：仍需正文相关性、价值和事实审核。':'历史或日期待核参考：不计作新资讯；政策是否现行有效须另行核验。'} 素材入库不等于读者可见。</p>
    {error && <p role="alert" className="mb-4 rounded-card bg-hot-soft p-3 text-[13px] text-hot">{error}</p>}
    {(d.state === "failed" || d.state === "unverified") && <div role="alert" className="mb-5 rounded-card bg-hot-soft p-4 text-[13px] text-hot ring-1 ring-hot/20"><strong>{c?.httpStatus !== 200 ? `HTTP ${c?.httpStatus}：原文获取失败` : `解析未核验：${c?.parseStatus}`}</strong><p className="mt-1">没有可用正文时不能导出。不会用搜索缓存补正文，也不据此认定官方撤稿。</p></div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-5">
        <ProcessingCandidate key={d.id} document={d} />
        {c?.noticeContext&&<Card title="公告与附件核验"><KV items={[
          ['公告性质',({consultation:'征求意见（不是正式生效政策）',application_notice:'申报通知（资格仍待核）',funding_allocation:'资金下达（不是到账或开放申报）',publicity:'公示（不是申报通知）',policy_reference:'政策资料（不证明现行有效）',issued_document:'文件发布（效力待核）',unknown:'待核实'})[c.noticeContext.nature]],
          ['原文明确的截止日',dateLabel(c.noticeContext.deadline)],
          ['时限进度',({closed:'已截止，仅作历史资料',deadline_today:'截止日当天，具体时刻待核',future_deadline:'原文截止日在未来，不能据此认定可申请',unknown:'时限待核实'})[noticeDeadlineState(c.noticeContext,beijingDate(new Date()))]],
          ['政策现行有效性','待核实；发布时间与资金下达不等于生效或到账'],
        ]}/>{c.noticeContext.deadlineLiteral&&<p className="mt-3 text-[13px]">原文：{c.noticeContext.deadlineLiteral}</p>}
          <ul className="mt-3 space-y-2 text-[13px]">{c.noticeContext.attachments.map(a=><li key={a.url}><a className="text-accent break-all" href={a.url} target="_blank" rel="noreferrer">{a.label||a.url}</a> · {a.format} / {a.parseStatus} · {a.pages??'未知'}页</li>)}</ul><p className="mt-3 text-[12px] text-ink-3">必需附件 {c.noticeContext.attachmentCount} 件。未完整解析的附件保持待复核，不以页面标题补正文。</p>
        </Card>}
        <Card title="AI 草稿与内部审核任务">
          <p className="text-[13px] text-ink-3">创建任务不发送模型请求。任务绑定当前观察、正文与来源许可版本；AI核查后仍须人工决定内部合格，不能公开发布。</p>
          <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={async e=>{e.preventDefault();await run("POST",base+"/flows",{identity:flowIdentity,selection},{success:"任务已创建，可进入查看"});}}>
            <label className="text-[13px]">尝试名称<input aria-label="任务尝试名称" required pattern="[a-zA-Z0-9_-]{1,64}" maxLength={64} value={flowIdentity} onChange={e=>setFlowIdentity(e.target.value)} className="mt-1 block rounded-control border border-line bg-bg-sunk px-3 py-2" placeholder="例如 review-20261020" /></label>
            <Button type="submit" disabled={terminal||frozen||!d.text?.hashMatches}>创建内部审核任务</Button>
            <label className="text-[13px]"><input type="checkbox" checked={newsSource||selection} disabled={newsSource} onChange={e=>setSelection(e.target.checked)}/> 新闻候选先做正文预筛和双评分；新采集新闻另做事件事实抽取，连同摘要核查与终审（门槛未校准）</label>
          </form>
          <ul className="space-y-3 text-[13px]">{d.flows.map(task=><li key={task.id}><Link className="text-accent" to={`/admin/fishery/flows/${task.id}`}>{task.identity} · {task.status}</Link>{task.stale&&<span className="ml-2 text-hot">版本已失效</span>}</li>)}</ul>{!d.flows.length&&<p className="text-[13px] text-ink-3">尚无AI审核任务。</p>}
        </Card>
        <Card title="来源与日期"><KV items={[
          ["原始URL", <a className="break-all text-accent" href={d.canonicalUrl} target="_blank" rel="noreferrer">{d.canonicalUrl}</a>],
          ["来源归属", d.sourceAttribution], ["网页发布机构", "未核实"], ["政策发文机关", "未核实"], ["文号", d.documentNumber ?? "未核实"], ["获取方式", acquisitionLabel(c?.acquisitionMode ?? d.text?.acquisitionMode)],
          ["获取时间", c ? `${bj(c.capturedAt, true)} 北京时间` : "未知"], ["发布日期", o?.dates.published.precision!=='unknown'&&o?dateLabel(o.dates.published):c?.parseStatus==='failed'||c?.parseStatus==='missing'?'提取失败，日期未核实':c?.parseStatus==='parsed'&&!c.publicationLiteral?'页面发布日期元数据未载明':'未核实（日期证据不足）'],
          ["事件日期", o?.dates.event?.value ? dateLabel(o.dates.event) : "未核实，不用抓取或发布日期代替"], ["通过日期", o?.dates.adopted.value ? dateLabel(o.dates.adopted) : "未核实"],
          ["生效日期", o?.dates.effectiveFrom.value ? dateLabel(o.dates.effectiveFrom) : "未核实"], ["终止日期", o?.dates.effectiveUntil.value ? dateLabel(o.dates.effectiveUntil) : "未核实"],
          ["政策状态", ({ unknown: "未核实", draft: "草案", adopted: "已通过", repealed: "已废止", superseded: "被替代" } as Record<string, string>)[o?.policyStatus ?? "unknown"]],
          ["适用区域", o?.scope.regions.join("、") || "未核实"], ["鱼种", o?.scope.species.join("、") || "未核实"], ["船旗 / 活动", `${o?.scope.flags.join("、") || "未核实"} / ${o?.scope.activities.join("、") || "未核实"}`],
        ]} />{o?.policyContext && <p className="mt-4 rounded-control bg-amber/10 p-3 text-[12.5px] text-ink-2">生效状态：{o.policyContext.entryIntoForce}；异议截止：{dateLabel(o.policyContext.objectionDeadline)}，不是生效日。条款年份：{o.policyContext.provisionYears.join("、") || "未知"}；原文提及不适用：{o.policyContext.nonApplicationMentioned.join("、") || "未知"}。</p>}</Card>
        <Card title="摘要与提取文本"><p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{o?.summaryZh ?? "尚无摘要"}</p>
          <p className="mt-4 text-[12px] text-ink-4">来源原文通过上方链接查看；下方只显示已存的纯文本，不执行原始HTML。</p>
          {d.text ? <><p className={`mt-2 text-[12px] ${d.text.hashMatches ? "text-ink-3" : "text-hot"}`}>{d.text.hashMatches ? "文本哈希与最新观察一致" : "文本哈希与最新观察不一致，不能视为最新已核正文"}{d.text.truncated ? "；仅展示前65536字符" : ""}</p><pre className="mt-3 max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3 text-[12.5px] leading-relaxed text-ink-2">{d.text.body}</pre></>
            : <p className="mt-3 text-[13px] text-ink-3">没有关联的已存提取文本；此记录可能仅有观察元数据或获取失败。</p>}
        </Card>
        <Card title="原件与附件证据"><KV items={[["原件HTTP", c?.httpStatus ?? "未记录"], ["解析状态", c?.parseStatus ?? "未记录"], ["解析器版本", c?.parser ?? "未记录"],
          ["原件SHA-256", <code className="break-all text-[11.5px]">{o?.rawSha256 ?? "未知"}</code>], ["文本SHA-256", <code className="break-all text-[11.5px]">{c?.bodySha256 ?? "无已核验文本"}</code>],
          ["附件HTTP / 页数", c?.attachmentUrl?`${c.attachmentHttpStatus ?? "未记录"} / ${c.attachmentPages ?? "未核实"}`:"不适用（未关联附件）"], ["附件SHA-256", <code className="break-all text-[11.5px]">{c?.attachmentSha256 ?? "未记录"}</code>]]} />
          <ul className="mt-4 space-y-3">{o?.evidence.map((e, i) => <li key={i} className="min-w-0 rounded-control bg-bg-sunk/60 p-3 text-[12px]"><a href={e.url} target="_blank" rel="noreferrer" className="break-all text-accent">{e.url}</a><p className="mt-1">页码 {e.page ?? "未定位"} · {e.section ?? "未标注章节"}</p><code className="mt-1 block break-all text-[11px] text-ink-3">{e.sha256}</code></li>)}</ul>
          <p className="mt-3 text-[12px] text-ink-4">哈希与收据不是远端签名。正文、附件、解析器或来源许可版本变化后，旧审核不能继续放行。</p>
        </Card>
        <Card title="观察与审核记录"><ol className="space-y-3 text-[12.5px] text-ink-2">{d.observations.map(item => <li key={item.revision} className="break-words border-b border-line pb-3 last:border-0"><strong>观察 v{item.revision}</strong> · {bj(item.observedAt, true)} 北京时间<p className="mt-1">{item.payload.sourceCapture?.parser ?? "管理员声明的元数据"}</p><code className="break-all text-[11px] text-ink-4">{item.contentHash}</code></li>)}</ol>
          <ul className="mt-4 space-y-3 text-[12.5px] text-ink-2">{d.reviews.map((r, i) => <li key={i} className="rounded-control bg-bg-sunk/60 p-3"><strong>{r.decision === "approved" ? "审核通过" : "拒绝"} · 观察 v{r.revision} / 许可 v{r.sourceRevision}</strong><p className="mt-1 break-words">{r.note}</p><p className="mt-1 break-words text-[11.5px] text-ink-4">{r.actor} · {bj(r.reviewedAt, true)} 北京时间</p></li>)}</ul>{!d.reviews.length && <p className="mt-3 text-[13px] text-ink-3">尚无审核记录</p>}
          {d.withdrawnReason && <p className="mt-3 break-words text-[13px] text-hot">撤回原因：{d.withdrawnReason}</p>}
        </Card>
      </div>
      <aside className="min-w-0 space-y-5 xl:sticky xl:top-5">
        <Card title="审核与导出">
          <p className="text-[13px] text-ink-3">操作绑定观察 v{d.latest?.revision ?? 0} 和来源许可 v{d.source.revision}。只记录人工决定，不授予转载许可。</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button tone="primary" disabled={terminal || frozen} onClick={() => open("approved")}>记录审核通过</Button><Button disabled={terminal || frozen} onClick={() => open("rejected")}>拒绝材料</Button><Button tone="danger" disabled={terminal || frozen} onClick={() => open("withdraw")}>撤回材料</Button></div>
          <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">{d.blockers.length ? "当前不可导出" : "可申请手动导出"}</h3>
          {d.blockers.length ? <ul className="list-disc space-y-2 pl-4 text-[12.5px] text-ink-2">{d.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul> : <p className="text-[12.5px] text-ink-3">后端将在提交时再次检查。只导出摘要与证据元数据，文件带隔离测试标记。</p>}
          <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!!d.blockers.length || terminal || frozen} onClick={() => download("json")}>导出 JSON</Button><Button disabled={!!d.blockers.length || terminal || frozen} onClick={() => download("markdown")}>导出 Markdown</Button></div>
          <p className="mt-3 text-[12px] text-ink-4">已下载的离线文件不能远程召回；每次使用前须重核状态。</p>
        </Card>
        <Card title="当前来源许可"><KV items={[["状态", d.source.profile.rightsStatus === "permitted" ? "有许可记录，仍受用途及期限限制" : "未知 / 受限 / 已撤销"], ["摘要 / 对外发布", `${d.source.profile.allowedSummary ? "允许" : "未允许"} / ${d.source.profile.allowedPublication ? "允许" : "未允许"}`], ["核验时间", bj(d.source.profile.rightsCheckedAt, true)], ["复核期限", bj(d.source.profile.reviewDueAt, true)]]} />{d.source.profile.evidenceUrl && <a href={d.source.profile.evidenceUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-[12px] text-accent">查看许可记录依据</a>}<p className="mt-3 text-[12px] text-ink-4">本页面不修改许可，也不将技术访问或测试批准当作真实授权。</p></Card>
      </aside>
    </div>
    <ReasonDialog open={!!command} title={command ? actionNames[command.kind] : ""} confirmLabel={command ? actionNames[command.kind] : "确认"} danger={command?.kind !== "approved"} busy={busy}
      description={command ? `仅处理观察 v${command.revision} / 来源许可 v${command.sourceRevision}。${command.kind === "withdraw" ? "撤回后不能继续追加观察或导出；此处不提供恢复。" : "不代表法律适用性审核，也不授予转载许可。"}` : ""}
      onClose={() => setCommand(null)} onSubmit={async reason => {
        if (!command || !ack || changed) return false;
        const payload = command.kind === "withdraw" ? { expectedRevision: command.revision, reason } : { revision: command.revision, sourceRevision: command.sourceRevision, decision: command.kind, applicabilityReviewed: false, note: reason };
        const result = await run("POST", `${base}/${command.kind === "withdraw" ? "withdraw" : "reviews"}`, payload, { success: "操作已记录，正在核对最新状态" });
        if (!result) { setError("操作未保存。已重新核对当前状态，请取消后查看版本与阻断原因。"); fresh.revalidate(); return false; }
        setError(null); return true;
      }}>
      <label className="flex items-start gap-2 text-[13px] text-ink-2"><input type="checkbox" required checked={ack} onChange={event => setAck(event.target.checked)} className="mt-1" />我已核对上述版本，理解本操作不替代真实转载许可。</label>
      {changed && <p role="alert" className="text-[13px] text-hot">材料或许可版本已变化，请取消后重新核对。</p>}
    </ReasonDialog>
  </AdminPage>;
}
