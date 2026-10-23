// Inspected TRS notices: attachments are required evidence, never a title-only substitute.
import * as cheerio from 'cheerio';
import {readPublicationDate} from '@aihot/backend/sources/dates';
import {beijingDate} from '@aihot/contracts/time';
import {captureSchema,dateSchema,linkSchema,noticeContextSchema,type NoticeContext} from '../contracts.ts';
import {archiveReceiptSchema,sha256,type PdfText} from './source-adapters.ts';
import {buildEvidenceCatalog,type EvidenceSection} from './evidence.ts';
import {relevanceEvidence,unknownDate} from './official-columns.ts';
const BASE='https://hyyyj.fujian.gov.cn/xxgk/tzgg/';
const collapse=(s:string)=>s.replace(/\s+/g,' ').trim();
const pageUrl=(url:string)=>linkSchema.safeParse(url).success&&url.startsWith(BASE)&&/\/t\d{8}_\d+\.htm$/.test(url);
export function noticePage(raw:Buffer,url:string){
 if(!pageUrl(url))throw new Error('Unexpected Fujian notice identity');
 const $=cheerio.load(new TextDecoder('utf8',{fatal:true}).decode(raw));
 const title=collapse($('meta[name=ArticleTitle]').attr('content')||$('h1.xl_tit').text())||null;
 const content=$('#detailCont .TRS_Editor').first().clone();content.find('script,style,iframe,form,noscript').remove();
 content.find('td,th').append('\t');content.find('p,br,div,li,tr,h2,h3').append('\n');
 const text=content.text().split(/\n+/).map(collapse).filter(Boolean).join('\n');
 const attachments:Array<{url:string;label:string;extension:string}>=[];
 for(const a of $('ul.myzj_xl_list a[href]').toArray()){
  const u=new URL($(a).attr('href')!,url);
  if(u.origin!==new URL(BASE).origin||u.search||u.hash||!u.pathname.startsWith(new URL('.',url).pathname)||!/^P\d+\.[a-z0-9]{1,8}$/i.test(u.pathname.split('/').at(-1)!)||!linkSchema.safeParse(u.href).success)throw new Error('Unverified notice attachment origin/path');
  if(!attachments.some(f=>f.url===u.href))attachments.push({url:u.href,label:collapse($(a).text()).slice(0,500),extension:u.pathname.split('.').at(-1)!.toLowerCase()});
 }
 return {title,text,literal:collapse($('meta[name=PubDate]').attr('content')||'')||null,attachments};
}
export function noticeClassification(title:string,text:string){
 const nature:NoticeContext['nature']=/征求.*意见|征求意见/.test(title)?'consultation':/公示/.test(title)?'publicity':/下达.*资金/.test(title)?'funding_allocation':/申报|申请/.test(title)?'application_notice':/明白纸|汇编/.test(title)?'policy_reference':/印发|公布/.test(title)?'issued_document':'unknown';
 const role:NoticeContext['deadlineRole']=nature==='consultation'?'consultation':nature==='publicity'?'publicity':nature==='application_notice'?'application':'unknown';
 const matches=role==='unknown'?[]:text.split(/\n+/).filter(p=>role==='publicity'?/公示时间|公示期/.test(p):role==='consultation'?/意见.*(?:截止|之前|日前)|(?:截止|之前|日前).*意见/.test(p):/申报|申请|提交/.test(p)&&/截止|之前|日前/.test(p)).flatMap(p=>{
  const dates=[...p.matchAll(/((?:19|20|21)\d{2})年(\d{1,2})月(\d{1,2})日/g)].map(m=>`${m[1]}-${m[2]!.padStart(2,'0')}-${m[3]!.padStart(2,'0')}`);
  // An abbreviated range end is not the complete date at its start. Do not invent the missing year.
  if(!dates.length||dates.length>2||[...p.matchAll(/\d{1,2}月\d{1,2}日/g)].length!==dates.length||dates.length===2&&!/至|到/.test(p))return [];
  const value=dates.at(-1)!;return dateSchema.safeParse({precision:'day',value}).success?[{value,literal:p.slice(0,1000)}]:[];
 });
 const deadline=matches.length===1?{precision:'day' as const,value:matches[0]!.value}:unknownDate();
 return {nature,validity:'unknown' as const,deadline,deadlineLiteral:matches.length===1?matches[0]!.literal:null,deadlineRole:role};
}
export interface NoticeAttachment {receipt:unknown;bytes:Buffer;parsed?:PdfText;}
export function attachmentFormat(bytes:Buffer):NoticeContext['attachments'][number]['format']{
 if(bytes.subarray(0,5).equals(Buffer.from('%PDF-')))return 'pdf';
 if(bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4])))return 'office_zip';
 if(bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))return 'ole';
 if(/^\s*(?:<!doctype|<html|<head|<body)/i.test(bytes.subarray(0,500).toString('utf8')))return 'html';return 'other';
}
export function prepareNotice(input:unknown,raw:Buffer,files:NoticeAttachment[]=[]){
 const r=archiveReceiptSchema.parse(input),conflicts:string[]=[],warnings=['Notice classification is an unreviewed retrieval aid; a deadline is not proof of eligibility or current policy validity'];
 if(!pageUrl(r.requestedUrl)||r.finalUrl!==r.requestedUrl||r.sha256!==sha256(raw))conflicts.push('Notice receipt/identity mismatch');
 const page=r.status===200&&!conflicts.length?noticePage(raw,r.finalUrl):{title:null,text:'',literal:null,attachments:[]};
 const context:NoticeContext=noticeContextSchema.parse({...noticeClassification(page.title??'',page.text),evidenceVersion:'notice-sections/v2',pageBody:{bodyStart:0,bodyEnd:page.text.length,sourceUrl:r.finalUrl,rawSha256:sha256(raw)},pageTextSha256:sha256(page.text),attachmentCount:page.attachments.length,attachments:[]});
 const substantiveText=page.text.split('\n').filter(p=>collapse(p)!==page.title).join('\n');
 const substantive=collapse(substantiveText).length>=40,relevanceParts=substantive?[substantiveText]:[];
 let body:string|null=page.text,complete=r.status===200&&!!page.title&&!conflicts.length;
 if(page.attachments.length>3){complete=false;warnings.push('More than three required attachments; bounded capture incomplete, review required');}
 for(const [index,a] of page.attachments.slice(0,3).entries()){
  const record:NoticeContext['attachments'][number]={...a,format:'not_fetched',sha256:null,httpStatus:null,parseStatus:'not_fetched',pages:null,textSha256:null,bodyStart:null,bodyEnd:null};
  const file=files[index];
  if(!file){complete=false;warnings.push(`Required attachment not captured: ${a.url}`);}
  else{
   const ar=archiveReceiptSchema.parse(file.receipt),hash=sha256(file.bytes),format=attachmentFormat(file.bytes);Object.assign(record,{format,sha256:hash,httpStatus:ar.status,parseStatus:ar.status===200?'unverified':'failed'});
   if(ar.requestedUrl!==a.url||ar.finalUrl!==a.url||ar.sha256!==hash)conflicts.push('Attachment receipt/URL/hash mismatch');
   const p=file.parsed;
   if(p?.status==='parsed'&&p.pages>0&&p.pages<=200){record.pages=p.pages;record.textSha256=sha256(p.text);}
   if(ar.status===200&&format==='pdf'&&a.extension==='pdf'&&p?.status==='parsed'&&p.rawSha256===hash&&p.pages>0&&p.pages<=200&&p.text.trim()&&(!p.textEvidence||p.textEvidence.textSha256===sha256(p.text))){
    const markerMatches=[...p.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)],markers=markerMatches.map(m=>Number(m[1]));
    const pages=p.text.split(/^--- Page \d+ ---\r?\n/gm).slice(1);
    if(markers.length!==p.pages||markerMatches[0]?.index!==0||markers.some((n,i)=>n!==i+1)){complete=false;warnings.push('PDF page coverage incomplete');}
    else if(pages.some(text=>!text.trim())){complete=false;warnings.push('PDF contains textless pages; blank versus scanned page not verified, manual review required');}
    else{body+=`\n\n附件：${a.label}\n原件：${a.url}\n`;record.bodyStart=body.length;body+=p.text;record.bodyEnd=body.length;record.pageIntervals=markerMatches.map((m,i)=>({page:i+1,start:record.bodyStart!+m.index!+m[0].length,end:record.bodyStart!+(markerMatches[i+1]?.index??p.text.length)}));relevanceParts.push(p.text);Object.assign(record,{parseStatus:'parsed',pages:p.pages,textSha256:sha256(p.text),...(p.textEvidence?{pdfTextEvidence:p.textEvidence}:{})});}
   }else{complete=false;warnings.push(`Required attachment unverified (${a.extension}/${format}/HTTP ${ar.status}): ${p?.error??'unsupported format or no complete verified PDF text; no automatic OCR'}`);}
  }
  context.attachments.push(record);
 }
 if(!page.attachments.length&&!substantive){complete=false;warnings.push('No substantive notice body; title alone is not an article');}
 if(body&&Buffer.byteLength(body)>4*1024*1024){complete=false;warnings.push('Combined notice text exceeds archive limit');}
 if(conflicts.length||!complete)body=null;
 const date=page.literal?readPublicationDate(page.literal,'+08:00'):null;
 if(page.literal&&!date?.publishedAt)conflicts.push('Invalid publication metadata');
 if(conflicts.length)body=null;
 const first=context.attachments[0],firstFile=files[0],evidence=body?relevanceEvidence(relevanceParts.join('\n')):[];
 const sourceCapture=captureSchema.parse({adapter:'fujian-notices',acquisitionMode:'live_capture',sourceUrl:r.finalUrl,capturedAt:r.finishedAt,httpStatus:r.status,rawSha256:sha256(raw),bodySha256:body?sha256(body):null,
  parser:'official-column/fujian-notices/v2',parseStatus:body?'parsed':r.status===200?'unverified':'failed',noticeContext:context,conflicts,
  publicationLiteral:page.literal,publishedAt:date?.publishedAt&&/\d{1,2}:\d{2}/.test(page.literal!)?new Date(date.publishedAt).toISOString():null,
  attachmentSha256:first?.sha256??null,attachmentUrl:first?.url??null,attachmentHttpStatus:first?.httpStatus??null,attachmentPages:first?.pages??null,attachmentCapturedAt:firstFile?archiveReceiptSchema.parse(firstFile.receipt).finishedAt:null});
 return {title:page.title,body,dates:{published:date?.publishedAt?{precision:'day' as const,value:beijingDate(date.publishedAt)}:unknownDate(),event:unknownDate(),adopted:unknownDate(),effectiveFrom:unknownDate(),effectiveUntil:unknownDate()},sourceCapture,
  readyForReview:!!body&&!!evidence.length,relevance:{decision:evidence.length?'candidate' as const:'not_proven' as const,method:'explicit_dwf_terms' as const,evidence},warnings,
  evidence:[{url:r.finalUrl,sha256:sha256(raw),page:null,section:'Official notice landing; attachment links and publication metadata'},...context.attachments.filter(a=>!!a.sha256).map(a=>({url:a.url,sha256:a.sha256!,page:null,section:`Required attachment; ${a.parseStatus}; no policy validity inference`}))]};
}
// Unavailability is not withdrawal. A verified changed link set or new 200 bytes is evidence of dependency change.
export function noticeAttachmentChanged(previous:NoticeContext|undefined,current:NoticeContext|undefined){
 if(!previous||!current)return false;
 if(previous.pageTextSha256!==current.pageTextSha256)return true;
 if(previous.attachmentCount!==current.attachmentCount||previous.attachments.map(a=>a.url).join('\n')!==current.attachments.map(a=>a.url).join('\n'))return true;
 return current.attachments.some(a=>a.httpStatus===200&&a.sha256&&previous.attachments.some(old=>old.url===a.url&&old.sha256&&old.sha256!==a.sha256));
}

