import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import type { FisheryReaderItem, FisheryReaderPage } from "../ui-contracts.ts";
import { readerHeaders } from "./reader-shell.tsx";
import { useFreshMaterial } from "./shared.tsx";
export const headers=readerHeaders;
export const meta:MetaFunction=()=>[{title:"已核对资料 · 远洋渔业资料预览"},{name:"robots",content:"noindex, nofollow"}];
export async function loader({request}:LoaderArgs) {return adminGet<FisheryReaderPage>(request,"/api/admin/fishery/reader"+new URL(request.url).search);}
export const originalDate=(item:FisheryReaderItem)=>item.dates.published.value?`${item.dates.published.value} · ${{year:"年",month:"月",day:"日",unknown:"未知"}[item.dates.published.precision]}精度`:"原文发布日期未知";
export const ageLabel=(item:FisheryReaderItem)=>item.age.historical?"历史资料":item.dates.published.precision==="unknown"?"日期未知":item.age.days===0?"当日原文":item.age.days!==null&&item.age.days>0?`${item.age.days}日前原文`:"日期待核";
export default function ReaderList({loaderData:d}:ComponentProps<typeof loader>) {
  useFreshMaterial();
  const pageHref=(page:number)=>"/fishery?"+new URLSearchParams({...d.selectedCategory?{category:d.selectedCategory}:{},page:String(page)});
  return <>
    <div className="reader-page-heading"><div><p className="reader-eyebrow">资料库</p><h1>已核对资料</h1><p>查看远洋经营与运营相关的政策、产业资料摘要。</p></div><p className="reader-reference">原文日期单列呈现<br/>资料年龄核对日 {d.referenceDate}</p></div>
    <div className="reader-list-layout">
      <aside className="reader-filters"><h2>资料分类</h2><nav aria-label="资料分类"><Link to="/fishery" aria-current={!d.selectedCategory?"page":undefined}>全部资料 <span>{d.total}</span></Link>{d.categories.map(c=><Link key={c.id} to={"/fishery?category="+c.id} aria-current={d.selectedCategory===c.id?"page":undefined}>{c.label} <span>{c.count}</span></Link>)}</nav><p>仅列出当前可读资料。采集与核对日期不作为新闻发布日期。分类按关键词整理，不是核验结论。</p></aside>
      <section className="reader-results" aria-label="已核对资料列表">
        <div className="reader-results-line"><span>{d.selectedCategory?d.categories.find(c=>c.id===d.selectedCategory)?.label??"所选分类":"全部资料"}</span><span>{d.filteredTotal} 篇</span></div>
        {d.rows.map(item=><article key={item.id} className="reader-card"><div className="reader-card-labels"><span className="reader-category">{item.category.label}</span><span className="reader-age">{ageLabel(item)}</span></div><p className="reader-source-title-label">已核对摘要</p><h2><Link to={`/fishery/${item.id}`}>{item.title}</Link></h2>{item.summary[1]&&<p className="reader-summary-preview">{item.summary[1].sentence}</p>}<div className="reader-card-bottom"><span>{item.source.name}</span><time>{originalDate(item)}</time><span className="reader-verified">{item.verification.label}</span></div></article>)}
        {!d.rows.length&&<div className="reader-empty"><h2>暂无可读资料</h2><p>完成原文证据核对与人工内部审核后，资料会出现在这里。</p><Link to="/admin/fishery">查看素材工作台 <span aria-hidden="true">→</span></Link></div>}
        {d.filteredTotal>d.limit&&<nav className="reader-pagination" aria-label="资料分页">{d.page>1?<Link to={pageHref(d.page-1)}>上一页</Link>:<span/>}<span>第 {d.page} 页</span>{d.page*d.limit<d.filteredTotal?<Link to={pageHref(d.page+1)}>下一页</Link>:<span/>}</nav>}
      </section>
    </div>
  </>;
}
