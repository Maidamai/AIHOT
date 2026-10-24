// Read-only compatibility projection for explicitly approved historical material.
// Ordinary news uses the native analysis/event/report queues directly.
import type {Db} from '@aihot/backend/db';
import {normalizeAnalysis,type AnalysisRun} from '@aihot/backend/editorial/analyze';
import {reviewedStructure} from './news-structure.ts';

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
