// Disposable NPFC optimization. Every batch keeps its own complete, independently verifiable PDF.
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { archiveReceiptSchema, sha256 } from "./source-adapters.ts";

export type ConditionalHeaders = Partial<Record<"if-none-match" | "if-modified-since", string>>;
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
const archiveId = z.string().regex(/^[a-zA-Z0-9-]{1,64}_[a-f0-9]{16}$/);
const headersSchema = z.strictObject({ "if-none-match": z.string().min(1).max(1024).optional(), "if-modified-since": z.string().min(1).max(1024).optional() });
const receiptSchema = archiveReceiptSchema.extend({ startedAt: z.iso.datetime({ offset: true }), bytes: z.int().nonnegative(), etag: z.string().nullable().optional(), lastModified: z.string().nullable().optional(), requestHeaders: headersSchema.optional() });
type Receipt = z.infer<typeof receiptSchema>;
type Artifact = { body: Buffer; receipt: Receipt };
const pointerSchema = z.strictObject({ version: z.literal("npfc-pdf-cache/1"), url: z.string(), batchId: id, archiveId, manifestSha256: hash });
type Pointer = z.infer<typeof pointerSchema>;
const proofSchema = z.strictObject({ version: z.literal("npfc-pdf-revalidation/1"), url: z.string(), source: pointerSchema, pdfSha256: hash, originalReceiptSha256: hash, requestHeaders: headersSchema });
type Check = () => Promise<void>;
type Write = (name: string, bytes: Buffer) => Promise<void>;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const cacheFile = (dataDir: string, url: string) => path.join(dataDir, "fishery-npfc-pdf-cache", sha256(url) + ".json");
const npfcUrl = (url: string) => { if (!/^https:\/\/www\.npfc\.int\/system\/files\/[^?#]+\.pdf$/i.test(url)) throw new Error("Invalid NPFC PDF cache URL"); };
async function bounded(file: string, max: number) { if ((await stat(file)).size > max) throw new Error("NPFC cache artifact too large"); return readFile(file); }
function during(receipt: Receipt, batch: { startedAt: string; finishedAt: string | null }) {
  const a = Date.parse(receipt.startedAt), b = Date.parse(receipt.finishedAt);
  const start = Date.parse(batch.startedAt), end = Date.parse(batch.finishedAt ?? "");
  if (![a,b,start,end].every(Number.isFinite) || a > b || a < start || b > end) throw new Error("NPFC receipt outside batch acquisition period");
}
function validPdf(artifact: Artifact, url: string) {
  npfcUrl(url);
  const { body, receipt } = artifact;
  if (receipt.status !== 200 || receipt.requestedUrl !== url || receipt.finalUrl !== url || receipt.bytes !== body.length || receipt.sha256 !== sha256(body) || !body.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid NPFC cached PDF/200 receipt");
}
function validateOrigin(bytes: Buffer, pointer: Pointer, artifact: Artifact) {
  if (sha256(bytes) !== pointer.manifestSha256) throw new Error("NPFC origin manifest hash mismatch");
  const batch = JSON.parse(bytes.toString("utf8"));
  const item = batch.items?.find((i: any) => i.archiveId === pointer.archiveId);
  if (batch.version !== "fishery-column-batch/0.1" || batch.id !== pointer.batchId || batch.status !== "complete" || !item || item.column !== "npfc" || item.state !== "ready" || pointer.archiveId !== `${pointer.batchId}_${sha256("npfc" + item.url).slice(0, 16)}` || item.prepared?.sourceCapture?.attachmentUrl !== pointer.url || item.prepared.sourceCapture.attachmentSha256 !== artifact.receipt.sha256 || item.prepared.sourceCapture.attachmentCapturedAt !== artifact.receipt.finishedAt) throw new Error("NPFC cache origin is not a complete ready original capture");
  during(artifact.receipt, batch);
}
function validators(receipt: Receipt): ConditionalHeaders {
  const result: ConditionalHeaders = {};
  if (receipt.etag && receipt.etag.length <= 1024 && !/[\r\n]/.test(receipt.etag)) result["if-none-match"] = receipt.etag;
  if (receipt.lastModified && receipt.lastModified.length <= 1024 && !/[\r\n]/.test(receipt.lastModified)) result["if-modified-since"] = receipt.lastModified;
  return result;
}

export async function captureNpfcPdf(options: { dataDir: string; batchId: string; archiveId: string; url: string; check: Check; write: Write; get: (url: string, name: string, headers?: ConditionalHeaders) => Promise<Artifact>; wait: () => Promise<unknown> }) {
  npfcUrl(options.url);
  const name = `${options.archiveId}-pdf`;
  let cached: { pointer: Pointer; manifest: Buffer; receiptBytes: Buffer; artifact: Artifact } | undefined, indexBytes: Buffer | undefined, unreadableIndex = false;
  await options.check();
  try {
    indexBytes = await bounded(cacheFile(options.dataDir, options.url), 4096);
    const pointer = pointerSchema.parse(JSON.parse(indexBytes.toString("utf8")));
    if (pointer.url !== options.url || pointer.batchId === options.batchId) throw new Error("NPFC cache source/URL mismatch");
    const root = path.join(options.dataDir, "fishery-batches", pointer.batchId);
    const manifest = await bounded(path.join(root, "manifest.json"), 2 * 1024 * 1024);
    const receiptBytes = await bounded(path.join(root, "raw", `${pointer.archiveId}-pdf.receipt.json`), 16 * 1024);
    const artifact = { body: await bounded(path.join(root, "raw", `${pointer.archiveId}-pdf.bin`), 10 * 1024 * 1024), receipt: receiptSchema.parse(JSON.parse(receiptBytes.toString("utf8"))) };
    validPdf(artifact, options.url); validateOrigin(manifest, pointer, artifact);
    cached = { pointer, manifest, receiptBytes, artifact };
  } catch (error) {
    unreadableIndex = !indexBytes && (error as NodeJS.ErrnoException).code !== "ENOENT";
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || indexBytes) await options.write(`${name}-cache-rejected.json`, encode({ error: String((error as Error).message), index: indexBytes?.toString("base64") ?? null }));
  }
  await options.check();
  const requestHeaders = cached ? validators(cached.artifact.receipt) : {};
  const response = await options.get(options.url, `${name}-response`, requestHeaders);
  let artifact = response, receiptBytes: Buffer = encode(response.receipt), source: Pointer | undefined;
  const matching304 = response.receipt.finalUrl === options.url && response.body.length === 0 && (!response.receipt.etag || response.receipt.etag === requestHeaders["if-none-match"]) && (!response.receipt.lastModified || !requestHeaders["if-modified-since"] || response.receipt.lastModified === requestHeaders["if-modified-since"]);
  if (response.receipt.status === 304 && cached && Object.keys(requestHeaders).length && matching304) {
    artifact = cached.artifact; receiptBytes = cached.receiptBytes; source = cached.pointer;
    await options.write(`${name}-origin-manifest.json`, cached.manifest);
    await options.write(`${name}-revalidation.json`, encode({ version: "npfc-pdf-revalidation/1", url: options.url, source, pdfSha256: artifact.receipt.sha256, originalReceiptSha256: sha256(receiptBytes), requestHeaders }));
  } else if (response.receipt.status === 304) {
    // Preserve the unusable 304 and issue at most one unconditional full GET in this round.
    await options.wait(); artifact = await options.get(options.url, `${name}-fallback`); receiptBytes = encode(artifact.receipt);
  }
  validPdf(artifact, options.url);
  await options.write(`${name}.bin`, artifact.body);
  await options.write(`${name}.receipt.json`, receiptBytes);
  return { ...artifact, publish: async () => {
    // An unreadable/oversized index stays intact as evidence; a complete batch does not need it.
    if (unreadableIndex) return;
    let guardFailure: { error: unknown } | undefined;
    const check = async () => { try { await options.check(); } catch (error) { guardFailure = { error }; throw error; } };
    const rethrowGuard = () => { if (guardFailure) throw guardFailure.error; };
    const file = cacheFile(options.dataDir, options.url), temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await check();
      const manifest = await bounded(path.join(options.dataDir, "fishery-batches", options.batchId, "manifest.json"), 2 * 1024 * 1024);
      const pointer: Pointer = source ?? { version: "npfc-pdf-cache/1", url: options.url, batchId: options.batchId, archiveId: options.archiveId, manifestSha256: sha256(manifest) };
      if (!source) validateOrigin(manifest, pointer, artifact);
      await check(); await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await check();
      await writeFile(temporary, encode(pointer), { flag: "wx", mode: 0o600 }); await check(); await rename(temporary, file); await check();
    } catch (error) {
      rethrowGuard();
      await check();
      // Cache I/O cannot negate the complete archive. Keep a diagnostic when the disk permits it.
      try { await check(); await writeFile(path.join(options.dataDir, "fishery-batches", options.batchId, "raw", `${name}-cache-publish-rejected.json`), encode({ error: String((error as Error).message) }), { flag: "wx", mode: 0o600 }); await check(); }
      catch { rethrowGuard(); await check(); }
    }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  } };
}

// The frozen origin and actual 304 response live in this batch. The mutable cache is never consulted.
export async function verifyNpfcPdf(dataDir: string, batch: { id: string; startedAt: string; finishedAt: string | null }, archive: string, url: string, artifact: { body: Buffer; receipt: unknown }) {
  const pdf = { body: artifact.body, receipt: receiptSchema.parse(artifact.receipt) }; validPdf(pdf, url);
  const root = path.join(dataDir, "fishery-batches", batch.id, "raw"), name = `${archive}-pdf`;
  let proofBytes: Buffer;
  try { proofBytes = await bounded(path.join(root, `${name}-revalidation.json`), 8192); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    for (const suffix of ["-origin-manifest.json", "-response.receipt.json"]) {
      const marker = await bounded(path.join(root, name + suffix), 2 * 1024 * 1024).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (marker && suffix === "-origin-manifest.json") throw new Error("NPFC revalidation marker missing");
      if (marker && JSON.parse(marker.toString("utf8")).status === 304) {
        const fallback = await bounded(path.join(root, `${name}-fallback.receipt.json`), 16 * 1024).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (!fallback || !fallback.equals(await bounded(path.join(root, `${name}.receipt.json`), 16 * 1024)) || !pdf.body.equals(await bounded(path.join(root, `${name}-fallback.bin`), 10 * 1024 * 1024))) throw new Error("NPFC revalidation marker missing");
      }
    }
    during(pdf.receipt, batch); return;
  }
  const proof = proofSchema.parse(JSON.parse(proofBytes.toString("utf8")));
  const receiptBytes = await bounded(path.join(root, `${name}.receipt.json`), 16 * 1024);
  if (proof.url !== url || proof.source.url !== url || proof.source.batchId === batch.id || proof.pdfSha256 !== pdf.receipt.sha256 || proof.originalReceiptSha256 !== sha256(receiptBytes) || JSON.stringify(proof.requestHeaders) !== JSON.stringify(validators(pdf.receipt)) || !Object.keys(proof.requestHeaders).length) throw new Error("NPFC revalidation validator/origin binding mismatch");
  validateOrigin(await bounded(path.join(root, `${name}-origin-manifest.json`), 2 * 1024 * 1024), proof.source, pdf);
  const response = receiptSchema.parse(JSON.parse((await bounded(path.join(root, `${name}-response.receipt.json`), 16 * 1024)).toString("utf8")));
  const body = await bounded(path.join(root, `${name}-response.bin`), 10 * 1024 * 1024);
  if (response.status !== 304 || response.requestedUrl !== url || response.finalUrl !== url || body.length || response.bytes !== 0 || response.sha256 !== sha256(body) || Date.parse(pdf.receipt.finishedAt) > Date.parse(response.startedAt) || JSON.stringify(response.requestHeaders) !== JSON.stringify(proof.requestHeaders) || response.etag && response.etag !== proof.requestHeaders["if-none-match"] || response.lastModified && proof.requestHeaders["if-modified-since"] && response.lastModified !== proof.requestHeaders["if-modified-since"]) throw new Error("Invalid NPFC actual 304 response evidence");
  during(response, batch);
}
