// Offline only: consume existing captures. No .env loading, network, database or model operations.
import { readFile, mkdir, mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { prepareOfficial, sha256, type PdfText } from "../backend/source-adapters.ts";
const run = promisify(execFile);
const { values } = parseArgs({ options: { source: { type: "string" }, receipt: { type: "string" }, html: { type: "string" },
  "pdf-receipt": { type: "string" }, pdf: { type: "string" }, output: { type: "string" } } });
const source = z.enum(["jinjiang", "iotc", "fuzhou"]).parse(values.source);
for (const name of ["receipt", "html", "output"] as const) if (!values[name]) throw new Error(`--${name} is required`);
async function bytes(file: string, limit: number) { if ((await stat(file)).size > limit) throw new Error("Archive size limit exceeded"); return readFile(file); }
const receipt = JSON.parse(await readFile(values.receipt!, "utf8"));
const html = await bytes(values.html!, 6 * 1024 * 1024);
let pdf: Parameters<typeof prepareOfficial>[3];
if (values.pdf && values["pdf-receipt"]) {
  const original = await bytes(values.pdf, 10 * 1024 * 1024);
  let parsed: PdfText = { status: "unverified", parser: "unavailable-pdf-parser", rawSha256: sha256(original), text: "", pages: 0 };
  if (process.platform === "darwin") {
    const scratch = await mkdtemp(path.join(tmpdir(), "fishery-pdf-"));
    try {
      const { stdout } = await run("/usr/bin/swift", ["-module-cache-path", path.join(scratch, "cache"), path.join(import.meta.dirname, "pdf-text.swift"), path.resolve(values.pdf)], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      const result = z.object({ pages: z.int().positive(), text: z.string().min(1) }).parse(JSON.parse(stdout));
      parsed = { ...parsed, status: "parsed", parser: "Apple PDFKit/v1", text: result.text, pages: result.pages };
    } catch (error) { parsed = { ...parsed, status: "failed", error: String((error as Error).message).slice(0, 300) }; }
    finally { await rm(scratch, { recursive: true, force: true }); }
  }
  pdf = { receipt: JSON.parse(await readFile(values["pdf-receipt"], "utf8")), bytes: original, parsed };
} else if (values.pdf || values["pdf-receipt"]) throw new Error("Both --pdf and --pdf-receipt are required together");
const result = prepareOfficial(source, receipt, html, pdf);
await mkdir(values.output!, { recursive: true });
const { body, ...metadata } = result;
await writeFile(path.join(values.output!, "capture.json"), JSON.stringify(metadata, null, 2) + "\n");
if (body) await writeFile(path.join(values.output!, "body.txt"), body);
else await rm(path.join(values.output!, "body.txt"), { force: true });
console.log(JSON.stringify({ source, readyForReview: result.readyForReview, parseStatus: result.sourceCapture.parseStatus, conflicts: result.sourceCapture.conflicts, bodyBytes: body ? Buffer.byteLength(body) : 0 }));
