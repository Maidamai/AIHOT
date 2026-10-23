// Offline replay only. HTTP receipts are local provenance, not an authenticated JMA signature.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jmaFeeds, jmaHash, jmaInstant, parseJmaFeed } from "../backend/jma-marine.ts";
import { inspectJmaSeaWarning, projectJmaSeaWarnings } from "../backend/jma-sea-warning-state.ts";

const [currentDirectory, ...priorDirectories] = process.argv.slice(2);
if (!currentDirectory) throw new Error("Usage: node modules/fishery/scripts/replay-jma-lifecycle.ts <current-capture> [prior-capture...]");
async function verifiedFile(directory: string, filename: string, receiptName: string, url?: string) {
  const bytes = await readFile(join(directory, filename));
  const receipt = JSON.parse(await readFile(join(directory, receiptName), "utf8"));
  assert.equal(receipt.status, 200); assert.equal(receipt.bytes, bytes.length); assert.equal(receipt.sha256, jmaHash(bytes));
  assert.equal(receipt.finalUrl, receipt.requestedUrl);
  if (url) assert.equal(receipt.requestedUrl, url);
  jmaInstant(receipt.capturedAt, "receipt capturedAt");
  return { bytes, receipt };
}
const feed = await verifiedFile(currentDirectory, "other_l.xml", "other_l.receipt.json", jmaFeeds[2]);
const parsedFeed = parseJmaFeed(new TextDecoder("utf-8", { fatal: true }).decode(feed.bytes));
const observations = [], samples = [];
for (const directory of [...priorDirectories, currentDirectory]) {
  const selection = JSON.parse(await readFile(join(directory, "selection.json"), "utf8"));
  // The original 2026-10-23 archive has a separate explicit local sample selection.
  try { selection.push(...JSON.parse(await readFile(join(directory, "local-selection.json"), "utf8"))); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
  for (const entry of selection) {
    const filename = new URL(entry.url).pathname.split("/").at(-1)!;
    const sample = await verifiedFile(directory, filename, filename + ".receipt.json", entry.url);
    if (directory === currentDirectory) assert.ok(parsedFeed.entries.some(e => e.url === entry.url && e.title === entry.title));
    const observed = inspectJmaSeaWarning(sample.bytes, entry.url);
    observations.push(observed);
    samples.push({ receipt: sample.receipt, id: observed.id, productTitle: observed.metadata?.title,
      infoType: observed.metadata?.infoType, status: observed.metadata?.status,
      notice: observed.warning?.notice ?? null, error: observed.error,
      areaBindings: observed.warning?.areaBindings ?? [],
      originalBytesPreserved: observed.warning ? observed.warning.official.rawBytes.equals(sample.bytes) : true });
  }
}
const now = samples.reduce((latest, s) => Date.parse(s.receipt.capturedAt) > Date.parse(latest) ? s.receipt.capturedAt : latest, feed.receipt.capturedAt);
const snapshot = projectJmaSeaWarnings(observations, {
  now, feed: { url: jmaFeeds[2], rawBytes: feed.bytes, checkedAt: feed.receipt.capturedAt },
  discovered: [], // One captured window; never presented as resumed/complete discovery history.
  // Explicit replay parameters only; neither is an official validity duration or production default.
  maxFeedAgeMs: 2 * 3_600_000, maxReviewAgeMs: 24 * 3_600_000,
});
console.log(JSON.stringify({ mode: "archived_http_receipts_replayed_offline", httpReceiptAssurance: "local_capture_not_origin_signed",
  feedReceipt: feed.receipt, samples, snapshot }, null, 2));
