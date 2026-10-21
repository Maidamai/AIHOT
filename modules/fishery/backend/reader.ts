// Private reader projection. Every list, category count and detail uses this same current set.
import { sql } from "@aihot/backend/db";
import { linkSchema } from "../contracts.ts";
import type { FisheryReaderItem, FisheryReaderPage, ReaderCategory } from "../ui-contracts.ts";
import { flowDetail } from "./flow.ts";
import { hash, NotFound } from "./store.ts";

export const READER_CATEGORIES={policy:"政策监管",safety:"作业安全",market:"市场贸易",research:"资源科研",equipment:"船舶装备",operations:"企业合作与港口基地",reference:"资料"} as const;
export type ReaderCategoryId=keyof typeof READER_CATEGORIES;
function categoryFor(text:string):ReaderCategoryId {
  if(/政策|法规|规章|决议|监管|履约|协定|配额|限额|resolution|regulation|conservation|compliance/i.test(text)) return "policy";
  if(/安全|救援|事故|预警|风暴|safety|rescue/i.test(text)) return "safety";
  if(/市场|贸易|出口|进口|价格|market|trade|export|import/i.test(text)) return "market";
  if(/资源|科研|调查|研究|种群|stock|research|survey/i.test(text)) return "research";
  if(/装备|船舶|渔船|造船|vessel|equipment/i.test(text)) return "equipment";
  if(/企业|合作|港口|基地|port|cooperation/i.test(text)) return "operations";
  return "reference";
}
export async function eligibleReaderItems(now=new Date()):Promise<FisheryReaderItem[]> {
  const rows=await sql`SELECT d.id,d.issuer,d.canonical_url,s.name AS source_name,f.profile,
    t.id AS task_id,t.snapshot,t.human_decision,o.payload
    FROM fishery_documents d JOIN sources s ON s.id=d.source_id JOIN fishery_sources f ON f.source_id=d.source_id
    JOIN LATERAL (SELECT * FROM fishery_flow_tasks WHERE document_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
    JOIN fishery_observations o ON o.document_id=d.id AND o.revision=(t.snapshot->>'observationRevision')::integer
    WHERE t.status='qualified' AND d.withdrawn_reason IS NULL AND s.participation_mode='editorial'`;
  const items:FisheryReaderItem[]=[];
  for(const row of rows) {
    if(/^(?:ISOLATED TEST|Synthetic fixture|SYNTHETIC TEST)/.test(row.profile.attribution??"")||/^ISOLATED TEST/.test(row.issuer)) continue;
    const flow=await flowDetail(row.task_id,now),candidate=flow.draft?.draft;
    if(!flow.authoritative||flow.stale||!flow.materialApproved||!flow.internalArticle||candidate?.relevance?.decision!=="relevant"||flow.quality_review?.status!=="needs_human_review"||row.human_decision?.decision!=="qualified"||row.human_decision.snapshotHash!==hash(row.snapshot)) continue;
    const title=candidate.summaryZh?.find((s:{sentence:string})=>s.sentence.trim())?.sentence,originalTitle=String(row.payload.originalTitle??row.payload.title??""),sourceUrl=linkSchema.safeParse(row.canonical_url);
    if(!title||!sourceUrl.success||!candidate.summaryZh?.length||candidate.summaryZh.some((s:{sentence:string})=>!s.sentence.trim())) continue;
    const capture=row.payload.sourceCapture;
    const summary=candidate.summaryZh.map((s:{sentence:string;evidence:{quote:string;paragraph:number;page:number|null}[]})=>({sentence:s.sentence,evidence:s.evidence.map(a=>({quote:a.quote,paragraph:a.paragraph,page:a.page,url:a.page!==null&&linkSchema.safeParse(capture?.attachmentUrl).success?capture.attachmentUrl:sourceUrl.data}))}));
    if(summary.some((s:{evidence:unknown[]})=>!s.evidence.length)) continue;
    const category=categoryFor(summary.map((s:{sentence:string})=>s.sentence).join("\n")),time=flow.timeline;
    items.push({id:row.id,title,source:{name:row.source_name,url:sourceUrl.data,originalTitle},category:{id:category,label:READER_CATEGORIES[category]},summary,
      dates:{published:time.sourcePublished,event:time.sourceEvent},age:{referenceDate:time.referenceDate,days:time.originalAgeDays,historical:time.historical,label:time.label},
      verification:{status:"internally_qualified",label:flow.draft?.provenance?.origin==="human_revision"?"人工修订候选，经模型辅助核查与人工审核":"摘要已完成内部核对",legalApplicability:"未完成法律适用性核验"}});
  }
  return items.sort((a,b)=>(b.dates.published.value??"").localeCompare(a.dates.published.value??"")||a.id.localeCompare(b.id));
}
export async function readerPage(query:{category?:ReaderCategoryId;page?:number}={},now=new Date()):Promise<FisheryReaderPage> {
  const all=await eligibleReaderItems(now),categories:ReaderCategory[]=Object.entries(READER_CATEGORIES).flatMap(([id,label])=>{const count=all.filter(i=>i.category.id===id).length;return count?[{id:id as ReaderCategoryId,label,count}]:[];});
  const selected=query.category?all.filter(item=>item.category.id===query.category):all,limit=20,page=Math.min(query.page??1,Math.max(1,Math.ceil(selected.length/limit)));
  return {rows:selected.slice((page-1)*limit,page*limit),categories,total:all.length,filteredTotal:selected.length,page,limit,selectedCategory:query.category??null,internalOnly:true,referenceDate:now.toISOString().slice(0,10)};
}
export async function readerItem(id:string,now=new Date()):Promise<FisheryReaderItem> {
  const item=(await eligibleReaderItems(now)).find(item=>item.id===id);
  if(!item) throw new NotFound("No current internally qualified fishery material");
  return item;
}
