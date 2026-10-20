// Bounded, operator-initiated official GET capture. No database, model, review or publishing.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { COLUMNS, columnIdSchema, discoverColumn, prepareColumnArticle, type ColumnId } from "./official-columns.ts";
import { sha256 } from "./source-adapters.ts";
import { assertIotcRobots, discoverIotc, iotcAttachment, prepareIotc } from "./iotc-columns.ts";
import { extractPdf } from "./pdf-text.ts";

export const batchIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
const archiveIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}_[a-f0-9]{16}$/);
export type PreparedArticle = ReturnType<typeof prepareColumnArticle> | ReturnType<typeof prepareIotc>;
export interface BatchItem { column: ColumnId; url: string; discoveryTitle: string; listDate: string | null; state: "ready" | "irrelevant" | "failed"; archiveId: string; prepared: Omit<PreparedArticle, "body"> | null; error: string | null; }
export interface ColumnBatch { version: "fishery-column-batch/0.1"; id: string; startedAt: string; finishedAt: string | null; status: "running" | "complete"; sources: { id: ColumnId; listed: number; titleFiltered: number; attempted: number; error: string | null }[]; items: BatchItem[]; }
export const batchRoot = (dataDir: string) => path.resolve(dataDir, "fishery-batches");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
async function save(file: string, value: unknown) { await writeFile(file, json(value), { mode: 0o600 }); }

