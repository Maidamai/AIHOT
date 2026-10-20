import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import type { FisheryReaderItem } from "../ui-contracts.ts";
import { readerHeaders } from "./reader-shell.tsx";
import { originalDate, ageLabel } from "./reader-list.tsx";
import { useFreshMaterial } from "./shared.tsx";
export const headers=readerHeaders;
export const meta:MetaFunction<typeof loader>=({loaderData})=>[{title:`${loaderData?.title??"资料暂不可读"} · 远洋渔业资料预览`},{name:"robots",content:"noindex, nofollow"}];
export async function loader({request,params}:LoaderArgs) {return adminGet<FisheryReaderItem>(request,`/api/admin/fishery/reader/${encodeURIComponent(params.id!)}`);}
export default function ReaderItem({loaderData:d}:ComponentProps<typeof loader>) {
  useFreshMaterial();
  return <article className="reader-article"><Link to="/fishery" className="reader-back">← 返回资料列表</Link><div className="reader-card-labels"><span className="reader-category">{d.category.label}</span><span className="reader-age">{ageLabel(d)}</span></div><h1>{d.title}</h1><div className="reader-article-byline"><span>{d.source.name}</span><span>{originalDate(d)}</span></div>
    <div className="reader-article-layout"><div className="reader-article-content"><section className="reader-summary-section"><h2>资料摘要</h2>{d.summary.map((fact,i)=><p key={i}>{fact.sentence}</p>)}</section><section className="reader-evidence-section"><div className="reader-section-heading"><h2>原文引证</h2><span>原文短引，非全文</span></div>{d.summary.map((fact,i)=><div key={i} className="reader-evidence-group"><h3>摘要第 {i+1} 句依据</h3>{fact.evidence.map((e,j)=><figure key={j} className="reader-quote"><blockquote>{e.quote}</blockquote><figcaption><a href={e.url} target="_blank" rel="noopener noreferrer">原文第 {e.paragraph} 段{e.page!==null?` · PDF 第 ${e.page} 页`:""} <span aria-hidden="true">↗</span></a></figcaption></figure>)}</div>)}</section></div>
      <aside className="reader-source-panel"><h2>来源与日期</h2><dl><div><dt>来源</dt><dd>{d.source.name}</dd></div><div><dt>原文发布日期</dt><dd>{originalDate(d)}</dd></div><div><dt>原文事件日期</dt><dd>{d.dates.event.value?`${d.dates.event.value} · ${{year:"年",month:"月",day:"日",unknown:"未知"}[d.dates.event.precision]}精度`:"未知，不从发布日期推断"}</dd></div><div><dt>资料年龄</dt><dd>{d.age.label}{d.age.days!==null&&d.age.days>=0?`（${d.age.days}日）`:""}</dd></div><div><dt>资料年龄核对日</dt><dd>{d.age.referenceDate}</dd></div><div><dt>核对状态</dt><dd>{d.verification.label}</dd></div></dl><a href={d.source.url} target="_blank" rel="noopener noreferrer" className="reader-original-link">查看来源原文 <span aria-hidden="true">↗</span></a><p>{d.verification.legalApplicability}。原文权利与具体业务适用范围仍须分别核对。</p></aside>
    </div>
  </article>;
}
