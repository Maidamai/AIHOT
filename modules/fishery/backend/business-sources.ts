// Bounded, offline preparation for the first complementary business sources.
// These definitions are not registered or enabled by importing this module.
import * as cheerio from 'cheerio';
import {fromHtml} from '@aihot/backend/sources/web-list';
import {readPublicationDate} from '@aihot/backend/sources/dates';
import {stableJson} from '@aihot/backend/lib/ids';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
import type {Candidate,SourceRow} from '@aihot/backend/sources/types';
import {archiveReceiptSchema,sha256,type ArchiveReceipt,type PdfText} from './source-adapters.ts';
import {pdfTextlessPages} from './pdf-text.ts';
import {buildEvidenceCatalog,type EvidenceSection} from './evidence.ts';

const FAO='https://www.fao.org/in-action/globefish/';
const ITF='https://www.itfglobal.org/';
const MPA='https://www.mpa.gov.sg/';
export const BUSINESS_SOURCES={
 'itf-fisheries':{
  name:'ITF 渔业劳动资讯',kind:'web_list',role:'trade_union',
  config:{url:`${ITF}en/sector/fisheries`,parseMode:'html',itemSelector:'article.node--type-news.node--view-mode-teaser',linkSelector:'h2 a',titleSelector:'h2 a',publishedAtRegex:'<time[^>]*>([^<]+)</time>',publishedAtUtcOffset:'+00:00',allowUrlPrefixes:[`${ITF}en/news/`]},
  title:'h1',body:'article.node--type-news.node--view-mode-full > .content-wrapper > .body-wrapper > .field--name-body',date:'article.node--type-news.node--view-mode-full > .node-info-wrapper .field-created time',
  boundary:'Union reporting on fishers; not a recruitment feed, official labour ruling or proof that an allegation is established.',
 },
 'fao-tuna':{
  name:'FAO GLOBEFISH 金枪鱼市场分析',kind:'web_list',role:'market_analysis',
  // The native parser interprets slash dates as month/day. Keep this discovery config undated;
  // discoverBusinessHtml supplies the inspected day/month dates, without changing the core parser.
  config:{url:`${FAO}species-analysis/tuna/en`,parseMode:'html',itemSelector:'.d-list-content',linkSelector:'h5 a',titleSelector:'h5 a',allowUrlPrefixes:[`${FAO}news-events/news/news-detail/`]},
  title:'.detail-title',body:'.news-detail__body',date:'.news-detail > span.detail__date',
  boundary:'Dated HTML market analysis only. Quarterly PDFs and price dashboards are not covered; historical prices are not current offers or vessel-side prices.',
 },
 'mpa-port':{
  name:'MPA 港口作业通知',kind:'rss',role:'port_notice',
  config:{feedUrl:`${MPA}feeds/media-releases`,summaryIsBody:false,allowUrlPrefixes:[`${MPA}media-centre/details/`],publishedAtUtcOffset:'+08:00'},
  title:'.news-header h3',body:'.news-detail__content',date:'.news-header__date',
  boundary:'Singapore port notices and circulars only; applicability to a vessel or its port call requires review. Bunker volumes and operational announcements are not fuel quotations.',
 },
} as const;
export type BusinessSourceId=keyof typeof BUSINESS_SOURCES;

