import { z } from "zod";
import { sha256 } from "./source-adapters.ts";
import {pdfBlankProofSchema,type PdfBlankProof} from './pdf-blank-proof.ts';

// Bump whenever segmentation, page binding or catalog serialization changes. Never replay an old wire response under a new version.
export const EVIDENCE_VERSION="fishery-spans-v2";
export const SECTIONED_EVIDENCE_VERSION="fishery-spans-v3-sections";
export interface EvidenceSource {id:string;url:string;sha256:string}
export interface EvidenceSection {id:string;kind:"webpage"|"pdf";sourceUrl:string;rawSha256:string;textSha256:string;start:number;end:number;label?:string;pages?:{page:number;start:number;end:number}[]}
export interface EvidenceInput {body:string;bodySha256:string;observationRevision:number;pages?:{page:number;text:string}[];sections?:EvidenceSection[];pdfBlankReview?:PdfBlankProof}
export interface EvidenceSpan {id:string;quote:string;paragraph:number;page:number|null;start:number;end:number;source?:EvidenceSource}
export interface EvidenceCatalog {version:string;hash:string;bodySha256:string;observationRevision:number;spans:EvidenceSpan[];pages:{page:number;start:number;end:number;source?:EvidenceSource}[];sections?:EvidenceSection[];pdfBlankReview?:PdfBlankProof}
export function sourceParagraphs(body:string) {
  return [...body.matchAll(/[^\n]+/g)].filter(m=>m[0].trim()).map((m,i)=>({paragraph:i+1,text:m[0],start:m.index!,end:m.index!+m[0].length}));
}
export function buildEvidenceCatalog(input:EvidenceInput):EvidenceCatalog {
  if(!input.body.trim()||input.body.length>64000||sha256(input.body)!==input.bodySha256) throw new Error("Missing, oversized or changed source body");
  if(!Number.isInteger(input.observationRevision)||input.observationRevision<1) throw new Error("Observation version required");
  if(input.sections!==undefined) {if(input.pdfBlankReview)throw new Error('Reviewed blank pages require their standalone original PDF');return buildSectionedCatalog(input);}
  const markers=[...input.body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  const pages=markers.map((m,i)=>({page:Number(m[1]),start:m.index!+m[0].length,end:markers[i+1]?.index??input.body.length}));
  if(markers.length||input.pages?.length) {
    if(!markers.length||input.body.slice(0,markers[0]!.index).trim()||pages.length!==input.pages?.length||pages.some((p,i)=>p.page!==i+1||input.pages![i]!.page!==p.page||input.body.slice(p.start,p.end).trim()!==input.pages![i]!.text)) throw new Error("PDF page intervals must match ordered Page markers and verified page text");
  }
  const textless=pages.filter(p=>!input.body.slice(p.start,p.end).trim()).map(p=>p.page);
  if(textless.length&&!input.pdfBlankReview)throw new Error('PDF page intervals contain unreviewed textless pages');
  if(input.pdfBlankReview){const proof=pdfBlankProofSchema.parse(input.pdfBlankReview);if(proof.physicalPages!==pages.length||JSON.stringify(proof.pageImages.map(p=>p.page))!==JSON.stringify(textless))throw new Error('Blank-page proof must match every empty physical page exactly');}
  const spans:EvidenceSpan[]=[],identities=new Set<string>();
  for(const p of sourceParagraphs(input.body)) {
    if(/^--- Page \d+ ---\r?$/.test(p.text)) continue;
    const page=pages.find(page=>p.start>=page.start&&p.end<=page.end)?.page??null;
    if(pages.length&&page===null) throw new Error("Source paragraph crosses or lacks a verified PDF page interval");
    // Only unambiguous Chinese sentence endings. English abbreviations, decimals, enumerations and PDF lines stay intact.
    let offset=0,sequence=0;
    for(const match of p.text.matchAll(/[。！？]+[”’」』）】]*/g)) {
      const end=match.index!+match[0].length;
      append(offset,end);offset=end;
    }
    if(offset<p.text.length) append(offset,p.text.length);
    function append(start:number,end:number) {
      const quote=p.text.slice(start,end);
      if(!quote.trim()) return;
      if(quote.length>1200) throw new Error("Evidence span exceeds quote capacity; zero-call manual review required, source not truncated");
      const identity=JSON.stringify([p.paragraph,page,quote]);
      if(identities.has(identity)) throw new Error("Ambiguous repeated span in one paragraph cannot preserve canonical evidence identity; zero-call manual review required");
      identities.add(identity);
      spans.push({id:`p${p.paragraph}s${++sequence}`,quote,paragraph:p.paragraph,page,start:p.start+start,end:p.start+end});
    }
  }
  if(!spans.length) throw new Error("No reliable source evidence spans; manual review required");
  const bound={version:input.pdfBlankReview?'fishery-spans-v4-reviewed-blanks':EVIDENCE_VERSION,bodySha256:input.bodySha256,observationRevision:input.observationRevision,spans,pages,...(input.pdfBlankReview?{pdfBlankReview:pdfBlankProofSchema.parse(input.pdfBlankReview)}:{})};
  return {...bound,hash:sha256(JSON.stringify(bound))};
}
export function evidenceBinding(catalog:EvidenceCatalog) {
  return {version:catalog.version,hash:catalog.hash,bodySha256:catalog.bodySha256,observationRevision:catalog.observationRevision};
}
export function assertEvidenceBinding(input:EvidenceInput,binding:ReturnType<typeof evidenceBinding>) {
  const catalog=buildEvidenceCatalog(input);
  if(!binding||binding.version!==catalog.version||binding.hash!==catalog.hash||binding.bodySha256!==catalog.bodySha256||binding.observationRevision!==catalog.observationRevision) throw new Error("Evidence catalog version/hash/body/revision changed; old wire response cannot be reinterpreted");
  return catalog;
}
export function evidenceIdSchema(catalog:EvidenceCatalog,min:number,max:number) {
  return z.array(z.enum(catalog.spans.map(s=>s.id) as [string,...string[]])).min(min).max(max).superRefine((ids,ctx)=>{
    if(new Set(ids).size!==ids.length) ctx.addIssue({code:"custom",message:"Duplicate evidence id refused"});
  }).transform(ids=>ids.map(id=>{
    const {quote,paragraph,page,source}=catalog.spans.find(s=>s.id===id)!;
    return {quote,paragraph,page,...(source?{source}:{})};
  }));
}
export function anchorIds(catalog:EvidenceCatalog,anchors:{quote:string;paragraph:number;page:number|null;source?:EvidenceSource}[]) {
  return anchors.map(anchor=>catalog.spans.find(s=>s.quote===anchor.quote&&s.paragraph===anchor.paragraph&&s.page===anchor.page&&sameEvidenceSource(s.source,anchor.source))?.id??null);
}
export function catalogSource(input:EvidenceInput,catalog:EvidenceCatalog) {
  // Keep the complete source context and readable, literal quotes next to their IDs. Pages remain verified intervals.
  return {body:input.body,offsetUnit:"UTF-16",evidenceCatalog:{...evidenceBinding(catalog),spans:catalog.spans},paragraphs:sourceParagraphs(input.body).map(({text,...index})=>index),pages:catalog.pages,...(catalog.pdfBlankReview?{reviewedBlankPages:catalog.pdfBlankReview}:{}),...(catalog.sections?{sourceSections:catalog.sections,generatedProvenance:[
    ...catalog.sections.slice(1).map((section,i)=>({kind:"attachment_separator",start:catalog.sections![i]!.end,end:section.start})),
    ...catalog.sections.flatMap(section=>(section.pages??[]).map((page,i)=>({kind:"pdf_page_marker",start:i===0?section.start:section.pages![i-1]!.end,end:page.start}))),
  ]}: {})};
}

export const LOSSLESS_SOURCE_WIRE='fishery-source-parts/1';
export type EvidenceBodyPart=string|[id:string,paragraph:number,page:number|null,start:number,quote:string,sourceId?:string];
// Send each original character exactly once, with IDs adjacent to their literal source text. Gaps are context, never evidence IDs.
export function compactCatalogSource(input:EvidenceInput,catalog:EvidenceCatalog){
  const {hash:catalogHash,...bound}=catalog;
  if(buildEvidenceCatalog(input).hash!==catalogHash||sha256(JSON.stringify(bound))!==catalogHash)throw new Error('Compact source requires the unchanged complete catalog');
  const bodyParts:EvidenceBodyPart[]=[],ids=new Set<string>(),sources=new Set(catalog.sections?.map(s=>s.id)??[]);let offset=0;
  for(const span of catalog.spans){
    if(ids.has(span.id)||span.start<offset||span.end!==span.start+span.quote.length||input.body.slice(span.start,span.end)!==span.quote||span.source&&!sources.has(span.source.id))throw new Error('Compact source span identity, order or exact text changed');
    ids.add(span.id);if(span.start>offset)bodyParts.push(input.body.slice(offset,span.start));
    bodyParts.push([span.id,span.paragraph,span.page,span.start,span.quote,...(span.source?[span.source.id]:[])] as EvidenceBodyPart);offset=span.end;
  }
  if(offset<input.body.length)bodyParts.push(input.body.slice(offset));
  const reconstructed=bodyParts.map(part=>typeof part==='string'?part:part[4]).join('');
  if(reconstructed!==input.body||sha256(reconstructed)!==input.bodySha256)throw new Error('Compact source is not a lossless reconstruction');
  const {body,paragraphs,evidenceCatalog,...provenance}=catalogSource(input,catalog);
  return {...provenance,sourceWireVersion:LOSSLESS_SOURCE_WIRE,evidenceCatalog:{...evidenceBinding(catalog),partColumns:['id','paragraph','page','start','quote','sourceId?']},bodyParts};
}

export function assertSavedEvidenceArtifact(input:EvidenceInput,artifact:{evidenceCatalog?:ReturnType<typeof evidenceBinding>;promptVersion?:string;schemaVersion?:string},expected:{promptVersion:string;schemaVersion:string}) {
  if(artifact.promptVersion!==expected.promptVersion||artifact.schemaVersion!==expected.schemaVersion) throw new Error("Saved artifact prompt/schema version changed; preserve the old attempt and do not automatically resend");
  return assertEvidenceBinding(input,artifact.evidenceCatalog!);
}

export function sameEvidenceSource(a:EvidenceSource|undefined,b:EvidenceSource|undefined) {
  return a===undefined?b===undefined:!!b&&a.id===b.id&&a.url===b.url&&a.sha256===b.sha256;
}
function buildSectionedCatalog(input:EvidenceInput):EvidenceCatalog {
  const sections=input.sections!;
  if(input.pages!==undefined||sections.length<1||sections.length>4)throw new Error("Sectioned evidence requires bounded source sections without legacy pages");
  const spans:EvidenceSpan[]=[],pages:EvidenceCatalog['pages']=[],ids=new Set<string>();
  let previousEnd=0;
  for(const [i,section] of sections.entries()){
    const {id,sourceUrl,rawSha256,textSha256,start,end}=section;
    if(id!==(i===0?'webpage':`attachment-${i}`)||ids.has(id)||section.kind!==(i===0?'webpage':'pdf')||!/^https?:\/\//.test(sourceUrl)||!/^([a-f0-9]{64})$/.test(rawSha256)||!/^([a-f0-9]{64})$/.test(textSha256)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>input.body.length)throw new Error("Invalid source section provenance or intervals");
    ids.add(id);
    const gap=i===0?'':`\n\n附件：${section.label}\n原件：${sourceUrl}\n`;
    if((i===0&&(section.label!==undefined||section.pages!==undefined))||(i>0&&(typeof section.label!=='string'||section.label.length>500))||start!==previousEnd+gap.length||input.body.slice(previousEnd,start)!==gap||sha256(input.body.slice(start,end))!==textSha256)throw new Error("Source section reconstruction or text hash mismatch");
    previousEnd=end;
    const source={id,url:sourceUrl,sha256:rawSha256};
    if(section.kind==='pdf'){
      const text=input.body.slice(start,end),markers=[...text.matchAll(/^--- Page (\d+) ---\r?\n/gm)],intervals=section.pages;
      if(!intervals?.length||intervals.length>200||intervals.length!==markers.length||markers[0]?.index!==0)throw new Error("Source PDF page intervals incomplete");
      for(const [j,m] of markers.entries()){
        const p=intervals[j]!,expected={page:j+1,start:start+m.index!+m[0].length,end:start+(markers[j+1]?.index??text.length)};
        if(Number(m[1])!==j+1||p.page!==expected.page||p.start!==expected.start||p.end!==expected.end||!input.body.slice(p.start,p.end).trim())throw new Error("Source PDF page intervals incomplete or changed");
        pages.push({...expected,source});
      }
    }
    for(const p of sourceParagraphs(input.body)){
      if(p.end<=start||p.start>=end)continue;
      if(p.start<start||p.end>end)throw new Error("Source paragraph crosses section interval");
      if(section.kind==='pdf'&&/^--- Page \d+ ---\r?$/.test(p.text))continue;
      const page=section.kind==='pdf'?pages.find(page=>page.source?.id===id&&p.start>=page.start&&p.end<=page.end)?.page:null;
      if(page===undefined)throw new Error("Source paragraph lacks a verified attachment page interval");
      let offset=0,sequence=0;const identities=new Set<string>();
      for(const match of p.text.matchAll(/[。！？]+[”’」』）】]*/g)){const last=match.index!+match[0].length;append(offset,last);offset=last;}
      if(offset<p.text.length)append(offset,p.text.length);
      function append(from:number,to:number){
        const quote=p.text.slice(from,to);if(!quote.trim())return;
        if(quote.length>1200)throw new Error("Evidence span exceeds quote capacity; zero-call manual review required, source not truncated");
        if(identities.has(quote))throw new Error("Ambiguous repeated span in one paragraph cannot preserve canonical evidence identity; zero-call manual review required");
        identities.add(quote);spans.push({id:`p${p.paragraph}s${++sequence}`,quote,paragraph:p.paragraph,page:page!,start:p.start+from,end:p.start+to,source});
      }
    }
  }
  if(previousEnd!==input.body.length||!spans.length)throw new Error("Complete source section coverage required");
  const bound={version:SECTIONED_EVIDENCE_VERSION,bodySha256:input.bodySha256,observationRevision:input.observationRevision,spans,pages,sections};
  return {...bound,hash:sha256(JSON.stringify(bound))};
}
