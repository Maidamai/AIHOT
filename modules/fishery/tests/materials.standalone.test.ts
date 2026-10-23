import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareOfficial, sha256, type ArchiveReceipt } from "../backend/source-adapters.ts";
import { assertCaptureExportable } from "../backend/export.ts";
import { canExportSummary, dateSchema, effectiveState, linkSchema, observationSchema, sourceSchema } from "../contracts.ts";
import { observationFixture, sourceFixture, unknownDate,npfcRobotsFixture,pdfFixture } from "./fixtures.ts";
import { extractPdf,mapPdfFootnotes } from "../backend/pdf-text.ts";
import { readFile, access, chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COLUMNS, discoverColumn, prepareColumnArticle, relevanceEvidence } from "../backend/official-columns.ts";
import { batchRoot, collectColumns, listBatches, readBatch, readCapturedText, verifyBatchItem } from "../backend/column-batches.ts";
import { importBatch } from "../backend/import-batch.ts";
import { config } from "@aihot/backend/config";
import { evidenceIdentity } from "../backend/store.ts";
import { buildFisheryDraftRequest, fisheryDraftSchema, prepareFisheryDraft, validateFisheryDraft, fisheryDraftWireSchema,parseFisheryManualRevision } from "../backend/ai-draft.ts";
import { TRIAL, installTrialTransport, trialCapacity, trialUsage,validateTrialWire } from "../backend/trial-transport.ts";
import {runFisherySelection,newSelection} from '../backend/selection.ts';
import {discoverNpfc,npfcAttachment,prepareNpfc,assertNpfcRobots} from '../backend/npfc-columns.ts';
import type { ColumnFetcher } from '../backend/column-batches.ts';
import {noticeFixture} from './fixtures.ts';
import {noticePage,noticeClassification,prepareNotice,noticeAttachmentChanged,noticeEvidenceSections} from '../backend/fujian-notices.ts';
import {noticeDeadlineState} from '../contracts.ts';

test('Fujian notices retain actual container text without an editor class and across sibling blocks',()=>{
 const url='https://hyyyj.fujian.gov.cn/xxgk/tzgg/202610/t20261021_9999008.htm';
 const facts=['这是隔离样本，船员业务通知正文直接写在文章容器中，不能只依赖编辑器类名。','完整申请条件和办理截止日期位于后续段落，采集不得遗漏。'];
 for(const markup of [facts.map(s=>`<p>${s}</p>`).join(''),`<div class="TRS_Editor"><p>${facts[0]}</p></div><p>${facts[1]}</p>`]){
  const raw=Buffer.from(`<meta name="ArticleTitle" content="合成业务通知"><meta name="PubDate" content="2026-10-21 16:42"><div id="detailCont">${markup}<script>discard()</script></div><footer>无关导航</footer>`);
  const p=prepareNotice({requestedUrl:url,finalUrl:url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T12:00:00Z'},raw);
  assert.equal(p.readyForReview,true);assert.equal(p.body,facts.join('\n'));assert.equal(p.sourceCapture.publishedAt,'2026-10-21T08:42:00.000Z');
  assert.equal(noticeEvidenceSections(p.body!,p.sourceCapture)[0].end,p.body!.length);
  assert.throws(()=>noticeEvidenceSections(p.body!,{...p.sourceCapture,parser:'official-column/fujian-notices/v2'}),/recapture/);
 }
});
test('Fujian notices bind complete required attachments, real formats, page spans and archived revalidation',async()=>{
 const f=noticeFixture(),dir=await mkdtemp(path.join(tmpdir(),'notice-archive-'));
 const fetch:ColumnFetcher=async url=>({url,status:url.endsWith('robots.txt')?404:200,headers:{get:()=>null},body:url.endsWith('robots.txt')?Buffer.from('missing'):url.endsWith('/tzgg/')?Buffer.from(f.listing):url===f.url?Buffer.from(f.landing()):f.pdf});
 try{
  const b=await collectColumns({id:'notice-complete',dataDir:dir,columns:['fujian-notices'],limit:1,wait:async()=>{},fetch,parsePdf:f.parsePdf});
  assert.equal(b.items[0].state,'ready',b.items[0].error??'');const p=await verifyBatchItem(dir,b,b.items[0],{parsePdf:f.parsePdf});
  assert.equal(p.dates.published.value,'2025-07-29','PubDate is used, never URL date');
  assert.equal(p.sourceCapture.publishedAt,'2025-07-29T02:20:00.000Z');
  const a=p.sourceCapture.noticeContext!.attachments[0];assert.equal(p.body!.slice(a.bodyStart!,a.bodyEnd!),f.text);assert.equal(a.textSha256,sha256(f.text));assert.equal(a.pages,2);
  const old=prepareColumnArticle('fujian',{requestedUrl:COLUMNS.fujian.url+'202507/t20250728_9999001.htm',finalUrl:COLUMNS.fujian.url+'202507/t20250728_9999001.htm',status:200,finishedAt:new Date().toISOString(),sha256:sha256(Buffer.from(f.landing()))},Buffer.from(f.landing()));assert.equal(old.readyForReview,false,'A landing title is insufficient');
  const first=p.sourceCapture.noticeContext!,missing={...first,attachments:first.attachments.map(a=>({...a,httpStatus:404,sha256:sha256('404')}))};assert.equal(noticeAttachmentChanged(first,missing),false);
  assert.equal(noticeAttachmentChanged(first,{...first,attachments:first.attachments.map(a=>({...a,sha256:sha256('changed')}))}),true);
  await writeFile(path.join(batchRoot(dir),b.id,'raw',`${b.items[0].archiveId}-attachment-0.bin`),'tampered');
  await assert.rejects(verifyBatchItem(dir,b,b.items[0],{parsePdf:f.parsePdf}),/hash mismatch/);
  let sends=0;const absent=await collectColumns({id:'notice-absent',dataDir:dir,columns:['fujian-notices'],noticeSelect:[f.url.replace('9999001','9999002')],limit:1,wait:async()=>{},fetch:async(...args)=>{sends++;return fetch(...args);}});assert.equal(sends,2);assert.equal(absent.items.length,0);assert.match(absent.sources[0].error!,/absent/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Fujian notices fail closed on unsupported, scanned, missing, spoofed and incomplete attachments',async()=>{
 const f=noticeFixture(),raw=Buffer.from(f.landing()),receipt={requestedUrl:f.url,finalUrl:f.url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'},pr={...receipt,requestedUrl:f.pdfUrl,finalUrl:f.pdfUrl,sha256:sha256(f.pdf)},parsed=await f.parsePdf(f.pdf);
 for(const file of [undefined,{receipt:pr,bytes:f.pdf,parsed:{...parsed,status:'unverified' as const,text:'',pages:0,error:'No text; no automatic OCR'}},{receipt:{...pr,status:404},bytes:f.pdf,parsed},{receipt:pr,bytes:f.pdf,parsed:{...parsed,text:'--- Page 1 ---\nOnly first page'}},{receipt:{...pr,sha256:sha256('<html>blocked</html>')},bytes:Buffer.from('<html>blocked</html>'),parsed}]){
  const p=prepareNotice(receipt,raw,file?[file]:[]);assert.equal(p.readyForReview,false);assert.equal(p.body,null);assert.equal(p.sourceCapture.parseStatus,'unverified');
 }
 const xurl=f.pdfUrl.replace('.pdf','.xlsx'),xraw=Buffer.from(f.landing(xurl)),xbytes=Buffer.from([80,75,3,4,1,2]);
 const x=prepareNotice({...receipt,sha256:sha256(xraw)},xraw,[{receipt:{...pr,requestedUrl:xurl,finalUrl:xurl,sha256:sha256(xbytes)},bytes:xbytes}]);
 assert.equal(x.sourceCapture.noticeContext!.attachments[0].format,'office_zip');assert.equal(x.body,null);
 const neutral=prepareNotice(receipt,raw,[{receipt:pr,bytes:f.pdf,parsed:{...parsed,pages:1,text:'--- Page 1 ---\n普通近岸养殖技术安排。'}}]);
 assert.equal(neutral.readyForReview,true,'Complete body is a candidate, not approval');assert.equal(neutral.relevance.decision,'not_proven');
 const mixed=prepareNotice(receipt,raw,[{receipt:pr,bytes:f.pdf,parsed:{...parsed,text:'--- Page 1 ---\n远洋渔业正文\n--- Page 2 ---\n'}}]);assert.equal(mixed.body,null,'Textless pages cannot silently stand for scanned pages');assert.match(mixed.warnings.join(';'),/textless/);
 const n=neutral.sourceCapture.noticeContext!;assert.equal(noticeAttachmentChanged(n,{...n,pageTextSha256:sha256('changed actual landing body'),attachments:n.attachments.map(a=>({...a,httpStatus:404,sha256:sha256('404')}))}),true,'Verified 200 page-body changes invalidate old evidence independently of attachment unavailability');
 assert.throws(()=>noticePage(Buffer.from(f.landing('https://example.org/P0202507289.pdf')),f.url),/origin/);
 const body=Buffer.from(`<meta name="ArticleTitle" content="远洋公示"><div id="detailCont"><div class="TRS_Editor"><table><tr><td>远洋项目</td><td>${'合成完整资料。'.repeat(10)}</td></tr></table></div></div>`);
 const table=prepareNotice({...receipt,sha256:sha256(body)},body);assert.equal(table.readyForReview,true);assert.match(table.body!,/远洋项目 合成完整/);
});
test('Fujian notice dates separate ended publicity, application, consultation, allocation and unknown validity',()=>{
 const publicity=noticeClassification('资金项目名单公示','公示时间2025年11月25日至2025年11月27日（3个工作日）。');assert.equal(publicity.nature,'publicity');assert.equal(publicity.deadline.value,'2025-11-27');
 const context={...publicity,pageTextSha256:sha256(''),attachmentCount:0,attachments:[]};
 assert.equal(noticeDeadlineState(context,'2026-10-23'),'closed');assert.equal(noticeDeadlineState(context,'2025-11-27'),'deadline_today');assert.equal(noticeDeadlineState(context,'2025-11-26'),'future_deadline');
 assert.equal(noticeClassification('申报通知','申报企业应于2026年1月27日前提交。').deadline.value,'2026-01-27');
 assert.equal(noticeClassification('申报通知','申报企业应于1月27日前提交。').deadline.precision,'unknown');
 assert.equal(noticeClassification('名单公示','公示时间2025年11月25日至11月27日。').deadline.precision,'unknown','Abbreviated range end must not become its complete start date');
 assert.equal(noticeClassification('下达渔业资金通知','2026年1月27日前提交。').nature,'funding_allocation');
 assert.equal(noticeClassification('征求意见通知','意见反馈截止2026年1月27日。').nature,'consultation');
 assert.equal(noticeClassification('政策明白纸','有效期至2026年1月27日。').validity,'unknown');
});

function npfcCacheFixture() {
 const url='https://www.npfc.int/cmm-2026-01-cache-test',pdfUrl='https://www.npfc.int/system/files/2026-04/cache-test.pdf',title='CMM 2026-01 Synthetic cache test';
 const listing=Buffer.from(`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`);
 const landing=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdfUrl}">Complete PDF</a></span></div></div>`);
 const pdf=Buffer.from('%PDF-synthetic-cache-protocol-only'),modified='Wed, 21 Oct 2026 12:00:00 GMT';
 const parsePdf=async(bytes:Buffer)=>({status:'parsed' as const,rawSha256:sha256(bytes),parser:'synthetic-cache/v1',pages:1,text:`--- Page 1 ---\nCMM 2026-01\nSynthetic complete material ${sha256(bytes)}`});
 const fetch=(pdfFetch:ColumnFetcher):ColumnFetcher=>async(input,options)=>input===pdfUrl?pdfFetch(input,options):{url:input,status:200,body:input.endsWith('/robots.txt')?npfcRobotsFixture:input===COLUMNS.npfc.url?listing:landing,headers:{get:()=>null}};
 const response=(status=200,body=pdf,etag:string|null='"synthetic-v1"',finalUrl=pdfUrl)=>({url:finalUrl,status,body,headers:{get:(name:string)=>name==='etag'?etag:name==='last-modified'?modified:name==='content-type'?'application/pdf':null}});
 return {url,pdfUrl,pdf,modified,parsePdf,fetch,response};
}

test('NPFC conditional PDFs freeze original 200 evidence and verify 304 without mutable cache or origin files',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-')),f=npfcCacheFixture();
 const run=(id:string,pdfFetch:ColumnFetcher)=>collectColumns({id,dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,fetch:f.fetch(pdfFetch)});
 try {
  let calls=0;const first=await run('cache-original',async(input,options)=>{calls++;assert.deepEqual(options?.headers,{});return f.response();});
  assert.equal(first.items[0].state,'ready',JSON.stringify(first.items));
  const second=await run('cache-revalidated',async(input,options)=>{calls++;assert.deepEqual(options?.headers,{'if-none-match':'"synthetic-v1"','if-modified-since':f.modified});return f.response(304,Buffer.alloc(0));});
  assert.equal(calls,2);assert.equal(second.items[0].state,'ready',JSON.stringify(second.items));
  const original=first.items[0].prepared!.sourceCapture,current=second.items[0].prepared!.sourceCapture;
  assert.equal(current.attachmentCapturedAt,original.attachmentCapturedAt);
  assert.equal(current.attachmentHttpStatus,200);assert.equal(current.attachmentSha256,original.attachmentSha256);
  assert.equal(evidenceIdentity({...observationFixture,rawSha256:original.rawSha256,sourceCapture:original}),evidenceIdentity({...observationFixture,rawSha256:current.rawSha256,sourceCapture:current}),'A 304 adds no stable version fields');
  const rawDir=path.join(batchRoot(dataDir),second.id,'raw'),prefix=path.join(rawDir,second.items[0].archiveId+'-pdf');
  assert.equal(JSON.parse(await readFile(prefix+'-response.receipt.json','utf8')).status,304);
  assert.equal(JSON.parse(await readFile(prefix+'.receipt.json','utf8')).finishedAt,original.attachmentCapturedAt);
  await rm(path.join(dataDir,'fishery-npfc-pdf-cache'),{recursive:true});await rm(path.join(batchRoot(dataDir),first.id),{recursive:true});
  assert.equal((await verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf})).readyForReview,true);
  const proof=await readFile(prefix+'-revalidation.json'),value=JSON.parse(proof.toString());value.requestHeaders['if-none-match']='"tampered"';await writeFile(prefix+'-revalidation.json',JSON.stringify(value));
  await assert.rejects(verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf}),/binding mismatch/);
  await writeFile(prefix+'-revalidation.json',proof);
  const origin=await readFile(prefix+'-origin-manifest.json');await writeFile(prefix+'-origin-manifest.json',Buffer.concat([origin,Buffer.from(' ')]));
  await assert.rejects(verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf}),/origin manifest hash/);await writeFile(prefix+'-origin-manifest.json',origin);
  const responseBytes=await readFile(prefix+'-response.receipt.json'),response=JSON.parse(responseBytes.toString());response.startedAt='2000-01-01T00:00:00.000Z';await writeFile(prefix+'-response.receipt.json',JSON.stringify(response));
  await assert.rejects(verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf}),/304 response evidence/);
  await writeFile(prefix+'-response.receipt.json',responseBytes);response.startedAt=JSON.parse(responseBytes.toString()).startedAt;response.requestHeaders={};await writeFile(prefix+'-response.receipt.json',JSON.stringify(response));
  await assert.rejects(verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf}),/304 response evidence/);
  await rm(prefix+'-revalidation.json');await assert.rejects(verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf}),/marker missing/);
 } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('NPFC PDFs without validators always GET fully, Last-Modified alone supports 304, and failed parsing publishes no cache',async()=>{
 for(const mode of ['none','last-modified','parse-failed'] as const){
  const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-validators-')),f=npfcCacheFixture();let calls=0;
  const fetch=f.fetch(async(input,options)=>{calls++;if(calls===2)assert.deepEqual(options?.headers,mode==='last-modified'?{'if-modified-since':f.modified}:{});const result=f.response(calls===2?304:200,calls===2?Buffer.alloc(0):f.pdf,null);if(mode==='none')result.headers={get:()=>null};return calls===3?f.response():result;});
  const run=(id:string)=>collectColumns({id,dataDir,columns:['npfc'],limit:1,wait:async()=>{},fetch,parsePdf:mode==='parse-failed'?async bytes=>({...await f.parsePdf(bytes),status:'failed' as const,error:'Synthetic parser failure'}):f.parsePdf});
  try {
   const first=await run('validator-first');
   if(mode==='parse-failed'){assert.equal(first.items[0].state,'failed');await assert.rejects(access(path.join(dataDir,'fishery-npfc-pdf-cache')),/ENOENT/);continue;}
   const second=await run('validator-second');assert.equal(second.items[0].state,'ready');assert.equal(calls,mode==='none'?3:2);
   assert.equal((await verifyBatchItem(dataDir,second,second.items[0],{parsePdf:f.parsePdf})).readyForReview,true);
  } finally {await rm(dataDir,{recursive:true,force:true});}
 }
});

