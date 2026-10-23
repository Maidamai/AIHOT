// Explicit one-shot transport only. Persist outside the repository; one writer per directory.
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { jmaFeeds, jmaHash, jmaUrl } from "./jma-marine.ts";

const entrySchema = z.object({ attemptedAt: z.iso.datetime({ offset: true }), state: z.enum(["pending", "complete"]), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), bytes: z.number().int().nonnegative().optional(), etag: z.string().optional(), lastModified: z.string().optional(), checkedAt: z.iso.datetime({ offset: true }).optional() }).refine(e => e.state !== "complete" || (e.sha256 !== undefined && e.bytes !== undefined && e.checkedAt !== undefined), "Incomplete cache receipt");
const schema = z.object({ version: z.literal(1), usage: z.record(z.string(), z.number().nonnegative()), entries: z.record(z.string(), entrySchema) });
type State = z.infer<typeof schema>;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
async function atomic(path: string, bytes: string | Uint8Array) {
  const tmp = `${path}.tmp`;
  const f = await open(tmp, "w", 0o600);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
  await rename(tmp, path);
  const parent = await open(dirname(path), "r");
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function cachedJmaGet(directory: string, inputUrl: string, options: {
  now: string; transport: Transport; dailyBudgetBytes?: number;
}) {
  const url = jmaUrl(inputUrl), at = Date.parse(options.now);
  if (!z.iso.datetime({ offset: true }).safeParse(options.now).success || !Number.isFinite(at)) throw new Error("Invalid acquisition clock");
  const feed = jmaFeeds.includes(url as typeof jmaFeeds[number]);
  const limit = feed ? 8_000_000 : 2_000_000;
  const budget = options.dailyBudgetBytes ?? 100_000_000;
  if (!Number.isSafeInteger(budget) || budget < limit || budget > 9_000_000_000) throw new Error("Invalid budget");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await open(join(directory, "writer.lock"), "wx", 0o600);
  try {
    const statePath = join(directory, "checkpoint.json"), rawPath = join(directory, `${jmaHash(url)}.xml`);
    let state: State;
    try { state = schema.parse(JSON.parse(await readFile(statePath, "utf8"))); }
    catch (e: any) { if (e.code !== "ENOENT") throw e; state = { version: 1, usage: {}, entries: {} }; }
    const save = () => atomic(statePath, JSON.stringify(state));
    const old = state.entries[url];
    if (old?.state === "pending") throw new Error("Uncertain prior request: inspect local archive and receipt; no automatic retry");
    let cached: Buffer | null = null;
    if (old) {
      cached = await readFile(rawPath);
      if (jmaHash(cached) !== old.sha256) throw new Error("Cache integrity failure; no redownload");
      if (!feed || at - Date.parse(old.checkedAt!) < 3_600_000) return { bytes: cached, acquisition: "cache" as const };
    }
    // Charge the full cap before a request. Failed/uncertain requests keep the reservation.
    // JST calendar day is conservative for JMA; all consumers behind the IP still need a shared cap.
    const day = new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
    if ((state.usage[day] ?? 0) + limit > budget) throw new Error("Daily download budget exhausted");
    state.usage[day] = (state.usage[day] ?? 0) + limit;
    state.entries[url] = { attemptedAt: options.now, state: "pending" };
    await save();
    const headers: Record<string, string> = { Accept: "application/xml", "Accept-Encoding": "identity" };
    if (old?.etag) headers["If-None-Match"] = old.etag;
    if (old?.lastModified) headers["If-Modified-Since"] = old.lastModified;
    const response = await options.transport(url, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (response.status === 304 && old && cached) {
      state.entries[url] = { ...old, checkedAt: options.now };
      state.usage[day] -= limit;
      await save();
      return { bytes: cached, acquisition: "not_modified" as const };
    }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error(`JMA HTTP ${response.status}`); }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > limit) {
          // A stream chunk may cross the cap; charge bytes already received before stopping.
          state.usage[day] += size - limit;
          await reader.cancel(); await save();
          throw new Error("JMA response cap exceeded");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    // Save raw before completing the checkpoint. A crash in between stops for review.
    await atomic(rawPath, bytes);
    state.entries[url] = { attemptedAt: options.now, checkedAt: options.now, state: "complete", sha256: jmaHash(bytes), bytes: size,
      etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined };
    state.usage[day] -= limit - size;
    await save();
    return { bytes, acquisition: "download" as const };
  } finally { await lock.close(); await unlink(join(directory, "writer.lock")); }
}
