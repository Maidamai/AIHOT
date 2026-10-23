import { z } from "zod";
import { lockDocument } from "./store.ts";
// A continuation adapter into the original analysis/event/report stores, not another event system.
import { sql, type Db } from '@aihot/backend/db';
import { Conflict, audit } from '@aihot/backend/audit';
import { defineQueue } from '@aihot/backend/modules';
import { enqueueOn, getBoss } from '@aihot/backend/jobs/queue';
import { normalizeAnalysis, type AnalysisRun } from '@aihot/backend/editorial/analyze';
import { groupArticle } from '@aihot/backend/events/group';
import { publishArticle } from '@aihot/backend/publication/publish';
import { currentPublicationCondition, selectedCondition } from '@aihot/backend/publication/scope';
import { composeDaily, composeWeekly, composeMonthly, dueDaily, dueWeekly, dueMonthly } from '@aihot/backend/reports/compose';
import { periodEntries } from '@aihot/backend/reports/edition';
import { addDays, beijingDate, beijingTime, isoWeekLabel, isoWeekRange, monthRange } from '@aihot/contracts/time';
import { EDITION_TIMES } from '@aihot/site';
import { withFisheryAuthorization, assertFisheryCapacity } from './authorization.ts';
import { assertProcessingLease } from './processing-lease.ts';
import { reviewedStructure } from './news-structure.ts';

export function approvedNewsRun(task: any, title: string, summary: string): AnalysisRun | null {
  const structure=reviewedStructure(task.selection,task.quality_review),s=task.selection;
  if(!structure||s.outcome?.label!=='SCORED'||!s.outcome.attentionCandidate)return null;
  const prefilter=s.results.prefilter,first=s.results['score-1'],second=s.results['score-2'];
  if(!prefilter||!first||!second||first.receiptId===second.receiptId)return null;
  return {
    prefilter:{...prefilter.data,model:prefilter.model,receiptId:prefilter.receiptId,reused:true},
    scores:{model:first.model,values:[first.data.attentionScore,second.data.attentionScore],threshold:s.outcome.threshold,receiptIds:[first.receiptId,second.receiptId],reused:true},
    writing:{kind:'understand',model:task.draft.model,titleZh:title,summaryZh:summary,reasonZh:null,
      receiptIds:[task.draft.receiptId,task.quality_review.receiptId].filter((id):id is number=>typeof id==='number'),reused:true},
    structure,
  };
}
export async function projectNewsAnalysis(db:Db,articleId:string,revision:number,binding:string,run:AnalysisRun) {
  const [existing]=await db`SELECT id FROM analyses WHERE article_id=${articleId} AND input_revision=${revision} AND output->>'fisheryApproval'=${binding} ORDER BY id DESC LIMIT 1`;
  if(existing)return existing.id;
  const out=normalizeAnalysis(run),receipts=[run.prefilter!.receiptId,...run.scores!.receiptIds,...run.writing!.receiptIds,run.structure!.receiptId];
  const [analysis]=await db`INSERT INTO analyses(article_id,input_revision,origin,model,prompt_version,receipt_ids,relevance,category,tags,subjects,title_zh,summary_zh,reason_zh,score,selected,output)
    VALUES(${articleId},${revision},'model',${run.writing!.model},'fishery-reviewed-core-analysis/v1',${receipts},${out.relevance},${out.category},${out.tags},${out.subjects},${out.titleZh},${out.summaryZh},${out.reasonZh},${out.score},${out.selected},
      ${db.json({prefilter:{label:run.prefilter!.label,reason:run.prefilter!.reason},scores:out.scores,scoreModel:out.scoreModel,threshold:out.threshold,scope:out.scope,fact:out.fact,fisheryApproval:binding})}) RETURNING id`;
  await db`UPDATE articles SET processing_state='analyzed',processing_error=NULL,grouping_status='pending',selection_adds_value=NULL,grouped_at=NULL WHERE id=${articleId} AND revision=${revision}`;
  return analysis!.id;
}
export interface NewsJob {articleId:string;revision:number;projectionHash:string;actor:string;attempt?:number}
export async function assertNewsCurrent(job:NewsJob, requireLease=true) {
  if(requireLease)await assertProcessingLease();
  const current=await currentPublicationCondition();
  const [row]=await sql`SELECT a.grouping_status,a.backfill FROM publications p JOIN articles a ON a.id=p.article_id
    JOIN fishery_publication_bindings b ON b.article_id=a.id JOIN analyses an ON an.id=p.analysis_id
    WHERE a.id=${job.articleId} AND a.revision=${job.revision} AND b.projection_hash=${job.projectionHash}
      AND an.input_revision=a.revision AND an.output->>'fisheryApproval'=${job.projectionHash} AND an.selected
      AND p.visibility='public' AND p.eligible AND ${current.condition}`;
  if(!row||row.backfill)throw new Conflict('Current approved, scored news revision required; withdrawn/stale/history work cannot continue');
  return row;
}
export async function runNewsEditorial(job:NewsJob) {
  const current=await assertNewsCurrent(job);
  if(current.grouping_status==='complete')return {reused:true};
  const result=await withFisheryAuthorization(async()=>{
    const result=await groupArticle(job.articleId);
    await assertNewsCurrent(job);
    return result;
  },{receiptAttemptTag:`fishery-news:${job.projectionHash}:${job.attempt??1}`,assertAuthorized:async()=>{await assertNewsCurrent(job);}});
  await assertNewsCurrent(job);
  await publishArticle(job.articleId);
  await audit(job.actor,'fishery.news.grouped',`content:${job.articleId}`,null,null,{revision:job.revision,projectionHash:job.projectionHash,result});
  return result;
}
export const newsQueue=defineQueue<NewsJob>({name:'fishery.news',options:{policy:'short',retryLimit:0,expireInSeconds:600},worker:{batchSize:1,localConcurrency:1},run:async jobs=>{for(const job of jobs)await runNewsEditorial(job);}});
export async function enqueueNews(job:NewsJob,db:Db) {
  await getBoss({schedule:false,supervise:false});
  // Terminal jobs are retained as an explicit stop too; ordinary publication replay is never a paid retry.
  const [existing]=await db`SELECT id FROM pgboss.job WHERE name=${newsQueue.name} AND data->>'articleId'=${job.articleId} AND data->>'projectionHash'=${job.projectionHash} LIMIT 1`;
  if(existing)return null;
  const [article]=await db`SELECT grouping_status,backfill FROM articles WHERE id=${job.articleId}`;
  if(article?.backfill||article?.grouping_status==='complete')return null;
  return enqueueOn(newsQueue,job,{singletonKey:`${job.articleId}:${job.projectionHash}`},db);
}