test('NPFC cache publication I/O failure retains the ready archive and a diagnostic',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-optional-')),f=npfcCacheFixture();
 try {
  const batch=await collectColumns({id:'cache-optional-io',dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,fetch:f.fetch(async()=>{
   await mkdir(path.join(dataDir,'fishery-npfc-pdf-cache',sha256(f.pdfUrl)+'.json'),{recursive:true});return f.response();
  })});
  assert.equal(batch.status,'complete');assert.equal(batch.items[0].state,'ready');
  assert.match(await readFile(path.join(batchRoot(dataDir),batch.id,'raw',batch.items[0].archiveId+'-pdf-cache-publish-rejected.json'),'utf8'),/EISDIR|ENOTEMPTY/);
  assert.equal((await verifyBatchItem(dataDir,batch,batch.items[0],{parsePdf:f.parsePdf})).readyForReview,true);
 } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('NPFC untrusted 304 uses at most one unconditional retry and never creates a fake successful body',async()=>{
 for(const fallback of ['200','304','redirect','damaged'] as const){
  const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-fallback-')),f=npfcCacheFixture();let calls=0;
  try {
   const batch=await collectColumns({id:'untrusted-'+fallback,dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,fetch:f.fetch(async(input,options)=>{
    calls++;assert.ok(!options?.headers||Object.keys(options.headers).length===0);
    return calls===1?f.response(304,Buffer.alloc(0)):fallback==='200'?f.response():fallback==='304'?f.response(304,Buffer.alloc(0)):fallback==='redirect'?f.response(200,f.pdf,'"synthetic-v1"','https://www.npfc.int/system/files/other.pdf'):f.response(200,Buffer.from('not a PDF'));
   })});
   assert.equal(calls,2);assert.equal(batch.items[0].state,fallback==='200'?'ready':'failed');
   const root=path.join(batchRoot(dataDir),batch.id,'raw'),name=batch.items[0].archiveId+'-pdf';
   assert.equal(JSON.parse(await readFile(path.join(root,name+'-response.receipt.json'),'utf8')).status,304);
   if(fallback!=='200'){await assert.rejects(access(path.join(root,name+'.bin')),/ENOENT/);await assert.rejects(access(path.join(dataDir,'fishery-npfc-pdf-cache')),/ENOENT/);}
  } finally {await rm(dataDir,{recursive:true,force:true});}
 }
});

test('NPFC damaged caches remain evidence, same-URL new bytes change identity, and source validators stay isolated',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-damage-')),f=npfcCacheFixture();
 const run=(id:string,pdfFetch:ColumnFetcher)=>collectColumns({id,dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,fetch:f.fetch(pdfFetch)});
 try {
  const original=await run('cache-damage-original',async()=>f.response());
  const indexFile=path.join(dataDir,'fishery-npfc-pdf-cache',sha256(f.pdfUrl)+'.json'),originalIndex=await readFile(indexFile);
  const pdfFile=path.join(batchRoot(dataDir),original.id,'raw',original.items[0].archiveId+'-pdf.bin');await writeFile(pdfFile,'preserved damaged bytes');
  let calls=0;const recovered=await run('cache-damage-fallback',async(input,options)=>{calls++;assert.ok(!options?.headers||Object.keys(options.headers).length===0);return calls===1?f.response(304,Buffer.alloc(0)):f.response();});
  assert.equal(calls,2);assert.equal(recovered.items[0].state,'ready');assert.equal(await readFile(pdfFile,'utf8'),'preserved damaged bytes');
  assert.match(await readFile(path.join(batchRoot(dataDir),recovered.id,'raw',recovered.items[0].archiveId+'-pdf-cache-rejected.json'),'utf8'),/Invalid NPFC cached PDF/);
  const changed=await run('cache-new-bytes',async(input,options)=>{assert.equal(options?.headers?.['if-none-match'],'"synthetic-v1"');return f.response(200,Buffer.from('%PDF-synthetic-updated'),'"synthetic-v2"');});
  assert.notEqual(changed.items[0].prepared!.sourceCapture.attachmentSha256,recovered.items[0].prepared!.sourceCapture.attachmentSha256);
  assert.notEqual(evidenceIdentity({...observationFixture,rawSha256:changed.items[0].prepared!.sourceCapture.rawSha256,sourceCapture:changed.items[0].prepared!.sourceCapture}),evidenceIdentity({...observationFixture,rawSha256:recovered.items[0].prepared!.sourceCapture.rawSha256,sourceCapture:recovered.items[0].prepared!.sourceCapture}));
  const wrong=JSON.parse(originalIndex.toString());wrong.url='https://iotc.org/other.pdf';await writeFile(indexFile,JSON.stringify(wrong));
  const isolated=await run('cache-source-isolated',async(input,options)=>{assert.deepEqual(options?.headers,{});return f.response();});assert.equal(isolated.items[0].state,'ready');
  const raw=path.join(batchRoot(dataDir),changed.id,'raw'),name=changed.items[0].archiveId+'-pdf';
  await rm(path.join(raw,name+'-response.receipt.json'));await rm(path.join(raw,name+'-response.bin'));
  assert.equal((await verifyBatchItem(dataDir,changed,changed.items[0],{parsePdf:f.parsePdf})).readyForReview,true,'Legacy batches with their actual in-period 200 need no sidecar');
  const old=JSON.parse(await readFile(path.join(raw,name+'.receipt.json'),'utf8'));old.finishedAt='2000-01-01T00:00:00.000Z';await writeFile(path.join(raw,name+'.receipt.json'),JSON.stringify(old));
  await assert.rejects(verifyBatchItem(dataDir,changed,changed.items[0],{parsePdf:f.parsePdf}),/outside batch acquisition/);
 } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('NPFC cached PDF reads and writes obey lost-lease and abort guards before cache publication',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-cache-guard-')),f=npfcCacheFixture();
 try {
  const original=await collectColumns({id:'cache-guard-original',dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,fetch:f.fetch(async()=>f.response())});
  const index=path.join(dataDir,'fishery-npfc-pdf-cache',sha256(f.pdfUrl)+'.json'),before=await readFile(index);
  let lost=false;await assert.rejects(collectColumns({id:'cache-guard-lost',dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,guard:async()=>{if(lost)throw new Error('Synthetic lost source lease');},fetch:f.fetch(async()=>{lost=true;return f.response(304,Buffer.alloc(0));})}),/lost source lease/);
  assert.deepEqual(await readFile(index),before);
  const root=path.join(batchRoot(dataDir),'cache-guard-lost','raw'),files=await readdir(root);assert.ok(!files.some(name=>name.includes('-pdf')),'A lease lost in GET prevents response and cache writes');
  const controller=new AbortController();controller.abort();let gets=0;
  await assert.rejects(collectColumns({id:'cache-aborted',dataDir,columns:['npfc'],limit:1,signal:controller.signal,fetch:async()=>{gets++;return f.response();}}),/abort/i);assert.equal(gets,0);
  await assert.rejects(access(path.join(batchRoot(dataDir),'cache-aborted')),/ENOENT/);
  await assert.rejects(collectColumns({id:'cache-publication-lost',dataDir,columns:['npfc'],limit:1,wait:async()=>{},parsePdf:f.parsePdf,guard:async()=>{
   if((await readdir(path.dirname(index))).some(name=>name.endsWith('.tmp')))throw new Error('Synthetic lost publication lease');
  },fetch:f.fetch(async()=>f.response())}),/lost publication lease/);
  assert.deepEqual(await readFile(index),before,'The cache I/O catch must never swallow a failed publication guard');
  assert.equal((await readBatch(dataDir,'cache-publication-lost')).status,'complete');
  assert.equal(original.items[0].state,'ready');
 } finally {await rm(dataDir,{recursive:true,force:true});}
});

test('NPFC measure discovery binds the visible version, not an older URL slug or an effective-date assumption',()=>{
 const title='CMM 2026-07 For Chub Mackerel (Effective date: 1 June 2026)',url='https://www.npfc.int/cmm-2025-07-chub-mackerel';
 const html=`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a><a href="${url}">${title}</a><a href="https://evil.example/cmm-2026-01-other">CMM 2026-01 Other</a><a href="/taxonomy/term/58">Most recent CMMs</a></td></tr></table></div></div>`;
 const discovered=discoverNpfc(html);assert.equal(discovered.listed,1);assert.equal(discovered.rejected,1);assert.equal(discovered.candidates[0].number,'2026-07');
 assert.throws(()=>discoverNpfc(html.replace(`>${title}</a><a href="${url}">${title}`,`>${title}</a><a href="${url}">${title.replace('2026-07','2025-07')}`)),/Conflicting/);
 assert.throws(()=>discoverNpfc(html.replace(`>${title}</a><a href="${url}">${title}`,`>${title}</a><a href="${url}">${title.replace('1 June','2 June')}`)),/Conflicting/);
 assert.deepEqual(discoverColumn('npfc',html),discovered);assert.equal(discoverColumnPagination('npfc',html).scope,'current_page_only');
 assert.throws(()=>discoverColumnPagination('npfc',html,'https://www.npfc.int/cmms-pdf?page=1'),/query/);
 const raw=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="/system/files/2026-04/current.pdf">Official PDF</a></span></div></div>`),pdf=Buffer.from('%PDF-synthetic-test-only');
 const text='--- Page 1 ---\nCMM 2026-07\n(Entered into force 1 June 2026)\nSynthetic Convention Area requirements, not real operational guidance.';
 const attachment={receipt:receipt(pdf,'https://www.npfc.int/system/files/2026-04/current.pdf'),bytes:pdf,parsed:{status:'parsed' as const,rawSha256:sha256(pdf),parser:'synthetic/v1',pages:1,text}};
 const candidate=discovered.candidates[0],result=prepareNpfc(candidate,receipt(raw,url),raw,attachment);
 assert.equal(result.readyForReview,true);assert.equal(result.body,text);assert.equal(result.sourceCapture.attachmentPages,1);assert.equal(result.sourceCapture.regulatoryListing?.measureNumber,'2026-07');
 assert.equal(result.policyContext.entryIntoForce,'unknown');assert.equal(result.dates.published.precision,'unknown');assert.equal(result.dates.effectiveFrom.precision,'unknown');assert.equal(result.sourceCapture.regulatoryListing?.applicableSea,'unknown');
 assert.equal(prepareNpfc(candidate,receipt(raw,url),raw).readyForReview,false);
 for(const altered of [text.replace('2026-07','2025-07'),text.replace('1 June','2 June')]){const bad=prepareNpfc(candidate,receipt(raw,url),raw,{...attachment,parsed:{...attachment.parsed,text:altered}});assert.equal(bad.body,null);assert.equal(bad.sourceCapture.parseStatus,'unverified');}
 const failed=prepareNpfc(candidate,receipt(raw,url),raw,{...attachment,parsed:{...attachment.parsed,status:'failed',error:'Synthetic full PDF parse failed'}});assert.equal(failed.readyForReview,false);assert.match(failed.warnings.join(';'),/parse failed/);
 for(const changed of [raw.toString().replace('current.pdf','current.pdf?download=1'),raw.toString().replace('href="/system','href="https://evil.example/system'),raw.toString().replace('</span>','<a href="/system/files/other.pdf">Other PDF</a></span>')]){
  if(changed===raw.toString())continue;assert.throws(()=>npfcAttachment(Buffer.from(changed),url),/unambiguous/);
 }
 const changedRobots=Buffer.from('User-agent: *\nDisallow: /\n');assert.throws(()=>assertNpfcRobots(receipt(changedRobots,'https://www.npfc.int/robots.txt'),changedRobots),/robots changed/);
 const observation=observationSchema.parse({...observationFixture,rawSha256:result.sourceCapture.rawSha256,sourceCapture:result.sourceCapture});assert.doesNotThrow(()=>assertCaptureExportable(observation));
 assert.throws(()=>assertCaptureExportable({...observation,sourceCapture:{...result.sourceCapture,attachmentPages:null}}),/PDF evidence/);
});

test('NPFC full-PDF batches reverify archived identities, preserve complete text and reject corrupted provenance',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'npfc-archive-test-')),url='https://www.npfc.int/cmm-2026-01-synthetic-test';
 const title='CMM 2026-01 Synthetic Test (Effective date: 23 July 2026)',pdfUrl='https://www.npfc.int/system/files/2026-04/test.pdf';
 const raw=pdfFixture(false,false,'CMM 2026-01 Synthetic test.');
 const listing=`<div class="region-content"><div class="view-document-list"><table><tr><td class="views-field-title"><a href="${url}">${title}</a></td></tr></table></div></div>`,landing=`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${pdfUrl}">Complete PDF</a></span></div></div>`;
 try{
  assert.doesNotThrow(()=>assertNpfcRobots(receipt(npfcRobotsFixture,'https://www.npfc.int/robots.txt'),npfcRobotsFixture));
  let gets=0;const batch=await collectColumns({id:'npfc-complete-fixture',dataDir,columns:['npfc'],limit:1,wait:async()=>{},fetch:async input=>{gets++;return {url:input,status:200,headers:{get:()=>input===pdfUrl?'application/pdf':'text/html'},body:input.endsWith('/robots.txt')?npfcRobotsFixture:input===COLUMNS.npfc.url?Buffer.from(listing):input===url?Buffer.from(landing):raw};}});
  assert.equal(gets,4);assert.equal(batch.items[0].state,'ready',JSON.stringify(batch.items));
  const item=batch.items[0],body=await readCapturedText(dataDir,item.archiveId,item.prepared!.sourceCapture.bodySha256!);
  const parsePdf=async(bytes:Buffer)=>({status:'parsed' as const,rawSha256:sha256(bytes),parser:'synthetic-reverify/v1',pages:1,text:body});
  const verified=await verifyBatchItem(dataDir,batch,item,{parsePdf});assert.equal(verified.readyForReview,true);assert.match(verified.body!,/Synthetic test/);assert.equal(verified.sourceCapture.attachmentPages,1);
  const again=await verifyBatchItem(dataDir,batch,item,{parsePdf});assert.equal(again.sourceCapture.bodySha256,verified.sourceCapture.bodySha256);assert.equal(gets,4,'archive verification performs no GET');
  let redirectedGets=0;const redirected=await collectColumns({id:'npfc-redirect-fixture',dataDir,columns:['npfc'],limit:1,wait:async()=>{},fetch:async input=>{redirectedGets++;return {url:input===COLUMNS.npfc.url?'https://www.npfc.int/other-measures':input,status:200,headers:{get:()=> 'text/html'},body:input.endsWith('/robots.txt')?npfcRobotsFixture:Buffer.from(listing)};}});
  assert.equal(redirectedGets,2);assert.equal(redirected.items.length,0);assert.match(redirected.sources[0].error!,/unexpected identity/);
  const file=path.join(batchRoot(dataDir),batch.id,'raw','npfc-list.bin');await writeFile(file,listing.replace('2026-01','2025-01'));
  await assert.rejects(verifyBatchItem(dataDir,batch,batch.items[0]),/raw hash mismatch/);
 }finally{await rm(dataDir,{recursive:true,force:true});}
});

test('selection and core event transport keep the output ceiling; missing usage retains full unknown reserve',async()=>{
 const request=(tokens:number)=>({method:'POST',body:JSON.stringify({model:TRIAL.model,messages:[{role:'system',content:'Synthetic prompt'},{role:'user',content:'Synthetic public test source'}],max_tokens:tokens,temperature:0,response_format:{type:'json_object'},thinking:{type:'disabled'}})});
 for(const tokens of [400,512,520,1024,1200,1600,2048])assert.doesNotThrow(()=>validateTrialWire(TRIAL.endpoint,request(tokens)));
 for(const tokens of [0,400.5,2049,64000])assert.throws(()=>validateTrialWire(TRIAL.endpoint,request(tokens)),/parameters refused/);
 assert.throws(()=>validateTrialWire('https://example.org/chat/completions',request(512)),/destination/);
 const entries:any[]=[];let sent=0;
 const restore=installTrialTransport({reserve:async()=>{trialCapacity(entries);entries.push({state:'pending',reservedMicroCny:TRIAL.reserveMicroCny});return 1;},settle:async(id,state,usage)=>{entries[id-1].state=state;entries[id-1].usage=usage;}},async()=>{sent++;return new Response(JSON.stringify({model:TRIAL.model,choices:[]}),{status:200});});
 try{
  await assert.rejects(fetch(TRIAL.endpoint,request(512)),/usage missing/);assert.equal(sent,1);assert.equal(entries[0].state,'unknown');assert.equal(entries[0].reservedMicroCny,400000);assert.throws(()=>trialCapacity(entries,5),/reconciliation/);
 }finally{restore();}
});
test('selection refuses an overlong complete source before any model request',async()=>{
 let sends=0;
 const a={id:'synthetic-long',revision:1,title:'Synthetic',url:'https://example.org/public',author:null,publishedAt:null,bodyText:'海'.repeat(60001),excerpt:null,xPost:null,media:[],source:{name:'Synthetic',kind:'external',tier:'T1',firstParty:true}};
 await assert.rejects(runFisherySelection(a,newSelection('T1'),async()=>{sends++;throw new Error('Must not send');},async()=>{}),/complete original body/);assert.equal(sends,0);
});
import {reviewFisheryDraft,buildFisheryReviewRequest,assertFisheryPairFits} from "../backend/ai-review.ts";
import {buildEvidenceCatalog,evidenceBinding,assertEvidenceBinding,assertSavedEvidenceArtifact} from "../backend/evidence.ts";
import { discoverIotc, iotcAttachment, prepareIotc } from "../backend/iotc-columns.ts";
import {discoverColumnPagination} from "../backend/official-columns.ts";
import {collectColumnRound,listColumnProgress,listColumnRounds,initialColumnProgress,parseColumnProgress} from "../backend/column-progress.ts";

test("operator CLI refuses retired IOTC before making an archive or network request",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"fishery-retired-cli-")),destination=path.join(root,"must-not-exist");
  try {
    await assert.rejects(promisify(execFile)(process.execPath,["modules/fishery/scripts/collect-columns.ts","--id","retired-iotc-cli","--data-dir",destination,"--columns","iotc","--limit","1"],{cwd:process.cwd(),timeout:10_000}),error=>{
      assert.match(String((error as {stderr?:string}).stderr),/IOTC business source is retired/);return true;
    });
    await assert.rejects(access(destination),/ENOENT/);
  } finally {await rm(root,{recursive:true,force:true});}
});

const roundUrl=(n:number)=>`https://yyj.moa.gov.cn/gzdt/202610/t20261020_${99000+n}.htm`;
function roundListing(ids:number[],index=0,count=1) {
  // Inspected TRS template, represented as data. Never evaluate source JavaScript.
  return `<ul class="sj_e_tonzhi_list">${ids.map(n=>`<li><a href="${roundUrl(n)}">远洋渔业合成材料${n}</a></li>`).join("")}</ul><script>var currentPage = ${index};var nextPage = currentPage+1;var countPage = ${count}// pages\ndocument.write("<a href=\\"index"+"_" + nextPage + "."+"htm\\">下一页</a>");</script>`;
}
function roundArticle(n:number,changed=false) {return Buffer.from(`<meta name="ArticleTitle" content="远洋渔业合成材料${n}"><meta name="PubDate" content="2026-10-20"><div class="sj_arc_body"><div class="TRS_Editor"><p>${changed?"远洋渔业正文已作合成修订。":"远洋渔业公海履约合成原文。"}${"完整上下文用于测试，不能作为真实信息。".repeat(4)}</p></div></div>`);}

test("inspected pagination is bounded to official identities and unverified Fujian history stays explicit",()=>{
  assert.equal(discoverColumnPagination("moa",roundListing([1],0,2)).nextUrl,COLUMNS.moa.url+"index_1.htm");
  assert.throws(()=>discoverColumnPagination("moa",roundListing([1],0,2),COLUMNS.moa.url+"index_1.htm"),/metadata disagrees/);
  assert.equal(discoverColumnPagination("moa",'<a href="https://evil.example/page">下一页</a>').scope,"pagination_unverified");
  assert.equal(discoverColumnPagination("fujian",'<a href="javascript:;">下一页</a>').scope,"pagination_unverified");
  const html='<ul class="pager"><li class="pager-current">1</li><li class="pager-next"><a href="/cmms/basic?page=1">next</a></li><li class="pager-last"><a href="/cmms/basic?page=10">last</a></li></ul>';
  assert.deepEqual(discoverColumnPagination("iotc",html),{pageUrl:COLUMNS.iotc.url,pageIndex:0,nextUrl:COLUMNS.iotc.url+"?page=1",totalPages:11,scope:"verified_pagination"});
  for(const href of ["https://evil.example/cmms/basic?page=1","/cmms/basic?page=2","/cmms/basic?page=1&other=1"]) assert.throws(()=>discoverColumnPagination("iotc",html.replace('/cmms/basic?page=1',href)));
  assert.equal(linkSchema.safeParse(COLUMNS.iotc.url+"?page=1").success,true);
  for(const url of [COLUMNS.iotc.url+"?page=1&token=secret",COLUMNS.iotc.url+"?page=0",COLUMNS.iotc.url+"?page=01",COLUMNS.iotc.url+"?page=1#secret","https://iotc.org/other?page=1"]) assert.equal(linkSchema.safeParse(url).success,false);
  assert.throws(()=>discoverColumnPagination("iotc",'<ul class="pager"><li class="pager-last"><a href="/cmms/basic?page=10">last</a></li></ul>'),/omits or contradicts/);
});