// Model ingress requires the new capture metadata; old archive manifests remain readable for recapture/review.
export function noticeEvidenceSections(body:string,input:unknown):EvidenceSection[] {
 const c=captureSchema.parse(input),n=c.noticeContext;
 if(c.adapter!=='fujian-notices'||c.parser!=='official-column/fujian-notices/v2'||c.httpStatus!==200||c.parseStatus!=='parsed'||c.conflicts.length||!c.bodySha256||!n||n.evidenceVersion!=='notice-sections/v2'||!n.pageBody)throw new Error('Notice source sections require complete v2 capture metadata; recapture before model input');
 if(n.pageBody.sourceUrl!==c.sourceUrl||n.pageBody.rawSha256!==c.rawSha256)throw new Error('Notice webpage source provenance mismatch');
 const sections:EvidenceSection[]=[{id:'webpage',kind:'webpage',sourceUrl:n.pageBody.sourceUrl,rawSha256:n.pageBody.rawSha256,textSha256:n.pageTextSha256,start:n.pageBody.bodyStart,end:n.pageBody.bodyEnd}];
 for(const [i,a] of n.attachments.entries()){
  if(a.bodyStart===null||a.bodyEnd===null||!a.sha256||!a.textSha256||!a.pages||!a.pageIntervals||a.pageIntervals.length!==a.pages)throw new Error('Notice attachment page intervals missing or incomplete');
  sections.push({id:`attachment-${i+1}`,kind:'pdf',sourceUrl:a.url,rawSha256:a.sha256,textSha256:a.textSha256,start:a.bodyStart,end:a.bodyEnd,label:a.label,pages:a.pageIntervals});
 }
 // Keep first-attachment legacy convenience fields consistent, never use them as complete notice coverage.
 const first=n.attachments[0];
 if(c.attachmentUrl!==(first?.url??null)||c.attachmentSha256!==(first?.sha256??null)||c.attachmentPages!==(first?.pages??null))throw new Error('Notice attachment provenance summary mismatch');
 buildEvidenceCatalog({body,bodySha256:c.bodySha256,observationRevision:1,sections});
 return sections;
}
