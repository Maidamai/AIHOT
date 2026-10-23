// Formal capture bridge: exact archived listing, page and required attachments; no rights grant.
import {parseRss} from '@aihot/backend/sources/rss';
import {stableJson} from '@aihot/backend/lib/ids';
import {captureSchema,type businessContextSchema} from '../contracts.ts';
import type {z} from 'zod';
import {BUSINESS_SOURCES,businessSource,discoverBusinessHtml,restrictMpaListing,prepareBusinessArticle,type BusinessSourceId} from './business-sources.ts';
import {archiveReceiptSchema,sha256} from './source-adapters.ts';
import {buildEvidenceCatalog} from './evidence.ts';
export type {BusinessSourceId} from './business-sources.ts';
export const isBusinessSource=(id:string):id is BusinessSourceId=>Object.hasOwn(BUSINESS_SOURCES,id);
const hashes={'itf-fisheries':'8e8cb58d810473a52cce903be5ffb73d948eef981bbd101cffbf8dc2c02fcf4e','fao-tuna':'4813213a20ec84cce0d745b196d12cfc0f68988d591b5dd4ead1c61f16cec8a9'};
export function assertBusinessRobots(id:BusinessSourceId,input:unknown,raw:Buffer){
 const r=archiveReceiptSchema.parse(input),url=new URL('/robots.txt',BUSINESS_SOURCES[id].config.allowUrlPrefixes[0]).href;
 // Inspected ITF/FAO policies permit only these adapter paths. MPA has a true missing
 // robots page (404); deny 403/429/5xx, redirects and every uninspected policy change.
 if(r.requestedUrl!==url||r.finalUrl!==url||r.sha256!==sha256(raw)||
   (id==='mpa-port'?r.status!==404:r.status!==200||r.sha256!==hashes[id]))throw new Error('Business robots changed or unavailable; inspect before acquisition');
}
export function discoverBusinessListing(id:BusinessSourceId,input:unknown,raw:Buffer){
 const source=businessSource(id),url=String(source.config.url??source.config.feedUrl),r=archiveReceiptSchema.parse(input);
 if(r.status!==200||r.requestedUrl!==url||r.finalUrl!==url||r.sha256!==sha256(raw))throw new Error('Exact business listing archive required');
 const all=id==='mpa-port'?parseRss(source,new TextDecoder('utf-8',{fatal:true}).decode(raw),url):discoverBusinessHtml(id,input,raw);
 const native=id==='mpa-port'?restrictMpaListing(all):all;
 const seen=new Set<string>();
 if(native.some(c=>seen.has(c.url)||!seen.add(c.url)))throw new Error('Duplicate business listing identity');
 return {native,listed:all.length,rejected:all.length-native.length,candidates:native.map(c=>({url:c.url,title:c.title,listDate:c.publicationTime?(id==='mpa-port'&&c.publicationTime.length>10?new Date(Date.parse(c.publicationTime)+8*3600000).toISOString().slice(0,10):c.publicationTime.slice(0,10)):null,priority:'context' as const}))};
}
export function businessAttachments(...args:Parameters<typeof prepareBusinessArticle>){
 const p=prepareBusinessArticle(...args),links=p.links.filter(l=>l.role==='required_attachment');
 if(links.length>3)throw new Error('Business required attachments exceed bounded capacity');
 if(links.some(l=>!l.url.startsWith('https://www.mpa.gov.sg/api/media/')||!l.url.endsWith('.pdf')||new URL(l.url).search||new URL(l.url).hash))throw new Error('Unverified business attachment path');
 return links;
}
export function prepareBusinessCapture(id:BusinessSourceId,...args:Tail<Parameters<typeof prepareBusinessArticle>>){
 const p=prepareBusinessArticle(id,...args),unknown=()=>({precision:'unknown' as const,value:null});
 const sourceCapture=captureSchema.parse({adapter:id,acquisitionMode:'live_capture',sourceUrl:p.url,capturedAt:p.receipt.finishedAt,httpStatus:p.receipt.status,rawSha256:p.receipt.sha256,
  bodySha256:p.bodySha256,parser:'business-capture/v1',parseStatus:p.readyForReview?'parsed':'unverified',attachmentSha256:null,publicationLiteral:p.publicationLiteral,conflicts:[],
  businessContext:{version:'business-capture/v1',versionHash:p.versionHash,evidenceHash:p.evidenceHash,pageTextSha256:p.pageTextSha256,links:p.links,
   attachments:p.attachmentReceipts.map(a=>({url:a.finalUrl,sha256:a.sha256,httpStatus:a.status})),sections:p.sections}});
 return {title:p.title,body:p.body,dates:{published:p.publicationTime?{precision:'day' as const,value:p.publicationTime}:unknown(),event:unknown(),adopted:unknown(),effectiveFrom:unknown(),effectiveUntil:unknown()},
  sourceCapture,evidence:[{url:p.url,sha256:p.receipt.sha256,page:null as number|null,section:'Business source body; applicability and reuse rights unreviewed'}],readyForReview:p.readyForReview,warnings:[BUSINESS_SOURCES[id].boundary,...p.issues]};
}
type Tail<T extends unknown[]>=T extends [unknown,...infer R]?R:never;
type Capture={adapter?:string;businessContext?:z.infer<typeof businessContextSchema>;bodySha256?:string|null};
export function businessEvidenceSections(body:string,capture:Capture){
 const c=capture.businessContext;if(!c)return undefined;
 if(!capture.adapter||!isBusinessSource(capture.adapter)||!c.versionHash||!c.evidenceHash||!capture.bodySha256||sha256(stableJson({versionHash:c.versionHash,sections:c.sections}))!==c.evidenceHash)throw new Error('Business source section binding changed');
 buildEvidenceCatalog({body,bodySha256:capture.bodySha256,sections:c.sections,observationRevision:1});return c.sections;
}
export function businessDependencyChanged(old:Capture|undefined,current:Capture|undefined){
 const a=old?.businessContext,b=current?.businessContext;
 if(!a||!b||old?.adapter!==current?.adapter)return false;
 if(a.pageTextSha256!==b.pageTextSha256||stableJson(a.links)!==stableJson(b.links))return true;
 return b.attachments.some(file=>file.httpStatus===200&&a.attachments.some(previous=>previous.url===file.url&&previous.sha256!==file.sha256));
}
