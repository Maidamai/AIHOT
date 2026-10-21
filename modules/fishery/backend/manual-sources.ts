// Explicit imports of operator-uploaded public archives. No acquisition, model calls or approval.
import { readFile, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { z } from "zod";
import { config } from "@aihot/backend/config";
import { readPublicationDate } from "@aihot/backend/sources/dates";
import { beijingDate } from "@aihot/contracts/time";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import type { FastifyInstance } from "fastify";
import { captureSchema, linkSchema } from "../contracts.ts";
import { archiveReceiptSchema, sha256, type PdfText } from "./source-adapters.ts";
import { extractPdf } from "./pdf-text.ts";
import { importCapturedMaterial } from "./store.ts";

export const manualArchiveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const manualManifestSchema = z.strictObject({
  version: z.literal("manual-official-source/1"), id: manualArchiveIdSchema, url: linkSchema,
  name: z.string().trim().min(1).max(300), attribution: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(500),
  publishedAt: z.iso.datetime({offset:true}).nullable(), publicationLiteral: z.string().max(150).nullable(),
  rawSha256: digest, bodySha256: digest,
  parser: z.enum(["manual-official-html/v1", "manual-official-pdf/v1"]), bodySelector: z.string().max(80).optional(),
});
const known = new Map([
  ["http://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm", ".TRS_Editor"],
  ["https://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm", ".TRS_Editor"],
  ["http://fgs.moa.gov.cn/flfg/202508/t20250801_6476253.htm", ".TRS_Editor"],
  ["https://fgs.moa.gov.cn/flfg/202508/t20250801_6476253.htm", ".TRS_Editor"],
  ["https://www.hunan.gov.cn/zqt/zcsd/202405/t20240506_33293093.html", "#zoom"],
  ["https://www.moa.gov.cn/govpublic/YYJ/202507/P020250731549012145690.pdf", "pdf"],
]);
const collapse = (s:string) => s.replace(/\s+/g," ").trim();
const unknown = () => ({precision:"unknown" as const,value:null});
export async function prepareManualSource(raw:Buffer, input:unknown, receiptInput:unknown, options:{parsePdf?:(raw:Buffer)=>Promise<PdfText>}={}) {
  const manifest=manualManifestSchema.parse(input),receipt=archiveReceiptSchema.parse(receiptInput),selector=known.get(manifest.url);
  if(!selector || receipt.requestedUrl!==manifest.url || receipt.finalUrl!==manifest.url) throw new Error("Manual archive URL is not the verified official URL");
  if(receipt.status!==200 || !raw.length || raw.length>20*1024*1024 || sha256(raw)!==receipt.sha256 || receipt.sha256!==manifest.rawSha256) throw new Error("HTTP 200 original bytes and matching receipt/manifest hashes required");
  let body:string, pdf:PdfText|undefined;
  let published=unknown() as {precision:"unknown"|"day";value:string|null};
  if(selector==="pdf") {
    if(manifest.parser!=="manual-official-pdf/v1" || manifest.bodySelector || !raw.subarray(0,5).equals(Buffer.from("%PDF-"))) throw new Error("Expected original PDF archive");
    if(manifest.publishedAt!==null || manifest.publicationLiteral!==null) throw new Error("PDF web publication date is unknown; signature dates are not publication metadata");
    pdf=await(options.parsePdf??extractPdf)(raw);
    if(pdf.status!=="parsed" || pdf.rawSha256!==sha256(raw) || !pdf.text || pdf.pages<1) throw new Error(`Full PDF parsing failed: ${pdf.error??pdf.status}`);
    const markers=[...pdf.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
    if(markers.length!==pdf.pages || markers.some((m,i)=>Number(m[1])!==i+1)) throw new Error("Full PDF page coverage required");
    body=pdf.text;
  } else {
    if(manifest.parser!=="manual-official-html/v1" || manifest.bodySelector!==selector) throw new Error("Expected verified official HTML selector");
    const $=cheerio.load(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    const title=collapse($("meta[name=ArticleTitle]").attr("content")||$("h1").first().text());
    if(!title || collapse(manifest.title)!==title) throw new Error("HTML title differs from original metadata");
    const nodes=$(selector);
    if(nodes.length!==1) throw new Error("Unique complete official body container required");
    const content=nodes.clone();content.find("script,style,iframe,form,noscript").remove();
    content.find("p,br,div,li,tr,h1,h2,h3,h4,table").append("\n");
    body=content.text().split(/\n+/).map(collapse).filter(Boolean).join("\n");
    if(body.length<100 || /<html|访问异常|访问验证|验证码/.test(body.slice(0,150))) throw new Error("Official full body missing or blocked");
    const literal=collapse($("meta[name=PubDate]").attr("content")||"")||null;
    // Operator may preserve unknown dates, but may not invent a precise publication time.
    if(manifest.publicationLiteral!==null && manifest.publicationLiteral!==literal) throw new Error("Publication literal differs from original metadata");
    if(manifest.publishedAt) {
      const parsed=literal?readPublicationDate(literal,"+08:00"):null;
      if(!parsed?.publishedAt || new Date(parsed.publishedAt).toISOString()!==new Date(manifest.publishedAt).toISOString()) throw new Error("Publication timestamp differs from original metadata");
      published={precision:"day",value:beijingDate(parsed.publishedAt)};
    }
  }
  if(Buffer.byteLength(body)>4*1024*1024) throw new Error("Manual body oversized");
  const sourceCapture=captureSchema.parse({adapter:"manual_official",manualArchiveId:manifest.id,acquisitionMode:"archive_replay",sourceUrl:manifest.url,capturedAt:receipt.finishedAt,httpStatus:200,
    rawSha256:sha256(raw),bodySha256:sha256(body),parser:pdf?`${manifest.parser}; ${pdf.parser}`.slice(0,100):manifest.parser,parseStatus:"parsed",attachmentSha256:null,
    attachmentPages:pdf?.pages??null,pdfTextEvidence:pdf?.textEvidence,publishedAt:manifest.publishedAt,publicationLiteral:manifest.publicationLiteral,conflicts:[]});
  return {manifest,body,sourceCapture,dates:{published,event:unknown(),adopted:unknown(),effectiveFrom:unknown(),effectiveUntil:unknown()}};
}
async function bounded(file:string,max:number) {
  const stat=await lstat(file);if(!stat.isFile()||stat.size>max) throw new Error("Archive file missing, linked or oversized");
  const bytes=await readFile(file);if(bytes.length>max) throw new Error("Archive file oversized");return bytes;
}
export async function verifyManualSource(dataDir:string,id:string,options:Parameters<typeof prepareManualSource>[3]={}) {
  manualArchiveIdSchema.parse(id);
  const root=path.join(dataDir,"fishery-manual-archives"),dir=path.join(root,id);
  if(!(await lstat(root)).isDirectory()||!(await lstat(dir)).isDirectory()) throw new Error("Invalid archive directory");
  const manifest=manualManifestSchema.parse(JSON.parse((await bounded(path.join(dir,"manifest.json"),32*1024)).toString("utf8")));
  if(manifest.id!==id) throw new Error("Manual archive id mismatch");
  const receipt=JSON.parse((await bounded(path.join(dir,"receipt.json"),32*1024)).toString("utf8"));
  const result=await prepareManualSource(await bounded(path.join(dir,"raw.bin"),20*1024*1024),manifest,receipt,options);
  const body=await bounded(path.join(dir,"body.txt"),4*1024*1024);
  if(sha256(body)!==manifest.bodySha256 || result.sourceCapture.bodySha256!==manifest.bodySha256 || !body.equals(Buffer.from(result.body))) throw new Error("Archived body does not equal complete deterministic original extraction");
  return result;
}
export async function listManualSources(dataDir:string) {
  const root=path.join(dataDir,"fishery-manual-archives");let names:string[];
  try{if(!(await lstat(root)).isDirectory()) throw new Error("Invalid archive root");names=await readdir(root);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  return Promise.all(names.filter(id=>manualArchiveIdSchema.safeParse(id).success).sort().slice(0,100).map(async id=>{
    try{const r=await verifyManualSource(dataDir,id);return {id,title:r.manifest.title,url:r.manifest.url,name:r.manifest.name,attribution:r.manifest.attribution,parser:r.sourceCapture.parser,pages:r.sourceCapture.attachmentPages,bodySha256:r.sourceCapture.bodySha256,importable:true,error:null};}
    catch(error){return {id,importable:false,error:(error as Error).message.slice(0,500)};}
  }));
}
export async function importManualSource(id:string,actor:string) {
  const r=await verifyManualSource(config.dataDir,id).catch(error=>{throw Object.assign(new Error(`Manual archive cannot be imported: ${(error as Error).message}`),{statusCode:400});}),m=r.manifest;
  const row=await importCapturedMaterial({id:`manual-${new URL(m.url).hostname.replace(/\./g,"-")}`,name:m.name,issuer:m.attribution},m.url,{
    expectedRevision:0,originalTitle:m.title,title:m.title,summaryZh:"人工核验官方归档；尚待普通人工审核。HTTP回执及哈希不是网站签名；正文未包含图片附件的OCR内容。",language:"zh",rawSha256:m.rawSha256,dates:r.dates,policyStatus:"unknown",sourceCapture:r.sourceCapture,
    scope:{regions:[],species:[],flags:[],activities:[],unknownFields:["regions","species","flags","activities"]},evidence:[{url:m.url,sha256:m.rawSha256,page:null,section:"人工核验公开官方原件；来源归属、日期、适用性和权利待人工复核"}],
  },actor);
  return {archiveId:id,rows:[row],reviewState:"unreviewed",modelCalls:0,published:false};
}
export function installManualSourceRoutes(app:FastifyInstance) {
  app.get("/api/admin/fishery/manual-sources",adminHandler(async()=>({rows:await listManualSources(config.dataDir)})));
  app.post("/api/admin/fishery/manual-sources/:id/import",adminHandler(async(req,_reply,admin)=>importManualSource(manualArchiveIdSchema.parse((req.params as {id:string}).id),admin.name)));
}
