// Inspected official columns. Discovery uses their current lists, never a fixed article list.
import * as cheerio from "cheerio";
import { z } from "zod";
import { readPublicationDate } from "@aihot/backend/sources/dates";
import { beijingDate, beijingAt } from "@aihot/contracts/time";
import { captureSchema, dateSchema, linkSchema } from "../contracts.ts";
import { archiveReceiptSchema, sha256 } from "./source-adapters.ts";
import { discoverIotc } from "./iotc-columns.ts";
import {discoverNpfc,NPFC_LIST} from './npfc-columns.ts';
import {isBusinessSource,type BusinessSourceId} from './business-capture.ts';
import {JFA_PRESS,discoverJfaPress,prepareJfaPress} from './jfa-press.ts';

export const COLUMNS = {
  'itf-fisheries':{name:'ITF · 渔业劳动资讯',url:'https://www.itfglobal.org/en/sector/fisheries',list:'article.node--type-news.node--view-mode-teaser',body:'.field--name-body',issuer:'International Transport Workers’ Federation (ITF)'},
  'fao-tuna':{name:'FAO GLOBEFISH · 金枪鱼市场分析',tier:'T1',url:'https://www.fao.org/in-action/globefish/species-analysis/tuna/en',list:'.d-list-content',body:'.news-detail__body',issuer:'Food and Agriculture Organization (FAO)'},
  'mpa-port':{name:'MPA · 港口作业通知',tier:'T1',url:'https://www.mpa.gov.sg/feeds/media-releases',list:'rss',body:'.news-detail__content',issuer:'Maritime and Port Authority of Singapore (MPA)'},
  'jfa-press':{name:'日本水产厅 · 新闻发布',tier:'T1',url:JFA_PRESS,list:'#main_content dl.list_item dd a[href]',body:'#main_content',issuer:'日本水产厅（Fisheries Agency of Japan）'},
  moa: {
    name: "农业农村部渔业渔政管理局 · 工作动态", tier: "T1", url: "https://yyj.moa.gov.cn/gzdt/",
    list: ".sj_e_tonzhi_list li a", body: ".sj_arc_body .TRS_Editor", issuer: "农业农村部渔业渔政管理局",
  },
  fujian: {
    name: "福建省海洋与渔业局 · 省局动态", tier: "T1", url: "https://hyyyj.fujian.gov.cn/xxgk/hydt/stdt/",
    list: ".xw-list-1.gl_list li a", body: "#detailCont", issuer: "福建省海洋与渔业局",
  },
  'fujian-notices':{
    name:'福建省海洋与渔业局 · 通知公告',tier:'T1',url:'https://hyyyj.fujian.gov.cn/xxgk/tzgg/',list:'.xw-list-1.gl_list li a[href]',body:'#detailCont',issuer:'福建省海洋与渔业局',
  },
  iotc: {
    name: "IOTC · Current Conservation and Management Measures", url: "https://iotc.org/cmms/basic",
    list: "table.views-table tbody tr", body: "#content .node-cmm", issuer: "Indian Ocean Tuna Commission (IOTC)",
  },
  npfc:{name:'NPFC 北太平洋渔业委员会 · 逐项养护管理措施',tier:'T1',url:NPFC_LIST,list:'.region-content .view-document-list td.views-field-title > a[href]',body:'.region-content',issuer:'North Pacific Fisheries Commission (NPFC)'},
} as const;
export const columnIdSchema = z.enum(["moa", "fujian", "iotc", "npfc", "fujian-notices", "jfa-press", "itf-fisheries", "fao-tuna", "mpa-port"]);
export type ColumnId = z.infer<typeof columnIdSchema>;
// News lists and regulatory inventories have different time semantics.
export const isNewsColumn = (id: ColumnId) => id !== "npfc" && id !== "iotc";
// A day without a time belongs to the source's calendar, independent of the host timezone.
export function columnPublishedAt(columnId:string,publicationTime:string|null):Date|null {
  if(!publicationTime)return null;
  if(publicationTime.length!==10)return new Date(publicationTime);
  if(columnId==='itf-fisheries'||columnId==='fao-tuna')return new Date(publicationTime+'T00:00:00Z');
  if(columnId==='jfa-press')return new Date(publicationTime+'T00:00:00+09:00');
  return beijingAt(publicationTime,'00:00');
}
export interface ColumnPagination { pageUrl:string; pageIndex:number; nextUrl:string|null; totalPages:number|null; scope:"verified_pagination"|"current_page_only"|"pagination_unverified"; }
export function columnPageIndex(id:ColumnId,input:string) {
  const url=new URL(input),base=new URL(COLUMNS[id].url);
  if(url.origin!==base.origin||url.hash||url.username||url.password) throw new Error("Unexpected official listing URL");
  if(id==="iotc") {
    if(url.pathname!==base.pathname||[...url.searchParams.keys()].some(k=>k!=="page")||url.searchParams.getAll("page").length>1) throw new Error("Unexpected IOTC listing page");
    const n=url.searchParams.get("page");if(n!==null&&!/^[1-9]\d{0,2}$/.test(n)) throw new Error("Invalid IOTC page index");return n===null?0:Number(n);
  }
  if(url.search) throw new Error("Unexpected official listing query");
  if(input===base.href) return 0;
  const relative=url.pathname.slice(base.pathname.length);
  if(!url.pathname.startsWith(base.pathname)||id!=="moa"||!/^index(?:_[1-9]\d{0,2})?\.htm$/.test(relative)) throw new Error("Unverified official listing pagination path");
  return Number(/_(\d+)\.htm$/.exec(relative)?.[1]??0);
}
export function discoverColumnPagination(id:ColumnId,html:string,pageUrl=COLUMNS[id].url as string):ColumnPagination {
  const pageIndex=columnPageIndex(id,pageUrl),base:ColumnPagination={pageUrl,pageIndex,nextUrl:null,totalPages:null,scope:"pagination_unverified"};
  if(id==="moa") {
    // Inspected archive: TRS numeric declarations plus this exact index_N.htm generator.
    const current=/\bvar\s+currentPage\s*=\s*(\d+)\s*;/.exec(html),count=/\bvar\s+countPage\s*=\s*(\d+)\s*(?:;|\/\/)/.exec(html);
    const generator=/\bvar\s+nextPage\s*=\s*currentPage\s*\+\s*1/.test(html)&&/href=\\"index"\s*\+\s*"_"\s*\+\s*nextPage\s*\+\s*"\."\s*\+\s*"htm\\">下一页/.test(html);
    if(!current||!count||!generator) return base;
    if(Number(current[1])!==pageIndex||Number(count[1])<1||Number(count[1])>1000||pageIndex>=Number(count[1])) throw new Error("Official listing page metadata disagrees with URL");
    return {...base,scope:"verified_pagination",totalPages:Number(count[1]),nextUrl:pageIndex+1<Number(count[1])?new URL(`index_${pageIndex+1}.htm`,COLUMNS.moa.url).href:null};
  }
  if(id==="fujian"||id==='fujian-notices') return base; // The observed JS pagebar does not disclose a verified URL mechanism.
  if(id==='npfc'||id==='jfa-press'||isBusinessSource(id))return {...base,scope:'current_page_only'};
  const $=cheerio.load(html),links=$("ul.pager li.pager-next a[href]").toArray().map(a=>new URL($(a).attr("href")!,pageUrl).href);
  if(new Set(links).size>1) throw new Error("Conflicting IOTC next-page links");
  const nextUrl=links[0]??null;
  if(nextUrl&&columnPageIndex(id,nextUrl)!==pageIndex+1) throw new Error("Unexpected IOTC next-page sequence");
  const last=$("ul.pager li.pager-last a[href]").first().attr("href");
  const totalPages=last?columnPageIndex(id,new URL(last,pageUrl).href)+1:null;
  const current=collapse($("ul.pager li.pager-current").first().text());
  if(current&&(!/^\d+$/.test(current)||Number(current)!==pageIndex+1)) throw new Error("IOTC current-page marker disagrees with URL");
  if(totalPages!==null&&(totalPages<pageIndex+1||totalPages>pageIndex+1&&!nextUrl||nextUrl&&totalPages<pageIndex+2)) throw new Error("IOTC pager omits or contradicts remaining pages");
  return {...base,nextUrl,totalPages,scope:current?"verified_pagination":$("ul.pager").length?"pagination_unverified":"current_page_only"};
}
export const unknownDate = () => ({ precision: "unknown" as const, value: null });
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const direct = /远洋|公海|境外入渔|南极磷虾|国际渔业|IOTC|NPFC|SPRFMO|WCPFC|CCAMLR/i;
export interface Candidate { url: string; title: string; listDate: string | null; priority: "direct" | "context"; }

