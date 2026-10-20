// Bounded manual official capture and explicit static archive reparse. No database, model, review or publishing.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { COLUMNS, columnIdSchema, discoverColumn, prepareColumnArticle, type ColumnId } from "./official-columns.ts";
import { archiveReceiptSchema, sha256, type PdfText } from "./source-adapters.ts";
import { assertIotcRobots, discoverIotc, iotcAttachment, prepareIotc } from "./iotc-columns.ts";
import { extractPdf } from "./pdf-text.ts";

export const batchIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
const archiveIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}_[a-f0-9]{16}$/);
export type PreparedArticle = ReturnType<typeof prepareColumnArticle> | ReturnType<typeof prepareIotc>;
export interface BatchItem { column: ColumnId; url: string; discoveryTitle: string; listDate: string | null; state: "ready" | "irrelevant" | "failed"; archiveId: string; prepared: Omit<PreparedArticle, "body"> | null; error: string | null; }
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const replaySchema=z.strictObject({version:z.literal("fishery-pdf-reparse/1"),operation:z.literal("static-archived-pdf-reparse"),sourceBatchId:batchIdSchema,sourceManifestSha256:hashSchema,reparsedAt:z.iso.datetime({offset:true}),networkRequests:z.literal(0),reparsedItems:z.int().min(1).max(36),sourceSummary:z.array(z.strictObject({id:columnIdSchema,listed:z.int().nonnegative(),titleFiltered:z.int().nonnegative(),attempted:z.int().nonnegative(),error:z.string().nullable()})).max(6),
  artifacts:z.array(z.strictObject({sourceName:z.string(),targetName:z.string(),sha256:hashSchema})).max(148),
  items:z.array(z.strictObject({sourceArchiveId:archiveIdSchema,archiveId:archiveIdSchema,oldBodySha256:hashSchema,oldParser:z.string().min(1).max(200),newBodySha256:hashSchema,newParser:z.string().min(1).max(200)})).max(36)});
type Replay=z.infer<typeof replaySchema>;
type ParsePdf=(bytes:Buffer)=>Promise<PdfText>;
export interface ColumnBatch { version: "fishery-column-batch/0.1"; id: string; startedAt: string; finishedAt: string | null; status: "running" | "complete"; reparse?:Replay; networkRequests?:0;reparsedItems?:number;sources: { id: ColumnId; listed: number; titleFiltered: number; attempted: number; error: string | null }[]; items: BatchItem[]; }
export const batchRoot = (dataDir: string) => path.resolve(dataDir, "fishery-batches");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
async function save(file: string, value: unknown) { await writeFile(file, json(value), { mode: 0o600 }); }

export async function readBatch(dataDir: string, id: string): Promise<ColumnBatch> {
  batchIdSchema.parse(id);
  const file = path.join(batchRoot(dataDir), id, "manifest.json");
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error("Batch manifest too large");
  const value = JSON.parse(await readFile(file, "utf8")) as ColumnBatch;
  if (value.version !== "fishery-column-batch/0.1" || value.id !== id || !Array.isArray(value.items) || !Array.isArray(value.sources) || value.items.length > 36) throw new Error("Invalid batch manifest");
  if(value.reparse) replaySchema.parse(value.reparse);
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
export async function verifyBatchItem(dataDir: string, batch: ColumnBatch, item: BatchItem, options:{parsePdf?:ParsePdf}={}) {
  const marker=await stat(path.join(batchRoot(dataDir),batch.id,"reparse.json")).then(()=>true,error=>{if(error.code==="ENOENT") return false;throw error;});
  if(marker!==!!batch.reparse) throw new Error("Reparse provenance marker/manifest mismatch");
  const replay=batch.reparse?await verifyReplay(dataDir,batch):null;
  if (!item.archiveId.startsWith(batchIdSchema.parse(batch.id) + "_")) throw new Error("Archive/batch mismatch");
  archiveIdSchema.parse(item.archiveId);
  const root = path.join(batchRoot(dataDir), batch.id, "raw");
  if ((await stat(path.join(root,`${item.archiveId}.bin`))).size > 6 * 1024 * 1024) throw new Error("Captured response too large");
  const {body:raw,receipt}=await readArchive(root,item.archiveId,6*1024*1024);
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
    result = prepareIotc(candidate, receipt, raw, { receipt: attachment.receipt, bytes: attachment.body, parsed: await (options.parsePdf??extractPdf)(attachment.body) },replay?"archive_replay":"live_capture");
    result.evidence.push({ url: COLUMNS.iotc.url, sha256: sha256(listing.body), page: null, section: "Archived current CMM listing; discovery identity" });
  } else result = prepareColumnArticle(item.column, receipt, raw);
  result.sourceCapture.archiveId = item.archiveId;
  if(replay) {
    const bound=replay.items.find(i=>i.archiveId===item.archiveId);
    if(!bound||result.sourceCapture.parser!==bound.newParser||result.sourceCapture.bodySha256!==bound.newBodySha256) throw new Error("Reparse parser/body provenance mismatch");
  }
  if (result.body && await readCapturedText(dataDir, item.archiveId, result.sourceCapture.bodySha256!) !== result.body) throw new Error("Prepared body differs from archived body");
  return result;
}