/** Explicit recovery of a terminal continuation; never rewrites a receipt, ledger or approved fact. */
export async function retryNewsEditorial(taskId:string,input:unknown,actor:string) {
  const data=z.strictObject({projectionHash:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().positive(),mode:z.enum(['resume','regenerate']),acknowledgeNewCharge:z.boolean().default(false),reason:z.string().trim().min(1).max(2000)}).parse(input);
  return sql.begin(async tx=>{
    const [task]=await tx`SELECT document_id FROM fishery_flow_tasks WHERE id=${taskId}`;
    if(!task)throw new Conflict('News task not found');
    await lockDocument(tx,task.document_id);
    const [binding]=await tx`SELECT article_id FROM fishery_publication_bindings WHERE kind='article' AND item_id=${task.document_id}`;
    if(!binding)throw new Conflict('Approved news projection required');
    const job:NewsJob={articleId:binding.article_id,projectionHash:data.projectionHash,revision:data.revision,actor};
    await assertNewsCurrent(job,false);
    const jobs=await tx`SELECT id,state,data FROM pgboss.job WHERE name=${newsQueue.name} AND data->>'articleId'=${job.articleId} AND data->>'projectionHash'=${job.projectionHash} ORDER BY created_on DESC`;
    if(!jobs.length||jobs.some(j=>['created','retry','active'].includes(j.state))||jobs[0].state!=='failed')throw new Conflict('Only a settled failed continuation can be explicitly retried; reconcile active ownership first');
    if((await tx`SELECT 1 FROM receipts WHERE subject=${'article:'+job.articleId} AND status IN ('pending','unknown') LIMIT 1`).length)throw new Conflict('Reconcile pending/unknown receipt and cumulative billing before retry');
    const previous=Math.max(...jobs.map(j=>j.data.attempt??1));
    job.attempt=previous+(data.mode==='regenerate'?1:0);
    if(job.attempt>3)throw new Conflict('Three explicit paid grouping attempts exhausted');
    if(data.mode==='regenerate'){
      if(!data.acknowledgeNewCharge)throw new Conflict('Regeneration requires explicit new-charge acknowledgement');
      await assertFisheryCapacity(1);
    }
    const id=await enqueueOn(newsQueue,job,{singletonKey:`${job.articleId}:${job.projectionHash}`},tx);
    await audit(actor,'fishery.news.retry',`content:${job.articleId}`,data.reason,null,{id,...job,mode:data.mode,acknowledgeNewCharge:data.acknowledgeNewCharge},{db:tx});
    return {id,attempt:job.attempt,mode:data.mode};
  });
}

/** Only due issues with real approved entries. Original rules reuse reviewed copy; no overview model. */
export async function composeApprovedReports(now=new Date()) {
  await assertProcessingLease();
  const rows=await sql`SELECT greatest(p.timeline_at,p.visible_after) AS at FROM publications p
    WHERE ${(await selectedCondition(now)).condition} AND NOT p.backfill`;
  if(!rows.length)return {generated:[]};
  const dates=[...new Set(rows.map(r=>{const at=new Date(r.at);return addDays(beijingDate(at),beijingTime(at)>=EDITION_TIMES.daily?1:0);} ))].filter(d=>d<=dueDaily(now)).sort();
  const generated:string[]=[];
  for(const date of dates){
    if(generated.length>=8)break;
    if((await sql`SELECT 1 FROM reports WHERE kind='daily' AND key=${date}`).length)continue;
    await assertProcessingLease();await composeDaily(date);generated.push(`daily:${date}`);
  }
  for(const kind of ['weekly','monthly'] as const){
    const labels=[...new Set(dates.map(d=>kind==='weekly'?isoWeekLabel(d):d.slice(0,7)))].filter(k=>k<=(kind==='weekly'?dueWeekly(now):dueMonthly(now))).sort();
    for(const key of labels){
      if(generated.length>=8)break;
      if((await sql`SELECT 1 FROM reports WHERE kind=${kind} AND key=${key}`).length)continue;
      const range=kind==='weekly'?isoWeekRange(key)!:monthRange(key)!;
      if(!(await periodEntries(range.start,range.end)).entries.length)continue;
      await assertProcessingLease();
      if(kind==='weekly')await composeWeekly(key,undefined,{writeOverview:false});else await composeMonthly(key,undefined,{writeOverview:false});
      generated.push(`${kind}:${key}`);
    }
  }
  return {generated};
}