export async function readBatch(dataDir: string, id: string): Promise<ColumnBatch> {
  batchIdSchema.parse(id);
  const file = path.join(batchRoot(dataDir), id, "manifest.json");
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error("Batch manifest too large");
  const value = JSON.parse(await readFile(file, "utf8")) as ColumnBatch;
  if (value.version !== "fishery-column-batch/0.1" || value.id !== id || !Array.isArray(value.items) || !Array.isArray(value.sources) || value.items.length > 36) throw new Error("Invalid batch manifest");
  for (const item of value.items) { columnIdSchema.parse(item.column); archiveIdSchema.parse(item.archiveId); if (!item.archiveId.startsWith(id + "_")) throw new Error("Archive/batch mismatch"); }
  return value;
}
export async function listBatches(dataDir: string) {
  let names: string[];
  try { names = await readdir(batchRoot(dataDir)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return await Promise.all(names.filter(id => batchIdSchema.safeParse(id).success).sort().reverse().slice(0, 40).map(id => readBatch(dataDir, id)));
}
export async function readCapturedText(dataDir: string, archiveId: string, expectedHash: string): Promise<string> {
  archiveIdSchema.parse(archiveId);
  const runId = archiveId.slice(0, archiveId.lastIndexOf("_"));
  const file = path.join(batchRoot(dataDir), runId, "body", `${archiveId}.txt`);
  if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error("Captured body too large");
  const body = await readFile(file, "utf8");
  if (sha256(body) !== expectedHash) throw new Error("Captured body hash mismatch");
  return body;
}
// Importers must reconstruct the prepared result from raw bytes, never trust edited manifest fields.
export async function verifyBatchItem(dataDir: string, batch: ColumnBatch, item: BatchItem) {
  if (!item.archiveId.startsWith(batchIdSchema.parse(batch.id) + "_")) throw new Error("Archive/batch mismatch");
  archiveIdSchema.parse(item.archiveId);
  const root = path.join(batchRoot(dataDir), batch.id, "raw");
  if ((await stat(path.join(root,`${item.archiveId}.bin`))).size > 6 * 1024 * 1024) throw new Error("Captured response too large");
  const raw = await readFile(path.join(root, `${item.archiveId}.bin`));
  const receipt = JSON.parse(await readFile(path.join(root, `${item.archiveId}.receipt.json`), "utf8"));
  if (receipt.requestedUrl !== item.url) throw new Error("Discovery URL/receipt mismatch");
  if(item.archiveId !== `${batch.id}_${sha256(item.column+item.url).slice(0,16)}`) throw new Error("Archive identity mismatch");
  let result: PreparedArticle;
  if (item.column === "iotc") {
    const robots = await readArchive(root, "iotc-robots", 256 * 1024);
    assertIotcRobots(robots.receipt, robots.body);
    const listing = await readArchive(root, "iotc-list", 6 * 1024 * 1024);
    if (listing.receipt.requestedUrl !== COLUMNS.iotc.url || listing.receipt.finalUrl !== COLUMNS.iotc.url || listing.receipt.status !== 200) throw new Error("Invalid IOTC listing receipt");
    const candidate = discoverIotc(new TextDecoder("utf8", { fatal: true }).decode(listing.body)).candidates.find(c => c.url === item.url);
    if (!candidate) throw new Error("IOTC measure identity absent from archived current listing");
    const attachment = await readArchive(root, `${item.archiveId}-pdf`, 10 * 1024 * 1024);
    result = prepareIotc(candidate, receipt, raw, { receipt: attachment.receipt, bytes: attachment.body, parsed: await extractPdf(attachment.body) });
    result.evidence.push({ url: COLUMNS.iotc.url, sha256: sha256(listing.body), page: null, section: "Archived current CMM listing; discovery identity" });
  } else result = prepareColumnArticle(item.column, receipt, raw);
  result.sourceCapture.archiveId = item.archiveId;
  if (result.body && await readCapturedText(dataDir, item.archiveId, result.sourceCapture.bodySha256!) !== result.body) throw new Error("Prepared body differs from archived body");
  return result;
}

async function readArchive(root: string, name: string, maxBytes: number) {
  const file = path.join(root, `${name}.bin`), receiptFile = path.join(root, `${name}.receipt.json`);
  if ((await stat(file)).size > maxBytes || (await stat(receiptFile)).size > 16 * 1024) throw new Error("Captured response too large");
  const body = await readFile(file), receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  if (sha256(body) !== receipt.sha256) throw new Error("Captured raw hash mismatch");
  return { body, receipt };
}

type Response = { url: string; status: number; body: Buffer; headers: { get(name: string): string | null } };
type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = url => guardedFetch(url, { route: "direct", timeoutMs: 20_000, maxBytes: new URL(url).pathname.endsWith(".pdf") ? 10 * 1024 * 1024 : 6 * 1024 * 1024, maxRedirects: 3, redirectPolicy: "same-origin", headers: { "user-agent": "Mozilla/5.0 (compatible; FisheryEvidencePilot/0.2)", accept: "text/html,application/pdf;q=0.9,text/plain;q=0.8" } });
export async function collectColumns(options: { id: string; dataDir: string; columns: ColumnId[]; limit: number; iotcSelect?: string[]; fetch?: Fetcher; wait?: (ms: number) => Promise<unknown> }) {
  const id = batchIdSchema.parse(options.id), limit = z.number().int().min(1).max(5).parse(options.limit);
  const columns = [...new Set(options.columns.map(c => columnIdSchema.parse(c)))];
  if (!columns.length) throw new Error("At least one column is required");
  if (options.iotcSelect?.length && (!columns.includes("iotc") || options.iotcSelect.length > limit)) throw new Error("IOTC selection needs the IOTC column and must fit the batch limit");
  const root = path.join(batchRoot(options.dataDir), id);
  await mkdir(batchRoot(options.dataDir), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 }); // Exclusive: never mix captures or blindly retry a partial run.
  await mkdir(path.join(root, "raw"), { mode: 0o700 });
  await mkdir(path.join(root, "body"), { mode: 0o700 });
  const batch: ColumnBatch = { version: "fishery-column-batch/0.1", id, startedAt: new Date().toISOString(), finishedAt: null, status: "running", sources: [], items: [] };
  const persist = () => save(path.join(root, "manifest.json"), batch);
  await persist();
  const fetch = options.fetch ?? defaultFetch, wait = options.wait ?? sleep, deadline = Date.now() + 180_000;
  async function get(url: string, name: string) {
    if (Date.now() > deadline) throw new Error("Manual batch time budget exhausted");
    const startedAt = new Date().toISOString(), response = await fetch(url);
    const maxBytes = name.endsWith("-robots") ? 256 * 1024 : name.endsWith("-pdf") ? 10 * 1024 * 1024 : 6 * 1024 * 1024;
    if (response.body.length > maxBytes) throw new Error("Captured response too large; full bytes required");
    const receipt = { requestedUrl: url, finalUrl: response.url, status: response.status, startedAt, finishedAt: new Date().toISOString(), contentType: response.headers.get("content-type"), bytes: response.body.length, sha256: sha256(response.body) };
    await writeFile(path.join(root, "raw", `${name}.bin`), response.body, { mode: 0o600, flag: "wx" });
    await save(path.join(root, "raw", `${name}.receipt.json`), receipt);
    return { receipt, body: response.body };
  }
  for (const column of columns) {
    const source = { id: column, listed: 0, titleFiltered: 0, attempted: 0, error: null as string | null };
    batch.sources.push(source); await persist();
    try {
      const config = COLUMNS[column];
      const robots = await get(new URL("/robots.txt", config.url).href, `${column}-robots`);
      // Inspected sources currently return 404. Any new policy or denial needs operator inspection.
      if (column === "iotc") assertIotcRobots(robots.receipt, robots.body);
      else if (robots.receipt.status !== 404) throw new Error(`Robots status ${robots.receipt.status}; stop for policy inspection`);
      const delay = column === "iotc" ? 10_000 : 1200;
      await wait(delay);
      const listing = await get(config.url, `${column}-list`);
      if (listing.receipt.status !== 200 || new URL(listing.receipt.finalUrl).origin !== new URL(config.url).origin || (column === "iotc" && listing.receipt.finalUrl !== config.url)) throw new Error(`Listing unavailable: HTTP ${listing.receipt.status} or unexpected identity`);
      const discovered = discoverColumn(column, new TextDecoder("utf8", { fatal: true }).decode(listing.body));
      source.listed = discovered.listed; source.titleFiltered = discovered.rejected;
      if (!discovered.listed) throw new Error("Official listing selector returned no article identities");
      let ready = 0;
      let candidates = [...discovered.candidates].sort((a, b) => Number(a.priority === "context") - Number(b.priority === "context")).slice(0, 12);
      const iotcCandidates = column === "iotc" ? discoverIotc(new TextDecoder("utf8", { fatal: true }).decode(listing.body)).candidates : [];
      if (column === "iotc") {
        const selection = options.iotcSelect ?? [];
        if (selection.some(value => !iotcCandidates.some(c => c.url === value || c.number === value))) throw new Error("Requested IOTC selection absent from current listing; no direct URL bypass");
        candidates = iotcCandidates.filter(c => !selection.length || selection.includes(c.url) || selection.includes(c.number)).slice(0, limit);
      }
      for (const candidate of candidates) {
        if (ready >= limit) break;
        const archiveId = `${id}_${sha256(column + candidate.url).slice(0, 16)}`;
        const item: BatchItem = { column, url: candidate.url, discoveryTitle: candidate.title, listDate: candidate.listDate, state: "failed", archiveId, prepared: null, error: null };
        source.attempted++; batch.items.push(item);
        try {
          await wait(delay);
          const article = await get(candidate.url, archiveId);
          let prepared: PreparedArticle;
          if (column === "iotc") {
            let pdf: Parameters<typeof prepareIotc>[3];
            if (article.receipt.status === 200) {
              const url = iotcAttachment(article.body, article.receipt.finalUrl);
              await wait(delay);
              const attachment = await get(url, `${archiveId}-pdf`);
              pdf = { receipt: attachment.receipt, bytes: attachment.body, parsed: await extractPdf(attachment.body) };
            }
            prepared = prepareIotc(iotcCandidates.find(c => c.url === candidate.url)!, article.receipt, article.body, pdf);
            prepared.evidence.push({ url: COLUMNS.iotc.url, sha256: sha256(listing.body), page: null, section: "Archived current CMM listing; discovery identity" });
          } else prepared = prepareColumnArticle(column, article.receipt, article.body);
          prepared.sourceCapture.archiveId = archiveId;
          const { body, ...metadata } = prepared;
          item.prepared = metadata;
          if (body) await writeFile(path.join(root, "body", `${archiveId}.txt`), body, { mode: 0o600, flag: "wx" });
          item.state = prepared.readyForReview ? "ready" : prepared.sourceCapture.parseStatus === "parsed" ? "irrelevant" : "failed";
          if (item.state === "ready") ready++;
          if (item.state === "failed") item.error = [...prepared.sourceCapture.conflicts, ...prepared.warnings].join("; ") || "Article parse failed";
        } catch (error) { item.error = String((error as Error).message).slice(0, 500); }
        await persist();
      }
    } catch (error) { source.error = String((error as Error).message).slice(0, 500); }
    await persist();
  }
  batch.status = "complete"; batch.finishedAt = new Date().toISOString(); await persist();
  return batch;
}
