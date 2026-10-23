import { businessPublication, isHistorical } from "./business-shared.tsx";
import type { ReactNode } from "react";
import type { SiteItemDetail } from "@aihot/contracts/site";
import { BUSINESS_EXECUTOR_LABELS, type BusinessGuideReaderItem } from "../business-contracts.ts";
import { BusinessTimeliness, useBusinessNow } from "./business-timeliness.tsx";

function SourceLink({ url, children }: { url: string | null; children: ReactNode }) {
  let safe = false;
  try { safe = ["https:", "http:"].includes(new URL(url ?? "").protocol); } catch { /* Unknown links stay plain text. */ }
  return safe ? <a href={url!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children} ↗</a> : <span>{children}（链接待确认）</span>;
}

const unknown = "未核实（尚无已采纳证据）";
function dateText(value: { value: string | null; precision: string }) {
  return value.value ? `${value.value}（${({ year: "年", month: "月", day: "日" } as Record<string, string>)[value.precision] ?? value.precision}精度）` : unknown;
}

function Evidence({ ids, guide }: { ids: string[]; guide: BusinessGuideReaderItem }) {
  if (!ids.length) return null;
  return <details className="mt-3 text-[12px] leading-relaxed text-ink-3">
    <summary className="cursor-pointer text-accent">查看原文短引与证据（{ids.length}）</summary>
    {ids.map(id => {
      const evidence = guide.evidence[id];
      return evidence ? <figure key={id} className="mt-3 border-l-2 border-line-strong pl-3">
        <blockquote className="whitespace-pre-wrap break-words text-[13px] leading-[1.8] text-ink-2">{evidence.quote}</blockquote>
        <figcaption className="mt-1"><SourceLink url={evidence.url}>原文第 {evidence.paragraph} 段{evidence.page !== null ? ` · PDF 第 ${evidence.page} 页` : ""}</SourceLink></figcaption>
      </figure> : <p key={id}>证据暂不可用</p>;
    })}
  </details>;
}

function Field({ title, children, evidence = [], guide }: { title: string; children: ReactNode; evidence?: string[]; guide: BusinessGuideReaderItem }) {
  return <section className="border-b border-line pb-5">
    <h2 className="mb-2 text-[15px] font-semibold text-ink">{title}</h2>
    <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.9] text-ink-2">{children}</div>
    <Evidence ids={evidence} guide={guide} />
  </section>;
}

