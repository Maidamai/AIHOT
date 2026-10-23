// Original AIHOT selection steps, with the existing fishery receipt/budget boundary supplied by flow.ts.
import type {AnalysisRun} from '@aihot/backend/editorial/analyze';
import {runSelectionPrefilter,runSelectionScores,tierThreshold,PROMPT_VERSIONS,type AnalyzeInputArticle} from '@aihot/backend/editorial/analyze';
import {MAX_BODY_CHARS} from '@aihot/backend/editorial/writing';
import {SELECTION} from '@aihot/industry/selection';
import {Conflict} from '@aihot/backend/audit';
import type {chatJson} from '@aihot/backend/providers/llm';
import {fisheryWireBytes} from './ai-review.ts';
import {TRIAL} from './trial-transport.ts';

export const selectionStages=['prefilter','score-1','score-2'] as const;
export type SelectionStage=typeof selectionStages[number];
export const selectionConfiguration=()=>({version:'fishery-selection/v1',prompts:{prefilter:PROMPT_VERSIONS.prefilter,score:PROMPT_VERSIONS.score},model:'default',thresholds:SELECTION.thresholds,calibrated:false});
export type SelectionState = {
  config:ReturnType<typeof selectionConfiguration>;
  structure?:{attempt:number;promptVersion:string;result?:NonNullable<AnalysisRun["structure"]>};
  sourceTier:string;
  attempts:Record<SelectionStage,number>;
  results:Partial<Record<SelectionStage,{data:any;receiptId:number;model:string;reused:boolean}>>;
  outcome?:{label:string;values:number[];threshold:number|null;average:number|null;attentionCandidate:boolean;calibrated:false;factApproval:false};
}
export const newSelection=(sourceTier:string,news=false):SelectionState=>({...(news?{structure:{attempt:1,promptVersion:PROMPT_VERSIONS.structure}}:{}),config:selectionConfiguration(),sourceTier,attempts:{prefilter:1,'score-1':1,'score-2':1},results:{}});
export function assertSelectionInput(a:AnalyzeInputArticle){
  if(!a.bodyText?.trim()||a.bodyText.length>MAX_BODY_CHARS)throw new Conflict('Selection requires the complete original body within '+MAX_BODY_CHARS+' characters; no silent truncation');
}
export async function runFisherySelection(a:AnalyzeInputArticle,state:SelectionState,invoke:typeof chatJson,save:(stage:SelectionStage,result:SelectionState['results'][SelectionStage],next:string)=>Promise<void>){
  assertSelectionInput(a);
  const guarded:typeof chatJson=async options=>{
    const stage:SelectionStage=options.purpose==='prefilter_article'?'prefilter':options.attemptTag?.endsWith('score-1')?'score-1':'score-2';
    if(fisheryWireBytes(options)>TRIAL.maxWireBytes)throw new Conflict('Full selection request exceeds wire capacity; no truncation or request');
    const saved=state.results[stage];
    if(saved)return {...saved,data:options.schema.parse(saved.data),reused:true,usage:null};
    const answer=await invoke(options),result={data:answer.data,receiptId:answer.receiptId,model:answer.model,reused:answer.reused};
    state.results[stage]=result;
    if(stage==='score-2'){
      const values=[state.results['score-1']!.data.attentionScore,state.results['score-2']!.data.attentionScore],threshold=tierThreshold(a.source.tier);
      const complete=threshold!==null&&state.results['score-1']!.receiptId!==result.receiptId;
      state.outcome={label:complete?'SCORED':'UNSCORED',values,threshold,average:complete?Math.floor((values[0]+values[1])/2):null,
        attentionCandidate:complete&&values[0]+values[1]>=2*threshold!,calibrated:false,factApproval:false};
    }
    await save(stage,result,stage==='prefilter'?'score-1':stage==='score-1'?'score-2':'generation');
    return answer;
  };
  const prefilter=await runSelectionPrefilter(a,{prefilterModel:'default',invoke:guarded});
  if(prefilter.label!=='PASS')return {label:prefilter.label,values:[],threshold:null,average:null,attentionCandidate:false,calibrated:false as const,factApproval:false as const};
  const scores=await runSelectionScores(a,{scoreModel:'default',attemptTag:'fishery-selection',invoke:guarded});
  const complete=!!scores&&!scores.refused&&scores.values.length===2&&new Set(scores.receiptIds).size===2;
  return {label:complete?'SCORED':!scores?'NO_THRESHOLD':scores.refused?'REFUSED':'PARTIAL',values:scores?.values??[],threshold:scores?.threshold??null,average:complete?Math.floor((scores!.values[0]!+scores!.values[1]!)/2):null,
    attentionCandidate:complete&&scores!.values[0]!+scores!.values[1]!>=2*scores!.threshold,calibrated:false as const,factApproval:false as const};
}

