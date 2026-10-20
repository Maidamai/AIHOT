// Offline only: consume existing captures. No .env loading, network, database or model operations.
import { readFile, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { z } from "zod";
import { prepareOfficial } from "../backend/source-adapters.ts";
import { extractPdf } from "../backend/pdf-text.ts";
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
  const parsed = await extractPdf(original);
  pdf = { receipt: JSON.parse(await readFile(values["pdf-receipt"], "utf8")), bytes: original, parsed };
} else if (values.pdf || values["pdf-receipt"]) throw new Error("Both --pdf and --pdf-receipt are required together");
const result = prepareOfficial(source, receipt, html, pdf);
await mkdir(values.output!, { recursive: true });
const { body, ...metadata } = result;
await writeFile(path.join(values.output!, "capture.json"), JSON.stringify(metadata, null, 2) + "\n");
if (body) await writeFile(path.join(values.output!, "body.txt"), body);
else await rm(path.join(values.output!, "body.txt"), { force: true });
console.log(JSON.stringify({ source, readyForReview: result.readyForReview, parseStatus: result.sourceCapture.parseStatus, conflicts: result.sourceCapture.conflicts, bodyBytes: body ? Buffer.byteLength(body) : 0 }));
