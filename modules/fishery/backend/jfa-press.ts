// Inspected Japanese Fisheries Agency releases. No external links, images or paid acquisition.
import * as cheerio from 'cheerio';
import {captureSchema,dateSchema,jfaContextSchema,linkSchema,type JfaContext} from '../contracts.ts';
import {archiveReceiptSchema,sha256,type PdfText} from './source-adapters.ts';
import {buildEvidenceCatalog,type EvidenceSection} from './evidence.ts';
import type {Candidate} from './official-columns.ts';
export const JFA_PRESS='https://www.jfa.maff.go.jp/j/press/';
const ROBOTS='https://www.jfa.maff.go.jp/robots.txt';
const ROBOTS_MISSING_SHA256='458e61da3ecdb675ae7b9d98805fd4529d9de15c9b802d63279d28e61934debc';
const CAPACITY_WARNING='JFA required attachment count exceeds automatic capacity (6); verified landing and attachment inventory only, no complete text or model input';
const collapse=(s:string)=>s.replace(/\s+/g,' ').trim();
const unknown=()=>({precision:'unknown' as const,value:null});
function articleUrl(input:string){const u=new URL(input);return linkSchema.safeParse(input).success&&u.origin===new URL(JFA_PRESS).origin&&!u.search&&!u.hash&&/^\/j\/press\/[a-z_]+\/\d{6}(?:_\d+)?\.html$/.test(u.pathname);}
// RFC 9309 §2.3.1.3 permits unavailable 4xx robots. Only the observed official missing-page response is accepted.
export function assertJfaRobots(input:unknown,raw:Buffer){
 const r=archiveReceiptSchema.parse(input);
 if(r.requestedUrl!==ROBOTS||r.finalUrl!==ROBOTS||r.status!==403||r.sha256!==sha256(raw)||r.sha256!==ROBOTS_MISSING_SHA256)throw new Error('JFA robots policy changed or unavailable; inspect before acquisition');
}
export function jfaDate(literal:string):string|null{
 const m=/^(令和|平成)(元|\d+)年(\d{1,2})月(\d{1,2})日/.exec(collapse(literal));if(!m)return null;
 const year=(m[1]==='令和'?2018:1988)+(m[2]==='元'?1:Number(m[2])),value=`${year}-${m[3]!.padStart(2,'0')}-${m[4]!.padStart(2,'0')}`;
 return dateSchema.safeParse({precision:'day',value}).success?value:null;
}
export function discoverJfaPress(html:string){
 const $=cheerio.load(html),candidates:Candidate[]=[],seen=new Set<string>();let rejected=0;
 for(const a of $('#main_content dl.list_item dd a[href]').toArray()){
  let url:string;try{url=new URL($(a).attr('href')!,JFA_PRESS).href;}catch{rejected++;continue;}
  if(!articleUrl(url)){rejected++;continue;}if(seen.has(url))continue;seen.add(url);
  const title=collapse($(a).text());if(!title){rejected++;continue;}
  const item=$(a).closest('dl.list_item'),month=collapse(item.prevAll('h2').first().text()),day=collapse(item.prevAll('p.list_item_date').first().text());
  const y=/^(令和|平成)(元|\d+)年/.exec(month),listDate=y?jfaDate(`${y[1]}${y[2]}年${day}`):null;
  candidates.push({url,title,listDate,priority:'context'});
 }
 return {candidates,rejected,listed:seen.size};
}
export function jfaPage(raw:Buffer,url:string){
 if(!articleUrl(url))throw new Error('Unexpected JFA press identity');
 const $=cheerio.load(new TextDecoder('utf8',{fatal:true}).decode(raw)),content=$('#main_content').first().clone();
 const title=collapse(content.find('h1').first().text())||null,publicationLiteral=collapse(content.find('.content_utility-date').text()).replace(/\s*水産庁\s*$/,'')||null;
 content.find('script,style,iframe,form,noscript,.content_utility,.subheading,.outline,.adobe_reader,h1').remove();
 const attachments:Array<{url:string;label:string;extension:string}>=[];
 for(const a of content.find('a[href]').toArray()){
  const href=$(a).attr('href')!,u=new URL(href,url);
  if(!/\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:$|[?#])/i.test(u.href)&&!u.pathname.includes('/attach/'))continue;
  // Third-party documents are recorded but never fetched by this adapter; fail rather than omit required evidence.
  if(u.origin!==new URL(JFA_PRESS).origin||u.search||u.hash||!u.pathname.startsWith(new URL('attach/',url).pathname)||!linkSchema.safeParse(u.href).success)throw new Error('Unverified JFA attachment origin/path');
  if(!attachments.some(f=>f.url===u.href))attachments.push({url:u.href,label:collapse($(a).text()).slice(0,500),extension:u.pathname.split('.').at(-1)!.toLowerCase()});
 }
 content.find('td,th').append('\t');content.find('p,br,div,li,tr,h2,h3').append('\n');
 const body=content.text().split(/\n+/).map(collapse).filter(Boolean).join('\n');
 return {title,publicationLiteral,body,attachments};
}
export interface JfaAttachment {receipt:unknown;bytes:Buffer;parsed?:PdfText;}
export function prepareJfaPress(input:unknown,raw:Buffer,files:JfaAttachment[]=[],acquisitionMode:'live_capture'|'archive_replay'='live_capture'){
 const r=archiveReceiptSchema.parse(input),conflicts:string[]=[],warnings=['Japanese official release; geographic scope and legal effect require review. Public output remains attributed summary/link; no images or third-party redistribution'];
 if(!articleUrl(r.requestedUrl)||r.finalUrl!==r.requestedUrl||r.sha256!==sha256(raw))conflicts.push('JFA receipt/identity mismatch');
 let page:ReturnType<typeof jfaPage>={title:null,publicationLiteral:null,body:'',attachments:[]};
 if(r.status===200&&!conflicts.length)try{page=jfaPage(raw,r.finalUrl);}catch(error){conflicts.push((error as Error).message);}
 const context:JfaContext=jfaContextSchema.parse({pageBody:{bodyStart:0,bodyEnd:page.body.length,sourceUrl:r.finalUrl,rawSha256:sha256(raw)},pageTextSha256:sha256(page.body),attachmentListSha256:sha256(JSON.stringify(page.attachments)),attachmentCount:page.attachments.length,attachments:[],...(page.attachments.length>6?{capacityLimit:6}:{})});
 let body:string|null=page.body,complete=r.status===200&&!!page.title&&page.body.length>=40&&!conflicts.length;
 if(page.attachments.length>6){complete=false;warnings.push(CAPACITY_WARNING);}
 if(page.attachments.length>6&&files.length)conflicts.push('Capacity-limited JFA landing must not claim partial attachment acquisition');
 if(files.reduce((n,f)=>n+f.bytes.length,0)>24*1024*1024){complete=false;warnings.push('Required attachments exceed 24 MiB total; acquisition blocked');}
 for(const [i,a] of (page.attachments.length>6?[]:page.attachments).entries()){
  const record:JfaContext['attachments'][number]={...a,format:'not_fetched',sha256:null,httpStatus:null,parseStatus:'not_fetched',pages:null,textSha256:null,bodyStart:null,bodyEnd:null},file=files[i];
  if(!file){complete=false;warnings.push(`Required attachment missing: ${a.url}`);}
  else{
   const ar=archiveReceiptSchema.parse(file.receipt),hash=sha256(file.bytes),p=file.parsed,pdf=file.bytes.subarray(0,5).equals(Buffer.from('%PDF-'));
   Object.assign(record,{format:pdf?'pdf':'other',sha256:hash,httpStatus:ar.status,parseStatus:ar.status===200?'unverified':'failed'});
   if(ar.requestedUrl!==a.url||ar.finalUrl!==a.url||ar.sha256!==hash)conflicts.push('JFA attachment receipt/identity mismatch');
   const matches=p?[...p.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)]:[];
   if(ar.status===200&&a.extension==='pdf'&&pdf&&file.bytes.length<=10*1024*1024&&p?.status==='parsed'&&p.rawSha256===hash&&p.pages>0&&p.pages<=200&&matches.length===p.pages&&matches[0]?.index===0&&matches.every((m,j)=>Number(m[1])===j+1&&p.text.slice(m.index!+m[0].length,matches[j+1]?.index??p.text.length).trim())&&(!p.textEvidence||p.textEvidence.textSha256===sha256(p.text))){
    body+=`\n\n附件：${a.label}\n原件：${a.url}\n`;record.bodyStart=body.length;body+=p.text;record.bodyEnd=body.length;
    Object.assign(record,{parseStatus:'parsed',pages:p.pages,textSha256:sha256(p.text),pageIntervals:matches.map((m,j)=>({page:j+1,start:record.bodyStart!+m.index!+m[0].length,end:record.bodyStart!+(matches[j+1]?.index??p.text.length)})),...(p.textEvidence?{pdfTextEvidence:p.textEvidence}:{})});
   }else{complete=false;warnings.push(`Required attachment incomplete: ${a.url}; HTTP ${ar.status}, parser ${p?.status??'missing'}`);}
  }
  context.attachments.push(record);
 }
 if(files.length>page.attachments.length)conflicts.push('Unexpected JFA attachment bytes');
 if(body.length>64000){complete=false;warnings.push('Combined release exceeds complete model-input limit (64000 characters); blocked without truncation');}
 if(!complete||conflicts.length)body=null;
 const day=page.publicationLiteral?jfaDate(page.publicationLiteral):null;
 if(page.publicationLiteral&&!day)warnings.push('Publication date unverified; URL/list/capture dates are not substitutes');
 const first=context.attachments[0],sourceCapture=captureSchema.parse({adapter:'jfa-press',acquisitionMode,sourceUrl:r.finalUrl,capturedAt:r.finishedAt,httpStatus:r.status,rawSha256:sha256(raw),bodySha256:body?sha256(body):null,parser:'official-column/jfa-press/v1',parseStatus:body?'parsed':conflicts.length||context.capacityLimit?'unverified':r.status!==200?'failed':'missing',attachmentSha256:first?.sha256??null,attachmentUrl:first?.url??null,attachmentHttpStatus:first?.httpStatus??null,attachmentCapturedAt:files[0]?archiveReceiptSchema.parse(files[0].receipt).finishedAt:null,attachmentPages:first?.pages??null,publishedAt:null,publicationLiteral:page.publicationLiteral,conflicts,jfaContext:context});
 const evidence=body?body.split(/\n+/).filter(p=>/公海|国際|北太平洋|漁獲|資源|NPFC|IUU|サンマ|マサバ|マイワシ|まぐろ|遠洋/i.test(p)).slice(0,8).map(p=>p.slice(0,500)):[];
 return {title:page.title,body,dates:{published:day?{precision:'day' as const,value:day}:unknown(),event:unknown(),adopted:unknown(),effectiveFrom:unknown(),effectiveUntil:unknown()},sourceCapture,readyForReview:!!body,relevance:{decision:evidence.length?'candidate' as const:'not_proven' as const,method:'explicit_dwf_terms' as const,evidence},warnings,evidence:[{url:r.finalUrl,sha256:sha256(raw),page:null,section:'JFA official HTML release; no inferred legal applicability'},...context.attachments.filter(a=>a.sha256).map(a=>({url:a.url,sha256:a.sha256!,page:null,section:`Required attachment; ${a.parseStatus}`}))]};
}
export function jfaAttachmentChanged(previous:JfaContext|undefined,current:JfaContext|undefined){
 if(!previous||!current)return false;
 return previous.pageTextSha256!==current.pageTextSha256||previous.attachmentListSha256!==current.attachmentListSha256||previous.attachmentCount!==current.attachmentCount||previous.attachments.map(a=>a.url).join('\n')!==current.attachments.map(a=>a.url).join('\n')||current.attachments.some(a=>a.httpStatus===200&&a.sha256&&previous.attachments.some(old=>old.url===a.url&&old.sha256&&old.sha256!==a.sha256));
}
export function jfaCapacityNeedsReview(input:{title:string|null;body:string|null;sourceCapture:unknown;readyForReview:boolean;warnings:string[]}){
 const c=captureSchema.parse(input.sourceCapture),n=c.jfaContext;
 return c.adapter==='jfa-press'&&c.httpStatus===200&&c.parseStatus==='unverified'&&!c.conflicts.length&&!!input.title&&!input.readyForReview&&input.body===null&&c.bodySha256===null&&!!n?.pageBody&&n.pageBody.sourceUrl===c.sourceUrl&&n.pageBody.rawSha256===c.rawSha256&&n.capacityLimit===6&&n.attachmentCount>6&&n.attachments.length===0&&input.warnings.includes(CAPACITY_WARNING);
}
export function jfaEvidenceSections(body:string,input:unknown):EvidenceSection[]{
 const c=captureSchema.parse(input),n=c.jfaContext;
 if(c.adapter!=='jfa-press'||c.parser!=='official-column/jfa-press/v1'||c.httpStatus!==200||c.parseStatus!=='parsed'||c.conflicts.length||!c.bodySha256||!n?.pageBody||n.pageBody.sourceUrl!==c.sourceUrl||n.pageBody.rawSha256!==c.rawSha256)throw new Error('Complete JFA page/attachment provenance required');
 const sections:EvidenceSection[]=[{id:'webpage',kind:'webpage',sourceUrl:c.sourceUrl,rawSha256:c.rawSha256,textSha256:n.pageTextSha256,start:0,end:n.pageBody.bodyEnd}];
 for(const [i,a] of n.attachments.entries()){
  if(a.bodyStart===null||a.bodyEnd===null||!a.sha256||!a.textSha256||!a.pages||a.pageIntervals?.length!==a.pages)throw new Error('JFA attachment page intervals incomplete');
  sections.push({id:`attachment-${i+1}`,kind:'pdf',sourceUrl:a.url,rawSha256:a.sha256,textSha256:a.textSha256,start:a.bodyStart,end:a.bodyEnd,label:a.label,pages:a.pageIntervals});
 }
 buildEvidenceCatalog({body,bodySha256:c.bodySha256,observationRevision:1,sections});return sections;
}