export function discoverColumn(id: ColumnId, html: string): { candidates: Candidate[]; rejected: number; listed: number } {
  if(isBusinessSource(id))throw new Error("Business discovery requires its archived receipt");
  if (id === "iotc") return discoverIotc(html);
  if (id === 'npfc')return discoverNpfc(html);
  if (id === 'jfa-press')return discoverJfaPress(html);
  const column = COLUMNS[id], base = new URL(column.url), $ = cheerio.load(html), seen = new Set<string>();
  const candidates: Candidate[] = []; let rejected = 0, listed = 0;
  for (const anchor of $(column.list).toArray()) {
    const node = $(anchor), href = node.attr("href");
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, column.url); } catch { continue; }
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !/\/t\d{8}_\d+\.s?html?$/.test(url.pathname) || !linkSchema.safeParse(url.href).success || seen.has(url.href)) continue;
    seen.add(url.href); listed++;
    // Discover every article in list order. Relevance is decided from the complete body.
    const title = collapse(node.attr("title") || node.text()), priority = "context" as const;
    if (!title) { rejected++; continue; }
    const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(node.closest("li").text())?.[0] ?? null;
    candidates.push({ url: url.href, title, listDate: date, priority });
  }
  return { candidates, rejected, listed };
}

export function relevanceEvidence(body: string): string[] {
  // These are retrieval cues, not AI scores or factual approval. Keep the source text as evidence.
  return body.split(/\n+/).map(collapse).flatMap(p => {
    const match = direct.exec(p);
    return match ? [p.slice(Math.max(0, match.index - 150), match.index + 350)] : [];
  }).slice(0, 8);
}