/** A review-only definition, never a change to production sources or rights. */
export function businessSource(id:BusinessSourceId):SourceRow {
 const source=BUSINESS_SOURCES[id];
 return {id:`fishery-business-${id}`,name:source.name,kind:source.kind,config:structuredClone(source.config),tier:'T1',participation_mode:'isolated',first_party:true,interval_minutes:360,enabled:false,cursor:null,fail_count:0};
}
const collapse=(text:string)=>text.replace(/\s+/g,' ').trim();
const documentLink=/\.(?:pdf|docx?|xlsx?|zip)(?:$|[?#])/i;
function safeUrl(value:string,prefix:string){
 try{const u=new URL(value);return u.href.startsWith(prefix)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}
}
function articleUrl(id:BusinessSourceId,value:string){
 const prefix=BUSINESS_SOURCES[id].config.allowUrlPrefixes[0];
 return safeUrl(value,prefix)&&new URL(value).pathname.length>new URL(prefix).pathname.length;
}
function readArchive(input:unknown,raw:Buffer,expected:string):ArchiveReceipt {
 const receipt=archiveReceiptSchema.parse(input);
 if(receipt.status!==200||receipt.requestedUrl!==expected||receipt.finalUrl!==expected||raw.length===0||raw.length>6*1024*1024||receipt.sha256!==sha256(raw))throw new Error('Business source requires exact HTTP 200 URL and matching bounded original bytes');
 return receipt;
}
function publicationDay(id:BusinessSourceId,literal:string):string|null {
 if(id==='fao-tuna'){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(literal);
  return m?readPublicationDate(`${m[3]}-${m[2]}-${m[1]}`,'+00:00').publicationTime:null;
 }
 const normalized=literal.replace(/^Published\s+/i,'');
 return readPublicationDate(normalized,id==='mpa-port'?'+08:00':'+00:00').publicationTime;
}

/** Static lists only; use the existing fetchRss + restrictMpaListing for MPA. */
export function discoverBusinessHtml(id:Exclude<BusinessSourceId,'mpa-port'>,input:unknown,raw:Buffer):Candidate[] {
 const source=businessSource(id),url=String(source.config.url);readArchive(input,raw,url);
 const html=new TextDecoder('utf-8',{fatal:true}).decode(raw),$=cheerio.load(html);
 const items=fromHtml(html,url,source).filter(item=>articleUrl(id,item.url));
 if(!items.length)throw new Error('No business news matched the inspected listing');
 if(id==='fao-tuna')for(const item of items){
  const cards=$('.d-list-content').toArray().filter(el=>$(el).find('h5 a').first().attr('href')===item.url);
  const dates=cards.map(el=>publicationDay(id,collapse($(el).find('h6.date').text())));
  if(dates.length!==1||!dates[0])throw new Error('FAO listing date missing, duplicate or invalid; no URL/capture-date fallback');
  item.publicationTime=dates[0];item.publishedAt=readPublicationDate(dates[0],'+00:00').publishedAt;
 }
 return items;
}

/** Preserve native RSS identity/date handling. A feed description is never the notice body. */
export function restrictMpaListing(items:Candidate[]):Candidate[] {
 return items.filter(item=>articleUrl('mpa-port',item.url)&&/^(?:PORT MARINE (?:NOTICE|CIRCULAR)|SHIPPING CIRCULAR)\b/i.test(item.title)).map(item=>({...item,bodyHtml:null,bodyText:null,bodyStatus:'pending'}));
}
export interface BusinessAttachment {receipt:unknown;bytes:Buffer;parsed:PdfText}
export interface BusinessPrepared {
 schemaVersion:'fishery-business-preview/1';source:BusinessSourceId;url:string;identityKey:string;
 readyForReview:boolean;readyForImport:false;title:string|null;publicationLiteral:string|null;publicationTime:string|null;
 body:string|null;bodySha256:string|null;versionHash:string|null;evidenceHash:string|null;receipt:ArchiveReceipt;
 sections:EvidenceSection[];links:{url:string;label:string;role:'required_attachment'|'reference'}[];
 attachmentReceipts:ArchiveReceipt[];issues:string[];
}

/** Reads archived bytes; no network, model, database, source registration or approval. */
export function prepareBusinessArticle(id:BusinessSourceId,candidate:Candidate,input:unknown,raw:Buffer,files:BusinessAttachment[]=[]):BusinessPrepared {
 if(!articleUrl(id,candidate.url))throw new Error('Unexpected business article identity');
 const identityKey=identityKeyForUrl(candidate.url);if(!identityKey)throw new Error('Business article lacks a valid native identity');
 const receipt=readArchive(input,raw,candidate.url),source=BUSINESS_SOURCES[id];
 const $=cheerio.load(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const titleNodes=$(source.title),dateNodes=$(source.date),contentNodes=$(source.body),issues:string[]=[];
 const title=titleNodes.length===1?collapse(titleNodes.text()):null;
 const literal=dateNodes.length===1?collapse(dateNodes.text()):null;
 const day=literal?publicationDay(id,literal):null;
 if(!title||title!==collapse(candidate.title))issues.push('Unique article title must match its discovered listing title');
 if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))issues.push('Verified publication day missing; capture/update/event dates are not substitutes');
 const machineDate=dateNodes.attr('datetime');
 if(id==='itf-fisheries'&&machineDate&&readPublicationDate(machineDate,'+00:00').publicationTime?.slice(0,10)!==day)issues.push('ITF visible and machine dates disagree');
 const listed=candidate.publicationTime;
 // RSS carries a UTC timestamp; compare its Singapore calendar day, retaining page day precision.
 const listedDay=listed&&/^\d{4}-\d{2}-\d{2}$/.test(listed)?listed:listed&&id==='mpa-port'&&Number.isFinite(Date.parse(listed))?new Date(Date.parse(listed)+8*3600000).toISOString().slice(0,10):null;
 if(!listedDay||listedDay!==day)issues.push('Listing and article publication days disagree or are unverified');
 if(contentNodes.length!==1)issues.push('Unique complete article body container required');
 const content=contentNodes.clone();content.find('script,style,iframe,form,noscript').remove();
 // MPA's inspected article container also contains category navigation beside the PDF wrapper.
 if(id==='mpa-port')content.find('.news-detail__tags').remove();
 const links:BusinessPrepared['links']=[];
 for(const element of content.find('a[href]').toArray()){
  const href=$(element).attr('href')!;let url:URL;
  try{url=new URL(href,candidate.url);}catch{issues.push('Invalid article reference URL');continue;}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)continue;
  if(!documentLink.test(url.href)&&id!=='mpa-port')continue;
  const role=id==='mpa-port'?'required_attachment':'reference';
  if(role==='required_attachment'&&(!safeUrl(url.href,`${MPA}api/media/`)||!url.pathname.endsWith('.pdf')))issues.push('Unverified MPA attachment URL or format');
  if(!links.some(link=>link.url===url.href))links.push({url:url.href,label:collapse($(element).text()).slice(0,500),role});
 }
 content.find('td,th').append('\t');content.find('p,br,div,li,tr,h1,h2,h3,h4,table').append('\n');
 let body=content.text().split(/\n+/).map(collapse).filter(Boolean).join('\n');
 if(!body||id!=='mpa-port'&&body.length<100)issues.push('Full article body missing; listing/metadata excerpts are not substitutes');
 const sections:EvidenceSection[]=[{id:'webpage',kind:'webpage',sourceUrl:candidate.url,rawSha256:receipt.sha256,textSha256:sha256(body),start:0,end:body.length}];
 const required=links.filter(link=>link.role==='required_attachment'),attachmentReceipts:ArchiveReceipt[]=[];
 if(id==='mpa-port'&&(required.length<1||required.length>3))issues.push('MPA notice requires one to three complete PDF attachments');
 if(files.length!==required.length)issues.push('Every required attachment must be provided exactly once; no extras');
 for(const [index,link] of required.entries()){
  const file=files[index];if(!file)continue;
  const ar=archiveReceiptSchema.parse(file.receipt),pdf=file.parsed;attachmentReceipts.push(ar);
  if(ar.status!==200||ar.requestedUrl!==link.url||ar.finalUrl!==link.url||sha256(file.bytes)!==ar.sha256||pdf.rawSha256!==ar.sha256||file.bytes.length>10*1024*1024||!file.bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||pdf.status!=='parsed'||!pdf.text.trim()||pdf.textEvidence&&pdf.textEvidence.textSha256!==sha256(pdf.text)){
   issues.push('Required PDF URL, original hash or complete text is unverified');continue;
  }
  try{if(pdfTextlessPages(pdf.text,pdf.pages).length)throw new Error('Unreviewed textless PDF page');}catch(error){issues.push((error as Error).message);continue;}
  const number=/(PORT MARINE (?:NOTICE|CIRCULAR)|SHIPPING CIRCULAR)\s+NO\.?\s*(\d+)\s+OF\s+(\d{4})/i.exec(title??'');
  const header=/(PORT MARINE (?:NOTICE|CIRCULAR)|SHIPPING CIRCULAR)\s+NO\.?\s*(\d+)\s+OF\s+(\d{4})/i.exec(collapse(pdf.text));
  if(index===0&&(!number||!header||number[1]!.toUpperCase()!==header[1]!.toUpperCase()||Number(number[2])!==Number(header[2])||number[3]!==header[3]))issues.push('MPA first PDF notice number/year must match the landing page');
  body+=`\n\n附件：${link.label}\n原件：${link.url}\n`;const start=body.length;body+=pdf.text;
  const markers=[...pdf.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  sections.push({id:`attachment-${index+1}`,kind:'pdf',sourceUrl:link.url,rawSha256:ar.sha256,textSha256:sha256(pdf.text),start,end:body.length,label:link.label,pages:markers.map((m,i)=>({page:i+1,start:start+m.index!+m[0].length,end:start+(markers[i+1]?.index??pdf.text.length)}))});
 }
 if(body.length>64000)issues.push('Complete body exceeds evidence capacity; no truncation');
 if(!issues.length)try{buildEvidenceCatalog({body,bodySha256:sha256(body),sections,observationRevision:1});}catch(error){issues.push((error as Error).message);}
 const readyForReview=issues.length===0,bodySha256=readyForReview?sha256(body):null;
 // Real revisits changed ITF/MPA page chrome with identical article text and dates. Record new
 // originals separately: unchanged content must retain its already-bound observation/review,
 // not silently replace its raw evidence. Same-URL PDF byte changes remain content revisions.
 const versionHash=readyForReview?sha256(stableJson({source:id,url:candidate.url,title,publicationTime:day,bodySha256,links,attachments:attachmentReceipts.map(a=>({url:a.finalUrl,sha256:a.sha256}))})):null;
 const evidenceHash=readyForReview?sha256(stableJson({versionHash,sections})):null;
 return {schemaVersion:'fishery-business-preview/1',source:id,url:candidate.url,identityKey,readyForReview,readyForImport:false,title,publicationLiteral:literal,publicationTime:day,body:readyForReview?body:null,bodySha256,versionHash,evidenceHash,receipt,sections:readyForReview?sections:[],links,attachmentReceipts,issues};
}

/** A failed revisit must not replace a successful version or advance a success cursor. */
export function businessRevision(previous:BusinessPrepared|null,current:BusinessPrepared):'new'|'unchanged'|'revised'|'blocked' {
 if(previous&&(previous.source!==current.source||previous.identityKey!==current.identityKey))throw new Error('Cannot compare different business article identities');
 if(!current.readyForReview||!current.versionHash)return 'blocked';
 if(!previous?.readyForReview||!previous.versionHash)return 'new';
 return previous.versionHash===current.versionHash?'unchanged':'revised';
}