test("news rounds prioritize new messages, finish the current list and recheck bounded bodies without walking history",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-news-")),called:string[]=[];let added=false,changed=false;
  const fetch=async(url:string)=>{called.push(url);const robots=url.endsWith("robots.txt"),listing=url===COLUMNS.moa.url;
    return {url,status:robots?404:200,body:robots?Buffer.from("missing"):listing?Buffer.from(roundListing(added?[1,2,3,4,5,6,7]:[1,2,3,4,5,6],0,2)):roundArticle(Number(/_(\d+)\.htm$/.exec(url)![1])-99000,changed),headers:{get:()=>"text/html"}};};
  const run=(id:string)=>collectColumnRound({id,dataDir,columns:["moa"],limit:5,maxPages:2,fetch,wait:async()=>{}});
  try {
    const first=await run("news-first");assert.equal(first.sources[0]!.after!.pendingUrls.length,1);
    added=true;const before=called.length,second=await run("news-second"),fresh=called.slice(before);
    assert.deepEqual(fresh.filter(u=>/t2026/.test(u)),[roundUrl(7),roundUrl(6)]);
    assert.equal(second.sources[0]!.after!.cursorUrl,COLUMNS.moa.url);assert.equal(second.sources[0]!.health!.coverage,"current_page_only");
    assert.ok(!called.some(u=>u.endsWith('index_1.htm')));
    changed=true;const n=called.length,third=await run("news-recheck");
    assert.deepEqual(called.slice(n).filter(u=>/t2026/.test(u)),[1,2,3,4,5].map(roundUrl));
    assert.equal(third.sources[0]!.after!.cycle,1);assert.deepEqual(third.sources[0]!.after!.pendingUrls,[roundUrl(6),roundUrl(7)]);
    const recaptured=await readBatch(dataDir,third.sources[0]!.batches[0]),item=recaptured.items.find(i=>i.url===roundUrl(1))!;
    assert.match(await readCapturedText(dataDir,item.archiveId,item.prepared!.sourceCapture.bodySha256!),/正文已作合成修订/);
    const m=called.length;await run("news-recheck-rest");assert.deepEqual(called.slice(m).filter(u=>/t2026/.test(u)),[roundUrl(6),roundUrl(7)]);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("news completion cache keeps only the current list instead of exhausting its lifetime identity bound",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-news-cache-")),directory=path.join(dataDir,"fishery-column-progress");
  const before={...initialColumnProgress("moa"),completedUrls:Array.from({length:4096},(_,i)=>roundUrl(i+1))};
  const fetch=async(url:string)=>({url,status:url.endsWith("robots.txt")?404:200,body:url.endsWith("robots.txt")?Buffer.from("missing"):url===COLUMNS.moa.url?Buffer.from(roundListing([5000,1])):roundArticle(5000),headers:{get:()=>"text/html"}});
  try {
    await mkdir(directory);await writeFile(path.join(directory,"moa.json"),JSON.stringify(before));
    const r=await collectColumnRound({id:"news-trim",dataDir,columns:["moa"],limit:2,maxPages:1,fetch,wait:async()=>{}});
    assert.equal(r.outcome,"success");assert.deepEqual(r.sources[0]!.after!.completedUrls,[roundUrl(1),roundUrl(5000)]);
    assert.equal(r.sources[0]!.after!.pendingUrls.length,0);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("news recheck failures retain retry identities across list disappearance while new URLs stay first",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-news-retry-")),called:string[]=[];let listed=[1,2],failed:number|null=null;
  const fetch=async(url:string)=>{called.push(url);const robots=url.endsWith("robots.txt"),listing=url===COLUMNS.moa.url,n=robots||listing?0:Number(/_(\d+)\.htm$/.exec(url)![1])-99000;
    return {url,status:robots||n===failed?404:200,body:robots?Buffer.from("missing"):listing?Buffer.from(roundListing(listed)):roundArticle(n),headers:{get:()=>"text/html"}};};
  const run=(id:string)=>collectColumnRound({id,dataDir,columns:["moa"],limit:2,maxPages:1,fetch,wait:async()=>{}});
  try {
    await run("retry-initial");failed=1;const retry=await run("retry-failed");
    assert.equal(retry.outcome,"partial");assert.deepEqual(retry.sources[0]!.after!.pendingUrls,[roundUrl(1)]);
    listed=[2,3];const absent=await run("retry-disappeared");
    assert.ok(absent.sources[0]!.after!.pendingUrls.includes(roundUrl(1)));assert.ok(!absent.sources[0]!.after!.completedUrls.includes(roundUrl(1)));
    failed=null;listed=[1,2,3,4];const n=called.length,recovered=await run("retry-returned");
    assert.deepEqual(called.slice(n).filter(u=>/t2026/.test(u)),[roundUrl(4),roundUrl(1)]);
    assert.equal(recovered.outcome,"success");assert.equal(recovered.sources[0]!.after!.pendingUrls.length,0);
    const failedBatch=await readBatch(dataDir,retry.sources[0]!.batches[0]);assert.equal(failedBatch.items.find(i=>i.url===roundUrl(1))!.state,"failed");
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("failed articles keep the cursor and pending identity while successful captures are not repeated",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-failure-"));let fail=true;const articles:string[]=[];
  const fetch=async(url:string)=>{const robots=url.endsWith("robots.txt"),listing=url===COLUMNS.moa.url;if(!robots&&!listing)articles.push(url);
    return {url,status:robots||url===roundUrl(1)&&fail?404:200,body:robots?Buffer.from("missing"):listing?Buffer.from(roundListing([1,2],0,2)):roundArticle(1),headers:{get:()=>"text/html"}};};
  try {
    const a=await collectColumnRound({id:"failure-a",dataDir,columns:["moa"],limit:2,maxPages:1,fetch,wait:async()=>{}});
    assert.equal(a.outcome,"partial");assert.equal(a.sources[0]!.after!.cursorUrl,COLUMNS.moa.url);assert.deepEqual(a.sources[0]!.after!.pendingUrls,[roundUrl(1)]);assert.equal(a.sources[0]!.health!.lastSuccessAt,null);
    fail=false;articles.length=0;const b=await collectColumnRound({id:"failure-b",dataDir,columns:["moa"],limit:2,maxPages:1,fetch,wait:async()=>{}});
    assert.deepEqual(articles,[roundUrl(1)]);assert.equal(b.sources[0]!.after!.cursorUrl,COLUMNS.moa.url);
    assert.equal((await readBatch(dataDir,"failure-a-moa-p0")).items[0]!.state,"failed","Failed evidence remains unchanged");
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("all-source denial is a failed completed round without advancing any source",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-denied-"));
  try {
    const r=await collectColumnRound({id:"all-denied",dataDir,columns:["moa","fujian","iotc"],limit:2,maxPages:2,wait:async()=>{},fetch:async url=>({url,status:403,body:Buffer.from("denied"),headers:{get:()=>null}})});
    assert.equal(r.status,"finished");assert.equal(r.outcome,"failure");assert.ok(r.sources.every(s=>s.health!.outcome==="failure"&&s.after!.cursorUrl===COLUMNS[s.column].url&&s.health!.lastSuccessAt===null));
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("crash checkpoints resume persisted captures and commits idempotently with zero new requests",async()=>{
  for(const stage of ["child-persisted","before-source-commit","after-source-commit"] as const) {
    const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-crash-"));let calls=0,crash=true;
    const fetch=async(url:string)=>{calls++;return {url,status:url.endsWith("robots.txt")?404:200,body:Buffer.from(url.endsWith("robots.txt")?"missing":url===COLUMNS.moa.url?roundListing([1]):roundArticle(1)),headers:{get:()=>"text/html"}};};
    const options={id:"resume-real-checkpoint",dataDir,columns:["moa"] as const,limit:1,maxPages:1,fetch,wait:async()=>{},checkpoint:async(s:string)=>{if(s===stage&&crash){crash=false;throw new Error("Synthetic stopped process boundary");}}};
    try {
      await assert.rejects(collectColumnRound({...options,columns:[...options.columns]}),/Synthetic stopped/);const before=calls;
      const recovered=await collectColumnRound({...options,columns:[...options.columns],resume:{acknowledgeStopped:true,reason:"Synthetic runner stopped after fault injection"}});
      assert.equal(calls,before);assert.equal(recovered.status,"finished");assert.equal(recovered.sources[0]!.after!.revision,1);assert.equal(recovered.sources[0]!.after!.cycle,1);
      await collectColumnRound({...options,columns:[...options.columns],resume:{acknowledgeStopped:true,reason:"Synthetic completed replay is read only"}});assert.equal(calls,before);
    } finally {await rm(dataDir,{recursive:true,force:true});}
  }
});

test("a damaged or changed-profile source checkpoint is preserved and does not hide healthy sources",async()=>{
  const before=initialColumnProgress("moa"),column=COLUMNS.moa as {tier:string;url:string},original={tier:column.tier,url:column.url};
  try {
    column.tier="T2";assert.deepEqual(parseColumnProgress("moa",before),before,"Editorial tier changes preserve acquisition identity");
    column.url="https://yyj.moa.gov.cn/other/";assert.throws(()=>parseColumnProgress("moa",before),/binding|URL|pagination/);
  } finally {Object.assign(column,original);}
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-damaged-"));
  try {
    const dir=path.join(dataDir,"fishery-column-progress");await mkdir(dir);await writeFile(path.join(dir,"moa.json"),'{"truncated":');
    const r=await collectColumnRound({id:"isolated-health",dataDir,columns:["moa","fujian"],limit:1,maxPages:1,wait:async()=>{},fetch:async url=>({url,status:url.endsWith("robots.txt")?404:200,body:url.endsWith("robots.txt")?Buffer.from("missing"):url===COLUMNS.fujian.url?Buffer.from(`<ul class="xw-list-1 gl_list"><li><a href="${columnUrl}">远洋渔业</a></li></ul>`):columnHtml(),headers:{get:()=>"text/html"}})});
    assert.equal(r.outcome,"partial");assert.equal(r.sources[0]!.health!.outcome,"failure");assert.equal(r.sources[1]!.health!.outcome,"success");assert.equal(r.sources[1]!.health!.coverage,"current_page_only");
    assert.equal(await readFile(path.join(dir,"moa.json"),"utf8"),'{"truncated":');assert.equal((await listColumnProgress(dataDir))[0]!.status,"unreadable");assert.equal((await listColumnRounds(dataDir)).length,1);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("unfinished rounds cannot be bypassed by a new id and stale resumes fail before HTTP",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-stale-"));let calls=0;
  const fetch=async(url:string)=>{calls++;return {url,status:url.endsWith("robots.txt")?404:200,body:Buffer.from(url.endsWith("robots.txt")?"missing":url===COLUMNS.moa.url?roundListing([1],0,2):roundArticle(1)),headers:{get:()=>"text/html"}};};
  const options={id:"unfinished-a",dataDir,columns:["moa"] as const,limit:2,maxPages:2,fetch,wait:async()=>{}};
  try {
    await assert.rejects(collectColumnRound({...options,columns:[...options.columns],checkpoint:async()=>{throw new Error("Synthetic interruption");}}),/Synthetic interruption/);
    const before=calls;
    await assert.rejects(collectColumnRound({...options,columns:[...options.columns],id:"bypass-b"}),/Unfinished round/);assert.equal(calls,before);
    const file=path.join(dataDir,"fishery-column-progress","rounds","unfinished-a","manifest.json"),round=JSON.parse(await readFile(file,"utf8")),state={...round.sources[0].before,revision:99};
    await writeFile(path.join(dataDir,"fishery-column-progress","moa.json"),JSON.stringify(state));
    await assert.rejects(collectColumnRound({...options,columns:[...options.columns],resume:{acknowledgeStopped:true,reason:"Synthetic stopped runner but source externally changed"}}),/before any request/);assert.equal(calls,before);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("explicit recovery closes an interrupted GET child without rewriting or repeating it",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-progress-unknown-get-"));let calls=0;
  const fetch=async(url:string)=>{calls++;return {url,status:url.endsWith("robots.txt")?404:200,body:Buffer.from(url.endsWith("robots.txt")?"missing":url===COLUMNS.moa.url?roundListing([1]):roundArticle(1)),headers:{get:()=>"text/html"}};};
  const options={id:"mid-get",dataDir,columns:["moa"] as const,limit:1,maxPages:1,fetch,wait:async()=>{}};
  try {
    await assert.rejects(collectColumnRound({...options,columns:[...options.columns],checkpoint:async()=>{throw new Error("Synthetic checkpoint stop");}}));
    const file=path.join(batchRoot(dataDir),"mid-get-moa-p0","manifest.json"),batch=JSON.parse(await readFile(file,"utf8"));
    batch.status="running";batch.finishedAt=null;await writeFile(file,JSON.stringify(batch));const bytes=await readFile(file),before=calls;
    const recovered=await collectColumnRound({...options,columns:[...options.columns],resume:{acknowledgeStopped:true,reason:"Synthetic old GET process confirmed stopped"}});
    assert.equal(calls,before);assert.equal(recovered.outcome,"failure");assert.equal(recovered.sources[0]!.after!.cursorUrl,COLUMNS.moa.url);assert.deepEqual(await readFile(file),bytes);
    const next=await collectColumnRound({...options,columns:[...options.columns],id:"after-mid-get"});assert.equal(next.outcome,"success");assert.equal((await readBatch(dataDir,"mid-get-moa-p0")).status,"running");
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("saved DeepSeek responses preserve strict evidence arrays and the accepted draft's source anchors",async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL("./fixtures/ai-trial-responses-20261020.json",import.meta.url),"utf8"));
  const input=(f:any)=>({documentId:`offline-receipt-${f.receiptId}`,observationRevision:1,body:f.body,bodySha256:f.bodySha256,language:"zh"});
  const [first,accepted]=fixtures,original=structuredClone(first.response);
  const failure=fisheryDraftSchema.safeParse(first.response);
  assert.equal(failure.success,false);
  if(!failure.success) assert.ok(failure.error.issues.some(i=>i.path.join(".")==="relevance.evidence"));
  // An explicit test-only format correction demonstrates the desired contract. Runtime never coerces.
  const corrected=structuredClone(first.response);
  function arrays(v:any) {if(!v||typeof v!=="object") return;for(const [key,value]of Object.entries(v)){if(key==="evidence") v[key]=value===null?[]:Array.isArray(value)?value:[value];else arrays(value);}}
  arrays(corrected);
  assert.throws(()=>validateFisheryDraft(input(first),corrected),/Actual fishing area/);
  assert.deepEqual(first.response,original,"Never rewrite the original model response");
  assert.throws(()=>validateFisheryDraft(input(accepted),accepted.response),/Ambiguous issuer/);
  assert.equal(accepted.response.dates.published.date.precision,"unknown");
});

test("saved partial event dates cannot become ISO dates or borrow the source publication date",async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL("./fixtures/ai-trial-responses-20261020.json",import.meta.url),"utf8"));
  const f=structuredClone(fixtures[2]);f.response.locations=[];const input={documentId:"offline-partial-date",observationRevision:1,body:f.body,bodySha256:f.bodySha256,language:"zh"};
  assert.equal(f.response.dates.event.date.value,"--05-16");
  assert.throws(()=>validateFisheryDraft(input,f.response),/Invalid ISO date/);
  for(const value of ["2026-05-16",f.sourcePublication.value]) {
    const invented=structuredClone(f.response);invented.dates.published={date:unknownDate,evidence:[]};invented.dates.event.date={precision:"day",value};
    assert.throws(()=>validateFisheryDraft(input,invented),/components are not explicit/);
  }
  const partial=structuredClone(f.response);partial.dates.published={date:unknownDate,evidence:[]};partial.dates.event.date=unknownDate;
  const result=validateFisheryDraft(input,partial);
  assert.deepEqual(result.dates.event.date,unknownDate);assert.equal(result.dates.event.evidence[0]!.quote,"5月16日");
  // This only passes structural/date gates; the saved location-role inferences still need human review.
  const body="会议于2026年5月16日在福州举行。",anchor={quote:body,paragraph:1,page:null};
  const complete={...partial,summaryZh:[],relevance:{decision:"unknown",reason:"Synthetic date test",evidence:[]},locations:[],dates:{...partial.dates,event:{date:{precision:"day",value:"2026-05-16"},evidence:[anchor]}}};
  const fullInput={...input,body,bodySha256:sha256(body)};
  assert.equal(validateFisheryDraft(fullInput,complete).dates.event.date.value,"2026-05-16");
  assert.throws(()=>validateFisheryDraft(fullInput,{...complete,dates:{...complete.dates,published:complete.dates.event}}),/Publication metadata/);
  for(const body of ["Meeting occurred on 16 May 2026.","会议记载2026-05-16T23:30:00Z。"]){
    const event={date:{precision:"day",value:"2026-05-16"},evidence:[{quote:body,paragraph:1,page:null}]};
    const dated={...complete,dates:{...complete.dates,event}},context={...input,body,bodySha256:sha256(body)};
    assert.doesNotThrow(()=>validateFisheryDraft(context,dated));
    assert.throws(()=>validateFisheryDraft(context,{...dated,dates:{...dated.dates,event:{...event,date:{precision:"day",value:"2026-05-17"}}}}),/components are not explicit/);
  }
});

test("trial counts actual sends, refuses overrides and redirects, and uses cumulative amount with trusted usage and preserves unresolved reservations",async()=>{
  const entries:{state:string;reservedMicroCny:number;usage?:ReturnType<typeof trialUsage>|null}[]=[],wire={model:TRIAL.model,messages:[{role:"system",content:"JSON only"},{role:"user",content:"Synthetic public article"}],max_tokens:2048,thinking:{type:"disabled"},response_format:{type:"json_object"},temperature:0};
  const options={method:"POST",body:JSON.stringify(wire)};let sends=0;
  const restore=installTrialTransport({reserve:async()=>{trialCapacity(entries);entries.push({state:"pending",reservedMicroCny:TRIAL.reserveMicroCny});return entries.length;},settle:async(id,state,usage)=>{entries[id-1]!.state=state;entries[id-1]!.usage=usage;}},async(_url,opts)=>{
    sends++;assert.equal(opts?.redirect,"error");return new Response(JSON.stringify({usage:{prompt_tokens:1000,completion_tokens:100}}),{status:200});
  });
  try {
    await assert.rejects(fetch("https://example.org/chat/completions",options),/destination/);
    for(const override of [{max_tokens:9000},{tools:[]},{model:"different"},{n:2},{thinking:{type:"enabled"}},{messages:[{role:"user",content:"x"}]}]) await assert.rejects(fetch(TRIAL.endpoint,{method:"POST",body:JSON.stringify({...wire,...override})}));
    assert.equal(sends,0);
    for(let i=0;i<30;i++) await fetch(TRIAL.endpoint,options);
    assert.equal(sends,30);assert.equal(entries.length*TRIAL.reserveMicroCny,12_000_000);
    for(const entry of entries) entry.usage=null;
    await assert.rejects(fetch(TRIAL.endpoint,options),/hard amount/);assert.equal(sends,30);
    assert.throws(()=>trialCapacity([{state:"unknown",reservedMicroCny:400000}]),/manual reconciliation/);
    assert.throws(()=>trialUsage(null),/usage missing/);assert.throws(()=>trialUsage({prompt_tokens:100001,completion_tokens:1}));
    assert.equal(trialUsage({prompt_tokens:100000,completion_tokens:2048}).estimatedMicroCny,216384);
  } finally {restore();}
});

const columnUrl = "https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/202605/t20260519_7149775.htm";
function columnHtml(body="明确推进远洋渔业和南极磷虾产业合规发展。".repeat(4),date="2026-05-20 08:29") {
  return Buffer.from(`<meta name="ArticleTitle" content="合成远洋渔业材料"><meta name="PubDate" content="${date}"><h1>合成远洋渔业材料</h1><div id="detailCont"><div class="TRS_Editor"><html><body><p>${body}</p></body></html></div><p>第二个正文块：公海作业合规证据。</p><script>NEVER_EXECUTE</script></div><aside>无关推荐</aside>`);
}
const columnReceipt=(body:Buffer,url=columnUrl,status=200)=>({requestedUrl:url,finalUrl:url,status,finishedAt:"2026-10-20T00:00:00Z",sha256:sha256(body)});

test("official discovery preserves latest list order without title keyword rejection",()=>{
  const html=`<ul class="xw-list-1 gl_list"><li><a href="${columnUrl}">远洋渔业新材料</a><span>2026-05-19</span></li><li><a href="${columnUrl.replace("7149775","9999999")}">近海养殖合同履约</a></li><li><a href="https://example.org/t20260519_1.htm">公海</a></li><li><a href="${columnUrl}">重复</a></li></ul>`;
  const result=discoverColumn("fujian",html);
  assert.equal(result.listed,2);assert.equal(result.rejected,0);assert.equal(result.candidates.length,2);
  assert.equal(result.candidates[0]!.url,columnUrl);assert.equal(result.candidates[0]!.listDate,"2026-05-19");
  const long="中性背景文字".repeat(150)+"公海渔业治理证据";
  assert.ok(relevanceEvidence(long)[0]!.includes("公海渔业治理证据"));
});

test("complete bodies enter review without title or body keyword approval",()=>{
  // Two inspected official titles and short paragraph-4 excerpts reproduce the missed retrievals.
  const cases=[
    {url:"https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/202610/t20261018_7237949.htm",date:"2026-10-19",title:"推进建设21世纪海上丝绸之路高质量发展：国际友城与海洋经济合作研讨会在福州举办",body:"主题发言阶段，新加坡青年海运协会主席周毅恩、摩洛哥国家渔业研究所水产品增值与技术专业中心主任玛丽亚姆・哈鲁比、印中商务中心董事长韩煦雅、福州宏龙海洋水产有限公司副总经理齐琤，围绕海运人才交流、蓝色技术走廊、印尼海洋经济与中印尼海洋产业合作机遇、远洋渔业发展等主题分享实践经验，为海洋经济合作建言献策。",evidence:"远洋渔业发展"},
    {url:"https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/202609/t20260929_7219976.htm",date:"2026-09-29",title:"福建省海洋与渔业局领导以“四不两直”方式赴宁德调研检查涉渔船舶安全监管工作",body:"实地走访渔船组织化公司福建省联邦远洋渔业有限公司，详细了解渔船出海作业管理、船员安全教育、海上应急处置等工作，强调要创新完善激励约束机制，压实渔船组织化公司主体责任",evidence:"福建省联邦远洋渔业有限公司"},
  ];
  const listing=`<ul class="xw-list-1 gl_list">${cases.map(c=>`<li><a href="${c.url}">${c.title}</a></li>`).join("")}</ul>`;
  assert.deepEqual(discoverColumn("fujian",listing).candidates.map(c=>[c.url,c.priority]),cases.map(c=>[c.url,"context"]));
  const article=(title:string,body:string,date="2026-10-20")=>Buffer.from(`<meta name="ArticleTitle" content="${title}"><meta name="PubDate" content="${date}"><div id="detailCont"><p>${body}</p></div>`);
  for(const c of cases){
    const raw=article(c.title,c.body,c.date),result=prepareColumnArticle("fujian",columnReceipt(raw,c.url),raw,"archive_replay");
    assert.equal(result.relevance.decision,"candidate");assert.ok(result.relevance.evidence.some(e=>e.includes(c.evidence)));
    assert.equal(result.dates.published.value,c.date);assert.equal(result.dates.effectiveFrom.precision,"unknown");
  }
  const excludedTitles=["全省海洋经济高质量发展大会","近海养殖合同履约","水产养殖安全生产培训","海洋经济合作与近海养殖交流"];
  // A matching context title cannot upgrade ordinary coastal safety/cooperation text.
  for(const title of [cases[0]!.title,cases[1]!.title,"全省渔业安全生产检查工作部署",...excludedTitles]){
    const raw=article(title,"此次检查聚焦近海渔船安全生产，核查救生消防设备、进出港报告和船员培训情况，要求整改隐患，提升沿海渔港应急处置能力。"),result=prepareColumnArticle("fujian",columnReceipt(raw),raw);
    assert.equal(result.sourceCapture.parseStatus,"parsed");assert.equal(result.readyForReview,true);
    assert.equal(result.relevance.decision,"not_proven");assert.deepEqual(result.relevance.evidence,[]);
  }
});

test("official metadata outranks URL dates; nested blocks survive and missing dates remain unknown",()=>{
  const raw=columnHtml(),result=prepareColumnArticle("fujian",columnReceipt(raw),raw,"archive_replay");
  assert.equal(result.readyForReview,true);assert.equal(result.dates.published.value,"2026-05-20");
  assert.equal(result.sourceCapture.publishedAt,"2026-05-20T00:29:00.000Z");assert.equal(result.dates.event.value,null);
  assert.match(result.body!,/第二个正文块/);assert.doesNotMatch(result.body!,/NEVER_EXECUTE|无关推荐/);
  assert.equal(result.sourceCapture.acquisitionMode,"archive_replay");
  for(const date of ["","2026-02-30 08:29"]) {
    const bytes=columnHtml(undefined,date),r=prepareColumnArticle("fujian",columnReceipt(bytes),bytes);
    assert.equal(r.dates.published.value,null);
    if(date) assert.equal(r.readyForReview,false);
  }
  for(const [bytes,receipt] of [[raw,columnReceipt(raw,columnUrl,404)],[raw,{...columnReceipt(raw),sha256:"0".repeat(64)}],[raw,columnReceipt(raw,"https://hyyyj.fujian.gov.cn/other/t20260519_1.htm")],[Buffer.from([0xff]),columnReceipt(Buffer.from([0xff]))]] as const) {
    assert.equal(prepareColumnArticle("fujian",receipt,bytes).readyForReview,false);
  }
  const empty=Buffer.from('<meta name="ArticleTitle" content="标题"><div id="detailCont"></div>');
  assert.equal(prepareColumnArticle("fujian",columnReceipt(empty),empty).readyForReview,false);
});

test("manual batches archive current-list responses, expose failures and verify bound body hashes",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-batch-test-"));
  const badUrl=columnUrl.replace("7149775","7149776"), raw=columnHtml(), called:string[]=[];
  const fetch=async(url:string)=>{
    called.push(url);if(url===badUrl) throw new Error("Synthetic upstream timeout");
    const body=url.endsWith("robots.txt")?Buffer.from("not found"):url===COLUMNS.fujian.url?Buffer.from(`<ul class="xw-list-1 gl_list"><li><a href="${badUrl}">公海超时样例</a></li><li><a href="${columnUrl}">南极磷虾</a></li></ul>`):raw;
    return {url,status:url.endsWith("robots.txt")?404:200,body,headers:{get:()=>"text/html"}};
  };
  try {
    const b=await collectColumns({id:"synthetic-1",dataDir,columns:["fujian"],limit:1,fetch,wait:async()=>{}});
    assert.equal(b.sources[0]!.listed,2);assert.deepEqual(b.items.map(i=>i.state),["failed","ready"]);
    assert.match(b.items[0]!.error!,/timeout/);assert.equal(b.status,"complete");
    const stored=await readBatch(dataDir,b.id);const item=stored.items[1]!;
    assert.equal((await verifyBatchItem(dataDir,stored,item)).readyForReview,true);
    assert.equal(await readCapturedText(dataDir,item.archiveId,item.prepared!.sourceCapture.bodySha256!),prepareColumnArticle("fujian",columnReceipt(raw),raw).body);
    await writeFile(path.join(dataDir,"fishery-batches",b.id,"body",`${item.archiveId}.txt`),"tampered");
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/hash mismatch/);
    await assert.rejects(collectColumns({id:b.id,dataDir,columns:["fujian"],limit:1,fetch,wait:async()=>{}}),/EEXIST/);
    await assert.rejects(readBatch(dataDir,"../escape"));
    const denied=await collectColumns({id:"synthetic-2",dataDir,columns:["fujian"],limit:1,fetch:async url=>({url,status:403,body:Buffer.from("denied"),headers:{get:()=>null}}),wait:async()=>{}});
    assert.equal(denied.items.length,0);assert.match(denied.sources[0]!.error!,/policy inspection/);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("unreadable batch manifests are isolated in listings and rejected before import",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-manifest-test-")),previousDataDir=config.dataDir;
  const batch={version:"fishery-column-batch/0.1",id:"healthy",startedAt:"2026-10-20T00:00:00Z",finishedAt:"2026-10-20T00:01:00Z",status:"complete",sources:[],items:[]};
  const broken=[{id:"missing",body:null},{id:"truncated",body:'{"version":"fishery-column-batch/0.1",'},{id:"invalid",body:JSON.stringify({...batch,id:"invalid",sources:[null]})}];
  try {
    config.dataDir=dataDir;
    for(const {id,body} of [{id:batch.id,body:JSON.stringify(batch)},...broken]) {
      await mkdir(path.join(batchRoot(dataDir),id),{recursive:true});
      if(body!==null) await writeFile(path.join(batchRoot(dataDir),id,"manifest.json"),body);
    }
    const rows=await listBatches(dataDir);assert.equal(rows.length,4);
    assert.deepEqual(rows.find(r=>r.id===batch.id),batch);
    for(const brokenBatch of broken) {
      const row=rows.find(r=>r.id===brokenBatch.id)!;assert.equal(row.status,"unreadable");
      if(row.status!=="unreadable") throw new Error("Expected an explicit unreadable row");
      assert.ok(row.error);assert.equal("items" in row,false);assert.equal("networkRequests" in row,false);
      await assert.rejects(readBatch(dataDir,row.id));
      await assert.rejects(importBatch(row.id,"standalone-test"),/ENOENT|JSON|Invalid batch manifest/);
      const file=path.join(batchRoot(dataDir),row.id,"manifest.json");
      if(brokenBatch.body===null) await assert.rejects(access(file));
      else assert.equal(await readFile(file,"utf8"),brokenBatch.body,"Listing/import must not repair bad evidence");
    }
  } finally {config.dataDir=previousDataDir;await rm(dataDir,{recursive:true,force:true});}
});

test("manifest write failure preserves the previous complete JSON and leaves the batch unfinished",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-manifest-failure-")),id="interrupted",root=path.join(batchRoot(dataDir),id);
  let previousManifest="";
  try {
    await assert.rejects(collectColumns({id,dataDir,columns:["fujian"],limit:1,wait:async()=>{},fetch:async url=>{
      const robots=url.endsWith("robots.txt"),listing=url===COLUMNS.fujian.url;
      if(!robots&&!listing) {
        previousManifest=await readFile(path.join(root,"manifest.json"),"utf8");
        await writeFile(path.join(root,".manifest.other-writer.tmp"),"preserve unrelated temporary evidence");
        await chmod(root,0o500);
      }
      return {url,status:robots?404:200,body:robots?Buffer.from("missing"):listing?Buffer.from(`<ul class="xw-list-1 gl_list"><li><a href="${columnUrl}">远洋渔业材料</a></li></ul>`):columnHtml(),headers:{get:()=>"text/html"}};
    }}),/EACCES|EPERM/);
    assert.ok(previousManifest);assert.equal(await readFile(path.join(root,"manifest.json"),"utf8"),previousManifest);
    const stored=await readBatch(dataDir,id);assert.equal(stored.status,"running");assert.equal(stored.finishedAt,null);
    assert.deepEqual((await readdir(root)).sort(),[".manifest.other-writer.tmp","body","manifest.json","raw"]);
    assert.equal(await readFile(path.join(root,".manifest.other-writer.tmp"),"utf8"),"preserve unrelated temporary evidence");
  } finally {await chmod(root,0o700).catch(()=>{});await rm(dataDir,{recursive:true,force:true});}
});

test("manifest rename failure removes its written temporary file and preserves other evidence",async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-manifest-rename-")),id="rename-blocked",root=path.join(batchRoot(dataDir),id),manifest=path.join(root,"manifest.json");
  let previousManifest="";
  try {
    await assert.rejects(collectColumns({id,dataDir,columns:["fujian"],limit:1,wait:async()=>{},fetch:async url=>{
      const robots=url.endsWith("robots.txt"),listing=url===COLUMNS.fujian.url;
      if(!robots&&!listing) {
        previousManifest=await readFile(manifest,"utf8");
        await rename(manifest,path.join(root,"previous-manifest.json"));
        await mkdir(manifest);
        await writeFile(path.join(manifest,"target-evidence.txt"),"preserve existing target evidence");
        await writeFile(path.join(root,"other-writer.tmp"),"preserve unrelated temporary evidence");
      }
      return {url,status:robots?404:200,body:robots?Buffer.from("missing"):listing?Buffer.from(`<ul class="xw-list-1 gl_list"><li><a href="${columnUrl}">远洋渔业材料</a></li></ul>`):columnHtml(),headers:{get:()=>"text/html"}};
    }}),(error:NodeJS.ErrnoException)=>error.syscall==="rename"&&["EISDIR","ENOTEMPTY","EEXIST"].includes(error.code??""));
    assert.ok(previousManifest);assert.equal(await readFile(path.join(root,"previous-manifest.json"),"utf8"),previousManifest);
    assert.equal(JSON.parse(previousManifest).status,"running");
    assert.equal(await readFile(path.join(manifest,"target-evidence.txt"),"utf8"),"preserve existing target evidence");
    assert.equal(await readFile(path.join(root,"other-writer.tmp"),"utf8"),"preserve unrelated temporary evidence");
    assert.deepEqual((await readdir(root)).sort(),["body","manifest.json","other-writer.tmp","previous-manifest.json","raw"]);
    assert.equal((await readdir(path.join(root,"body"))).length,1,"The article body was saved before manifest replacement failed");
    assert.equal((await listBatches(dataDir))[0]!.status,"unreadable");
    await assert.rejects(readBatch(dataDir,id));
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("capture time and archive relocation do not change evidence, but latest-body changes do",()=>{
  const raw=columnHtml(),r=prepareColumnArticle("fujian",columnReceipt(raw),raw);
  const a={...observationFixture,rawSha256:r.sourceCapture.rawSha256,sourceCapture:r.sourceCapture};
  const first=evidenceIdentity(a);
  assert.equal(evidenceIdentity({...a,sourceCapture:{...r.sourceCapture,capturedAt:"2026-10-21T00:00:00Z",archiveId:"later_1234"}}),first);
  const b={...a,sourceCapture:{...r.sourceCapture,bodySha256:"b".repeat(64)}};
  assert.notEqual(evidenceIdentity(b),first);
  assert.notEqual(evidenceIdentity(a),evidenceIdentity(b));
});

test("fishery AI mock yields only version-bound drafts; false anchors and Pending-as-effective fail",async()=>{
  const body="Resolution status: Pending. Objection deadline is 18 November 2026.\nIndian Ocean meeting; vessels departed Xiamen port.", input={documentId:"synthetic",observationRevision:2,body,bodySha256:sha256(body),language:"en"};
  const anchor={quote:"Resolution status: Pending.",paragraph:1,page:null};
  const unknown={date:unknownDate,evidence:[]};
  const output={relevance:{decision:"unknown",reason:"Needs original review",evidence:[]},summaryZh:[{sentence:"该决议仍待生效。",evidence:[anchor]}],dates:{published:unknown,event:unknown,adopted:unknown,effective:unknown,objectionDeadline:unknown},entryIntoForce:{value:"pending",evidence:[anchor]},locations:[],uncertainties:["No vessel registration evidence"]};
  const result=await prepareFisheryDraft(input,"mock",async options=>{assert.equal(options.purpose,"fishery_draft");return {data:fisheryDraftSchema.parse(output),receiptId:123,reused:false,model:"mock",usage:null};});
  assert.equal(result.status,"needs_review");assert.equal(result.observationRevision,2);assert.equal(result.bodySha256,input.bodySha256);
  assert.throws(()=>validateFisheryDraft(input,{...output,summaryZh:[{sentence:"False",evidence:[{...anchor,quote:"In force"}]}]}),/continuous/);
  assert.throws(()=>validateFisheryDraft(input,{...output,entryIntoForce:{value:"pending",evidence:[{...anchor,page:4}]}}),/page anchor/);
  assert.throws(()=>validateFisheryDraft(input,{...output,dates:{...output.dates,effective:{date:{precision:"day",value:"2026-11-18"},evidence:[anchor]}}}),/Pending/);
  assert.throws(()=>buildFisheryDraftRequest({...input,body:body+" changed"},"mock"),/changed source body/);
});

test("date precision never supplies missing days, times or legal applicability", () => {
  assert.deepEqual(dateSchema.parse(unknownDate), unknownDate);
  const month = dateSchema.parse({ precision: "month", value: "2026-10" });
  assert.equal(month.value, "2026-10");
  assert.equal(effectiveState(month, "2026-10-20"), "unknown");
  assert.equal(effectiveState(month, "2026-09-20"), "future");
  assert.equal(effectiveState(unknownDate, "2026-10-20"), "unknown");
  assert.equal(effectiveState({ precision: "day", value: "2028-01-01" }, "2026-10-20"), "future");
  assert.equal(effectiveState({ precision: "day", value: "2026-10-20" }, "2026-10-20"), "reached");
  for (const value of ["2026-02-30", "2026-13-01", "2026-04-17T00:00:00Z"])
    assert.equal(dateSchema.safeParse({ precision: "day", value }).success, false);
});

test("unknown rights fail closed, and expired or future rights cannot authorize an export", () => {
  const unknown = sourceSchema.parse({ expectedRevision: 0 });
  assert.equal(unknown.allowedFulltextExport, false);
  assert.equal(canExportSummary(unknown, Date.parse("2026-10-20")), false);
  assert.equal(sourceSchema.safeParse({ expectedRevision: 0, allowedSummary: true }).success, false);
  assert.equal(sourceSchema.safeParse({ ...sourceFixture, evidenceUrl: null }).success, false);
  const allowed = sourceSchema.parse(sourceFixture);
  assert.equal(canExportSummary(allowed, Date.parse("2026-10-20")), true);
  assert.equal(canExportSummary({ ...allowed, reviewDueAt: "2026-10-20T00:00:00Z" }, Date.parse("2026-10-20")), false);
  assert.equal(canExportSummary({ ...allowed, rightsCheckedAt: "2026-10-21T00:00:00Z" }, Date.parse("2026-10-20")), false);
});

test("observation contracts refuse raw bodies and ambiguous empty scopes", () => {
  assert.equal(observationSchema.safeParse(observationFixture).success, true);
  for (const extra of [{ fulltext: "forbidden" }, { body: "forbidden" }, { translation: "forbidden" }])
    assert.equal(observationSchema.safeParse({ ...observationFixture, ...extra }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, scope: { ...observationFixture.scope, unknownFields: [] } }).success, false);
  assert.equal(observationSchema.safeParse({ ...observationFixture, rawSha256: "not-a-hash" }).success, false);
});

test("metadata links cannot carry credentials, query secrets or private literal destinations", () => {
  for (const url of ["http://example.org/policy", "https://user:secret@example.org/", "https://example.org/?token=secret", "https://127.0.0.1/policy", "https://[::1]/", "https://localhost/policy", "https://secret.internal/policy", "file:///tmp/policy"])
    assert.equal(linkSchema.safeParse(url).success, false, url);
  assert.equal(linkSchema.safeParse("https://example.org/policy.pdf").success, true);
});

// These are synthetic structures, not copies of third-party articles or PDFs.
const jjUrl = "https://www.jinjiang.gov.cn/xxgk/jjyw/202603/t20260321_fixture.htm";
const ioUrl = "https://iotc.org/cmm/fixture-measure";
const pdfUrl = "https://iotc.org/sites/default/files/fixture.pdf";
const paragraph = "合成企业报道，仅用于离线提取测试。船队从厦门出发，不据港口反推企业归属。".repeat(12);
const jjHtml = (time = "2026-03-21 19:36", meta = "2026-03-21", body = paragraph) => Buffer.from(`<html><head><title>合成测试</title><meta name="ArticleTitle" content="合成船队报道"><meta name="PubDate" content="${meta}"></head><body><article><h1>合成船队报道</h1><span class="article_time">${time}</span><div class="TRS_Editor"><p>${body}</p></div></article></body></html>`);
const ioHtml = (status = "Pending", deadline = "18 November 2026") => Buffer.from(`<html><body><h1>Synthetic Resolution 26/01</h1><div id="content"><div class="node-cmm"><a href="${pdfUrl}">PDF</a><div class="field-name-field-cmm-status">${status}</div><div class="field-name-field-cmm-remarks">Entry into force pending extended objection deadline on ${deadline}. Does not apply to India and Somalia.</div><div class="field-name-field-cmm-adoption-date"><span class="date-display-single" content="2026-01-01T00:00:00+04:00">2026</span></div></div></div></body></html>`);
const receipt = (raw: Buffer, url = jjUrl, status = 200): ArchiveReceipt => ({ requestedUrl: url, finalUrl: url, status, finishedAt: "2026-10-20T05:00:00Z", sha256: sha256(raw) });
const syntheticPdf = () => {
  const bytes = Buffer.from("%PDF- synthetic fixture bytes, not an actual third-party PDF");
  return { bytes, receipt: receipt(bytes, pdfUrl), parsed: { status: "parsed" as const, rawSha256: sha256(bytes), parser: "synthetic test parser", text: "RESOLUTION 26/01. Entry into force pending extended objection deadline on 18 November 2026. The total allowable catch is a synthetic amount in 2027 and 2028.", pages: 2 } };
};

test("Jinjiang reads visible source time at +08:00 and leaves the body geography untouched", () => {
  const raw = jjHtml(), result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(result.readyForReview, true);
  assert.equal(result.reviewState, "awaiting_human_review");
  assert.equal(result.sourceCapture.publishedAt, "2026-03-21T11:36:00.000Z");
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.ok(result.body?.includes("从厦门出发"));
  assert.equal("approved" in result, false);
});

test("live receipts and archive replay are labelled separately without upgrading a 404 to article text", () => {
  const raw = jjHtml();
  const archived = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.equal(archived.sourceCapture.acquisitionMode, "archive_replay");
  assert.ok(archived.warnings.some(w => w.includes("no new network acquisition")));
  const live = prepareOfficial("jinjiang", receipt(raw), raw, undefined, "live_capture");
  assert.equal(live.sourceCapture.acquisitionMode, "live_capture");
  assert.ok(live.warnings.some(w => w.includes("Live HTTP acquisition receipt")));
  assert.equal(live.warnings.some(w => /Offline archive/i.test(w)), false);
  const missing = Buffer.from("404 error response");
  const failed = prepareOfficial("fuzhou", receipt(missing, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), missing, undefined, "live_capture");
  assert.equal(failed.sourceCapture.acquisitionMode, "live_capture");
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.readyForReview, false); assert.equal(failed.body, null);
});

test("missing source dates remain unknown despite a dated URL; day-only metadata stays day-only", () => {
  let raw = jjHtml("", "");
  let result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, unknownDate);
  assert.equal(result.sourceCapture.publishedAt, null);
  raw = jjHtml("", "2026-03-21"); result = prepareOfficial("jinjiang", receipt(raw), raw);
  assert.deepEqual(result.dates.published, { precision: "day", value: "2026-03-21" });
  assert.equal(result.sourceCapture.publishedAt, null);
});

test("conflicting or invalid publication fields block a prepared body", () => {
  for (const raw of [jjHtml("2026-03-22 19:36"), jjHtml("2026-02-30 19:36")]) {
    const result = prepareOfficial("jinjiang", receipt(raw), raw);
    assert.equal(result.readyForReview, false); assert.equal(result.body, null);
    assert.ok(result.sourceCapture.conflicts.length > 0);
    assert.deepEqual(result.dates.published, unknownDate);
  }
});

test("404, missing body, wrong host and hash mismatch never become article material", () => {
  const raw = Buffer.from("<title>404 missing</title>cached snippets must not be used");
  const failed = prepareOfficial("fuzhou", receipt(raw, "https://hyj.fuzhou.gov.cn/fixture.htm", 404), raw);
  assert.equal(failed.sourceCapture.httpStatus, 404); assert.equal(failed.sourceCapture.parseStatus, "failed");
  assert.equal(failed.body, null); assert.equal(failed.readyForReview, false);
  const empty = jjHtml("2026-03-21 19:36", "2026-03-21", "");
  assert.equal(prepareOfficial("jinjiang", receipt(empty), empty).readyForReview, false);
  const good = jjHtml();
  assert.equal(prepareOfficial("jinjiang", { ...receipt(good), sha256: "0".repeat(64) }, good).readyForReview, false);
  assert.equal(prepareOfficial("jinjiang", receipt(good, "https://example.org/"), good).readyForReview, false);
});

test("IOTC Pending keeps objection deadline separate and 2027–2028 provisions out of 2026", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  assert.equal(result.readyForReview, true);
  assert.deepEqual(result.dates.adopted, { precision: "year", value: "2026" });
  assert.deepEqual(result.dates.published, unknownDate);
  assert.deepEqual(result.dates.effectiveFrom, unknownDate);
  assert.equal(result.policyContext?.entryIntoForce, "pending");
  assert.deepEqual(result.policyContext?.objectionDeadline, { precision: "day", value: "2026-11-18" });
  assert.deepEqual(result.policyContext?.provisionYears, [2027, 2028]);
  assert.deepEqual(result.policyContext?.nonApplicationMentioned, ["India", "Somalia"]);
  assert.equal(result.sourceCapture.attachmentHttpStatus, 200);
  assert.equal(result.sourceCapture.attachmentSha256, sha256(syntheticPdf().bytes));
  assert.equal(effectiveState(result.dates.adopted, "2026-10-20"), "unknown");
});

test("IOTC missing/failed/unverified PDF and conflicting status or deadline stay blocked", () => {
  const raw = ioHtml();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw).readyForReview, false);
  for (const status of ["failed", "unverified", "missing"] as const) {
    const pdf = syntheticPdf();
    assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, status } }).readyForReview, false);
  }
  const conflict = ioHtml("In force");
  assert.equal(prepareOfficial("iotc", receipt(conflict, ioUrl), conflict, syntheticPdf()).readyForReview, false);
  const otherDeadline = ioHtml("Pending", "19 November 2026");
  assert.equal(prepareOfficial("iotc", receipt(otherDeadline, ioUrl), otherDeadline, syntheticPdf()).readyForReview, false);
  const pdf = syntheticPdf();
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, parsed: { ...pdf.parsed, text: pdf.parsed.text.replace("26/01", "26/02") } }).readyForReview, false);
  assert.equal(prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, receipt: { ...pdf.receipt, status: 404 } }).sourceCapture.attachmentHttpStatus, 404);
  // A parser claiming success must not turn empty bytes or an HTML error page into a verified PDF.
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>Upstream error pretending to be a PDF</html>")]) {
    const failed = prepareOfficial("iotc", receipt(raw, ioUrl), raw, { ...pdf, bytes, receipt: receipt(bytes, pdfUrl), parsed: { ...pdf.parsed, rawSha256: sha256(bytes) } });
    assert.equal(failed.readyForReview, false);
    assert.equal(failed.body, null);
    assert.equal(failed.sourceCapture.parseStatus, "failed");
  }
});

