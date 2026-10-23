// Offline replay of the second JMA capture. Never fetches HTTP, uses a database or invokes AI.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cachedJmaGet } from "../backend/jma-cache.ts";
import { currentJmaMetadata, jmaHash, jmaRecoveryStatus, parseJmaFeed } from "../backend/jma-marine.ts";
import { jmaMarineZoneCatalog } from "../backend/jma-marine-zones.ts";
import { parseJmaSeaWarning, selectJmaSeaWarnings } from "../backend/jma-sea-warning.ts";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error("Usage: node modules/fishery/scripts/replay-jma-sea-warning.ts <marine-capture-directory>");
const feedReceipt = JSON.parse(await readFile(join(directory, "other_l.xml.receipt.json"), "utf8"));
const feedBytes = await readFile(join(directory, "other_l.xml"));
assert.equal(jmaHash(feedBytes), feedReceipt.sha256); assert.equal(feedBytes.length, feedReceipt.bytes); assert.equal(feedReceipt.status, 200);
const feed = parseJmaFeed(new TextDecoder("utf-8", { fatal: true }).decode(feedBytes));
const candidates = selectJmaSeaWarnings(feed);
const selection = [...JSON.parse(await readFile(join(directory, "selection.json"), "utf8")), ...JSON.parse(await readFile(join(directory, "local-selection.json"), "utf8"))];
assert.equal(new Set(selection.map(s => s.url)).size, selection.length);
const samples = [];
for (const selected of selection) {
  assert.equal(candidates.some(e => e.url === selected.url && e.title === selected.title), true);
  const name = new URL(selected.url).pathname.split("/").at(-1)!;
  const bytes = await readFile(join(directory, name));
  const receipt = JSON.parse(await readFile(join(directory, name + ".receipt.json"), "utf8"));
  assert.equal(jmaHash(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes); assert.equal(receipt.status, 200);
  assert.equal(receipt.requestedUrl, selected.url); assert.equal(receipt.finalUrl, selected.url);
  const warning = parseJmaSeaWarning(bytes, selected.url);
  assert.deepEqual(warning.official.rawBytes, bytes);
  const originalValues: Array<{ path: string; value: string; unit: string; type: string | null }> = [];
  const subAreaNames: string[] = []; let subAreaCount = 0;
  const walk = (node: any, path: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
    if (node["@_unit"] && typeof node["#text"] === "string") originalValues.push({ path, value: node["#text"], unit: node["@_unit"], type: node["@_type"] ?? null });
    for (const [k, v] of Object.entries(node)) {
      if (k === "SubArea") subAreaCount += Array.isArray(v) ? v.length : 1;
      if (k === "AreaName" && typeof v === "string") subAreaNames.push(v);
      walk(v, `${path}.${k}`);
    }
  };
  walk(warning.official.body, "Body");
  const cacheDirectory = await mkdtemp(join(tmpdir(), "jma-marine-replay-")); let archiveReads = 0;
  try {
    const transport = async () => { archiveReads++; return new Response(bytes); };
    const first = await cachedJmaGet(cacheDirectory, selected.url, { now: receipt.capturedAt, transport });
    const resumed = await cachedJmaGet(cacheDirectory, selected.url, { now: receipt.capturedAt, transport });
    assert.equal(archiveReads, 1); assert.equal(resumed.acquisition, "cache");
    assert.deepEqual(first.bytes, bytes); assert.deepEqual(resumed.bytes, bytes);
  } finally { await rm(cacheDirectory, { recursive: true, force: true }); }
  const current = currentJmaMetadata([warning.metadata], receipt.capturedAt, 24 * 3_600_000)[0];
  samples.push({ receipt, productCode: warning.productCode, metadata: warning.metadata, effectiveAt: warning.effectiveAt,
    notice: warning.notice, areaBindings: warning.areaBindings, originalValueNodeCount: originalValues.length,
    originalValuesPreview: originalValues.slice(0, 6), subAreaCount, subAreaNames,
    reviewStateAtCapture: current.state, expiresAt: current.expiresAt, expiryBasis: current.expiryBasis,
    offlineCacheReplay: { mode: "archive_transport_not_live_HTTP", archiveReads, invocations: 2, result: "same_bytes_cache_hit" },
    navigationWarningComplete: false, replacesVesselWarningSystem: false });
}
const oldest = feed.entries.map(e => e.updatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
const materialReceipts = await Promise.all(["manual.zip", "codes.zip"].map(async name => {
  const receipt = JSON.parse(await readFile(join(directory, name + ".receipt.json"), "utf8"));
  const bytes = await readFile(join(directory, name)); assert.equal(jmaHash(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes);
  return receipt;
}));
assert.equal(materialReceipts[1].sha256, jmaMarineZoneCatalog.bundleSha256);
assert.equal(jmaHash(await readFile(join(directory, jmaMarineZoneCatalog.workbook))), jmaMarineZoneCatalog.workbookSha256);
console.log(JSON.stringify({ acquisitionMode: "live_capture_then_offline_replay",
  feed: { receipt: feedReceipt, updatedAt: feed.updatedAt, entryCount: feed.entries.length, uniqueUrls: new Set(feed.entries.map(e => e.url)).size,
    selectedWarningEntries: candidates.length, oldestEntryUpdatedAt: oldest, recovery: jmaRecoveryStatus(null, oldest, feedReceipt.capturedAt) },
  materialReceipts, zoneCatalog: { workbook: jmaMarineZoneCatalog.workbook, sha256: jmaMarineZoneCatalog.workbookSha256,
    codeTypeCounts: Object.fromEntries(Object.entries(jmaMarineZoneCatalog.codeTypes).map(([k, v]) => [k, Object.keys(v).length])), geometryResolved: false },
  samples, warningAndAtomBodyBytes: feedBytes.length + samples.reduce((n, s) => n + s.receipt.bytes, 0),
  additionalMaterialBodyBytes: materialReceipts.reduce((n, r) => n + r.bytes, 0),
  liveCorrectionsObserved: samples.filter(s => s.metadata.infoType === "訂正").length,
  liveCancellationsObserved: samples.filter(s => s.metadata.infoType === "取消").length,
  liveReleaseNoticesObserved: samples.filter(s => s.notice === "official_release_notice").length,
  navigationWarningComplete: false, replacesVesselWarningSystem: false,
}, null, 2));