export function prepareColumnArticle(id: Exclude<ColumnId, "iotc"|"npfc"|'fujian-notices'|BusinessSourceId>, receiptInput: unknown, raw: Buffer, acquisitionMode: "live_capture" | "archive_replay" = "live_capture") {
  if(id==='jfa-press')return prepareJfaPress(receiptInput,raw,[],acquisitionMode);
  const receipt = archiveReceiptSchema.parse(receiptInput), column = COLUMNS[id], origin = new URL(column.url).origin;
  const conflicts: string[] = [], warnings: string[] = [];
  if (sha256(raw) !== receipt.sha256) conflicts.push("Raw bytes differ from the HTTP receipt");
  if ([receipt.requestedUrl, receipt.finalUrl].some(u => new URL(u).origin !== origin)) conflicts.push("Unexpected official source origin");
  if ([receipt.requestedUrl, receipt.finalUrl].some(u => !new URL(u).pathname.startsWith(new URL(column.url).pathname) || !/\/t\d{8}_\d+\.s?html?$/.test(new URL(u).pathname))) conflicts.push("Unexpected official article path");
  let title: string | null = null, body: string | null = null, publicationLiteral: string | null = null, publishedAt: string | null = null;
  let published: z.infer<typeof dateSchema> = unknownDate();
  let parseStatus: "parsed" | "missing" | "failed" | "unverified" = receipt.status === 200 ? "missing" : "failed";
  if (receipt.status !== 200) warnings.push(`HTTP ${receipt.status}: no article body; never fill with search/cache text`);
  else if (conflicts.length) parseStatus = "unverified";
  else {
    let html: string | null = null;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { parseStatus = "unverified"; warnings.push("Invalid UTF-8; no guessed decoding"); }
    if (html !== null) {
      const $ = cheerio.load(html);
      title = collapse($("meta[name=ArticleTitle]").attr("content") || $("h1").first().text()) || null;
      publicationLiteral = collapse($("meta[name=PubDate]").attr("content") || "") || null;
      if (publicationLiteral) {
        const date = readPublicationDate(publicationLiteral, "+08:00");
        if (date.publishedAt) {
          const day = beijingDate(date.publishedAt);
          published = { precision: "day", value: day };
          if (/\d{1,2}:\d{2}/.test(publicationLiteral)) publishedAt = new Date(date.publishedAt).toISOString();
        } else conflicts.push("Visible publication metadata is invalid");
      } else warnings.push("Publication metadata missing; list/URL/event/capture dates are not substitutes");
      const content = $(column.body).first().clone();
      content.find("script,style,iframe,form,noscript").remove();
      // #detailCont keeps all TRS blocks, including text outside nested .TRS_Editor nodes.
      content.find("p,br,div,li,tr,h2,h3").append("\n");
      const text = content.text().split(/\n+/).map(collapse).filter(Boolean).join("\n");
      if (title && text.length >= 40) { body = text; parseStatus = "parsed"; }
      else warnings.push("Expected official article title/body selector missing or empty");
      if (conflicts.length) { parseStatus = "unverified"; body = null; }
    }
  }
  const evidence = body ? relevanceEvidence(body) : [];
  if (body && !evidence.length) warnings.push("No explicit DWF retrieval cue; relevance requires full-body prefilter review");
  const capture = captureSchema.parse({ adapter: id, acquisitionMode, sourceUrl: receipt.finalUrl, capturedAt: receipt.finishedAt,
    httpStatus: receipt.status, rawSha256: sha256(raw), bodySha256: body ? sha256(body) : null,
    parser: `official-column/${id}/v1`, parseStatus, attachmentSha256: null,
    publishedAt, publicationLiteral, conflicts });
  return { title, body, dates: { published, event: unknownDate(), adopted: unknownDate(), effectiveFrom: unknownDate(), effectiveUntil: unknownDate() },
    sourceCapture: capture, readyForReview: parseStatus === "parsed" && !!body,
    relevance: { decision: evidence.length ? "candidate" as const : "not_proven" as const, method: "explicit_dwf_terms" as const, evidence }, warnings };
}