async function readArchive(root: string, name: string, maxBytes: number) {
  const file = path.join(root, `${name}.bin`), receiptFile = path.join(root, `${name}.receipt.json`);
  if ((await stat(file)).size > maxBytes || (await stat(receiptFile)).size > 16 * 1024) throw new Error("Captured response too large");
  const body = await readFile(file), receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  archiveReceiptSchema.parse(receipt);
  if (sha256(body) !== receipt.sha256) throw new Error("Captured raw hash mismatch");
  if(receipt.bytes!==undefined&&receipt.bytes!==body.length) throw new Error("Captured receipt byte count mismatch");
  return { body, receipt };
}

type SavedArtifact={sourceName:string;targetName:string;sha256:string;bytes:Buffer};
async function loadReparseSource(dataDir:string,id:string,targetId:string) {
  const source=await readBatch(dataDir,id),root=path.join(batchRoot(dataDir),id);
  if(source.status!=="complete"||!source.finishedAt||source.reparse||!source.items.length||source.items.some(i=>i.column!=="iotc"||i.state!=="ready"||!i.prepared?.sourceCapture.bodySha256)) throw new Error("A complete original IOTC PDF batch with ready archived bodies is required");
  const manifestBytes=await readFile(path.join(root,"manifest.json"));
  if(JSON.stringify(JSON.parse(manifestBytes.toString("utf8")))!==JSON.stringify(source)) throw new Error("Source manifest changed while reading");
  const artifacts:SavedArtifact[]=[];
  const add=async(sourceName:string,targetName:string,max:number)=>{
    const file=path.join(root,sourceName);if((await stat(file)).size>max) throw new Error("Reparse source artifact exceeds size limit");
    const bytes=await readFile(file);artifacts.push({sourceName,targetName,sha256:sha256(bytes),bytes});
  };
  for(const name of ["iotc-robots","iotc-list"]) {
    await readArchive(path.join(root,"raw"),name,name.endsWith("robots")?256*1024:6*1024*1024);
    await add(`raw/${name}.bin`,`raw/${name}.bin`,6*1024*1024);await add(`raw/${name}.receipt.json`,`raw/${name}.receipt.json`,16*1024);
  }
  for(const item of source.items) {
    const archiveId=`${targetId}_${sha256(item.column+item.url).slice(0,16)}`;
    if(item.archiveId!==`${id}_${sha256(item.column+item.url).slice(0,16)}`) throw new Error("Source archive identity mismatch");
    const landing=await readArchive(path.join(root,"raw"),item.archiveId,6*1024*1024),pdf=await readArchive(path.join(root,"raw"),`${item.archiveId}-pdf`,10*1024*1024),capture=item.prepared!.sourceCapture;
    if(landing.receipt.requestedUrl!==item.url||capture.archiveId!==item.archiveId||capture.rawSha256!==sha256(landing.body)||capture.attachmentSha256!==sha256(pdf.body)||capture.capturedAt!==landing.receipt.finishedAt||capture.attachmentCapturedAt!==pdf.receipt.finishedAt) throw new Error("Source prepared hashes/acquisition times disagree with original receipts");
    await readCapturedText(dataDir,item.archiveId,capture.bodySha256!);
    await add(`body/${item.archiveId}.txt`,`body/${archiveId}.txt`,4*1024*1024);
    for(const suffix of ["","-pdf"]) {
      await add(`raw/${item.archiveId}${suffix}.bin`,`raw/${archiveId}${suffix}.bin`,10*1024*1024);
      await add(`raw/${item.archiveId}${suffix}.receipt.json`,`raw/${archiveId}${suffix}.receipt.json`,16*1024);
    }
  }
  return {source,manifestBytes,artifacts};
}
async function verifyReplay(dataDir:string,batch:ColumnBatch) {
  const replay=replaySchema.parse(batch.reparse);
  if(replay.sourceBatchId===batch.id||batch.status!=="complete"||batch.startedAt!==replay.reparsedAt) throw new Error("Invalid static reparse batch identity/state");
  const markerFile=path.join(batchRoot(dataDir),batch.id,"reparse.json");
  if((await stat(markerFile)).size>128*1024||JSON.stringify(replaySchema.parse(JSON.parse(await readFile(markerFile,"utf8"))))!==JSON.stringify(replay)) throw new Error("Reparse provenance marker/manifest mismatch");
  const original=await loadReparseSource(dataDir,replay.sourceBatchId,batch.id);
  if(batch.networkRequests!==0||batch.reparsedItems!==original.source.items.length||replay.reparsedItems!==original.source.items.length||JSON.stringify(replay.sourceSummary)!==JSON.stringify(original.source.sources)||batch.sources.some(s=>s.listed!==0||s.attempted!==0||s.titleFiltered!==0)) throw new Error("Static reparse summary cannot claim fresh network acquisition");
  if(sha256(original.manifestBytes)!==replay.sourceManifestSha256) throw new Error("Source manifest hash changed; replay provenance invalid");
  // Body entries are historical bindings, not copies into the new archive. Every raw response and
  // receipt must remain byte-identical under the deterministic new archive name.
  const raw=original.artifacts.filter(a=>a.sourceName.startsWith("raw/"));
  const descriptors=raw.map(({sourceName,targetName,sha256})=>({sourceName,targetName,sha256}));
  if(JSON.stringify(descriptors)!==JSON.stringify(replay.artifacts)||replay.items.length!==original.source.items.length||batch.items.length!==original.source.items.length) throw new Error("Replay artifact coverage differs from source archive");
  for(const file of raw) {
    const target=path.join(batchRoot(dataDir),batch.id,file.targetName);
    if((await stat(target)).size!==file.bytes.length||sha256(await readFile(target))!==file.sha256) throw new Error("Replay raw/receipt hash mismatch");
  }
  for(const source of original.source.items) {
    const target=batch.items.find(i=>i.url===source.url),binding=replay.items.find(i=>i.sourceArchiveId===source.archiveId),capture=source.prepared!.sourceCapture;
    if(!target||target.column!=="iotc"||!binding||target.archiveId!==binding.archiveId||binding.archiveId!==`${batch.id}_${sha256("iotc"+source.url).slice(0,16)}`||binding.oldBodySha256!==capture.bodySha256||binding.oldParser!==capture.parser) throw new Error("Replay original item/body/parser binding mismatch");
  }
  return replay;
}

