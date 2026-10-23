// Per-measure official archive. Listing membership is evidence, not a legal applicability decision.
import * as cheerio from 'cheerio';
import {captureSchema,linkSchema} from '../contracts.ts';
import {archiveReceiptSchema,sha256,type PdfText} from './source-adapters.ts';
import type {Candidate} from './official-columns.ts';
import {pdfTextlessPages} from './pdf-text.ts';
export const NPFC_LIST='https://www.npfc.int/cmms-pdf';
const ROBOTS_SHA256='897adef5514fda6260ba3fea751d854508d3c59358a971a93e8bc079c4ad9e75';
const collapse=(value:string)=>value.replace(/\s+/g,' ').trim();
export interface NpfcCandidate extends Candidate {number:string;effectiveLiteral:string|null;}
export function assertNpfcRobots(input:unknown,raw:Buffer){
 const r=archiveReceiptSchema.parse(input);
 if(r.status!==200||r.requestedUrl!=='https://www.npfc.int/robots.txt'||r.finalUrl!==r.requestedUrl||r.sha256!==ROBOTS_SHA256||sha256(raw)!==r.sha256)throw new Error('NPFC robots changed or unavailable; inspect policy before acquisition');
}
export function discoverNpfc(html:string){
 const $=cheerio.load(html),seen=new Map<string,string>(),candidates:NpfcCandidate[]=[];let rejected=0;
 for(const a of $('.region-content .view-document-list td.views-field-title > a[href]').toArray()){
  const title=collapse($(a).text()),number=/^CMM (\d{4}-\d{2})\b/.exec(title)?.[1];if(!number)continue;
  let url:URL;try{url=new URL($(a).attr('href')!,NPFC_LIST);}catch{continue;}
  if(url.origin!==new URL(NPFC_LIST).origin||!/^\/cmm-[a-z0-9-]+$/.test(url.pathname)||url.search||url.hash||!linkSchema.safeParse(url.href).success){rejected++;continue;}
  if(seen.has(url.href)){if(seen.get(url.href)!==title)throw new Error('Conflicting NPFC current-list identities for the same URL');continue;}seen.set(url.href,title);
  candidates.push({url:url.href,title,listDate:null,priority:'direct',number,effectiveLiteral:/\(Effective date:\s*([^()]+)\)/i.exec(title)?.[1]?.trim()??null});
 }
 return {candidates,rejected,listed:seen.size};
}
export function npfcAttachment(raw:Buffer,pageUrl:string){
 const $=cheerio.load(new TextDecoder('utf8',{fatal:true}).decode(raw));
 const urls=new Set($('.region-content .field--name-field-file .file-link a[href]').toArray().map(a=>new URL($(a).attr('href')!,pageUrl).href).filter(url=>/^https:\/\/www\.npfc\.int\/system\/files\/[^?#]+\.pdf$/i.test(url)&&linkSchema.safeParse(url).success));
 if(urls.size!==1)throw new Error('NPFC measure requires one unambiguous same-origin full PDF');return [...urls][0]!;
}
export function prepareNpfc(candidate:NpfcCandidate,input:unknown,raw:Buffer,pdf?:{receipt:unknown;bytes:Buffer;parsed:PdfText}){
 const r=archiveReceiptSchema.parse(input),conflicts:string[]=[],warnings=['Current-list membership and stated effective date are unreviewed source claims; sea, flag, species and present applicability require review'];
 let body:string|null=null,title:string|null=null,parseStatus:'parsed'|'missing'|'failed'|'unverified'=r.status===200?'missing':'failed';
 let attachmentSha256:string|null=null,attachmentUrl:string|null=null,attachmentHttpStatus:number|null=null,attachmentCapturedAt:string|null=null,attachmentPages:number|null=null;
 let textless:number[]=[];
 if(r.requestedUrl!==candidate.url||r.finalUrl!==candidate.url||r.sha256!==sha256(raw))conflicts.push('NPFC landing receipt/identity mismatch');
 if(r.status===200&&!conflicts.length){
  const $=cheerio.load(new TextDecoder('utf8',{fatal:true}).decode(raw));title=collapse($('h1').first().text());
  if(title!==candidate.title)conflicts.push('NPFC listing and landing title/version/effective label disagree');
  attachmentUrl=npfcAttachment(raw,r.finalUrl);
  if(!pdf)warnings.push('Full PDF missing; landing metadata is not measure text');
  else{
   const pr=archiveReceiptSchema.parse(pdf.receipt),p=pdf.parsed;
   attachmentSha256=sha256(pdf.bytes);attachmentHttpStatus=pr.status;attachmentCapturedAt=pr.finishedAt;attachmentPages=p.status==='parsed'&&p.pages>0?p.pages:null;
   if(pr.requestedUrl!==attachmentUrl||pr.finalUrl!==attachmentUrl||pr.sha256!==attachmentSha256||p.rawSha256!==attachmentSha256)conflicts.push('NPFC PDF receipt/text hash or URL mismatch');
   parseStatus=pr.status===200?p.status:'failed';
   textless=p.textlessPages??[];
   if(parseStatus==='parsed'){
    try{textless=pdfTextlessPages(p.text,p.pages);if(textless.length){parseStatus='unverified';warnings.push(`PDF textless pages ${textless.join(',')}; blank/scanned distinction unverified`);}}
    catch(error){parseStatus='unverified';warnings.push(String((error as Error).message));}
   }
   if(parseStatus==='parsed'){
    if(!pdf.bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!p.text.trim()||p.pages<1||p.pages>200)parseStatus='failed';
    else{
     const header=collapse(p.text.split('--- Page 2 ---')[0]??p.text).slice(0,2500);
     if(/\bCMM\s+(\d{4}-\d{2})\b/.exec(header)?.[1]!==candidate.number)conflicts.push('NPFC PDF measure version disagrees with current listing');
     const effective=/Entered into force\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(header)?.[1]??null;
     if(candidate.effectiveLiteral&&effective&&effective.toLowerCase()!==candidate.effectiveLiteral.toLowerCase())conflicts.push('NPFC PDF and listing stated effective dates disagree');
     if(!effective)warnings.push('PDF effective-date header unverified; no inferred entry into force');
     if(p.textEvidence&&p.textEvidence.textSha256!==sha256(p.text))conflicts.push('NPFC PDF transformation evidence mismatch');
     body=p.text;
    }
   }
   if(parseStatus!=='parsed')warnings.push(`Full PDF ${parseStatus}: ${p.error??'complete text unverified'}`);
  }
 }
 if(conflicts.length){parseStatus='unverified';body=null;}
 const unknown=()=>({precision:'unknown' as const,value:null});
 const sourceCapture=captureSchema.parse({adapter:'npfc',acquisitionMode:'live_capture',sourceUrl:r.finalUrl,capturedAt:r.finishedAt,httpStatus:r.status,rawSha256:sha256(raw),bodySha256:body?sha256(body):null,
  parser:`official-column/npfc/v1; ${pdf?.parsed.parser??'unavailable-pdf-parser'}`,parseStatus,attachmentSha256,attachmentUrl,attachmentHttpStatus,attachmentCapturedAt,attachmentPages,conflicts,
  ...(textless.length?{pdfTextlessPages:textless}:{}),...(pdf?.parsed.textEvidence?{pdfTextEvidence:pdf.parsed.textEvidence}:{}),regulatoryListing:{measureNumber:candidate.number,statedEffectiveDate:candidate.effectiveLiteral,membership:'listed_current_only',applicableSea:'unknown',effectiveStatus:'unknown'}});
 return {title,body,dates:{published:unknown(),event:unknown(),adopted:unknown(),effectiveFrom:unknown(),effectiveUntil:unknown()},sourceCapture,policyContext:{entryIntoForce:'unknown' as const,objectionDeadline:unknown(),nonApplicationMentioned:[],provisionYears:[]},readyForReview:parseStatus==='parsed'&&!!body&&!conflicts.length,warnings,
  evidence:[{url:r.finalUrl,sha256:sha256(raw),page:null,section:`NPFC CMM ${candidate.number}; stated effective ${candidate.effectiveLiteral??'unknown'}; applicability unreviewed`},...(attachmentSha256&&attachmentUrl?[{url:attachmentUrl,sha256:attachmentSha256,page:null,section:'Complete official PDF; scope and legal status require evidence review'}]:[])]};
}