function iotcList(rows: Array<[string, string, string, string]> = [[ioUrl, "26/01", "Pending", "2026"]]) {
  return Buffer.from(`<table class="views-table"><tbody>${rows.map(([url, number, status, year]) => `<tr><td class="views-field-title-1"><a href="${url}">Resolution ${number} Synthetic measure</a></td><td class="views-field-nothing"><b>${status.replaceAll("&", "&amp;")} </b><br>Supersedes: <a href="/cmm/resolution-1601-synthetic-old">Resolution 16/01</a></td><td class="views-field-field-cmm-adoption-date"><span class="date-display-single" content="${year}-01-01T00:00:00+04:00">${year}</span></td></tr>`).join("")}</tbody></table>`);
}

test("IOTC current-list discovery keeps list order, deduplicates URLs and reads current identities", () => {
  const active = "https://iotc.org/cmm/resolution-2803-synthetic", pending = "https://iotc.org/cmm/resolution-2801-synthetic";
  const html = iotcList([[active,"28/03","Active & supersedes","2028"],[active,"28/03","Active & supersedes","2028"],[pending,"28/01","Pending","2028"],["https://example.org/cmm/resolution-2804-no","28/04","Active","2028"],["https://iotc.org/cmm/resolution-2501-old","25/01","Superseded","2025"]]);
  const result = discoverIotc(html.toString());
  assert.equal(result.listed,3); assert.equal(result.rejected,1);
  assert.deepEqual(result.candidates.map(c => [c.url,c.number,c.status,c.adoptionYear]),[[active,"28/03","Active & supersedes","2028"],[pending,"28/01","Pending","2028"]]);
  assert.deepEqual(discoverColumn("iotc",html.toString()),result);
  const candidate = discoverIotc(iotcList().toString()).candidates[0]!;
  const raw = ioHtml(), good = prepareIotc(candidate,receipt(raw,ioUrl),raw,syntheticPdf());
  assert.equal(good.readyForReview,true); assert.equal(good.policyContext?.entryIntoForce,"pending");
  for (const mismatch of [{number:"26/02"},{status:"Active"},{adoptionYear:"2025"},{url:active}]) {
    const result = prepareIotc({...candidate,...mismatch},receipt(raw,ioUrl),raw,syntheticPdf());
    assert.equal(result.readyForReview,false); assert.equal(result.body,null); assert.equal(result.sourceCapture.bodySha256,null);
  }
  assert.equal(iotcAttachment(raw,ioUrl),pdfUrl);
  assert.throws(() => iotcAttachment(Buffer.from(raw.toString().replace(pdfUrl,"https://example.org/document.pdf")),ioUrl),/same-origin PDF/);
});

