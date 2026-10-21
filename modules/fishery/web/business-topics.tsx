import { BusinessTimeliness, useBusinessNow } from "./business-timeliness.tsx";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import type { BusinessGuideReaderPage } from "../business-contracts.ts";
import type { FisheryReaderPage } from "../ui-contracts.ts";
import { readerHeaders } from "./reader-shell.tsx";
import { ageLabel, originalDate } from "./reader-list.tsx";
import { BUSINESS_KINDS, businessPublication, isHistorical, BusinessDate } from "./business-shared.tsx";
import { useFreshMaterial } from "./shared.tsx";
export const headers=readerHeaders;
export const meta:MetaFunction=()=>[{title:"经营主题 · 远洋渔业资料预览"},{name:"robots",content:"noindex, nofollow"}];
export async function loader({request}:LoaderArgs) {
  const url=new URL(request.url),topicId=url.searchParams.get("topicId")??"",kind=url.searchParams.get("kind")??"",page=url.searchParams.get("page")??"1";
  const query=new URLSearchParams({page,...topicId?{topicId}:{},...kind&&kind!=="dynamic_article"?{kind}:{}});
  const business=await adminGet<BusinessGuideReaderPage>(request,"/api/admin/fishery/business-reader?"+query);
  const articles=kind==="dynamic_article"||!kind?await adminGet<FisheryReaderPage>(request,"/api/admin/fishery/reader?page="+encodeURIComponent(page)):null;
  return {business,articles,topicId,kind};
}
export default function BusinessTopics({loaderData:d}:ComponentProps<typeof loader>) {
  useFreshMaterial();const now=useBusinessNow(d.business.rows[0]?.timeliness.checkedAt??"1970-01-01T00:00:00Z");
  const href=(topicId=d.topicId,kind=d.kind,page=1)=>"/fishery/topics?"+new URLSearchParams({...topicId?{topicId}:{},...kind?{kind}:{},page:String(page)});
  const pagination=d.kind==="dynamic_article"?d.articles:d.business;
  const rows=d.kind==="dynamic_article"?[]:d.business.rows,articles=d.topicId?[]:d.articles?.rows??[];
  return <div className="business-topics"><div className="reader-page-heading"><div><p className="reader-eyebrow">远洋经营</p><h1>经营主题</h1><p>按经营环节查看人工编审指南、政策资料与动态文章。</p></div><Link className="reader-back" to="/admin/fishery/guides/new">人工编审指南 →</Link></div>
    <p className="business-notice">指南仅在人工批准且当前证据有效时可读。资料摘要不自动成为业务指南；适用范围、材料、时间和办理入口缺少依据时保持未知。这里不提供代办、招聘、救援或实时气象油价服务。</p>
    <div className="reader-list-layout"><aside className="reader-filters"><h2>经营主题</h2><nav aria-label="经营主题"><Link to={href("")} aria-current={!d.topicId?"page":undefined}>全部主题</Link>{d.business.topics.map(t=><Link key={t.id} to={href(t.id)} aria-current={d.topicId===t.id?"page":undefined}>{t.label}<span>{t.count?`${t.count} 篇`:"待补充"}</span></Link>)}</nav></aside>
      <section className="reader-results" aria-label="主题内容"><nav className="business-kind-filter" aria-label="内容类型"><Link to={href(d.topicId,"")} aria-current={!d.kind?"page":undefined}>全部类型</Link>{Object.entries(BUSINESS_KINDS).map(([key,label])=><Link key={key} to={href(d.topicId,key)} aria-current={d.kind===key?"page":undefined}>{label}</Link>)}</nav>
        {d.topicId&&<p className="business-topic-note">{d.business.topics.find(t=>t.id===d.topicId)?.emptyMessage??"仅展示明确归入此主题、当前可读的人工编审内容。"} 动态文章尚未建立人工主题关联。</p>}
        {rows.map(r=><article className="reader-card" key={r.id}><div className="reader-card-labels"><span className="reader-category">{BUSINESS_KINDS[r.payload.kind]}</span><span className="reader-age">人工编审</span>{isHistorical(businessPublication(r).date,r.verifiedAt)&&<span className="reader-age">历史资料</span>}</div><h2><Link to={"/fishery/guides/"+r.id}>{r.payload.title.value}</Link></h2><BusinessTimeliness item={r} now={now}/><p className="reader-summary-preview">{r.payload.summary[0]?.value}</p><div className="reader-card-bottom"><span>{r.source.name}</span><span>{businessPublication(r).label} <BusinessDate value={businessPublication(r).date}/></span><span>核验日 {r.verifiedAt.slice(0,10)}</span></div></article>)}
        {articles.map(r=><article className="reader-card" key={r.id}><div className="reader-card-labels"><span className="reader-category">动态文章 · 已核对摘要</span><span className="reader-age">{ageLabel(r)}</span></div><h2><Link to={"/fishery/"+r.id}>{r.title}</Link></h2><div className="reader-card-bottom"><span>{r.source.name}</span><span>{originalDate(r)}</span></div></article>)}
        {!rows.length&&!articles.length&&<div className="reader-empty"><h2>此类内容待补充</h2><p>经人工整理、证据核对和批准后显示。其他类型的资料不代替业务指南。</p><Link to={href("","")}>查看全部主题与类型</Link></div>}
        {pagination&&pagination.total>pagination.limit&&<nav className="reader-pagination" aria-label="主题分页">{pagination.page>1?<Link to={href(d.topicId,d.kind,pagination.page-1)}>上一页</Link>:<span/>}<span>第 {pagination.page} 页</span>{pagination.page*pagination.limit<pagination.total?<Link to={href(d.topicId,d.kind,pagination.page+1)}>下一页</Link>:<span/>}</nav>}
      </section></div></div>;
}