/** The existing guide's evidence-backed fields, inside the ordinary article layout. */
export function BusinessGuideBody({ guide }: { guide: BusinessGuideReaderItem }) {
  const p = guide.payload;
  const publication = businessPublication(guide);
  const historical = isHistorical(publication.date, guide.verifiedAt);
  const now = useBusinessNow(guide.timeliness.checkedAt);
  const fields = [
    ["事项与机会", p.opportunity], ["限制条件", p.restrictions], ["材料清单", p.materials], ["国家与地区", p.applicability.countriesOrRegions],
  ] as const;
  const secondary = [["船旗", p.applicability.flagStates], ["鱼种", p.applicability.species], ["渔法", p.applicability.fishingMethods]] as const;
  const unverified = secondary.filter(([, field]) => field.state === "unknown");
  const sameTitle = (value: string) => value.replace(/\s+/g, " ").trim() === p.title.value.replace(/\s+/g, " ").trim();
  const summary = p.summary.filter(s => !sameTitle(s.value));
  const titleEvidence = [...new Set([...p.title.evidence, ...p.summary.filter(s => sameTitle(s.value)).flatMap(s => s.evidence)])];
  const dateNames = { published: "原文发布日期（正文引句）", effectiveFrom: "文载生效日期", deadline: "办理截止日期", expiresAt: "文载失效日期" };
  return <div className="mt-5 border-t border-line pt-4" aria-label="办事指南与政策资料">
    <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] font-semibold text-accent">
      <span>{p.kind === "business_guide" ? "办事指南" : "政策资料"} · 编审整理</span>
      <SourceLink url={guide.source.url}>查看来源原文</SourceLink>
    </div>
    <BusinessTimeliness item={guide} now={now} />
    <div className="grid gap-5">
      <Field title="适用对象" evidence={p.audience.evidence} guide={guide}>{p.audience.state === "documented" ? p.audience.value : unknown}</Field>
      <div className="text-[12px] leading-relaxed text-ink-3">
        <p>{publication.label}：{dateText(publication.date)}{historical ? " · 历史资料（原文距核验日已满7日）" : !publication.date.value ? " · 原文日期未知，无法判断历史背景" : ""}</p>
        <p className="mt-2">{guide.verification.aiStatus === "passed" ? "AI对照核查已通过" : "AI核查待补"}，最终审核身份见下方来源与核验记录。具体法律适用性未知，不据此判断能否申报或捕捞。核验日不代表原文发布或更新。</p>
      </div>
      {summary.length > 0 && <Field title="内容摘要" guide={guide}>{summary.map((s, i) => <div key={i} className="mb-3"><p>{s.value}</p><Evidence ids={s.evidence} guide={guide} /></div>)}</Field>}
      <details className="border-b border-line pb-4 text-[13px] text-ink-3">
        <summary className="cursor-pointer text-accent">指南标题依据</summary>
        <p className="mt-3 leading-relaxed">{p.title.value}</p><Evidence ids={titleEvidence} guide={guide} />
      </details>
      {fields.map(([title, field]) => <Field key={title} title={title} evidence={field.evidence} guide={guide}>{field.state === "documented" ? field.value : unknown}</Field>)}
      {secondary.filter(([, field]) => field.state === "documented").map(([title, field]) => <Field key={title} title={title} evidence={field.evidence} guide={guide}>{field.value}</Field>)}
      <Field title="文载状态" evidence={p.documentStatus.evidence} guide={guide}>{p.documentStatus.state === "unknown" ? unknown : p.documentStatus.value === "formal" ? "正式文件（文载）" : "征求意见稿（文载）"}</Field>
      {(Object.keys(dateNames) as Array<keyof typeof dateNames>).map(key => <Field key={key} title={dateNames[key]} evidence={p.dates[key].evidence} guide={guide}>{key === "published" && publication.metadata ? "正文日期证据未核实；来源元数据日期见上方" : dateText(p.dates[key].value)}</Field>)}
      {p.relations.length > 0 && <Field title="修订、废止与解释关系" guide={guide}>{p.relations.map((relation, i) => <div key={i}>
        <p>{{ amends: "修订", repeals: "废止", interprets: "解释", supersedes: "取代" }[relation.type]} · <SourceLink url={relation.url}>{relation.title}</SourceLink></p>
        <Evidence ids={relation.evidence} guide={guide} />
      </div>)}</Field>}
      {(unverified.length > 0 || !p.relations.length) && <details className="border-b border-line pb-5 text-[13px] text-ink-3" aria-label="尚未核实的信息">
        <summary className="cursor-pointer text-accent">尚未核实：{[...unverified.map(([title]) => title), ...(!p.relations.length ? ["修订关系"] : [])].join("、")}</summary>
        <p className="my-3 leading-relaxed">以下信息尚未核实，不代表没有适用条件或限制。</p>
        <div className="grid gap-5">{unverified.map(([title, field]) => <Field key={title} title={title} evidence={field.evidence} guide={guide}>{unknown}</Field>)}
          {!p.relations.length && <Field title="修订、废止与解释关系" guide={guide}>{unknown}</Field>}
        </div>
      </details>}
      <Field title="官方办理或信息入口" evidence={p.serviceEntry.evidence} guide={guide}>
        {p.serviceEntry.state === "documented" ? <SourceLink url={p.serviceEntry.url}>{p.serviceEntry.label}</SourceLink> : unknown}
        <p className="mt-2 text-[12px] text-ink-3">原文记载入口不代表当前可办理，也不代表本站提供代办。</p>
      </Field>
      <Field title="来源与核验" guide={guide}>
        <dl className="grid gap-3 text-[13px]">
          <div><dt className="text-ink-3">来源原标题</dt><dd>{guide.source.originalTitle}</dd></div>
          <div><dt className="text-ink-3">来源元数据发布日期</dt><dd>{dateText(guide.source.published)}</dd></div>
          <div><dt className="text-ink-3">原文日期字面</dt><dd>{guide.source.publicationLiteral ?? unknown}</dd></div>
          <div><dt className="text-ink-3">采集时刻（非发布日期）</dt><dd>{guide.source.capturedAt ?? unknown}</dd></div>
          <div><dt className="text-ink-3">最终审核执行身份</dt><dd>{BUSINESS_EXECUTOR_LABELS[guide.verification.executorKind ?? "unspecified"]}</dd></div>
          <div><dt className="text-ink-3">AI核查状态</dt><dd>{guide.verification.aiStatus === "passed" ? "已通过" : "待核查"}</dd></div>
          <div><dt className="text-ink-3">核验日</dt><dd>{guide.verifiedAt.slice(0, 10)}（非原文发布日期）</dd></div>
          <div><dt className="text-ink-3">具体法律适用性</dt><dd>{unknown}</dd></div>
        </dl>
      </Field>
    </div>
  </div>;
}

function OriginalGuide({ data }: { data: unknown; item: SiteItemDetail }) {
  const details = data as { kind?: string; guide?: BusinessGuideReaderItem } | null;
  return details?.kind === "business_guide" && details.guide ? <BusinessGuideBody guide={details.guide} /> : null;
}
export default Object.assign(OriginalGuide, { rendersSummary: (data: unknown) => (data as { kind?: string; guide?: unknown } | null)?.kind === "business_guide" && !!(data as { guide?: unknown }).guide });
