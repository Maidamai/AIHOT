import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import {pdfBlankProofSchema,type PdfBlankProof} from './pdf-blank-proof.ts';
import {loadVerifiedPdfBlankReview} from './pdf-blank-review.ts';
import { config } from "@aihot/backend/config";
import { readCapturedText } from "./column-batches.ts";

export async function readSourceBody(capture: { manualArchiveId?: string; archiveId?: string; bodySha256: string | null;rawSha256?:string;attachmentPages?:number|null;pdfBlankReview?:PdfBlankProof }): Promise<string | null> {
  if (capture.manualArchiveId && capture.archiveId) throw new Error("Ambiguous source archive");
  if(capture.pdfBlankReview&&!capture.manualArchiveId)throw new Error('Blank-page review requires its registered manual PDF archive');
  if (!capture.manualArchiveId && !capture.archiveId) return null;
  if (!capture.bodySha256 || !/^[a-f0-9]{64}$/.test(capture.bodySha256)) throw new Error("Bound body hash required");
  if (capture.archiveId) return readCapturedText(config.dataDir, capture.archiveId, capture.bodySha256);
  const id = capture.manualArchiveId!;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error("Invalid manual archive id");
  const root = path.join(config.dataDir, "fishery-manual-archives"), dir = path.join(root, id), file = path.join(dir, "body.txt");
  if (!(await lstat(root)).isDirectory() || !(await lstat(dir)).isDirectory()) throw new Error("Invalid manual archive directory");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Manual source body missing or oversized");
  const bytes = await readFile(file);
  if (bytes.length > 4 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== capture.bodySha256) throw new Error("Manual source body hash mismatch");
  if(capture.pdfBlankReview){
    const proof=pdfBlankProofSchema.parse(capture.pdfBlankReview),rawFile=path.join(dir,'raw.bin'),manifestFile=path.join(dir,'manifest.json');
    const rawStat=await lstat(rawFile),manifestStat=await lstat(manifestFile);
    if(!rawStat.isFile()||rawStat.size>10*1024*1024||!manifestStat.isFile()||manifestStat.size>32768)throw new Error('Bound original PDF and manual manifest required');
    const raw=await readFile(rawFile),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
    if(raw.length>10*1024*1024||capture.rawSha256!==proof.rawSha256||capture.attachmentPages!==proof.physicalPages||manifest.id!==id||manifest.blankReviewId!==proof.reviewId||manifest.rawSha256!==proof.rawSha256||manifest.bodySha256!==capture.bodySha256)throw new Error('Blank-page proof no longer matches the current manual source');
    const verified=await loadVerifiedPdfBlankReview(config.dataDir,raw,proof.reviewId);
    if(!isDeepStrictEqual(verified,proof))throw new Error('Registered blank-page review changed; evidence no longer current');
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
