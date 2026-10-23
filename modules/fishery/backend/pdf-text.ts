// Read local archived bytes only. No network, OCR, password bypass or automatic approval.
import * as cheerio from "cheerio";
import {pdfTextEvidenceSchema} from "../contracts.ts";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256, type PdfText } from "./source-adapters.ts";
import {pdfBlankProofSchema,type PdfBlankProof} from './pdf-blank-proof.ts';

type Execute = (file: string, args: string[], options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;
const execute: Execute = promisify(execFile);
const OUTPUT_LIMIT = 4 * 1024 * 1024;
export function pdfTextlessPages(text:string,pages:number){
  const markers=[...text.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  if(!Number.isInteger(pages)||pages<1||pages>200||markers.length!==pages||markers.some((m,i)=>Number(m[1])!==i+1)||text.slice(0,markers[0]?.index??text.length).trim())throw new Error('PDF page coverage incomplete or ambiguous');
  return markers.flatMap((m,i)=>text.slice(m.index!+m[0].length,markers[i+1]?.index??text.length).trim()?[]:[i+1]);
}
// Called only with a registry-verified review in production. An empty text layer alone never establishes a blank page.
export function assertReviewedPdfBlanks(proof:PdfBlankProof,rawSha256:string,pages:number,textless:number[]){
  const review=pdfBlankProofSchema.parse(proof);
  if(review.rawSha256!==rawSha256||review.physicalPages!==pages||JSON.stringify(review.pageImages.map(p=>p.page))!==JSON.stringify(textless))throw new Error('Blank-page review does not match exact original, page count and every textless physical page');
}
type TextNode={text:string;fontSize:number;top:number;left:number;width:number;height:number};
const literalPattern=(text:string)=>text.trim().split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("\\s+");
// Only separate a small, raised numeric run with a uniquely located same-page footnote. No string/year guessing.
export function mapPdfFootnotes(layout:string,xml:string,expectedPages:number) {
  const $=cheerio.load(xml,{xmlMode:true}),pages=$("pdf2xml > page").toArray();
  const markers=[...layout.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
  if(pages.length!==expectedPages||markers.length!==expectedPages||markers.some((m,i)=>Number(m[1])!==i+1)) throw new Error("Structured PDF page coverage mismatch");
  const fonts=new Map<string,number>();
  for(const element of $("fontspec").toArray()) {
    const id=$(element).attr("id"),size=Number($(element).attr("size"));
    if(!id||!Number.isFinite(size)||size<=0||fonts.has(id)&&fonts.get(id)!==size) throw new Error("Ambiguous PDF font evidence");
    fonts.set(id,size);
  }
  const transformations:Omit<NonNullable<PdfText["textEvidence"]>["transformations"][number],"outputStart"|"outputEnd">[]=[];
  for(const [i,page] of pages.entries()) {
    const pageNumber=Number($(page).attr("number")),pageHeight=Number($(page).attr("height")),pageWidth=Number($(page).attr("width"));
    if(pageNumber!==i+1||!Number.isFinite(pageHeight)||pageHeight<=0||!Number.isFinite(pageWidth)||pageWidth<=0) throw new Error("Invalid structured PDF page geometry");
    const nodes=$(page).children("text").toArray().map(element=>{
      const node={text:$(element).text(),fontSize:fonts.get($(element).attr("font")??"")!,top:Number($(element).attr("top")),left:Number($(element).attr("left")),width:Number($(element).attr("width")),height:Number($(element).attr("height"))};
      if(Object.entries(node).some(([key,value])=>key!=="text"&&(!Number.isFinite(value)||Number(value)<0))||!node.fontSize||!node.height) throw new Error("Invalid structured PDF text geometry");
      return node;
    });
    const start=markers[i]!.index!+markers[i]![0].length,end=markers[i+1]?.index??layout.length,part=layout.slice(start,end);
    for(const [j,reference] of nodes.entries()) {
      const base=nodes[j-1],marker=reference.text.trim();
      if(!base||!/^\d{1,3}$/.test(marker)||reference.top>pageHeight*.75) continue;
      const adjacent=reference.left-(base.left+base.width);
      const raised=reference.fontSize<=base.fontSize*.8&&reference.height<=base.height*.8&&base.top+base.height-(reference.top+reference.height)>=base.height*.2&&reference.top>=base.top-base.height&&adjacent>=-1&&adjacent<=Math.max(3,base.fontSize*.35);
      if(!raised||!base.text.trim()) continue;
      const footnotes=nodes.flatMap((node,k)=>{
        const text=nodes[k+1];
        if(node.text.trim()!==marker||node.top<pageHeight*.8||node.left>pageWidth*.2||!text||!text.text.trim()||text.left<node.left+node.width-1||text.left-node.left-node.width>6||Math.abs(text.top-node.top)>Math.max(3,text.height*.25)||node.fontSize>text.fontSize*.8) return [];
        return [{marker:node,text}];
      });
      if(footnotes.length!==1) throw new Error("Raised PDF reference lacks a unique same-page footnote; manual review required");
      const footnote=footnotes[0]!;
      const footnoteLines=[footnote.text];
      const following=nodes.filter(node=>node!==footnote.marker&&node!==footnote.text&&node.text.trim()&&!/^Page \d+ of \d+$/i.test(node.text.trim())&&node.top>footnote.text.top+footnote.text.height*.5).sort((a,b)=>a.top-b.top||a.left-b.left);
      for(const node of following) {
        const previous=footnoteLines.at(-1)!;
        if(node.top-previous.top>previous.height*2||/^\d{1,3}$/.test(node.text.trim())) break;
        if(node.fontSize!==footnote.text.fontSize||Math.abs(node.height-footnote.text.height)>2||Math.abs(node.left-footnote.marker.left)>8) throw new Error("Ambiguous multiline PDF footnote requires manual mapping");
        footnoteLines.push(node);
      }
      const baseMatches=[...part.matchAll(new RegExp(literalPattern(base.text)+"\\s*"+marker+"(?!\\d)","g"))];
      const footnoteMatches=[...part.matchAll(new RegExp("(?<!\\d)"+marker+"\\s+"+footnoteLines.map(node=>literalPattern(node.text)).join("\\s+"),"g"))];
      if(baseMatches.length!==1||footnoteMatches.length!==1) throw new Error("Structured PDF reference/layout mapping is not unique; manual review required");
      const match=baseMatches[0]!,sourceStart=start+match.index!+match[0].length-marker.length;
      transformations.push({page:pageNumber,marker,sourceStart,sourceEnd:sourceStart+marker.length,sourceText:marker,replacement:`[${marker}]`,base,reference,footnote:footnote.text,footnoteLines,footnoteText:footnoteMatches[0]![0]});
    }
  }
  transformations.sort((a,b)=>a.sourceStart-b.sourceStart);
  if(transformations.length>128||transformations.some((t,i)=>i>0&&t.sourceStart<transformations[i-1]!.sourceEnd)) throw new Error("PDF transformation capacity/overlap requires manual review");
  let text="",offset=0;
  const mapped=transformations.map(t=>{
    text+=layout.slice(offset,t.sourceStart);const outputStart=text.length;text+=t.replacement;offset=t.sourceEnd;
    return {...t,outputStart,outputEnd:text.length};
  });
  text+=layout.slice(offset);
  return {text,textEvidence:pdfTextEvidenceSchema.parse({version:"pdf-footnotes/v1",layoutSha256:sha256(layout),structureSha256:sha256(xml),textSha256:sha256(text),transformations:mapped})};
}
export async function extractPdf(original: Buffer, options: { platform?: NodeJS.Platform; execute?: Execute; blankReview?:PdfBlankProof } = {}): Promise<PdfText> {
  let result: PdfText = { status: "unverified", parser: "unavailable-pdf-parser", rawSha256: sha256(original), text: "", pages: 0 };
  if (original.length > 10 * 1024 * 1024 || !original.subarray(0, 5).equals(Buffer.from("%PDF-")))
    return { ...result, status: "failed", error: "Invalid PDF signature or size limit" };
  const snapshot = Buffer.from(original);
  const platform = options.platform ?? process.platform, run = options.execute ?? execute;
  if (platform !== "darwin" && platform !== "linux") return result;
  const deadline = Date.now() + 60_000;
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TMPDIR: tmpdir() };
  const command = async (program: string, args: string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("PDF document deadline exceeded");
    const output = await run(program, args, { timeout: remaining, maxBuffer: OUTPUT_LIMIT, env });
    if (Buffer.byteLength(output.stdout) > OUTPUT_LIMIT) throw new Error("PDF output byte limit exceeded");
    return output;
  };
  let scratch: string | null = null;
  try {
    scratch = await mkdtemp(path.join(tmpdir(), "fishery-pdf-"));
    const file = path.join(scratch, "original.pdf");
    await writeFile(file, snapshot, { flag: "wx", mode: 0o600 });
    if (platform === "darwin") {
      result.parser = "Apple PDFKit/v2; per-page-text";
      const { stdout } = await command("/usr/bin/swift", ["-module-cache-path", path.join(scratch, "cache"), path.join(import.meta.dirname, "../scripts/pdf-text.swift"), path.resolve(file)]);
      const parsed = JSON.parse(stdout);
      if (!Number.isInteger(parsed.pages) || parsed.pages < 1 || parsed.pages > 200 || typeof parsed.text !== "string" || !parsed.text.trim())
        throw new Error("PDF page count or text is invalid");
      const textless=pdfTextlessPages(parsed.text,parsed.pages);
      if(textless.length&&!options.blankReview)return {...result,textlessPages:textless,error:`PDF has unverified textless pages: ${textless.join(',')}; blank/scanned distinction requires review, no automatic OCR`};
      if(options.blankReview)assertReviewedPdfBlanks(options.blankReview,result.rawSha256,parsed.pages,textless);
      result = { ...result, status: "parsed", pages: parsed.pages, text: parsed.text };
    } else {
      const infoVersion = await command("pdfinfo", ["-v"]), textVersion = await command("pdftotext", ["-v"]),structureVersion=await command("pdftohtml",["-v"]);
      const version = (name: string, output: { stdout: string; stderr: string }) => new RegExp(`${name} version ([0-9.]+)`).exec(output.stdout + output.stderr)?.[1];
      const iv = version("pdfinfo", infoVersion), tv = version("pdftotext", textVersion),sv=version("pdftohtml",structureVersion);
      if (!iv || !tv || !sv) throw new Error("Cannot identify Poppler versions");
      result.parser = `Poppler ${iv}/${tv}/${sv}; footnotes/v3; per-page-text`;
      const info = await command("pdfinfo", ["-enc", "UTF-8", path.resolve(file)]);
      const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
      if (info.stderr.trim() || !/^Encrypted:\s+no\s*$/m.test(info.stdout) || !Number.isInteger(pages) || pages < 1 || pages > 200)
        throw new Error("Unreadable, encrypted or excessive-page PDF");
      const parts: string[] = [],textless:number[]=[]; let bytes = 0;
      for (let page = 1; page <= pages; page++) {
        const extracted = await command("pdftotext", ["-f", String(page), "-l", String(page), "-enc", "UTF-8", "-eol", "unix", "-layout", "-nopgbrk", path.resolve(file), "-"]);
        if (extracted.stderr.trim()) throw new Error("PDF text extraction diagnostics require review");
        if(!extracted.stdout.trim())textless.push(page);
        const part = `--- Page ${page} ---\n${extracted.stdout}`;
        bytes += Buffer.byteLength(part) + (parts.length ? 2 : 0);
        if (bytes > OUTPUT_LIMIT) throw new Error("PDF output byte limit exceeded");
        parts.push(part);
      }
      if(textless.length&&!options.blankReview)return {...result,textlessPages:textless,error:`PDF has unverified textless pages: ${textless.join(',')}; blank/scanned distinction requires review, no automatic OCR`};
      if(options.blankReview)assertReviewedPdfBlanks(options.blankReview,result.rawSha256,pages,textless);
      const structure=await command("pdftohtml",["-xml","-hidden","-i","-stdout","-enc","UTF-8",path.resolve(file)]);
      if(structure.stderr.trim()) throw new Error("PDF structure diagnostics require review");
      const mapped=mapPdfFootnotes(parts.join("\n\n"),structure.stdout,pages);
      result = { ...result, status: "parsed", pages, ...mapped };
    }
  } catch (error) {
    result = { ...result, status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "unverified" : "failed", pages: 0, text: "", error: String((error as Error).message).slice(0, 300) };
  } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  return result;
}
