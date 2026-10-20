import { z } from "zod";
import { sha256 } from "./source-adapters.ts";

// Bump whenever segmentation, page binding or catalog serialization changes. Never replay an old wire response under a new version.
export const EVIDENCE_VERSION="fishery-spans-v1";
export interface EvidenceInput {body:string;bodySha256:string;observationRevision:number;pages?:{page:number;text:string}[]}
export interface EvidenceSpan {id:string;quote:string;paragraph:number;page:number|null;start:number;end:number}
export interface EvidenceCatalog {version:string;hash:string;bodySha256:string;observationRevision:number;spans:EvidenceSpan[];pages:{page:number;start:number;end:number}[]}
export function sourceParagraphs(body:string) {
  return [...body.matchAll(/[^\n]+/g)].filter(m=>m[0].trim()).map((m,i)=>({paragraph:i+1,text:m[0],start:m.index!,end:m.index!+m[0].length}));
}
export function buildEvidenceCatalog(input:EvidenceInput):EvidenceCatalog {
  if(!input.body.trim()||input.body.length>64000||sha256(input.body)!==input.bodySha256) throw new Error("Missing, oversized or changed source body");
  if(!Number.isInteger(input.observationRevision)||input.observationRevision<1) throw new Error("Observation version required");
  const markers=[...input.body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  const pages=markers.map((m,i)=>({page:Number(m[1]),start:m.index!+m[0].length,end:markers[i+1]?.index??input.body.length}));
  if(markers.length||input.pages?.length) {
    if(!markers.length||input.body.slice(0,markers[0]!.index).trim()||pages.length!==input.pages?.length||pages.some((p,i)=>p.page!==i+1||input.pages![i]!.page!==p.page||input.body.slice(p.start,p.end).trim()!==input.pages![i]!.text)) throw new Error("PDF page intervals must match ordered Page markers and verified page text");
  }
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
  const bound={version:EVIDENCE_VERSION,bodySha256:input.bodySha256,observationRevision:input.observationRevision,spans,pages};
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
    const {quote,paragraph,page}=catalog.spans.find(s=>s.id===id)!;
    return {quote,paragraph,page};
  }));
}
export function anchorIds(catalog:EvidenceCatalog,anchors:{quote:string;paragraph:number;page:number|null}[]) {
  return anchors.map(anchor=>catalog.spans.find(s=>s.quote===anchor.quote&&s.paragraph===anchor.paragraph&&s.page===anchor.page)?.id??null);
}
export function catalogSource(input:EvidenceInput,catalog:EvidenceCatalog) {
  // Full source exactly once; index points into it using UTF-16 code-unit offsets. Pages are intervals, never another full-text copy.
  return {body:input.body,offsetUnit:"UTF-16",evidenceCatalog:{...evidenceBinding(catalog),spans:catalog.spans.map(({quote,...index})=>index)},paragraphs:sourceParagraphs(input.body).map(({text,...index})=>index),pages:catalog.pages};
}

export function assertSavedEvidenceArtifact(input:EvidenceInput,artifact:{evidenceCatalog?:ReturnType<typeof evidenceBinding>;promptVersion?:string;schemaVersion?:string},expected:{promptVersion:string;schemaVersion:string}) {
  if(artifact.promptVersion!==expected.promptVersion||artifact.schemaVersion!==expected.schemaVersion) throw new Error("Saved artifact prompt/schema version changed; preserve the old attempt and do not automatically resend");
  return assertEvidenceBinding(input,artifact.evidenceCatalog!);
}
