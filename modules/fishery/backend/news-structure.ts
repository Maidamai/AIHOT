import {isCompositeScope} from "@aihot/backend/publication/scope";
// The core fact extractor supplies identity; the existing evidence review must approve it too.
import { PROMPT_VERSIONS, type AnalysisRun } from '@aihot/backend/editorial/analyze';
import { collapseWhitespace } from '@aihot/backend/lib/text';
import type { DraftInput } from './ai-draft.ts';
import { buildEvidenceCatalog } from './evidence.ts';
import { hash } from './store.ts';

export type NewsStructure = NonNullable<AnalysisRun['structure']>;
export function structureClaims(input: DraftInput, structure: NewsStructure, summary: {evidence:unknown[]}[]) {
  const catalog = buildEvidenceCatalog(input);
  const anchors = (quote: string | null | undefined) => {
    const text = collapseWhitespace(quote ?? '');
    const span = text && catalog.spans.find(s => collapseWhitespace(s.quote).includes(text));
    if (!span) throw new Error('News fact requires a bound original quote in the current evidence catalog');
    const {paragraph,page,quote:original,source} = span;
    return [{paragraph,page,quote:original,...(source?{source}:{})}];
  };
  if (structure.scope === 'unknown' || structure.scope === 'single' && !structure.fact) throw new Error('News identity remains unknown; no confirmed fact can be published');
  if (isCompositeScope(structure.scope)) return [{id:'newsStructure.scope',assertion:{scope:'composite',evidence:summary.flatMap(s=>s.evidence).slice(0,4)}}];
  const {conditions,...fact} = structure.fact!;
  return [
    {id:'newsStructure.fact',assertion:{scope:structure.scope,fact,evidence:anchors(fact.evidence)}},
    ...conditions.map((condition,i)=>({id:`newsStructure.conditions.${i}`,assertion:{condition:condition.text??condition.quote,evidence:anchors(condition.quote)}})),
  ];
}
export function reviewedStructure(selection: any, quality: any): NewsStructure | null {
  const state = selection?.structure;
  return state?.promptVersion === PROMPT_VERSIONS.structure && state.result && quality?.structureSha256 === hash(state.result)
    && quality.status === 'needs_human_review' && quality.review?.findings?.some((f:any)=>f.field.startsWith('newsStructure.')&&f.verdict==='supported')
    ? state.result : null;
}