test("IOTC batch captures a selected current Active measure and verifies original listing/PDF/body", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(),"fishery-iotc-test-"));
  // Public inspected robots policy fixture; every article, listing and PDF in this test is synthetic.
  const robots = await readFile(new URL("./fixtures/iotc-robots.txt",import.meta.url));
  const activeUrl = "https://iotc.org/cmm/resolution-2603-synthetic", list = iotcList([[ioUrl,"26/01","Pending","2026"],[activeUrl,"26/03","Active & supersedes","2026"]]);
  const html = Buffer.from(ioHtml("Active &amp; supersedes").toString().replace("26/01","26/03").replace(/Entry into force pending[^<]+/,"Synthetic active metadata; applicability unknown."));
  const pdf = pdfFixture(false,false,"RESOLUTION 26/03. Synthetic current fishery measure."), calls: string[] = [], waits: number[] = [];
  const fetch = async (url:string) => {
    calls.push(url);
    const body = url.endsWith("robots.txt") ? robots : url === COLUMNS.iotc.url ? list : url === activeUrl ? html : url === pdfUrl ? pdf : Buffer.from("not found");
    return {url,status:200,body,headers:{get:()=>url.endsWith(".pdf") ? "application/pdf" : "text/html"}};
  };
  try {
    const batch = await collectColumns({id:"iotc-current",dataDir,columns:["iotc"],limit:1,iotcSelect:["26/03"],fetch,wait:async ms=>{waits.push(ms);}});
    assert.equal(batch.sources[0]!.error,null); assert.equal(batch.items.length,1);
    const item = batch.items[0]!; assert.equal(item.state,"ready",item.error ?? "Expected full measure");
    assert.deepEqual(calls,["https://iotc.org/robots.txt",COLUMNS.iotc.url,activeUrl,pdfUrl]); assert.deepEqual(waits,[10000,10000,10000]);
    const stored = await readBatch(dataDir,batch.id), verified = await verifyBatchItem(dataDir,stored,stored.items[0]!);
    assert.equal(verified.readyForReview,true); assert.equal(verified.sourceCapture.attachmentPages,1);
    assert.equal(verified.sourceCapture.attachmentSha256,sha256(pdf)); assert.match(verified.body!,/--- Page 1 ---/);
    assert.ok("policyContext" in verified); if (!("policyContext" in verified)) throw new Error("Missing policy context");
    assert.equal(verified.policyContext?.entryIntoForce,"unknown"); assert.deepEqual(verified.dates.effectiveFrom,unknownDate);
    assert.equal(verified.evidence.find(e=>e.url===COLUMNS.iotc.url)?.sha256,sha256(list));
    observationSchema.parse({...observationFixture,rawSha256:verified.sourceCapture.rawSha256,dates:verified.dates,sourceCapture:verified.sourceCapture,policyContext:verified.policyContext,evidence:verified.evidence});
    const root = path.join(dataDir,"fishery-batches",batch.id);
    await writeFile(path.join(root,"raw","iotc-list.bin"),iotcList());
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/raw hash mismatch/);
    await writeFile(path.join(root,"raw","iotc-list.bin"),list);
    await writeFile(path.join(root,"raw",`${item.archiveId}-pdf.bin`),Buffer.from("tampered"));
    await assert.rejects(verifyBatchItem(dataDir,stored,item),/raw hash mismatch/);
    calls.length=0; waits.length=0;
    const missing = await collectColumns({id:"iotc-selection-missing",dataDir,columns:["iotc"],limit:1,iotcSelect:["29/01"],fetch,wait:async ms=>{waits.push(ms);}});
    assert.equal(missing.items.length,0); assert.match(missing.sources[0]!.error!,/absent from current listing/);
    assert.deepEqual(calls,["https://iotc.org/robots.txt",COLUMNS.iotc.url]);
    calls.length=0;
    const changed = await collectColumns({id:"iotc-policy-changed",dataDir,columns:["iotc"],limit:1,fetch:async url=>{calls.push(url);return {url,status:200,body:Buffer.from("User-agent: *\nCrawl-delay: 10\n"),headers:{get:()=>"text/plain"}};},wait:async()=>{throw new Error("Must stop before another request");}});
    assert.equal(changed.items.length,0); assert.match(changed.sources[0]!.error!,/policy inspection/); assert.deepEqual(calls,["https://iotc.org/robots.txt"]);
  } finally { await rm(dataDir,{recursive:true,force:true}); }
});

test("observation and export gates refuse pending-as-effective or failed capture, even after approval", () => {
  const raw = ioHtml(), result = prepareOfficial("iotc", receipt(raw, ioUrl), raw, syntheticPdf());
  const input = { ...observationFixture, rawSha256: sha256(raw), dates: result.dates, sourceCapture: result.sourceCapture, policyContext: result.policyContext! };
  const parsed = observationSchema.parse(input);
  assertCaptureExportable(parsed);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, attachmentHttpStatus: 404 }, { ...parsed.sourceCapture!, attachmentSha256: null }, { ...parsed.sourceCapture!, attachmentPages: null }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevents export/);
  assert.equal(observationSchema.safeParse({ ...input, dates: { ...input.dates, effectiveFrom: { precision: "day", value: "2026-11-18" } } }).success, false);
  for (const sourceCapture of [{ ...parsed.sourceCapture!, httpStatus: 404 }, { ...parsed.sourceCapture!, parseStatus: "unverified" as const }, { ...parsed.sourceCapture!, bodySha256: null }, { ...parsed.sourceCapture!, conflicts: ["fields disagree"] }])
    assert.throws(() => assertCaptureExportable({ ...parsed, sourceCapture }), /prevent export/);
  assert.equal(canExportSummary(sourceSchema.parse({ expectedRevision: 0 }), Date.now()), false);
  assert.deepEqual(dateSchema.parse({ precision: "year", value: "2026" }), { precision: "year", value: "2026" });
});

// Generated PDF 1.4 fixtures: no third-party documents or persisted passwords.

test("PDF commands read a private snapshot and retain byte hash and page evidence", async () => {
  const original = pdfFixture(); const expected = Buffer.from(original); let snapshot = "";
  const parsed = await extractPdf(original, { platform: "linux", execute: async (program, args, options) => {
    assert.ok(options.timeout > 0 && options.timeout <= 60_000); assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
    snapshot = args.find(a => a.endsWith("original.pdf"))!;
    original.fill(0); assert.deepEqual(await readFile(snapshot), expected);
    return { stdout: program === "pdfinfo" ? "Pages: 2\nEncrypted: no\n" : program === "pdftohtml" ? '<pdf2xml><fontspec id="0" size="12"/>'+[1,2].map(page=>`<page number="${page}" width="600" height="800"><text top="50" left="50" width="100" height="12" font="0">Verified synthetic page</text></page>`).join("")+'</pdf2xml>' : "Verified synthetic page\n", stderr: "" };
  } });
  assert.equal(parsed.status, "parsed"); assert.equal(parsed.rawSha256, sha256(expected)); assert.equal(parsed.pages, 2);
  assert.match(parsed.text, /--- Page 2 ---/); assert.match(parsed.parser, /Poppler 25.03.0/);
  await assert.rejects(access(snapshot));
});

test("PDF missing tools, blank pages, diagnostics, encryption, page and output limits block text", async () => {
  const raw = pdfFixture();
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(result.status, code === "ENOENT" ? "unverified" : "failed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const scenario of ["blank", "encrypted", "pages", "diagnostic", "output", "aggregate"]) {
    const result = await extractPdf(raw, { platform: "linux", execute: async (program, args) => {
      if (args[0] === "-v") return { stdout: "", stderr: `${program} version 25.03.0\n` };
      if (program === "pdfinfo") return { stdout: `Pages: ${scenario === "pages" ? 201 : 2}\nEncrypted: ${scenario === "encrypted" ? "yes" : "no"}\n`, stderr: "" };
      return { stdout: scenario === "blank" ? " \n" : scenario === "output" ? "x".repeat(4 * 1024 * 1024 + 1) : scenario === "aggregate" ? "x".repeat(2200000) : "Text", stderr: scenario === "diagnostic" ? "Syntax Warning" : "" };
    } });
    assert.equal(result.status, scenario === "blank" ? "unverified" : "failed", scenario); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from("<html>404</html>"), Buffer.alloc(10 * 1024 * 1024 + 1)])
    assert.equal((await extractPdf(bytes)).status, "failed");
});

test("installed PDF parser accepts generated text and blocks blank, encrypted and corrupt PDFs", { skip: !["linux", "darwin"].includes(process.platform) }, async () => {
  const positive = await extractPdf(pdfFixture());
  assert.equal(positive.status, "parsed", positive.error ?? "Expected parsed PDF"); assert.equal(positive.pages, 1);
  assert.match(positive.text, /Synthetic fishery evidence/);
  for (const bytes of [pdfFixture(true), pdfFixture(false, true), Buffer.from("%PDF-1.4\ncorrupted")]) {
    const result = await extractPdf(bytes); assert.notEqual(result.status, "parsed"); assert.equal(result.text, ""); assert.equal(result.pages, 0);
  }
});


test("independent review uses isolated context, distinct receipt purpose and requires every fact",async()=>{
  const body="远洋渔船共10艘。",input={documentId:"review",observationRevision:1,body,bodySha256:sha256(body),language:"zh"};
  const evidence=[{quote:body,paragraph:1,page:null}],date={date:unknownDate,evidence:[]};
  const draft={relevance:{decision:"unknown",reason:"待核",evidence:[]},summaryZh:[{sentence:body,evidence}],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],organizations:[],uncertainties:[]};
  const invoke=async(options:any)=>{assert.equal(options.purpose,"fishery_quality_review");assert.deepEqual(Object.keys(JSON.parse(options.user)),["source","candidate","claims"]);return {data:{decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"原文一致",evidence}]},receiptId:22,reused:false,model:"mock",usage:null} as any;};
  const result=await reviewFisheryDraft(input,draft,"mock",invoke);assert.equal(result.status,"needs_human_review");assert.equal(result.approved,false);assert.equal(result.receiptId,22);
  await assert.rejects(reviewFisheryDraft(input,draft,"mock",async o=>{const a=await invoke(o);a.data.findings[0].field="other";return a;}),/Invalid/);
  const missing=await reviewFisheryDraft(input,draft,"mock",async o=>{const a=await invoke(o);a.data.findings[0].verdict="not_found";return a;});assert.equal(missing.status,"needs_evidence");assert.deepEqual(missing.missingFields,["summaryZh.0"]);
  assert.throws(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence:"远洋渔船共10吨。",evidence}]}),/Numeric value\/unit/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,organizations:[{role:"page_publisher",value:"远洋渔船",evidence}]}),/publisher role/);
  assert.throws(()=>trialCapacity([{state:"received",reservedMicroCny:9_800_000}]),/hard amount/);
  assert.doesNotThrow(()=>trialCapacity([{state:"received",reservedMicroCny:9_500_000}]));
});


test("real review-v1 identifiers and absent optional fields fail the explicit claim-manifest contract",async()=>{
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-review-response-20261020.json",import.meta.url),"utf8")),original=structuredClone(fixture);
  const input={documentId:"receipt4-excerpts",observationRevision:1,body:fixture.body,bodySha256:fixture.bodySha256,language:"zh"};
  assert.throws(()=>validateFisheryDraft(input,fixture.draft),/Actual fishing area/);
  // Test-only counterfactual to isolate the review contract. Never save or approve this edited copy.
  const candidate=structuredClone(fixture.draft);candidate.locations=candidate.locations.map((v:any)=>v.role==="fishing_area"?{...v,role:"policy_scope"}:v);
  const request=buildFisheryReviewRequest(input,candidate,"mock"),manifest=JSON.parse(request.user as string).claims;
  assert.ok(manifest.some((c:any)=>c.id==="summaryZh.0"));assert.ok(!manifest.some((c:any)=>c.id.startsWith("dates.")));
  assert.equal(request.schema.safeParse(fixture.review).success,false,"Do not normalize legacy paths or remove real conflicting findings");
  const findings=manifest.map((c:any)=>({field:c.id,verdict:"supported",reason:"Synthetic contract-only example, not a factual endorsement",evidence:[]}));
  const contractFindings=findings.map((f:any)=>({...f,verdict:"not_found"}));
  assert.equal(request.schema.safeParse({decision:"needs_evidence",coverage:"complete_input",findings:contractFindings}).success,true);
  for(const invalid of [findings.slice(1),[...findings,findings[0]],[...findings.slice(1),findings[1]],findings.map((f:any,i:number)=>i?f:{...f,field:"summaryZh[0].sentence"})]) assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:invalid}).success,false);
  assert.deepEqual(fixture,original);
});

test("numeric checks preserve signs, thousands separators and opaque domain units",()=>{
  const date={date:unknownDate,evidence:[]};
  const draft={relevance:{decision:"unknown",reason:"test",evidence:[]},summaryZh:[],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},locations:[],uncertainties:[]};
  for(const [body,sentence] of [["增长10%。","下降-10%。"],["增长10万吨。","增长10亿美元。"],["配额1,000吨。","配额1。"],["增长-10%。","增长10%。"],["货物10吨。","货物10未知计量。"],["quota 10 tonnes.","quota 10 USD."]]) {
    const input={documentId:"numeric",observationRevision:1,body,bodySha256:sha256(body),language:"zh"},evidence=[{quote:body,paragraph:1,page:null}];
    assert.throws(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence,evidence}]}),/Numeric value\/unit/);
    assert.doesNotThrow(()=>validateFisheryDraft(input,{...draft,summaryZh:[{sentence:body,evidence}]}));
  }
  const body="计划于2020年5月举行会议，讨论公海治理。",input={documentId:"planned",observationRevision:1,body,bodySha256:sha256(body),language:"zh"},evidence=[{quote:body,paragraph:1,page:null}];
  assert.doesNotThrow(()=>validateFisheryDraft(input,{...draft,eventStatus:{value:"planned",evidence},locations:[{role:"policy_scope",value:"公海",evidence}]}));
  assert.throws(()=>validateFisheryDraft(input,{...draft,eventStatus:{value:"reported_occurred",evidence}}),/Reported occurrence/);
  const announced="将举行公海治理会议。",announcement={...input,body:announced,bodySha256:sha256(announced)};
  assert.throws(()=>validateFisheryDraft(announcement,{...draft,eventStatus:{value:"reported_occurred",evidence:[{quote:announced,paragraph:1,page:null}]}}),/Reported occurrence/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,validityStatus:"in_force"}),/Invalid input/);
  assert.throws(()=>validateFisheryDraft(input,{...draft,locations:[{role:"fishing_area",value:"公海",evidence}]}),/Actual fishing area/);
});


test("full-source generation and bounded review envelopes are checked before any send",()=>{
  const body="--- Page 1 ---\n"+Array.from({length:150},()=>"International fisheries governance full source evidence.").join("\n"),input={documentId:"full-pdf",observationRevision:1,body,bodySha256:sha256(body),language:"en",pages:[{page:1,text:body.slice("--- Page 1 ---\n".length)}]};
  const sizes=assertFisheryPairFits(input);assert.ok(sizes.generationBytes<96000);assert.ok(sizes.reviewEnvelopeBytes<96000);assert.equal(sizes.maxWireBytes,96000);
  const oversized=Array.from({length:4000},(_,i)=>`完整原文${i}。`).join("\n");
  assert.throws(()=>assertFisheryPairFits({...input,body:oversized,bodySha256:sha256(oversized),pages:[]}),/zero-call manual/);
});

test('oversized source wire is lossless with adjacent evidence IDs, while short requests and bounded review gates remain unchanged',async()=>{
  const {compactCatalogSource,catalogSource}=await import('../backend/evidence.ts');
  const {fisheryWireBytes}=await import('../backend/ai-review.ts');
  const {pdfPages}=await import('../backend/flow.ts');
  const headline='2025年版合成远洋资料，仅供历史参考。',body=`--- Page 1 ---\n${headline}\r\n\n--- Page 2 ---\n\n\n--- Page 3 ---\n`+Array.from({length:400},(_,i)=>`合成逐字原文${i}。😺 保留限定与空格。`).join('\r\n');
  const pdfBlankReview={version:'pdf-blank-review/1' as const,reviewId:'9d59308b-a508-4f80-86ab-8f5d46b8f251',rawSha256:sha256('synthetic raw PDF'),physicalPages:3,pageImages:[{page:2,sha256:sha256('synthetic blank PNG')}],proofHash:sha256('synthetic audit')};
  const input={...idTestInput(body),pages:pdfPages(body,3,pdfBlankReview),pdfBlankReview},catalog=buildEvidenceCatalog(input),before=JSON.stringify(catalog),request=buildFisheryDraftRequest(input,'mock'),wire=JSON.parse(String(request.user));
  assert.equal(wire.sourceWireVersion,'fishery-source-parts/1');assert.equal('body' in wire,false,'Do not duplicate the complete body beside its exact text parts');
  assert.equal(wire.bodyParts.map((p:any)=>typeof p==='string'?p:p[4]).join(''),body);
  const tuples=wire.bodyParts.filter(Array.isArray);assert.equal(tuples.length,catalog.spans.length);assert.equal(tuples.some((p:any)=>p[2]===2),false);
  for(const part of tuples){const span=catalog.spans.find(s=>s.id===part[0])!;assert.deepEqual(part,[span.id,span.paragraph,span.page,span.start,span.quote]);assert.equal(body.slice(span.start,span.end),part[4]);}
  assert.deepEqual(wire.reviewedBlankPages,pdfBlankReview);assert.deepEqual(wire.pages,catalog.pages);assert.equal(JSON.stringify(catalog),before);
  assert.throws(()=>compactCatalogSource(input,{...catalog,spans:[{...catalog.spans[0]!,paragraph:999},...catalog.spans.slice(1)]}),/unchanged complete catalog/);
  const legacy={...request,user:JSON.stringify({language:input.language,...catalogSource(input,catalog)})};assert.ok(fisheryWireBytes(legacy)>96000);
  const sizes=assertFisheryPairFits(input,request);assert.ok(sizes.generationBytes<=96000);assert.ok(sizes.reviewEnvelopeBytes<=96000);
  const id=catalog.spans[0]!.id,raw={...idTestDraft(),summaryZh:[{sentence:headline,evidence:[id]}]},candidate=validateFisheryDraft(input,request.schema.parse(raw));
  assert.equal(candidate.summaryZh[0]!.evidence[0]!.quote,headline);assert.equal(request.schema.safeParse({...raw,summaryZh:[{sentence:headline,evidence:['p999999s1']}]}).success,false);
  const review=buildFisheryReviewRequest(input,candidate,'mock'),reviewSource=JSON.parse(String(review.user)).source;assert.deepEqual(reviewSource,wire);
  const emptyReview=buildFisheryReviewRequest(input,{...idTestDraft(),relevance:{...idTestDraft().relevance,reason:'Preflight only'}},'mock');assert.equal(sizes.reviewEnvelopeBytes,fisheryWireBytes(emptyReview)+8192*2+4096,'Keep the original full bounded candidate/claims reserve');
  const short=idTestInput('短原文保持旧协议。'),shortRequest=buildFisheryDraftRequest(short,'mock'),shortSource=JSON.parse(String(shortRequest.user));
  assert.match(shortRequest.promptVersion!,/^fishery-draft-v5:/);assert.equal(shortSource.body,short.body);assert.equal(shortSource.sourceWireVersion,undefined);assert.deepEqual(shortSource,{language:short.language,...catalogSource(short,buildEvidenceCatalog(short))});
});

