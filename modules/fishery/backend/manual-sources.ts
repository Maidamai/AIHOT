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
interface HtmlSource { bodySelector: string; titleSelector?: string; titleAttribute?: string; removeTitle?: string; visibleDateSelector?: string; unknownDate?: boolean }
const article = (bodySelector: string, visibleDateSelector?: string): HtmlSource => ({ bodySelector, titleSelector: "meta[name=ArticleTitle]", titleAttribute: "content", visibleDateSelector });
const known = new Map<string, string | HtmlSource>([
  ["http://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm", ".TRS_Editor"],
  ["https://fgs.moa.gov.cn/flfg/202508/t20250801_6476248.htm", ".TRS_Editor"],
  ["http://fgs.moa.gov.cn/flfg/202508/t20250801_6476253.htm", ".TRS_Editor"],
  ["https://fgs.moa.gov.cn/flfg/202508/t20250801_6476253.htm", ".TRS_Editor"],
  ["https://www.hunan.gov.cn/zqt/zcsd/202405/t20240506_33293093.html", { bodySelector: "#zoom", unknownDate: true }],
  ["https://www.moa.gov.cn/govpublic/YYJ/202507/P020250731549012145690.pdf", "pdf"],
  ["https://www.mawei.gov.cn/xjwz/zwgk/gggs/tzgg/202603/t20260309_5292976.htm", article(".article_content", ".article_time")],
  // These inspected pages contain 20/16 nested editors. The direct child is the complete outer body.
  ["https://hyj.quanzhou.gov.cn/zfxxgk/zfxxgkml/zcfg/gfxwj/202507/t20250724_3193147.htm", article(".article_content > .TRS_Editor", ".article_time")],
  ["https://hyj.quanzhou.gov.cn/zfxxgk/zc/xzgfxwj/202507/t20250728_3193952.htm", article(".rules_text > .TRS_Editor")],
  ["https://zj.singlewindow.cn/pen-portal/guide/basic.jspa?id=196", { bodySelector: ".localGuide", titleSelector: ".localGuide .mainTitle", unknownDate: true }],
  ["https://online.customs.gov.cn/static/pages/guides/000629009001/000629009001.html", { bodySelector: ".layui-container.guide", titleSelector: ".layui-container.guide .header-title h3", removeTitle: ".layui-icon" }],
  ["https://www.ccs.org.cn/ccswz/columnDetail?columnid=201900002000000618", { bodySelector: ".ccrj .p", titleSelector: ".ccrj > h3.fnt_36", unknownDate: true }],
  ["https://gat.fujian.gov.cn/ztzl/cryjfwwj/bsxz_28282/202111/t20211115_5774073.htm", article(".TRS_Editor", ".article_time")],
  ["https://www.mawei.gov.cn/xjwz/zwgk/gggs/tzgg/202603/P020260910638846579817.pdf", "pdf"],
  ["https://hyj.quanzhou.gov.cn/zwgk/fgwj/yyl/202508/P020250804347985996003.pdf", "pdf"],
  ["https://hyj.quanzhou.gov.cn/zfxxgk/zc/xzgfxwj/202507/P020251216619209074818.pdf", "pdf"],
]);
const collapse = (s:string) => s.replace(/\s+/g," ").trim();
const unknown = () => ({precision:"unknown" as const,value:null});
export async function prepareManualSource(raw:Buffer, input:unknown, receiptInput:unknown, options:{parsePdf?:(raw:Buffer)=>Promise<PdfText>}={}) {
  const manifest=manualManifestSchema.parse(input),receipt=archiveReceiptSchema.parse(receiptInput),source=known.get(manifest.url);
  const selector=typeof source==="string"?source:source?.bodySelector;
  if(!selector || receipt.requestedUrl!==manifest.url || receipt.finalUrl!==manifest.url) throw new Error("Manual archive URL is not the verified official URL");
  if(receipt.status!==200 || !raw.length || raw.length>20*1024*1024 || sha256(raw)!==receipt.sha256 || receipt.sha256!==manifest.rawSha256) throw new Error("HTTP 200 original bytes and matching receipt/manifest hashes required");
  let body:string, pdf:PdfText|undefined;
  let published=unknown() as {precision:"unknown"|"day";value:string|null};
  if(selector==="pdf") {
    if(manifest.parser!=="manual-official-pdf/v1" || manifest.bodySelector || raw.length>10*1024*1024 || !raw.subarray(0,5).equals(Buffer.from("%PDF-"))) throw new Error("Expected original PDF archive within existing size limit");
    if(manifest.publishedAt!==null || manifest.publicationLiteral!==null) throw new Error("PDF web publication date is unknown; signature dates are not publication metadata");
    pdf=await(options.parsePdf??extractPdf)(raw);
    if(pdf.status!=="parsed" || pdf.rawSha256!==sha256(raw) || !pdf.text.replace(/^--- Page \d+ ---\r?$/gm,"").trim() || !Number.isInteger(pdf.pages) || pdf.pages<1 || pdf.pages>200) throw new Error(`Full PDF parsing failed: ${pdf.error??pdf.status}; verified text required`);
    const markers=[...pdf.text.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
    if(markers.length!==pdf.pages || markers.some((m,i)=>Number(m[1])!==i+1)) throw new Error("Full PDF page coverage required");
    body=pdf.text;
  } else {
    if(manifest.parser!=="manual-official-html/v1" || manifest.bodySelector!==selector) throw new Error("Expected verified official HTML selector");
    const $=cheerio.load(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    const html=typeof source==="object"?source:null;
    let title:string;
    if(html?.titleSelector) {
      const selected=$(html.titleSelector);
      if(selected.length!==1) throw new Error("Unique original title selector required");
      const titleNode=selected.clone();if(html.removeTitle) titleNode.find(html.removeTitle).remove();
      title=collapse(html.titleAttribute?selected.attr(html.titleAttribute)??"":titleNode.text());
    } else title=collapse($("meta[name=ArticleTitle]").attr("content")||$("h1").first().text());
    if(!title || collapse(manifest.title)!==title) throw new Error("HTML title differs from original metadata");
    const nodes=$(selector);
    if(nodes.length!==1) throw new Error("Unique complete official body container required");
    const content=nodes.clone();content.find("script,style,iframe,form,noscript").remove();
    content.find("p,br,div,li,tr,h1,h2,h3,h4,table").append("\n");
    body=content.text().split(/\n+/).map(collapse).filter(Boolean).join("\n");
    if(body.length<100 || /<html|访问异常|访问验证|验证码/.test(body.slice(0,150))) throw new Error("Official full body missing or blocked");
    const metadata=[...new Set($("meta[name=PubDate]").toArray().map(el=>collapse($(el).attr("content")??"")).filter(Boolean))];
    let literal=metadata.length===1&&!html?.unknownDate?metadata[0]!:null;
    if(literal&&html?.visibleDateSelector) {
      const visible=$(html.visibleDateSelector),date=/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/.exec(collapse(visible.text()))?.[0];
      const meta=readPublicationDate(literal,"+08:00"),shown=date?readPublicationDate(date,"+08:00"):null;
      if(visible.length!==1||!meta.publishedAt||!shown?.publishedAt||beijingDate(meta.publishedAt)!==beijingDate(shown.publishedAt)||(/\d{1,2}:\d{2}/.test(literal)&&/\d{1,2}:\d{2}/.test(date!)&&meta.publishedAt.getTime()!==shown.publishedAt.getTime())) literal=null;
    }
    // Operator may preserve unknown dates, but may not invent a precise publication time.
    if(manifest.publicationLiteral!==null && manifest.publicationLiteral!==literal) throw new Error("Publication literal differs from original metadata");
    if(manifest.publicationLiteral!==null) {
      const parsed=literal?readPublicationDate(literal,"+08:00"):null;
      if(!parsed?.publishedAt) throw new Error("Publication literal is not valid original metadata");
      published={precision:"day",value:beijingDate(parsed.publishedAt)};
      if(manifest.publishedAt&&(!/\d{1,2}:\d{2}/.test(literal!)||new Date(parsed.publishedAt).toISOString()!==new Date(manifest.publishedAt).toISOString())) throw new Error("Publication timestamp differs from original metadata or its precision");
    }
    else if(manifest.publishedAt) throw new Error("Publication timestamp requires its original literal");
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
    try{const r=await verifyManualSource(dataDir,id);return {id,title:r.manifest.title,url:r.manifest.url,name:r.manifest.name,attribution:r.manifest.attribution,publishedAt:r.sourceCapture.publishedAt,publicationLiteral:r.sourceCapture.publicationLiteral,capturedAt:r.sourceCapture.capturedAt,dates:r.dates,parser:r.sourceCapture.parser,pages:r.sourceCapture.attachmentPages,bodySha256:r.sourceCapture.bodySha256,importable:true,error:null};}
    catch(error){return {id,importable:false,error:(error as Error).message.slice(0,500)};}
  }));
}
export async function importManualSource(id:string,actor:string) {
  const r=await verifyManualSource(config.dataDir,id).catch(error=>{throw Object.assign(new Error(`Manual archive cannot be imported: ${(error as Error).message}`),{statusCode:400});}),m=r.manifest;
  const row=await importCapturedMaterial({id:`manual-${new URL(m.url).hostname.replace(/\./g,"-")}`,name:m.name,issuer:m.attribution},m.url,{
    expectedRevision:0,originalTitle:m.title,title:m.title,summaryZh:"人工核验官方归档；尚待普通人工审核。HTTP回执及哈希不是网站签名；正文未包含图片附件的OCR内容。",language:"zh",rawSha256:m.rawSha256,dates:r.dates,policyStatus:"unknown",sourceCapture:r.sourceCapture,
    scope:{regions:[],species:[],flags:[],activities:[],unknownFields:["regions","species","flags","activities"]},evidence:[{url:m.url,sha256:m.rawSha256,page:null,section:"人工核验公开官方原件；来源归属、日期、适用性和权利待人工复核"}],
  },actor);
  return {archiveId:id,rows:[row],reviewState:"check_current_document",modelCalls:0,published:false};
}
export function installManualSourceRoutes(app:FastifyInstance) {
  app.get("/api/admin/fishery/manual-sources",adminHandler(async()=>({rows:await listManualSources(config.dataDir)})));
  app.post("/api/admin/fishery/manual-sources/:id/import",adminHandler(async(req,_reply,admin)=>importManualSource(manualArchiveIdSchema.parse((req.params as {id:string}).id),admin.name)));
}