// Static-only transformation: original HTTP bytes, receipts and timestamps are preserved verbatim.
// No database imports, requests, model calls, old-body overwrite or retry of an existing target.
export async function reparseArchivedIotc(options:{dataDir:string;sourceBatchId:string;id:string;parsePdf?:ParsePdf}) {
  const id=batchIdSchema.parse(options.id),sourceBatchId=batchIdSchema.parse(options.sourceBatchId);
  if(id===sourceBatchId) throw new Error("A new exclusive batch id is required");
  const root=path.join(batchRoot(options.dataDir),id),sourceRoot=path.join(batchRoot(options.dataDir),sourceBatchId);
  const exists=await stat(root).then(()=>true,error=>{if(error.code==="ENOENT") return false;throw error;});
  if(exists) throw Object.assign(new Error("Target batch already exists; choose a new exclusive batch id"),{code:"EEXIST"});
  const original=await loadReparseSource(options.dataDir,sourceBatchId,id);
  const raw=original.artifacts.filter(a=>a.sourceName.startsWith("raw/")),reparsedAt=new Date().toISOString();
  const replay:Replay={version:"fishery-pdf-reparse/1",operation:"static-archived-pdf-reparse",sourceBatchId,sourceManifestSha256:sha256(original.manifestBytes),reparsedAt,networkRequests:0,reparsedItems:original.source.items.length,sourceSummary:original.source.sources,artifacts:raw.map(({sourceName,targetName,sha256})=>({sourceName,targetName,sha256})),items:[]};
  const batch:ColumnBatch={version:"fishery-column-batch/0.1",id,startedAt:reparsedAt,finishedAt:null,status:"running",networkRequests:0,reparsedItems:original.source.items.length,sources:[{id:"iotc",listed:0,titleFiltered:0,attempted:0,error:null}],items:[],reparse:replay};
  const robots=await readArchive(path.join(sourceRoot,"raw"),"iotc-robots",256*1024);assertIotcRobots(robots.receipt,robots.body);
  const listing=await readArchive(path.join(sourceRoot,"raw"),"iotc-list",6*1024*1024);
  if(listing.receipt.requestedUrl!==COLUMNS.iotc.url||listing.receipt.finalUrl!==COLUMNS.iotc.url||listing.receipt.status!==200) throw new Error("Invalid original IOTC listing receipt");
  const candidates=discoverIotc(new TextDecoder("utf8",{fatal:true}).decode(listing.body)).candidates;
  const bodies:{archiveId:string;body:string}[]=[];
  for(const old of original.source.items) {
    const candidate=candidates.find(c=>c.url===old.url);if(!candidate) throw new Error("Original item absent from archived IOTC listing");
    const landing=await readArchive(path.join(sourceRoot,"raw"),old.archiveId,6*1024*1024),pdf=await readArchive(path.join(sourceRoot,"raw"),`${old.archiveId}-pdf`,10*1024*1024);
    const prepared=prepareIotc(candidate,landing.receipt,landing.body,{receipt:pdf.receipt,bytes:pdf.body,parsed:await(options.parsePdf??extractPdf)(pdf.body)},"archive_replay");
    prepared.evidence.push({url:COLUMNS.iotc.url,sha256:sha256(listing.body),page:null,section:"Archived current CMM listing; discovery identity"});
    if(!prepared.readyForReview||!prepared.body) throw new Error(`Static PDF reparse failed: ${prepared.sourceCapture.conflicts.join("; ")||prepared.warnings.join("; ")}`);
    const archiveId=`${id}_${sha256("iotc"+old.url).slice(0,16)}`;prepared.sourceCapture.archiveId=archiveId;
    const {body,...metadata}=prepared;
    batch.items.push({...old,archiveId,prepared:metadata,state:"ready",error:null});bodies.push({archiveId,body});
    replay.items.push({sourceArchiveId:old.archiveId,archiveId,oldBodySha256:old.prepared!.sourceCapture.bodySha256!,oldParser:old.prepared!.sourceCapture.parser,newBodySha256:prepared.sourceCapture.bodySha256!,newParser:prepared.sourceCapture.parser});
  }
  // Check the original complete snapshot once more before creating any new target files.
  const finalSnapshot=await loadReparseSource(options.dataDir,sourceBatchId,id);
  if(sha256(finalSnapshot.manifestBytes)!==replay.sourceManifestSha256) throw new Error("Source manifest changed during reparse");
  if(finalSnapshot.artifacts.some((file,i)=>file.sha256!==original.artifacts[i]?.sha256)) throw new Error("Source artifact changed during reparse");
  await mkdir(batchRoot(options.dataDir),{recursive:true,mode:0o700});await mkdir(root,{mode:0o700});
  await writeFile(path.join(root,"manifest.json"),json(batch),{flag:"wx",mode:0o600});
  await mkdir(path.join(root,"raw"),{mode:0o700});await mkdir(path.join(root,"body"),{mode:0o700});
  await writeFile(path.join(root,"reparse.json"),json(replay),{flag:"wx",mode:0o600});
  for(const file of raw) await writeFile(path.join(root,file.targetName),file.bytes,{flag:"wx",mode:0o600});
  for(const file of bodies) await writeFile(path.join(root,"body",`${file.archiveId}.txt`),file.body,{flag:"wx",mode:0o600});
  batch.status="complete";batch.finishedAt=new Date().toISOString();
  await save(path.join(root,"manifest.json"),batch);
  return batch;
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