function idTestDraft() {
  const date={date:unknownDate,evidence:[]};
  return {relevance:{decision:"unknown",reason:"Synthetic protocol test only",evidence:[]},summaryZh:[],dates:{published:date,event:date,adopted:date,effective:date,objectionDeadline:date},entryIntoForce:{value:"unknown",evidence:[]},eventStatus:{value:"unknown",evidence:[]},validityStatus:"unknown",locations:[],organizations:[],uncertainties:[]};
}
function idTestInput(body:string) {return {documentId:"synthetic-id-protocol",observationRevision:1,body,bodySha256:sha256(body),language:"zh"};}

test("v5 strict ID wire expands complete evidence without repairing original receipt6",async()=>{
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-v4-receipt6-20261020.json",import.meta.url),"utf8")),original=JSON.stringify(fixture);
  const input=idTestInput(fixture.body),catalog=buildEvidenceCatalog(input),request=buildFisheryDraftRequest(input,"mock");
  assert.equal(input.bodySha256,fixture.bodySha256);
  assert.throws(()=>validateFisheryDraft(input,fixture.response),/Role value lacks literal evidence/);
  assert.equal(request.schema.safeParse(fixture.response).success,false,"Old quotes cannot be interpreted as ID wire");
  assert.equal(catalog.spans[0]!.id,"p1s1");assert.match(catalog.spans[0]!.quote,/在上海召开。$/);
  const wire={...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]},locations:[{role:"meeting_location",value:"上海",evidence:["p1s1"]}],dates:{...idTestDraft().dates,event:{date:unknownDate,evidence:["p1s1"]}}};
  const canonical=validateFisheryDraft(input,request.schema.parse(wire));
  assert.equal(canonical.eventStatus.value,"reported_occurred");assert.equal(canonical.locations[0]!.value,"上海");assert.deepEqual(canonical.dates.event.date,unknownDate);
  assert.equal(canonical.locations[0]!.evidence[0]!.quote,catalog.spans[0]!.quote);
  const source=JSON.parse(request.user as string);assert.equal(source.body,input.body);assert.ok(source.evidenceCatalog.spans.every((s:any)=>s.quote===input.body.slice(s.start,s.end)));
  for(const evidence of [null,{id:"p1s1"},[{quote:catalog.spans[0]!.quote,paragraph:1,page:null}],["p999s1"],["p1s1","p1s1"],Array(5).fill("p1s1")]) assert.equal(request.schema.safeParse({...wire,eventStatus:{value:"reported_occurred",evidence}}).success,false);
  assert.equal(request.schema.safeParse({...wire,eventStatus:{...wire.eventStatus,page:null}}).success,false);
  assert.throws(()=>buildEvidenceCatalog({...input,body:input.body+"变"}),/changed source body/);
  const binding=evidenceBinding(catalog);
  assert.doesNotThrow(()=>assertEvidenceBinding(input,{hash:binding.hash,version:binding.version,observationRevision:binding.observationRevision,bodySha256:binding.bodySha256}));
  assert.throws(()=>assertEvidenceBinding(input,{...binding,version:"fishery-spans-v0"}),/cannot be reinterpreted/);
  assert.throws(()=>assertEvidenceBinding({...input,observationRevision:2},binding),/cannot be reinterpreted/);
  assert.throws(()=>assertEvidenceBinding(idTestInput(input.body+"变"),binding),/cannot be reinterpreted/);
  assert.equal(JSON.stringify(fixture),original);
});

test("catalog preserves literal offsets, conservative English boundaries and verified PDF page intervals",()=>{
  const body="--- Page 1 ---\nRepeated evidence.\nNo. 1: Dr. A reports 1.5 tonnes.\n--- Page 2 ---\nRepeated evidence.\n会议已召开。第二会拟召开！";
  const pages=[{page:1,text:"Repeated evidence.\nNo. 1: Dr. A reports 1.5 tonnes."},{page:2,text:"Repeated evidence.\n会议已召开。第二会拟召开！"}],input={...idTestInput(body),pages};
  const catalog=buildEvidenceCatalog(input);
  assert.equal(catalog.spans[0]!.page,1);assert.equal(catalog.spans[2]!.page,2);assert.equal(catalog.spans[1]!.quote,"No. 1: Dr. A reports 1.5 tonnes.");
  for(const span of catalog.spans) assert.equal(body.slice(span.start,span.end),span.quote);
  const evidence=[{quote:"Repeated evidence.",paragraph:5,page:1}];
  assert.throws(()=>validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence:"Repeated evidence.",evidence}]}),/page anchor/);
  for(const badPages of [[pages[1]!,pages[0]!],[pages[0]!],pages.map(p=>({...p,text:"Repeated evidence."}))]) assert.throws(()=>buildEvidenceCatalog({...input,pages:badPages}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog({...idTestInput("Repeated evidence."),pages:[{page:1,text:"Repeated evidence."}]}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog({...idTestInput(body.replace("Page 2","Page 1")),pages}),/page intervals/);
  assert.throws(()=>buildEvidenceCatalog(idTestInput("重复句。重复句。")),/Ambiguous repeated span/);
  assert.throws(()=>buildEvidenceCatalog(idTestInput("x".repeat(1201))),/source not truncated/);
  const whitespace="  完整原句。  后一句！\r\nEnglish e.g. 1.5. ";
  for(const span of buildEvidenceCatalog(idTestInput(whitespace)).spans) assert.equal(whitespace.slice(span.start,span.end),span.quote);
});

test("ID expansion retains occurrence, date, unit, role and expanded review-envelope gates",()=>{
  const body="会议A已召开。会议B拟召开。会议未召开。如果会议召开则另行通知。公海是治理领域。船队10艘。会议于5月16日召开。",input=idTestInput(body),request=buildFisheryDraftRequest(input,"mock");
  const parse=(patch:object)=>validateFisheryDraft(input,request.schema.parse({...idTestDraft(),...patch}));
  assert.doesNotThrow(()=>parse({eventStatus:{value:"reported_occurred",evidence:["p1s1"]}}));
  for(const text of ["会议已正式召开。","报道记载会议已正式召开。","会议如期举行。","工作已按期完成。","The meeting was held.","The meeting took place."]) {
    const positive=idTestInput(text),positiveRequest=buildFisheryDraftRequest(positive,"mock");
    assert.doesNotThrow(()=>validateFisheryDraft(positive,positiveRequest.schema.parse({...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]}})),text);
  }
  for(const text of ["报道声称会议已召开，但事实并非如此。","据称会议已召开。","会议已召开一说未经证实。","主办方否认会议已召开。","会议是否已召开尚不清楚。","会议已召开？","The meeting allegedly took place.","It was claimed that the meeting was held, but that was not the case.","The meeting took place according to an unverified claim.","The organizer denied that the meeting took place.","会议未举行。","工作未完成。","会议并未正式召开。","会议未如期召开。","工作未能按期完成。","会议尚未正式举行。","The meeting never took place.","The meeting was not actually held.","The work was never completed.","会议取消召开。","会议延期举行。","若条件具备会议召开。","会议A已召开，会议B拟召开。","The meeting was not held.","The meeting was held if conditions were met.","The meeting was held but cancelled."]) {
    const negative=idTestInput(text),negativeRequest=buildFisheryDraftRequest(negative,"mock");
    assert.throws(()=>validateFisheryDraft(negative,negativeRequest.schema.parse({...idTestDraft(),eventStatus:{value:"reported_occurred",evidence:["p1s1"]}})),/Reported occurrence/,text);
  }
  for(const id of ["p1s2","p1s3","p1s4"]) assert.throws(()=>parse({eventStatus:{value:"reported_occurred",evidence:[id]}}),/Reported occurrence/);
  assert.throws(()=>parse({locations:[{role:"fishing_area",value:"公海",evidence:["p1s5"]}]}),/Actual fishing area/);
  assert.throws(()=>parse({summaryZh:[{sentence:"船队10吨。",evidence:["p1s6"]}]}),/Numeric value\/unit/);
  assert.throws(()=>parse({dates:{...idTestDraft().dates,event:{date:{precision:"day",value:"2026-05-16"},evidence:["p1s7"]}}}),/components are not explicit/);
  assert.throws(()=>parse({organizations:[{role:"page_publisher",value:"会议A",evidence:["p1s1"]}]}),/publisher role/);
  const longInput=idTestInput(Array.from({length:4},(_,i)=>"源".repeat(1149)+i+"。").join("")),longRequest=buildFisheryDraftRequest(longInput,"mock");
  assert.throws(()=>validateFisheryDraft(longInput,longRequest.schema.parse({...idTestDraft(),summaryZh:[{sentence:"合成包络",evidence:["p1s1","p1s2","p1s3","p1s4"]}]})),/bounded review envelope/);
});

test("review wire only supports original claim ID subsets and preserves complete unique claim manifests",async()=>{
  const input=idTestInput("船队10艘。另有另一船队10艘。"),catalog=buildEvidenceCatalog(input),generation=buildFisheryDraftRequest(input,"mock");
  const draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"船队10艘。",evidence:["p1s1"]}]})),request=buildFisheryReviewRequest(input,draft,"mock");
  const finding={field:"summaryZh.0",verdict:"supported",reason:"Synthetic only",evidence:["p1s1"]},wire={decision:"supported",coverage:"complete_input",findings:[finding]};
  assert.equal(request.schema.safeParse(wire).success,true);
  for(const evidence of [[],["p1s2"],["unknown"],null,{id:"p1s1"}]) assert.equal(request.schema.safeParse({...wire,findings:[{...finding,evidence}]}).success,false);
  for(const findings of [[],[finding,finding],[{...finding,field:"invented"}]]) assert.equal(request.schema.safeParse({...wire,findings}).success,false);
  const contradicted={...wire,decision:"needs_evidence",findings:[{...finding,verdict:"contradicted",evidence:["p1s2"]}]};
  assert.equal(request.schema.safeParse(contradicted).success,true,"Other source IDs can identify contradictions");
  const review=await reviewFisheryDraft(input,draft,"mock",async o=>({data:o.schema.parse(wire),receiptId:999,reused:false,model:"mock",usage:null}));
  assert.equal(review.status,"needs_human_review");assert.equal(review.approved,false);assert.deepEqual(review.evidenceCatalog,evidenceBinding(catalog));
  const empty=validateFisheryDraft(input,generation.schema.parse(idTestDraft())),emptyRequest=buildFisheryReviewRequest(input,empty,"mock");
  const result=await reviewFisheryDraft(input,empty,"mock",async()=>({data:emptyRequest.schema.parse({...wire,findings:[]}),receiptId:1000,reused:false,model:"mock",usage:null}));
  assert.equal(result.status,"needs_evidence");
});


test("saved generation and review cannot inherit a new prompt/schema or catalog version",()=>{
  const input=idTestInput("合成公海会议已召开。"),catalog=buildEvidenceCatalog(input),generation=buildFisheryDraftRequest(input,"mock"),draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"合成公海会议已召开。",evidence:["p1s1"]}]}));
  for(const [request,schemaVersion] of [[generation,"fishery-draft-wire-v5"],[buildFisheryReviewRequest(input,draft,"mock"),"fishery-review-wire-v3"]] as const) {
    const expected={promptVersion:request.promptVersion,schemaVersion},saved={...expected,evidenceCatalog:evidenceBinding(catalog)};
    assert.doesNotThrow(()=>assertSavedEvidenceArtifact(input,saved,expected));
    for(const changed of [{...saved,promptVersion:"old-prompt"},{...saved,schemaVersion:"old-schema"},{...saved,evidenceCatalog:{...saved.evidenceCatalog,version:"old-spans"}},{...saved,evidenceCatalog:{...saved.evidenceCatalog,hash:"0".repeat(64)}}]) assert.throws(()=>assertSavedEvidenceArtifact(input,changed,expected),/version changed|cannot be reinterpreted/);
    assert.throws(()=>assertSavedEvidenceArtifact(input,{},expected),/preserve the old attempt/);
    assert.deepEqual(saved,{...expected,evidenceCatalog:evidenceBinding(catalog)},"Version checks never rewrite saved results");
  }
});

async function iotcEntry9Fixture() {
  const fixture=JSON.parse(await readFile(new URL("./fixtures/ai-iotc-entry9-20261020.json",import.meta.url),"utf8"));
  const input={...idTestInput(fixture.body),documentId:"offline-original-entry9",language:"en",pages:fixture.pageRanges.map((p:{page:number;start:number;end:number})=>({page:p.page,text:fixture.body.slice(p.start,p.end).trim()}))};
  return {fixture,input};
}

test("readable IOTC ID catalog preserves complete source and original entry9 wrong-anchor rejection",async()=>{
  const {fixture,input}=await iotcEntry9Fixture(),original=JSON.stringify(fixture),catalog=buildEvidenceCatalog(input),request=buildFisheryDraftRequest(input,"mock"),source=JSON.parse(request.user as string);
  assert.equal(input.bodySha256,fixture.bodySha256);assert.equal(Buffer.byteLength(input.body),19598);assert.equal(input.pages.length,6);
  assert.equal(source.body,input.body);assert.deepEqual(source.evidenceCatalog.spans,catalog.spans);
  for(const span of source.evidenceCatalog.spans) assert.equal(span.quote,input.body.slice(span.start,span.end),span.id);
  const quote=(id:string)=>catalog.spans.find(s=>s.id===id)!.quote;
  assert.match(quote("p2s1"),/RESOLUTION 26\/03/);assert.match(quote("p5s1"),/Keywords/);assert.match(quote("p6s1"),/Indian Ocean Tuna Commission/);
  assert.match(quote("p46s1"),/means all fisheries/);assert.match(quote("p47s1"),/Subsistence fisheries/);assert.match(quote("p50s1"),/Artisanal fisheries/);
  assert.match(quote("p59s1"),/prohibit.*targeted fishing/);assert.match(quote("p60s1"),/mobulid rays/);
  assert.match(quote("p66s1"),/extent practicable.*safety/);assert.match(quote("p67s1"),/crew and observers/);
  const wrong=JSON.parse(fixture.rawContent);
  assert.deepEqual(wrong.organizations[0].evidence,["p2s1"]);
  assert.throws(()=>validateFisheryDraft(input,request.schema.parse(wrong)),/Role value lacks literal evidence: policy_issuer/);
  assert.throws(()=>assertEvidenceBinding(input,{...evidenceBinding(catalog),version:fixture.protocol.evidenceVersion}),/cannot be reinterpreted/);
  const sizes=assertFisheryPairFits(input,request);
  assert.ok(sizes.generationBytes<96000);assert.ok(sizes.reviewEnvelopeBytes<96000);assert.equal(sizes.maxWireBytes,96000);
  assert.throws(()=>assertFisheryPairFits(input,{...request,system:request.system+"界".repeat(7000)}),/zero-call manual/);
  // A fresh synthetic case proves readable ID expansion only. It is not a repair of entry9 or a real model result.
  const synthetic=validateFisheryDraft(input,request.schema.parse({...idTestDraft(),summaryZh:[{sentence:"CPCs须禁止其悬旗船故意设置任何渔具定向捕捞蝠鲼科鳐类。",evidence:["p59s1","p60s1"]}],organizations:[{role:"policy_issuer",value:"Indian Ocean Tuna Commission (IOTC)",evidence:["p6s1"]}]}));
  assert.deepEqual(synthetic.summaryZh[0]!.evidence.map(e=>e.quote),[quote("p59s1"),quote("p60s1")]);
  assert.equal(JSON.stringify(fixture),original,"Never rewrite the old wrong-ID response or its evidence bindings");
});

test("IOTC release claim missing safety qualifications cannot be repaired by supported review IDs",async()=>{
  const {input}=await iotcEntry9Fixture(),generation=buildFisheryDraftRequest(input,"mock");
  // Deliberately incomplete synthetic candidate: its bound line omits release, practicability and crew/observer safety.
  const draft=validateFisheryDraft(input,generation.schema.parse({...idTestDraft(),summaryZh:[{sentence:"CPCs须要求悬旗渔船尽快活体释放意外捕获的蝠鲼科鳐类。",evidence:["p65s1"]}]})),request=buildFisheryReviewRequest(input,draft,"mock");
  const finding={field:"summaryZh.0",verdict:"supported",reason:"Synthetic attempted repair",evidence:["p65s1","p66s1","p67s1"]};
  assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[finding]}).success,false,"Readable source must not authorize adding omitted safety anchors");
  assert.equal(request.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{...finding,evidence:["p66s1","p67s1"]}]}).success,false);
  const result=await reviewFisheryDraft(input,draft,"mock",async options=>{
    const source=JSON.parse(options.user as string).source;
    assert.match(source.body,/extent practicable/);assert.match(source.body,/crew and observers/);
    return {data:options.schema.parse({decision:"needs_evidence",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"not_found",reason:"Synthetic complete-context review: bound line lacks release, practicability and crew/observer safety; do not supplement anchors",evidence:[]}]}),receiptId:9999,reused:false,model:"mock",usage:null};
  });
  assert.equal(result.status,"needs_evidence");assert.deepEqual(result.missingFields,["summaryZh.0"]);assert.equal(result.approved,false);
});


test("complete calendar dates translate at equal day precision without exempting counts or inventing years",()=>{
  const check=(body:string,sentence:string)=>{const input=idTestInput(body),evidence=[{quote:body,paragraph:1,page:null}];return validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence,evidence}]});};
  for(const body of ["From 1 January 2028.","From January 1, 2028.","From 2028-01-01.","From 1 January 2028[1]."]) assert.doesNotThrow(()=>check(body,"自2028年1月1日起。"));
  assert.doesNotThrow(()=>check("自2028 年 1 月 1 日起。","From 1 January 2028."));
  for(const [body,sentence] of [["1 January 2028.","2028年1月2日。"],["1 January 2028.","2028年2月1日。"],["1 January 2028.","2030年1月1日。"],["1 January 20281.","2028年1月1日。"],["1 January.","2028年1月1日。"],["1 January 2028.","2028年。"],["1 January 2028; quota 10 tonnes.","2028年1月1日配额10美元。"],["1 January 2028; -10 tonnes.","2028年1月1日配额10 tonnes."]]) assert.throws(()=>check(body,sentence),/Calendar date|Numeric value/);
  assert.doesNotThrow(()=>check("整数20281。","整数20281。"));assert.throws(()=>check("整数20281。","整数2028。"),/Numeric value/);
  const input=idTestInput("1 January\n2028"),evidence=[{quote:"1 January",paragraph:1,page:null},{quote:"2028",paragraph:2,page:null}];
  assert.throws(()=>validateFisheryDraft(input,{...idTestDraft(),summaryZh:[{sentence:"2028年1月1日。",evidence}]}),/Calendar date/);
});

