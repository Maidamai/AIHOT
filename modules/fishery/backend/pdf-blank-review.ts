// Controlled administrative operations only. Neither missing text nor pixels automatically classify a page.
import { constants } from 'node:fs';
import { open, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { sql } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';
import { pdfBlankProofSchema, pdfBlankPageImageSchema, type PdfBlankProof } from './pdf-blank-proof.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/),hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const rendererSchema=z.strictObject({name:z.string().min(1).max(100),version:z.string().min(1).max(200),options:z.string().min(1).max(500)});
const receiptSchema=z.strictObject({reviewId:z.uuid(),rawSha256:digest,physicalPages:z.int().min(2).max(200),pageImages:z.array(pdfBlankPageImageSchema).min(1).max(199),renderer:rendererSchema,renderedAt:z.iso.datetime()});
const inputSchema=z.strictObject({reviewId:z.uuid(),expectedRawSha256:digest,expectedPageHashes:z.array(pdfBlankPageImageSchema).min(1).max(199),confirmation:z.literal('confirmed_blank'),reason:z.string().trim().min(1).max(2000),executorKind:z.enum(['human','authorized_agent'])});
const recordSchema=z.strictObject({version:z.literal('pdf-blank-review/1'),...receiptSchema.shape,actor:z.string().trim().min(1).max(300),reviewedAt:z.iso.datetime(),reason:z.string().trim().min(1).max(2000),confirmation:z.literal('confirmed_blank'),executorKind:z.enum(['human','authorized_agent'])});
const sealedRecordSchema=recordSchema.extend({proofHash:digest});
type Receipt=z.infer<typeof receiptSchema>;
type Execute=(file:string,args:string[],options:{timeout:number;maxBuffer:number;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string}>;
// Only used by deterministic tests, as with extractPdf. Production callers omit these options; manifests never supply them.
type TestOptions={platform?:NodeJS.Platform;execute?:Execute;now?:()=>Date};
function checkTestOptions(options:TestOptions){if(Object.keys(options).length&&!process.env.NODE_TEST_CONTEXT)throw new Error('Renderer overrides are available only inside the Node test runner');}
const execute:Execute=promisify(execFile),LIMIT=20*1024*1024,TOTAL_LIMIT=64*1024*1024;
const rootFor=(dataDir:string)=>path.join(path.resolve(dataDir),'fishery-pdf-blank-reviews');
const directoryFor=(dataDir:string,id:string)=>path.join(rootFor(dataDir),z.uuid().parse(id));
const encoded=(value:unknown)=>JSON.stringify(value);
function checkRaw(raw:Buffer){if(raw.length>10*1024*1024||!raw.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('Invalid PDF signature or byte limit');}
function checkPages(pages:number[],physicalPages:number){
 if(!pages.length||pages.length>=physicalPages||pages.some((page,i)=>!Number.isInteger(page)||page<1||page>physicalPages||i>0&&page<=pages[i-1]!))throw new Error('Blank-review pages require strictly increasing partial physical coverage');
}
async function regularBytes(file:string,limit:number){
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit)throw new Error('Review file is not a bounded regular file');return await handle.readFile();}finally{await handle.close();}
}
function checkPng(bytes:Buffer){
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>8192||bytes.readUInt32BE(20)>8192||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16_000_000)throw new Error('Renderer did not produce a bounded full-page PNG');
}
async function checkDirectory(dataDir:string,id:string){
 for(const dir of [rootFor(dataDir),directoryFor(dataDir,id)]){const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Review directory cannot be a symbolic link');}
}
async function imagesFor(dataDir:string,receipt:Receipt){
 await checkDirectory(dataDir,receipt.reviewId);let total=0;
 for(const image of receipt.pageImages){const bytes=await regularBytes(path.join(directoryFor(dataDir,receipt.reviewId),`${image.sha256}.png`),LIMIT);total+=bytes.length;if(total>TOTAL_LIMIT)throw new Error('Review image aggregate byte limit');checkPng(bytes);if(hash(bytes)!==image.sha256)throw new Error('Review PNG hash changed');}
}
async function render(raw:Buffer,pages:number[],options:TestOptions){
 checkTestOptions(options);checkRaw(raw);const snapshot=Buffer.from(raw),scratch=await mkdtemp(path.join(tmpdir(),'fishery-blank-render-')),run=options.execute??execute,deadline=Date.now()+60000;
 const command=async(file:string,args:string[])=>{const remaining=deadline-Date.now();if(remaining<=0)throw new Error('PDF render deadline exceeded');const out=await run(file,args,{timeout:remaining,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',TMPDIR:scratch}});if(Buffer.byteLength(out.stdout)+Buffer.byteLength(out.stderr)>4*1024*1024)throw new Error('PDF renderer diagnostics byte limit');return out;};
 try{
  const file=path.join(scratch,'original.pdf');await writeFile(file,snapshot,{flag:'wx',mode:0o600});
  let physicalPages:number,renderer:z.infer<typeof rendererSchema>,files:{page:number;file:string}[];
  if((options.platform??process.platform)==='linux'){
   const infoVersion=await command('/usr/bin/pdfinfo',['-v']),pngVersion=await command('/usr/bin/pdftoppm',['-v']);
   const iv=/pdfinfo version ([0-9.]+)/.exec(infoVersion.stdout+infoVersion.stderr)?.[1],pv=/pdftoppm version ([0-9.]+)/.exec(pngVersion.stdout+pngVersion.stderr)?.[1];if(!iv||!pv)throw new Error('Unidentified trusted Poppler renderer');
   const info=await command('/usr/bin/pdfinfo',['-enc','UTF-8',file]);physicalPages=Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
   if(info.stderr.trim()||!/^Encrypted:\s+no\s*$/m.test(info.stdout)||!Number.isInteger(physicalPages)||physicalPages<2||physicalPages>200)throw new Error('Unreadable, encrypted or excessive PDF coverage');
   checkPages(pages,physicalPages);renderer={name:'Poppler pdftoppm',version:`pdfinfo ${iv}; pdftoppm ${pv}`,options:'mediaBox; 144 dpi; PNG; annotations included; no crop, OCR or blank classification'};files=[];let renderedBytes=0;
   for(const page of pages){
    const geometry=await command('/usr/bin/pdfinfo',['-f',String(page),'-l',String(page),'-box','-enc','UTF-8',file]);
    const box=new RegExp(`^Page\\s+${page}\\s+MediaBox:\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s*$`,'m').exec(geometry.stdout)?.slice(1).map(Number);
    if(geometry.stderr.trim()||!box||box.some(v=>!Number.isFinite(v))||box[2]!-box[0]!<=0||box[3]!-box[1]!<=0||box[2]!-box[0]!>2000||box[3]!-box[1]!>2000)throw new Error('Bounded complete PDF media box required');
    const prefix=path.join(scratch,`page-${page}`),out=await command('/usr/bin/pdftoppm',['-f',String(page),'-l',String(page),'-r','144','-png','-singlefile',file,prefix]);if(out.stdout.trim()||out.stderr.trim())throw new Error('PDF rendering diagnostics require review');const png=await regularBytes(`${prefix}.png`,LIMIT);checkPng(png);renderedBytes+=png.length;if(renderedBytes>TOTAL_LIMIT)throw new Error('Review image aggregate byte limit');files.push({page,file:`${prefix}.png`});}
  }else if((options.platform??process.platform)==='darwin'){
   const script=path.resolve(import.meta.dirname,'../scripts/pdf-blank-render.swift'),scriptBytes=await regularBytes(script,1024*1024),outDir=path.join(scratch,'pages');
   const out=await command('/usr/bin/swift',['-module-cache-path',path.join(scratch,'cache'),script,file,outDir,...pages.map(String)]);if(out.stderr.trim())throw new Error('PDF rendering diagnostics require review');
   const data=z.strictObject({renderer:z.literal('Apple PDFKit full-mediaBox thumbnail'),version:z.string().min(1).max(100),options:z.literal('mediaBox; requested 2 pixels/point; no crop, OCR or blank classification'),physicalPages:z.int().min(2).max(200),pages:z.array(z.object({page:z.int(),file:z.string(),width:z.number(),height:z.number(),mediaBox:z.unknown(),rotation:z.number()})).min(1).max(199)}).parse(JSON.parse(out.stdout));
   physicalPages=data.physicalPages;checkPages(pages,physicalPages);if(data.pages.length!==pages.length||data.pages.some((p,i)=>p.page!==pages[i]||p.file!==`page-${p.page}.png`))throw new Error('Swift renderer page receipt mismatch');
   renderer={name:data.renderer,version:data.version,options:`${data.options}; scriptSHA256:${hash(scriptBytes)}`};files=data.pages.map(p=>({page:p.page,file:path.join(outDir,p.file)}));
  }else throw new Error('Trusted local PDF renderer unavailable');
  let total=0;const images=[];
  for(const p of files){const bytes=await regularBytes(p.file,LIMIT);total+=bytes.length;if(total>TOTAL_LIMIT)throw new Error('Review image aggregate byte limit');checkPng(bytes);images.push({page:p.page,sha256:hash(bytes),bytes});}
  return {rawSha256:hash(snapshot),physicalPages,renderer,images};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function preparePdfBlankReview(dataDir:string,raw:Buffer,pages:number[],options:TestOptions={}){
 const rendered=await render(raw,pages,options),reviewId=randomUUID(),receipt=receiptSchema.parse({reviewId,rawSha256:rendered.rawSha256,physicalPages:rendered.physicalPages,pageImages:rendered.images.map(({page,sha256})=>({page,sha256})),renderer:rendered.renderer,renderedAt:(options.now?.()??new Date()).toISOString()});
 await mkdir(rootFor(dataDir),{recursive:true,mode:0o700});const base=await lstat(rootFor(dataDir));if(!base.isDirectory()||base.isSymbolicLink())throw new Error('Review directory cannot be a symbolic link');
 const dir=directoryFor(dataDir,reviewId);await mkdir(dir,{mode:0o700});
 for(const image of new Map(rendered.images.map(image=>[image.sha256,image])).values())await writeFile(path.join(dir,`${image.sha256}.png`),image.bytes,{flag:'wx',mode:0o600});
 await writeFile(path.join(dir,'render.json'),encoded(receipt),{flag:'wx',mode:0o600});return receipt;
}
export async function recordPdfBlankReview(dataDir:string,raw:Buffer,input:unknown,actor:string,options:TestOptions={}):Promise<PdfBlankProof>{
 const request=inputSchema.parse(input);checkRaw(raw);if(hash(raw)!==request.expectedRawSha256)throw new Error('Review original PDF hash mismatch');
 await checkDirectory(dataDir,request.reviewId);const receipt=receiptSchema.parse(JSON.parse((await regularBytes(path.join(directoryFor(dataDir,request.reviewId),'render.json'),1024*1024)).toString('utf8')));
 if(receipt.reviewId!==request.reviewId||receipt.rawSha256!==request.expectedRawSha256||encoded(receipt.pageImages)!==encoded(request.expectedPageHashes))throw new Error('Reviewed render receipt changed');
 checkPages(receipt.pageImages.map(p=>p.page),receipt.physicalPages);await imagesFor(dataDir,receipt);
 const rerendered=await render(raw,receipt.pageImages.map(p=>p.page),options);
 if(rerendered.rawSha256!==receipt.rawSha256||rerendered.physicalPages!==receipt.physicalPages||encoded(rerendered.renderer)!==encoded(receipt.renderer)||encoded(rerendered.images.map(({page,sha256})=>({page,sha256})))!==encoded(receipt.pageImages))throw new Error('Trusted local rerender differs from reviewed page images');
 const record=recordSchema.parse({version:'pdf-blank-review/1',...receipt,actor,reviewedAt:(options.now?.()??new Date()).toISOString(),reason:request.reason,confirmation:request.confirmation,executorKind:request.executorKind}),proofHash=hash(encoded(record));
 const proof=pdfBlankProofSchema.parse({version:record.version,reviewId:record.reviewId,rawSha256:record.rawSha256,physicalPages:record.physicalPages,pageImages:record.pageImages,proofHash});
 await sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`pdf-blank-review:${record.reviewId}`},0))`;if((await tx`SELECT 1 FROM audit_log WHERE subject=${`pdf-blank-review:${record.reviewId}`} LIMIT 1`).length)throw new Error('Blank review already registered; preserve original audit');await imagesFor(dataDir,receipt);await audit(record.actor,'fishery.pdf_blank_review',`pdf-blank-review:${record.reviewId}`,record.reason,null,{...record,proofHash},{db:tx});});
 return proof;
}
export async function loadVerifiedPdfBlankReview(dataDir:string,raw:Buffer,reviewId:string):Promise<PdfBlankProof>{
 checkRaw(raw);z.uuid().parse(reviewId);const rows=await sql`SELECT actor,reason,after FROM audit_log WHERE subject=${`pdf-blank-review:${reviewId}`} AND action='fishery.pdf_blank_review' ORDER BY id`;
 if(rows.length!==1)throw new Error('Unique audited blank-page review required');
 const sealed=sealedRecordSchema.parse(rows[0]!.after),{proofHash,...record}=sealed;
 if(record.reviewId!==reviewId||record.rawSha256!==hash(raw)||rows[0]!.actor!==record.actor||rows[0]!.reason!==record.reason||hash(encoded(recordSchema.parse(record)))!==proofHash)throw new Error('Blank-review audit or original PDF hash changed');
 const proof=pdfBlankProofSchema.parse({version:record.version,reviewId:record.reviewId,rawSha256:record.rawSha256,physicalPages:record.physicalPages,pageImages:record.pageImages,proofHash});
 await imagesFor(dataDir,record);return proof;
}
