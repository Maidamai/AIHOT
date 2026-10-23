// Replays the five captured public samples; never performs HTTP, DB or model calls.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { currentJmaMetadata, jmaFeeds, jmaHash, jmaRecoveryStatus, jmaUrl, parseJmaBulletin, parseJmaFeed } from "../backend/jma-marine.ts";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error("Usage: node modules/fishery/scripts/replay-jma.ts <capture-directory>");
const feeds = [];
for (const name of ["regular", "extra"]) {
  const path = join(directory, `${name}_l.xml`), bytes = await readFile(path);
  const headers = await readFile(join(directory, `${name}.headers`), "utf8");
  const header = (key: string) => headers.match(new RegExp(`^${key}: (.+)$`, "im"))?.[1].trim() ?? null;
  assert.match(headers, /HTTP\/2 200/);
  const f = parseJmaFeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  feeds.push({ url: jmaFeeds[name === "regular" ? 0 : 1], status: 200, bytes: bytes.length, sha256: jmaHash(bytes),
    archiveMtime: (await stat(path)).mtime.toISOString(), serverDate: header("date"), etag: header("etag"), lastModified: header("last-modified"), cacheControl: header("cache-control"),
    updatedAt: f.updatedAt, entries: f.entries.length, uniqueUrls: new Set(f.entries.map(e => e.url)).size,
    oldestEntryUpdatedAt: f.entries.map(e => e.updatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
    newestEntryUpdatedAt: f.entries.map(e => e.updatedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
    maritimeTitleEntries: f.entries.filter(e => /海上/.test(e.title)).length,
    recovery: jmaRecoveryStatus(null, f.entries.map(e => e.updatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0], f.updatedAt),
  });
}
const receipts = [...JSON.parse(await readFile(join(directory, "sample-receipts.json"), "utf8")), JSON.parse(await readFile(join(directory, "wave-receipt.json"), "utf8"))];
const samples = [];
for (const receipt of receipts) {
  jmaUrl(receipt.url);
  const bytes = await readFile(join(directory, new URL(receipt.url).pathname.split("/").at(-1)!));
  assert.equal(jmaHash(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes); assert.equal(receipt.status, 200);
  const report = parseJmaBulletin(bytes, receipt.url);
  const review = currentJmaMetadata([report], receipt.capturedAt, 6 * 3_600_000)[0];
  const { areas, ...metadata } = report;
  samples.push({ receipt, metadata, areaCount: areas.length, areaPreview: areas.slice(0, 4),
    codeTypes: [...new Set(areas.map(a => a.codeType))], reviewStateAtCapture: review.state, reviewExpiresAt: review.expiresAt, expiryBasis: review.expiryBasis });
}
console.log(JSON.stringify({ acquisitionMode: "live_capture_then_offline_replay", feeds, samples,
  totalResponseBodyBytes: feeds.reduce((n, f) => n + f.bytes, 0) + samples.reduce((n, s) => n + s.receipt.bytes, 0),
  liveCorrectionsObserved: samples.filter(s => s.metadata.infoType === "訂正").length,
  liveCancellationsObserved: samples.filter(s => s.metadata.infoType === "取消").length,
  geometryAndMarineZoneMapping: "not_implemented", navigationWarningComplete: false,
}, null, 2));
