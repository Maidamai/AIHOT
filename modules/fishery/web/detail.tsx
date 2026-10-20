import { SITE } from "@aihot/site";
import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { AdminMe } from "@aihot/contracts/admin";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, KV, ReasonDialog } from "@aihot/web/features/admin/ui";
import { bj } from "@aihot/web/features/admin/format";
import type { MaterialDetail } from "../ui-contracts.ts";
import { acquisitionLabel, dateLabel, noStore, StateBadge, TrialNotice, useFreshMaterial } from "./shared.tsx";

export const headers = noStore;
export const meta: MetaFunction = () => [{ title: `素材详情 · ${SITE.name} 后台` }];
export async function loader({ request, params }: LoaderArgs) { return adminGet<MaterialDetail>(request, `/api/admin/fishery/documents/${encodeURIComponent(params.id!)}/detail`); }
type Command = { id: string; kind: "approved" | "rejected" | "withdraw"; revision: number; sourceRevision: number };
const actionNames = { approved: "记录审核通过", rejected: "拒绝材料", withdraw: "撤回材料" };

export default function Material({ loaderData: d }: ComponentProps<typeof loader>) {
  const o = d.latest?.payload, c = o?.sourceCapture, { run, busy } = useAdminAction(), fresh = useFreshMaterial();
  const me = (useRouteLoaderData("admin-layout") as { me: AdminMe }).me;
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
    {error && <p role="alert" className="mb-4 rounded-card bg-hot-soft p-3 text-[13px] text-hot">{error}</p>}
    {(d.state === "failed" || d.state === "unverified") && <div role="alert" className="mb-5 rounded-card bg-hot-soft p-4 text-[13px] text-hot ring-1 ring-hot/20"><strong>{c?.httpStatus !== 200 ? `HTTP ${c?.httpStatus}：原文获取失败` : `解析未核验：${c?.parseStatus}`}</strong><p className="mt-1">没有可用正文时不能导出。不会用搜索缓存补正文，也不据此认定官方撤稿。</p></div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-5">
        <Card title="来源与日期"><KV items={[
          ["原始URL", <a className="break-all text-accent" href={d.canonicalUrl} target="_blank" rel="noreferrer">{d.canonicalUrl}</a>],
          ["发布机构", d.issuer], ["文号", d.documentNumber ?? "未知"], ["获取方式", acquisitionLabel(c?.acquisitionMode ?? d.text?.acquisitionMode)],
          ["获取时间", c ? `${bj(c.capturedAt, true)} 北京时间` : "未知"], ["发布日期", o ? dateLabel(o.dates.published) : "未知"],
          ["事件日期", o?.dates.event ? dateLabel(o.dates.event) : "未知，不用抓取或发布日期代替"], ["通过日期", o ? dateLabel(o.dates.adopted) : "未知"],
          ["生效日期", o ? dateLabel(o.dates.effectiveFrom) : "未知"], ["终止日期", o ? dateLabel(o.dates.effectiveUntil) : "未知"],
          ["政策状态", ({ unknown: "未知", draft: "草案", adopted: "已通过", repealed: "已废止", superseded: "被替代" } as Record<string, string>)[o?.policyStatus ?? "unknown"]],
          ["适用区域", o?.scope.regions.join("、") || "未知"], ["鱼种", o?.scope.species.join("、") || "未知"], ["船旗 / 活动", `${o?.scope.flags.join("、") || "未知"} / ${o?.scope.activities.join("、") || "未知"}`],
        ]} />{o?.policyContext && <p className="mt-4 rounded-control bg-amber/10 p-3 text-[12.5px] text-ink-2">生效状态：{o.policyContext.entryIntoForce}；异议截止：{dateLabel(o.policyContext.objectionDeadline)}，不是生效日。条款年份：{o.policyContext.provisionYears.join("、") || "未知"}；原文提及不适用：{o.policyContext.nonApplicationMentioned.join("、") || "未知"}。</p>}</Card>
        <Card title="摘要与提取文本"><p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{o?.summaryZh ?? "尚无摘要"}</p>
          <p className="mt-4 text-[12px] text-ink-4">来源原文通过上方链接查看；下方只显示已存的纯文本，不执行原始HTML。</p>
          {d.text ? <><p className={`mt-2 text-[12px] ${d.text.hashMatches ? "text-ink-3" : "text-hot"}`}>{d.text.hashMatches ? "文本哈希与最新观察一致" : "文本哈希与最新观察不一致，不能视为最新已核正文"}{d.text.truncated ? "；仅展示前65536字符" : ""}</p><pre className="mt-3 max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3 text-[12.5px] leading-relaxed text-ink-2">{d.text.body}</pre></>
            : <p className="mt-3 text-[13px] text-ink-3">没有关联的已存提取文本；此记录可能仅有观察元数据或获取失败。</p>}
        </Card>
        <Card title="原件与附件证据"><KV items={[["原件HTTP", c?.httpStatus ?? "未记录"], ["解析状态", c?.parseStatus ?? "未记录"], ["解析器版本", c?.parser ?? "未记录"],
          ["原件SHA-256", <code className="break-all text-[11.5px]">{o?.rawSha256 ?? "未知"}</code>], ["文本SHA-256", <code className="break-all text-[11.5px]">{c?.bodySha256 ?? "无已核验文本"}</code>],
          ["附件HTTP / 页数", `${c?.attachmentHttpStatus ?? "未记录"} / ${c?.attachmentPages ?? "未记录"}`], ["附件SHA-256", <code className="break-all text-[11.5px]">{c?.attachmentSha256 ?? "未记录"}</code>]]} />
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
