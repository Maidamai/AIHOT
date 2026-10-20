// Explicit, one-shot GETs of the three pilot sources. No worker, credentials, models or approval.
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sha256, type Adapter } from "../backend/source-adapters.ts";

const urls = {
  jinjiang: "https://www.jinjiang.gov.cn/xxgk/jjyw/202603/t20260321_3276478.htm",
  iotc: "https://iotc.org/cmm/resolution-2601-establishing-interim-catch-limits-yellowfin-tuna-iotc-area-competence",
  fuzhou: "https://hyj.fuzhou.gov.cn/zwgk/tzgg/202610/t20261009_5379704.htm",
} as const;
const { values } = parseArgs({ options: { source: { type: "string" }, output: { type: "string" } } });
if (!values.source || !Object.hasOwn(urls, values.source) || !values.output) throw new Error("Use --source jinjiang|iotc|fuzhou --output <new directory>");
const source = values.source as Adapter;
const output = path.resolve(values.output);
// Refuse to mix new responses with a previous capture, including after a failed request.
await mkdir(output, { recursive: false });
const run = promisify(execFile);
const headers = { "user-agent": "Mozilla/5.0 (compatible; FisheryEvidencePilot/0.1)", accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" };
async function get(url: string, name: string, maxBytes: number) {
  const startedAt = new Date().toISOString();
  try {
    const response = await guardedFetch(url, { headers, route: "direct", timeoutMs: 35_000, maxBytes, maxRedirects: 3, redirectPolicy: "same-origin" });
    const receipt = { requestedUrl: url, finalUrl: response.url, status: response.status, startedAt, finishedAt: new Date().toISOString(),
      contentType: response.headers.get("content-type"), bytes: response.body.length, sha256: sha256(response.body) };
    await writeFile(path.join(output, `${name}.bin`), response.body, { flag: "wx" });
    await writeFile(path.join(output, `${name}.receipt.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return { response, receipt };
  } catch (error) {
    await writeFile(path.join(output, `${name}.failure.json`), JSON.stringify({ requestedUrl: url, startedAt, finishedAt: new Date().toISOString(),
      status: null, body: null, error: String((error as Error).message).slice(0, 500), reviewState: "acquisition_failed", noCacheFallback: true }, null, 2) + "\n", { flag: "wx" });
    return null;
  }
}
// This narrow pilot is not a scheduled crawler. Recheck IOTC's robots policy, then respect its
// known 10-second delay. An unavailable or changed policy stops acquisition for manual review.
if (source === "iotc") {
  const robots = await get("https://iotc.org/robots.txt", "robots", 256 * 1024);
  // Exact 2026-10-20 inspected snapshot: User-agent *, Crawl-delay 10; the two fixed paths allowed.
  // A changed rule (including a broader ancestor-path ban) must never pass a partial regex parser.
  if (!robots || robots.receipt.status !== 200 || robots.receipt.sha256 !== "278e83bcf567badfebcdea4d5d20ca9898e4449fe4eb2e3b5a08227b4ca9b762")
    throw new Error("IOTC robots policy unavailable or changed; inspect archived policy before proceeding");
  await wait(10_000);
}
const page = await get(urls[source], "page", 6 * 1024 * 1024);
if (!page) { console.log(JSON.stringify({ source, readyForReview: false, reviewState: "acquisition_failed", output })); process.exitCode = 2; }
else {
  const args = [path.join(import.meta.dirname, "prepare-official.ts"), "--source", source, "--receipt", path.join(output, "page.receipt.json"), "--html", path.join(output, "page.bin"), "--output", path.join(output, "prepared")];
  if (source === "iotc" && page.receipt.status === 200) {
    const $ = cheerio.load(page.response.text());
    const href = $("#content .node-cmm a[href]").toArray().map(e => new URL($(e).attr("href")!, page.receipt.finalUrl).href)
      .find(url => /^https:\/\/iotc\.org\/sites\/default\/files\/.*\.pdf$/.test(url));
    if (href) {
      await wait(10_000);
      const pdf = await get(href, "attachment", 10 * 1024 * 1024);
      if (pdf) args.push("--pdf-receipt", path.join(output, "attachment.receipt.json"), "--pdf", path.join(output, "attachment.bin"));
    }
  }
  const { stdout } = await run(process.execPath, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
  console.log(stdout.trim());
}