test("server-selected manual revision supports twelve IDs while generation stays capped at four",()=>{
  const body=Array.from({length:13},(_,i)=>`原文事实${String.fromCharCode(65+i)}。`).join("\n"),input=idTestInput(body),catalog=buildEvidenceCatalog(input),ids=catalog.spans.map(s=>s.id);
  const wire={...idTestDraft(),summaryZh:[{sentence:"原文事实A。",evidence:ids.slice(0,12)}]};
  assert.equal(fisheryDraftWireSchema(catalog).safeParse(wire).success,false);
  const manual=parseFisheryManualRevision(input,wire);
  assert.equal(manual.draft.summaryZh[0]!.evidence.length,12);assert.throws(()=>validateFisheryDraft(input,manual.draft),/server-selected/);
  assert.doesNotThrow(()=>validateFisheryDraft(input,manual.draft,{mode:"manual_revision"}));
  assert.equal(fisheryDraftWireSchema(catalog,{mode:"manual_revision"}).safeParse({...wire,summaryZh:[{sentence:"原文事实A。",evidence:ids}]}).success,false);
  const review=buildFisheryReviewRequest(input,manual.draft,"mock",{mode:"manual_revision"});
  assert.equal(review.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic binding only",evidence:ids.slice(0,12)}]}).success,true);
  assert.equal(review.schema.safeParse({decision:"supported",coverage:"complete_input",findings:[{field:"summaryZh.0",verdict:"supported",reason:"Synthetic forbidden extra",evidence:[ids[12]]}]}).success,false);
});

async function structuredIotcFixture() {
  const {fixture,input}=await iotcEntry9Fixture(),xml=await readFile(new URL("./fixtures/iotc-20261020-poppler-structure.xml",import.meta.url),"utf8"),mapped=mapPdfFootnotes(input.body,xml,6);
  const markers=[...mapped.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  const current={...input,observationRevision:2,body:mapped.text,bodySha256:sha256(mapped.text),pages:markers.map((m,i)=>({page:i+1,text:mapped.text.slice(m.index!+m[0].length,markers[i+1]?.index??mapped.text.length).trim()}))};
  return {fixture,input,xml,mapped,current};
}

test("structured Poppler superscripts preserve complete footnotes and map exact original/new offsets",async()=>{
  const {input,xml,mapped,current}=await structuredIotcFixture();
  assert.equal(current.bodySha256,"895f837dcf65fb9bea811968430a5052a474ec06819e624a798cf920dc54bef8");
  assert.equal(mapped.textEvidence.transformations.length,2);assert.equal(mapped.textEvidence.layoutSha256,input.bodySha256);assert.equal(mapped.textEvidence.structureSha256,sha256(xml));assert.equal(mapped.textEvidence.textSha256,current.bodySha256);
  assert.match(mapped.text,/1 January 2028\[1\]/);assert.match(input.body,/1 January 20281/);assert.match(mapped.text,/For Indonesia, paragraph 9 shall apply as of 1 January 2030\./);
  let restored=mapped.text;
  for(const t of [...mapped.textEvidence.transformations].reverse()) {
    assert.equal(input.body.slice(t.sourceStart,t.sourceEnd),t.sourceText);assert.equal(mapped.text.slice(t.outputStart,t.outputEnd),t.replacement);assert.ok(mapped.text.includes(t.footnoteText));
    assert.ok(t.reference.fontSize<t.base.fontSize);assert.ok(t.reference.top+t.reference.height<t.base.top+t.base.height);
    restored=restored.slice(0,t.outputStart)+t.sourceText+restored.slice(t.outputEnd);
  }
  assert.equal(restored,input.body,"Every other original byte/space/line is retained");
  assert.equal(mapped.textEvidence.transformations[1]!.footnoteLines.length,2);assert.match(mapped.textEvidence.transformations[1]!.footnoteText,/pp\. 136–138/);
  const plain="--- Page 1 ---\n整数20281。",plainXml='<pdf2xml><fontspec id="0" size="12"/><page number="1" width="600" height="800"><text top="50" left="50" width="120" height="12" font="0">整数20281。</text></page></pdf2xml>';
  assert.equal(mapPdfFootnotes(plain,plainXml,1).text,plain);assert.deepEqual(mapPdfFootnotes(plain,plainXml,1).textEvidence.transformations,[]);
  assert.throws(()=>mapPdfFootnotes(input.body.replace("times as of 1 January 20281:","times as of 1 January 20281: times as of 1 January 20281:"),xml,6),/not unique/);
  assert.throws(()=>mapPdfFootnotes(input.body,xml.replace('> For Indonesia, paragraph 9 shall apply as of 1 January 2030. </text>', '> </text>'),6),/unique same-page footnote/);
  const unchanged=mapPdfFootnotes(input.body,xml.replace('id="10" size="10"','id="10" size="17"'),6);
  assert.equal(unchanged.text,input.body,"Equal-size runs do not prove superscript separation");
  const sizes=assertFisheryPairFits(current);assert.ok(sizes.generationBytes<96000);assert.ok(sizes.reviewEnvelopeBytes<96000);
});

test("PDF transformation proof survives adapter, manifest JSON and strict observation schema",async()=>{
  const {mapped}=await structuredIotcFixture(),pdf=syntheticPdf();
  const raw=Buffer.from(ioHtml("Active").toString().replaceAll("26/01","26/03").replace(/Entry into force pending[^<]+/,"Synthetic active metadata; applicability unknown."));
  const parsed={...pdf.parsed,text:mapped.text,pages:6,parser:"Poppler 25.03.0/25.03.0/25.03.0; footnotes/v2",textEvidence:mapped.textEvidence};
  const result=prepareOfficial("iotc",receipt(raw,ioUrl),raw,{...pdf,parsed},"archive_replay");
  assert.equal(result.readyForReview,true,result.sourceCapture.conflicts.join("; "));assert.deepEqual(result.sourceCapture.pdfTextEvidence,mapped.textEvidence);
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-pdf-proof-"));
  try {
    const {body:_,...prepared}=result;
    await writeFile(path.join(dataDir,"manifest.json"),JSON.stringify({prepared}));
    const archived=JSON.parse(await readFile(path.join(dataDir,"manifest.json"),"utf8"));
    const observation=observationSchema.parse({...observationFixture,sourceCapture:archived.prepared.sourceCapture,rawSha256:result.sourceCapture.rawSha256,dates:result.dates,policyContext:result.policyContext});
    assert.deepEqual(observation.sourceCapture!.pdfTextEvidence,mapped.textEvidence);assert.equal(observation.sourceCapture!.bodySha256,mapped.textEvidence.textSha256);
    const wrong=prepareOfficial("iotc",receipt(raw,ioUrl),raw,{...pdf,parsed:{...parsed,text:parsed.text+"changed"}},"archive_replay");
    assert.equal(wrong.readyForReview,false);assert.match(wrong.sourceCapture.conflicts.join(";"),/different parsed body/);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("original IOTC entry10 stays rejected and an ambiguous 20281 source cannot authorize 2028 translation",async()=>{
  const {input,current}=await structuredIotcFixture(),fixture=JSON.parse(await readFile(new URL("./fixtures/ai-iotc-entry10-20261020.json",import.meta.url),"utf8")),original=JSON.stringify(fixture),wire=JSON.parse(fixture.rawContent),manual={mode:"manual_revision" as const};
  // Test-only use of the wider manual parser isolates the old output's semantic failures; it never rewrites or accepts that receipt as a manual revision.
  for(const source of [input,current]) assert.throws(()=>validateFisheryDraft(source,fisheryDraftWireSchema(buildEvidenceCatalog(source),manual).parse(wire),manual),/Actual fishing area/);
  const counterfactual=structuredClone(wire);counterfactual.locations=counterfactual.locations.filter((location:any)=>location.role!=="fishing_area");
  assert.throws(()=>validateFisheryDraft(input,fisheryDraftWireSchema(buildEvidenceCatalog(input),manual).parse(counterfactual),manual),/Calendar date/);
  assert.equal(JSON.stringify(fixture),original);
});


test("manual official archives require exact original bytes, complete deterministic bodies and ordinary review",async()=>{
  const {prepareManualSource,verifyManualSource,listManualSources}=await import("../backend/manual-sources.ts");
  const {readSourceBody}=await import("../backend/source-body.ts");
  const {captureSchema}=await import("../contracts.ts");
  const id="manual-archive-test",url="https://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm";
  const text="远洋渔业官方归档用于核对原文和完整附件。".repeat(12);
  const raw=Buffer.from(`<meta name="ArticleTitle" content="公开法规"><div class="TRS_Editor"><p>${text}</p><table><tr><td>最后表格</td><td>完整保留</td></tr></table><p>最后段落</p></div>`);
  const manifest={version:"manual-official-source/1",id,url,name:"公开法规",attribution:"官方归档来源",title:"公开法规",publishedAt:null,publicationLiteral:null,rawSha256:sha256(raw),bodySha256:"0".repeat(64),parser:"manual-official-html/v1",bodySelector:".TRS_Editor"};
  const receipt={requestedUrl:url,finalUrl:url,status:200,finishedAt:"2026-10-21T00:00:00Z",sha256:sha256(raw)};
  const parsed=await prepareManualSource(raw,manifest,receipt);
  assert.ok(parsed.body.endsWith("最后段落"));assert.ok(parsed.body.includes("最后表格完整保留"));
  assert.equal(parsed.sourceCapture.adapter,"manual_official");assert.equal(parsed.sourceCapture.acquisitionMode,"archive_replay");
  for(const status of [404,412]) await assert.rejects(prepareManualSource(raw,manifest,{...receipt,status}),/HTTP 200/);
  await assert.rejects(prepareManualSource(Buffer.concat([raw,Buffer.from("changed")]),manifest,receipt),/hashes/);
  await assert.rejects(prepareManualSource(raw,{...manifest,url:"https://example.com/"},receipt),/official URL/);
  await assert.rejects(prepareManualSource(raw,{...manifest,bodySelector:"body"},receipt),/selector/);
  assert.equal(captureSchema.safeParse({...parsed.sourceCapture,adapter:"moa"}).success,false);
  assert.equal(captureSchema.safeParse({...parsed.sourceCapture,archiveId:"old-archive"}).success,false);
  const payload={...observationFixture,rawSha256:sha256(raw),sourceCapture:parsed.sourceCapture};
  const relocated={...payload,sourceCapture:{...parsed.sourceCapture,manualArchiveId:"other-archive",capturedAt:"2026-10-22T00:00:00Z"}};
  assert.equal(evidenceIdentity(payload),evidenceIdentity(relocated));
  assert.notEqual(evidenceIdentity(payload),evidenceIdentity({...payload,sourceCapture:{...parsed.sourceCapture,bodySha256:"1".repeat(64)}}));
  assert.notEqual(evidenceIdentity(payload),evidenceIdentity({...payload,rawSha256:"2".repeat(64),sourceCapture:{...parsed.sourceCapture,rawSha256:"2".repeat(64)}}));
  const dataDir=await mkdtemp(path.join(tmpdir(),"manual-archives-")),dir=path.join(dataDir,"fishery-manual-archives",id);
  try {
    await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"manifest.json"),JSON.stringify({...manifest,bodySha256:sha256(parsed.body)}));
    await writeFile(path.join(dir,"receipt.json"),JSON.stringify(receipt));await writeFile(path.join(dir,"raw.bin"),raw);await writeFile(path.join(dir,"body.txt"),parsed.body);
    assert.equal((await verifyManualSource(dataDir,id)).body,parsed.body);
    const listed=(await listManualSources(dataDir))[0]!;
    assert.equal(listed.importable,true);assert.equal(listed.publishedAt,null);assert.equal(listed.publicationLiteral,null);assert.equal(listed.capturedAt,receipt.finishedAt);assert.deepEqual(listed.dates?.published,{precision:"unknown",value:null});
    await writeFile(path.join(dir,"body.txt"),parsed.body.slice(0,-10));
    await assert.rejects(verifyManualSource(dataDir,id),/complete deterministic/);
    assert.equal((await listManualSources(dataDir))[0]!.importable,false);
    await assert.rejects(verifyManualSource(dataDir,"../escape"));
    await assert.rejects(readSourceBody({manualArchiveId:"../escape",bodySha256:sha256(parsed.body)}),/Invalid manual archive/);
    assert.equal(await readSourceBody({bodySha256:null}),null);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});

test("manual PDF archives preserve all pages and fail on incomplete extraction or invented publication dates",async()=>{
  const {prepareManualSource}=await import("../backend/manual-sources.ts");
  const raw=Buffer.from("%PDF-synthetic original"),url="https://www.moa.gov.cn/govpublic/YYJ/202507/P020250731549012145690.pdf";
  const m={version:"manual-official-source/1",id:"pdf-test",url,name:"官方原件",attribution:"官方来源",title:"官方PDF",publishedAt:null,publicationLiteral:null,rawSha256:sha256(raw),bodySha256:"0".repeat(64),parser:"manual-official-pdf/v1"};
  const r={requestedUrl:url,finalUrl:url,status:200,finishedAt:"2026-10-21T00:00:00Z",sha256:sha256(raw)};
  const parsed={status:"parsed" as const,rawSha256:sha256(raw),parser:"Mock Poppler/v1",pages:2,text:"--- Page 1 ---\n完整第一页\n--- Page 2 ---\n完整第二页"};
  const result=await prepareManualSource(raw,m,r,{parsePdf:async()=>parsed});assert.equal(result.sourceCapture.attachmentPages,2);assert.ok(result.body.endsWith("完整第二页"));
  await assert.rejects(prepareManualSource(raw,m,r,{parsePdf:async()=>({...parsed,text:"--- Page 1 ---\n仅第一页"})}),/page coverage/);
  await assert.rejects(prepareManualSource(raw,{...m,publishedAt:"2025-07-14T00:00:00Z"},r,{parsePdf:async()=>parsed}),/publication date/);
  await assert.rejects(prepareManualSource(raw,m,r,{parsePdf:async()=>({...parsed,status:"failed",error:"missing parser"})}),/Full PDF parsing failed/);
});

test('explicit blank-page evidence preserves all physical pages without creating quotable facts or weakening ordinary PDF checks',async()=>{
  const {prepareManualSource}=await import('../backend/manual-sources.ts');
  const {pdfPages}=await import('../backend/flow.ts');
  const {catalogSource}=await import('../backend/evidence.ts');
  const raw=Buffer.from('%PDF-synthetic reviewed blank fixture'),rawSha256=sha256(raw);
  const text='--- Page 1 ---\n合成远洋资料第一条。\n\n--- Page 2 ---\n\n\n--- Page 3 ---\n最后一页限定条件必须保留。';
  const proof={version:'pdf-blank-review/1' as const,reviewId:'9d59308b-a508-4f80-86ab-8f5d46b8f251',rawSha256,physicalPages:3,pageImages:[{page:2,sha256:sha256('synthetic reviewed PNG')}],proofHash:sha256('synthetic audit only')};
  const parsed={status:'parsed' as const,rawSha256,parser:'Synthetic PDFKit',pages:3,text};
  const url='https://hyyyj.fujian.gov.cn/xxgk/tzgg/202507/P020250728594612073287.pdf';
  const manifest={version:'manual-official-source/1',id:'synthetic-reviewed-blank',url,name:'合成归档',attribution:'合成来源',title:'合成政策资料',publishedAt:null,publicationLiteral:null,rawSha256,bodySha256:sha256(text),parser:'manual-official-pdf/v1'};
  const receipt={requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:rawSha256};
  await assert.rejects(prepareManualSource(raw,manifest,receipt,{parsePdf:async()=>parsed}),/Unreviewed textless/);
  await assert.rejects(prepareManualSource(raw,{...manifest,blankReviewId:proof.reviewId},receipt,{parsePdf:async()=>parsed}),/Registered blank-page review/);
  const result=await prepareManualSource(raw,{...manifest,blankReviewId:proof.reviewId},receipt,{parsePdf:async()=>parsed,blankReview:proof});
  assert.equal(result.body,text);assert.equal(result.sourceCapture.attachmentPages,3);assert.deepEqual(result.sourceCapture.pdfTextlessPages,[2]);
  assert.deepEqual(result.dates.published,{precision:'unknown',value:null});assert.equal(result.sourceCapture.publishedAt,null);
  assert.throws(()=>pdfPages(text,3),/textless/);
  const pages=pdfPages(text,3,proof),input={body:text,bodySha256:sha256(text),observationRevision:1,pages,pdfBlankReview:proof};
  assert.equal(pages[1]!.text,'');assert.throws(()=>buildEvidenceCatalog({...input,pdfBlankReview:undefined}),/unreviewed textless/);
  const catalog=buildEvidenceCatalog(input);
  assert.equal(catalog.version,'fishery-spans-v4-reviewed-blanks');assert.equal(catalog.pages.length,3);assert.equal(catalog.spans.some(s=>s.page===2),false);
  assert.equal(catalog.spans.at(-1)!.quote,'最后一页限定条件必须保留。');
  assert.deepEqual(catalogSource(input,catalog).reviewedBlankPages,proof);
  for(const bad of [{...proof,rawSha256:sha256('different original')},{...proof,physicalPages:4},{...proof,pageImages:[{page:1,sha256:sha256('fake')}]},{...proof,pageImages:[...proof.pageImages,{page:3,sha256:sha256('fake')}]}]){
    await assert.rejects(prepareManualSource(raw,{...manifest,blankReviewId:proof.reviewId},receipt,{parsePdf:async()=>parsed,blankReview:bad}),/Blank-page review|Invalid/);
  }
  assert.notEqual(buildEvidenceCatalog({...input,pdfBlankReview:{...proof,proofHash:sha256('new review')}}).hash,catalog.hash);
  const plainBody='--- Page 1 ---\n正常页面不改变既有目录哈希。',plainInput={body:plainBody,bodySha256:sha256(plainBody),observationRevision:1,pages:[{page:1,text:'正常页面不改变既有目录哈希。'}]};
  const plain=buildEvidenceCatalog(plainInput),{hash,...bound}=plain;
  assert.equal(plain.version,'fishery-spans-v2');assert.equal('pdfBlankReview' in plain,false);assert.equal(hash,sha256(JSON.stringify(bound)));
  let calls=0;
  const execute=async()=>{calls++;return {stdout:JSON.stringify({pages:3,text}),stderr:''};};
  const blocked=await extractPdf(raw,{platform:'darwin',execute});assert.equal(blocked.status,'unverified');assert.equal(blocked.text,'');
  const accepted=await extractPdf(raw,{platform:'darwin',execute,blankReview:proof});assert.equal(accepted.status,'parsed');assert.equal(accepted.text,text);assert.equal(accepted.pages,3);
  assert.equal(calls,2,'Only local extraction stubs ran; no provider transport');
});

test("manual metadata query exceptions accept only the two exact inspected HTTPS identities",()=>{
  const urls=["https://zj.singlewindow.cn/pen-portal/guide/basic.jspa?id=196","https://www.ccs.org.cn/ccswz/columnDetail?columnid=201900002000000618"];
  for(const url of urls) {
    assert.equal(linkSchema.parse(url),url);
    const u=new URL(url),key=[...u.searchParams.keys()][0]!,value=u.searchParams.get(key)!;
    for(const invalid of [url+"&extra=1",url+`&${key}=${value}`,url.replace(value,value+"9"),url.replace("https:","http:"),url.replace(u.host,u.host+":8443"),url+"#fragment",url.replace("https://","https://user:pass@"),url.replace(value,"%"+value.charCodeAt(0).toString(16)+value.slice(1)),url.replace(u.hostname,"%"+u.hostname.charCodeAt(0).toString(16)+u.hostname.slice(1))])
      assert.equal(linkSchema.safeParse(invalid).success,false,invalid);
  }
  assert.equal(linkSchema.safeParse("https://example.org/metadata?id=196").success,false);
  assert.equal(linkSchema.parse("https://example.org/plain"),"https://example.org/plain","Other no-query identities retain their existing rule");
});

test("manual expanded HTML sources select inspected complete bodies and unique original titles",async()=>{
  const {prepareManualSource}=await import("../backend/manual-sources.ts");
  const text="合成公开服务说明，仅用于离线提取测试，不证明业务适用性。".repeat(6),tail="最后完整段落";
  const cases=[
    {url:"https://www.mawei.gov.cn/xjwz/zwgk/gggs/tzgg/202603/t20260309_5292976.htm",selector:".article_content",title:"集中申报公告",html:`<meta name="ArticleTitle" content="集中申报公告"><meta name="PubDate" content="2026-02-28 10:09"><span class="article_time">日期：2026-02-28 10:09</span><div class="article_content"><p>${text}</p><p>${tail}</p></div>`,literal:"2026-02-28 10:09",timestamp:"2026-02-28T02:09:00Z"},
    {url:"https://hyj.quanzhou.gov.cn/zfxxgk/zfxxgkml/zcfg/gfxwj/202507/t20250724_3193147.htm",selector:".article_content > .TRS_Editor",title:"扶持措施通知",html:`<meta name="ArticleTitle" content="扶持措施通知"><meta name="PubDate" content="2025-07-11"><span class="article_time">时间：2025-07-11 15:02</span><div class="article_content">${'<div class="TRS_Editor">'.repeat(20)}<p>${text}</p><p>${tail}</p>${'</div>'.repeat(20)}</div>`,literal:"2025-07-11",timestamp:null},
    {url:"https://hyj.quanzhou.gov.cn/zfxxgk/zc/xzgfxwj/202507/t20250728_3193952.htm",selector:".rules_text > .TRS_Editor",title:"专项资金规定",html:`<meta name="ArticleTitle" content="专项资金规定"><meta name="PubDate" content="2025-07-24"><div class="rules_text">${'<div class="TRS_Editor">'.repeat(16)}<p>${text}</p><p>${tail}</p>${'</div>'.repeat(16)}</div>`,literal:"2025-07-24",timestamp:null},
    {url:"https://zj.singlewindow.cn/pen-portal/guide/basic.jspa?id=196",selector:".localGuide",title:"地方特色应用——舟山智慧化一站式口岸监管服务平台",html:`<title>中国（浙江）国际贸易单一窗口</title><div class="localGuide"><div class="mainTitle">地方特色应用——舟山智慧化一站式口岸监管服务平台</div><p>${text}</p><p>${tail}</p></div>`,literal:null,timestamp:null},
    {url:"https://online.customs.gov.cn/static/pages/guides/000629009001/000629009001.html",selector:".layui-container.guide",title:"进口食品合格评定",html:`<meta name="ArticleTitle" content="办事指南卡片"><meta name="PubDate" content="2026-01-22 17:24"><div class="layui-container guide"><div class="header-title"><h3>进口食品合格评定<i class="layui-icon">图标</i></h3></div><p>${text}</p><p>${tail}</p></div>`,literal:"2026-01-22 17:24",timestamp:"2026-01-22T09:24:00Z"},
    {url:"https://www.ccs.org.cn/ccswz/columnDetail?columnid=201900002000000618",selector:".ccrj .p",title:"渔业船舶",html:`<title>渔业船舶</title><title>中国船级社</title><div class="ccrj"><h3 class="fnt_36">渔业船舶</h3><div class="p"><p>${text}</p><p>${tail}</p></div></div>`,literal:null,timestamp:null},
    {url:"https://gat.fujian.gov.cn/ztzl/cryjfwwj/bsxz_28282/202111/t20211115_5774073.htm",selector:".TRS_Editor",title:"外国人停留证件签发服务指南",html:`<meta name="ArticleTitle" content="外国人停留证件签发服务指南"><meta name="PubDate" content="2026-03-02 08:26"><span class="article_time">时间：2026-03-02 08:26</span><div class="TRS_Editor"><p>${text}</p><p>${tail}</p></div>`,literal:"2026-03-02 08:26",timestamp:"2026-03-02T00:26:00Z"},
  ];
  for(const c of cases) {
    const raw=Buffer.from(c.html),manifest={version:"manual-official-source/1",id:"expanded-html",url:c.url,name:"合成官方来源",attribution:"合成归属",title:c.title,publishedAt:c.timestamp,publicationLiteral:c.literal,rawSha256:sha256(raw),bodySha256:"0".repeat(64),parser:"manual-official-html/v1",bodySelector:c.selector};
    const receipt={requestedUrl:c.url,finalUrl:c.url,status:200,finishedAt:"2026-10-21T00:00:00Z",sha256:sha256(raw)};
    const result=await prepareManualSource(raw,manifest,receipt);
    assert.ok(result.body.endsWith(tail));assert.equal(result.body.split(text).length-1,1,"Nested editors must not duplicate the complete body");
    assert.deepEqual(result.dates.published,c.literal?{precision:"day",value:c.literal.slice(0,10)}:{precision:"unknown",value:null});
    assert.equal(result.sourceCapture.publishedAt,c.timestamp);
    await assert.rejects(prepareManualSource(raw,{...manifest,title:"伪造标题"},receipt),/title differs/);
    await assert.rejects(prepareManualSource(raw,manifest,{...receipt,finalUrl:c.url+"#changed"}),/official URL|metadata link/);
    if(c.url.includes("t20250724")) {
      const duplicate=Buffer.from(c.html.replace(/<\/div>$/,`<div class="TRS_Editor"><p>${text}</p></div></div>`));
      await assert.rejects(prepareManualSource(duplicate,{...manifest,rawSha256:sha256(duplicate)},{...receipt,sha256:sha256(duplicate)}),/Unique complete/);
      await assert.rejects(prepareManualSource(raw,{...manifest,publishedAt:"2025-07-11T00:00:00Z"},receipt),/precision/);
    }
  }
  const c=cases[0]!,raw=Buffer.from(c.html.replace("日期：2026-02-28 10:09","日期：2026-03-01 10:09")),manifest={version:"manual-official-source/1",id:"conflicting-date",url:c.url,name:"合成来源",attribution:"合成归属",title:c.title,publishedAt:null,publicationLiteral:null,rawSha256:sha256(raw),bodySha256:"0".repeat(64),parser:"manual-official-html/v1",bodySelector:c.selector},receipt={requestedUrl:c.url,finalUrl:c.url,status:200,finishedAt:"2026-10-21T00:00:00Z",sha256:sha256(raw)};
  assert.equal((await prepareManualSource(raw,manifest,receipt)).dates.published.precision,"unknown","Conflicting visible and metadata publication dates remain unknown");
  await assert.rejects(prepareManualSource(raw,{...manifest,publicationLiteral:c.literal,publishedAt:c.timestamp},receipt),/literal differs/);
});

test("manual added PDF identities retain full extraction, size and page-count limits",async()=>{
  const {prepareManualSource}=await import("../backend/manual-sources.ts");
  const urls=["https://www.mawei.gov.cn/xjwz/zwgk/gggs/tzgg/202603/P020260910638846579817.pdf","https://hyj.quanzhou.gov.cn/zwgk/fgwj/yyl/202508/P020250804347985996003.pdf","https://hyj.quanzhou.gov.cn/zfxxgk/zc/xzgfxwj/202507/P020251216619209074818.pdf"];
  for(const url of urls) {
    const raw=Buffer.from("%PDF-synthetic official original"),m={version:"manual-official-source/1",id:"extra-pdf",url,name:"合成PDF",attribution:"合成来源",title:"合成完整附件",publishedAt:null,publicationLiteral:null,rawSha256:sha256(raw),bodySha256:"0".repeat(64),parser:"manual-official-pdf/v1"},r={requestedUrl:url,finalUrl:url,status:200,finishedAt:"2026-10-21T00:00:00Z",sha256:sha256(raw)};
    const parsed={status:"parsed" as const,rawSha256:sha256(raw),parser:"Mock full parser",pages:2,text:"--- Page 1 ---\n第一页\n--- Page 2 ---\n完整末页"};
    const result=await prepareManualSource(raw,m,r,{parsePdf:async()=>parsed});assert.ok(result.body.endsWith("完整末页"));
    await assert.rejects(prepareManualSource(raw,m,r,{parsePdf:async()=>({...parsed,pages:201})}),/Full PDF parsing failed/);
    await assert.rejects(prepareManualSource(raw,m,r,{parsePdf:async()=>({...parsed,text:"--- Page 1 ---\n只有第一页"})}),/page coverage/);
    await assert.rejects(prepareManualSource(raw,m,r,{parsePdf:async()=>({...parsed,text:"--- Page 1 ---\n\n--- Page 2 ---\n"})}),/verified text required/);
    if(url===urls[0]) {
      const oversized=Buffer.alloc(10*1024*1024+1);oversized.write("%PDF-");let calls=0;
      await assert.rejects(prepareManualSource(oversized,{...m,rawSha256:sha256(oversized)},{...r,sha256:sha256(oversized)},{parsePdf:async()=>{calls++;return parsed;}}),/existing size limit/);
      assert.equal(calls,0,"Oversized PDFs must fail before invoking the parser");
    }
  }
});


test('NPFC mixed text and textless pages remain unverified even with complete page markers',async()=>{
 const f=npfcCacheFixture(),url=f.url,title='CMM 2026-01 Synthetic cache test',raw=Buffer.from(`<div class="region-content"><h1>${title}</h1><div class="field--name-field-file"><span class="file-link"><a href="${f.pdfUrl}">PDF</a></span></div></div>`),r={requestedUrl:url,finalUrl:url,status:200,finishedAt:'2026-10-23T00:00:00Z',sha256:sha256(raw)},p={status:'parsed' as const,rawSha256:sha256(f.pdf),parser:'synthetic/v1',pages:2,text:'--- Page 1 ---\nCMM 2026-01 Complete first-page text.\n--- Page 2 ---\n'};
 const result=prepareNpfc({url,title,number:'2026-01',effectiveLiteral:null,listDate:null,priority:'direct'},r,raw,{bytes:f.pdf,receipt:{...r,requestedUrl:f.pdfUrl,finalUrl:f.pdfUrl,sha256:sha256(f.pdf)},parsed:p});
 assert.equal(result.readyForReview,false);assert.equal(result.body,null);assert.equal(result.sourceCapture.parseStatus,'unverified');
 assert.deepEqual(result.sourceCapture.pdfTextlessPages,[2]);
});
test('historical parsed PDF metadata cannot bypass textless-page input or observation gates',async()=>{
 const {pdfPages}=await import('../backend/flow.ts');
 assert.throws(()=>pdfPages('--- Page 1 ---\nCMM2026 synthetic text\n--- Page 2 ---\n',2),/textless/);
 const f=npfcCacheFixture(),raw=Buffer.from(`<div class="region-content"><h1>CMM 2026-01 Synthetic cache test</h1><div class="field--name-field-file"><span class="file-link"><a href="${f.pdfUrl}">PDF</a></span></div></div>`),r={requestedUrl:f.url,finalUrl:f.url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'},p=prepareNpfc({url:f.url,title:'CMM 2026-01 Synthetic cache test',number:'2026-01',effectiveLiteral:null,listDate:null,priority:'direct'},r,raw,{receipt:{...r,requestedUrl:f.pdfUrl,finalUrl:f.pdfUrl,sha256:sha256(f.pdf)},bytes:f.pdf,parsed:{status:'parsed',rawSha256:sha256(f.pdf),parser:'synthetic',pages:2,text:'--- Page 1 ---\nCMM 2026-01\n--- Page 2 ---\n'}});
 assert.equal(observationSchema.safeParse({...observationFixture,rawSha256:p.sourceCapture.rawSha256,sourceCapture:{...p.sourceCapture,parseStatus:'parsed',bodySha256:sha256('forged full text')}}).success,false);
});
test('PDF extraction marks a mixed untextual second page unverified on both installed runtime protocols',async()=>{
 const raw=pdfFixture();
 for(const platform of ['linux','darwin'] as const){
  const result=await extractPdf(raw,{platform,execute:async(program,args)=>{
   if(platform==='darwin')return {stdout:JSON.stringify({pages:2,text:'--- Page 1 ---\nCMM 2026-01 text.\n\n--- Page 2 ---\n'}),stderr:''};
   if(args[0]==='-v')return {stdout:'',stderr:`${program} version 25.03.0`};
   if(program==='pdfinfo')return {stdout:'Pages: 2\nEncrypted: no\n',stderr:''};
   if(program==='pdftotext')return {stdout:args[args.indexOf('-f')+1]==='1'?'CMM 2026-01 text.':'  \n',stderr:''};
   if(program==='pdftohtml')return {stdout:'<pdf2xml><fontspec id="0" size="12"/><page number="1" width="600" height="800"><text top="50" left="50" width="100" height="12" font="0">CMM 2026-01 text.</text></page><page number="2" width="600" height="800"></page></pdf2xml>',stderr:''};
   throw new Error('Unexpected synthetic command');
  }});
  assert.equal(result.status,'unverified',platform);assert.equal(result.text,'');assert.deepEqual(result.textlessPages,[2]);
 }
});

function sectionedNoticeFixture(two=false){
 const f=noticeFixture(),secondUrl=new URL('P0202507289999002.pdf',f.url).href;
 const webpage='网页完整原文：远洋渔业办理事项。\n本页明确载明全部申请限制与原文说明，不能省略这些实际网页内容。';
 const html=f.landing().replace(f.title+'</div>',webpage+'</div>').replace('</ul>',two?`<li><a href="${secondUrl}">第二份政策附件.pdf</a></li></ul>`:'</ul>');
 const raw=Buffer.from(html),receipt={requestedUrl:f.url,finalUrl:f.url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'};
 const second=Buffer.from('%PDF-second-synthetic'),texts=[f.text,'--- Page 1 ---\n第二份附件完整事实。'];
 const files=[f.pdf,...(two?[second]:[])].map((bytes,i)=>({bytes,receipt:{...receipt,requestedUrl:i?secondUrl:f.pdfUrl,finalUrl:i?secondUrl:f.pdfUrl,sha256:sha256(bytes)},parsed:{status:'parsed' as const,rawSha256:sha256(bytes),parser:'synthetic/v1',pages:i?1:2,text:texts[i]!}}));
 const prepared=prepareNotice(receipt,raw,files);assert.ok(prepared.body);
 const input={...idTestInput(prepared.body),sections:noticeEvidenceSections(prepared.body,prepared.sourceCapture)};
 return {f,prepared,input,files,receipt,raw,webpage};
}
test('Notice evidence preserves complete webpage plus each PDF with distinct physical-page provenance',async()=>{
 for(const two of [false,true]){
  const {prepared,input,webpage}=sectionedNoticeFixture(two),catalog=buildEvidenceCatalog(input),source=JSON.parse(buildFisheryDraftRequest(input,'mock').user as string);
  assert.equal(catalog.version,'fishery-spans-v3-sections');assert.equal(source.body,prepared.body);assert.ok(source.body.startsWith(webpage));
  assert.equal(catalog.sections!.length,two?3:2);assert.equal(catalog.pages.length,two?3:2);
  assert.deepEqual(catalog.pages.map(p=>[p.source!.id,p.page]),two?[['attachment-1',1],['attachment-1',2],['attachment-2',1]]:[['attachment-1',1],['attachment-1',2]]);
  assert.ok(catalog.spans.some(s=>s.source?.id==='webpage'&&s.quote.includes('全部申请限制')));
  for(const span of catalog.spans){assert.equal(input.body.slice(span.start,span.end),span.quote);assert.equal(span.source!.url,catalog.sections!.find(section=>section.id===span.source!.id)!.sourceUrl);}
  assert.equal(new Set(catalog.spans.map(s=>s.id)).size,catalog.spans.length);
  assert.ok(catalog.spans.every(s=>!s.quote.startsWith('附件：')&&!s.quote.startsWith('原件：')),'Generated provenance labels are excluded from factual evidence');
  const last=catalog.spans.at(-1)!,draft=buildFisheryDraftRequest(input,'mock').schema.parse({...idTestDraft(),summaryZh:[{sentence:last.quote,evidence:[last.id]}]});
  assert.deepEqual(draft.summaryZh[0]!.evidence[0]!.source,last.source);validateFisheryDraft(input,draft);
  const reviewed=await reviewFisheryDraft(input,draft,'mock',async options=>({data:options.schema.parse({decision:'supported',coverage:'complete_input',findings:[{field:'summaryZh.0',verdict:'supported',reason:'Offline ID expansion only',evidence:[last.id]}]}),receiptId:999,model:'mock',usage:null,reused:false}));
  assert.deepEqual(reviewed.review.findings[0]!.evidence[0]!.source,last.source);
  const mutated=structuredClone(draft);mutated.summaryZh[0]!.evidence[0]!.source!.url='https://example.org/wrong.pdf';
  assert.throws(()=>validateFisheryDraft(input,mutated),/Source-bound/);
  delete mutated.summaryZh[0]!.evidence[0]!.source;assert.throws(()=>validateFisheryDraft(input,mutated),/Source-bound/);
  const generatedParagraph=input.body.slice(0,input.body.indexOf('附件：')).split(/\n+/).filter(p=>p.trim()).length+1;
  const forged=structuredClone(draft);forged.summaryZh[0]!.evidence=[{quote:'附件：政策附件.pdf',paragraph:generatedParagraph,page:null}];
  assert.throws(()=>validateFisheryDraft(input,forged),/Source-bound/);
 }
});
test('Notice metadata rejects missing pages, malformed spans and truncated source; provenance changes invalidate saved binding',()=>{
 const {prepared,input,receipt,raw,files}=sectionedNoticeFixture(true),binding=evidenceBinding(buildEvidenceCatalog(input));
 for(const mutate of [
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.pageBody!.bodyEnd--;},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.pageBody!.sourceUrl='https://example.org/notice';},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.pageBody!.rawSha256=sha256('altered raw');},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[0]!.bodyStart!++;},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[0]!.pageIntervals![0]!.end--;},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[0]!.pageIntervals!.pop();},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[1]!.pages=2;},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[1]!.url='https://example.org/replaced.pdf';},
  (c:typeof prepared.sourceCapture)=>{c.noticeContext!.attachments[1]!.textSha256=sha256('truncated');},
 ]){const capture=structuredClone(prepared.sourceCapture);mutate(capture);assert.throws(()=>noticeEvidenceSections(input.body,capture));}
 for(const mutate of [(s:typeof input.sections)=>{s[1]!.rawSha256=sha256('changed PDF raw');},(s:typeof input.sections)=>{s[0]!.sourceUrl='https://example.org/other-webpage';}]){
  const sections=structuredClone(input.sections);mutate(sections);assert.throws(()=>assertEvidenceBinding({...input,sections},binding),/changed/);
 }
 assert.throws(()=>buildEvidenceCatalog({...input,body:input.body.slice(0,-1),bodySha256:sha256(input.body.slice(0,-1))}),/section/);
 const omit=prepareNotice(receipt,raw,[files[0]!]);assert.equal(omit.body,null);
 const truncated=prepareNotice(receipt,raw,[{...files[0]!,parsed:{...files[0]!.parsed,text:'--- Page 1 ---\n只有第一页。'}},files[1]!]);assert.equal(truncated.body,null);
 const old=structuredClone(prepared.sourceCapture);old.parser='official-column/fujian-notices/v1';delete old.noticeContext!.evidenceVersion;delete old.noticeContext!.pageBody;
 assert.ok(observationSchema.shape.sourceCapture.parse(old));assert.throws(()=>noticeEvidenceSections(input.body,old),/recapture/);
});
test('Sectioned notices retain short actual webpage content while legacy single-PDF catalogs retain v2 hash and anchor shape',()=>{
 const f=noticeFixture(),raw=Buffer.from(f.landing()),r={requestedUrl:f.url,finalUrl:f.url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'};
 const prepared=prepareNotice(r,raw,[{bytes:f.pdf,receipt:{...r,requestedUrl:f.pdfUrl,finalUrl:f.pdfUrl,sha256:sha256(f.pdf)},parsed:{status:'parsed',rawSha256:sha256(f.pdf),parser:'synthetic/v1',pages:2,text:f.text}}]);
 assert.ok(prepared.body!.startsWith(f.title));assert.ok(buildEvidenceCatalog({...idTestInput(prepared.body!),sections:noticeEvidenceSections(prepared.body!,prepared.sourceCapture)}).spans.some(s=>s.source!.id==='webpage'&&s.quote===f.title));
 const body='--- Page 1 ---\n旧版完整事实。',input={...idTestInput(body),pages:[{page:1,text:'旧版完整事实。'}]},catalog=buildEvidenceCatalog(input);
 const bound={version:'fishery-spans-v2',bodySha256:sha256(body),observationRevision:input.observationRevision,spans:[{id:'p2s1',quote:'旧版完整事实。',paragraph:2,page:1,start:15,end:22}],pages:[{page:1,start:15,end:22}]};
 assert.equal(catalog.hash,sha256(JSON.stringify(bound)));assert.deepEqual(catalog,{...bound,hash:sha256(JSON.stringify(bound))});
 const draft=buildFisheryDraftRequest(input,'mock').schema.parse({...idTestDraft(),summaryZh:[{sentence:'旧版完整事实。',evidence:['p2s1']}]});
 assert.deepEqual(draft.summaryZh[0]!.evidence,[{quote:'旧版完整事实。',paragraph:2,page:1}]);
});

test('Legacy PDF evidence refuses a textless physical page even when old parsed metadata and markers claim completeness',()=>{
 const body='--- Page 1 ---\n完整第一页。\n--- Page 2 ---\n',input={...idTestInput(body),pages:[{page:1,text:'完整第一页。'},{page:2,text:''}]};
 assert.throws(()=>buildEvidenceCatalog(input),/page intervals/);
 assert.throws(()=>buildFisheryDraftRequest(input,'mock'),/page intervals/);
});

test('NPFC unavailable PDFs retain independently verified landing attachment identity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'npfc-unavailable-')),f=npfcCacheFixture();
 try{
  for(const failure of ['404','timeout','nonpdf'] as const){
   const b=await collectColumns({id:'landing-only-'+failure,dataDir:dir,columns:['npfc'],limit:1,wait:async()=>{},fetch:f.fetch(async()=>{
    if(failure==='timeout')throw new Error('Synthetic PDF timeout');
    return f.response(failure==='404'?404:200,Buffer.from('unavailable'));
   })});
   const item=b.items[0];assert.equal(item.state,'failed');assert.equal(item.prepared!.sourceCapture.attachmentUrl,f.pdfUrl);
   item.prepared!.sourceCapture.attachmentUrl='https://www.npfc.int/system/files/forged.pdf';
   const p=await verifyBatchItem(dir,b,item);assert.equal(p.sourceCapture.attachmentUrl,f.pdfUrl);assert.equal(p.sourceCapture.attachmentSha256,null);assert.equal(p.sourceCapture.parseStatus,'unverified');assert.equal(p.body,null);assert.equal(p.readyForReview,false);
   const raw=path.join(batchRoot(dir),b.id,'raw');
   if(failure!=='timeout')assert.equal(JSON.parse(await readFile(path.join(raw,item.archiveId+'-pdf-response.receipt.json'),'utf8')).status,failure==='404'?404:200);
  }
  const capture=async(id:string,mode:'landing-failed'|'title-mismatch'|'foreign-link'|'list-mismatch')=>collectColumns({id,dataDir:dir,columns:['npfc'],limit:1,wait:async()=>{},fetch:async url=>{
   const response=await f.fetch(async()=>f.response(404,Buffer.from('missing')))(url);
   if(url===f.url){
    if(mode==='landing-failed')response.status=404;
    if(mode==='title-mismatch')response.body=Buffer.from(response.body.toString().replace('CMM 2026-01 Synthetic cache test','CMM 2025-01 Other version'));
    if(mode==='foreign-link')response.body=Buffer.from(response.body.toString().replace(f.pdfUrl,'https://example.org/forged.pdf'));
   }
   if(url===COLUMNS.npfc.url&&mode==='list-mismatch')response.body=Buffer.from(response.body.toString().replace('CMM 2026-01 Synthetic cache test','CMM 2025-01 Other version'));
   return response;
  }});
  for(const mode of ['landing-failed','title-mismatch','foreign-link','list-mismatch'] as const){
   const b=await capture('untrusted-'+mode,mode);
   if(mode==='foreign-link')await assert.rejects(verifyBatchItem(dir,b,b.items[0]),/unambiguous/);
   else{const p=await verifyBatchItem(dir,b,b.items[0]);assert.ok(p.sourceCapture.httpStatus!==200||p.sourceCapture.conflicts.length>0);assert.equal(p.readyForReview,false);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
