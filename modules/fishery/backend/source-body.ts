import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { config } from "@aihot/backend/config";
import { readCapturedText } from "./column-batches.ts";

export async function readSourceBody(capture: { manualArchiveId?: string; archiveId?: string; bodySha256: string | null }): Promise<string | null> {
  if (capture.manualArchiveId && capture.archiveId) throw new Error("Ambiguous source archive");
  if (!capture.manualArchiveId && !capture.archiveId) return null;
  if (!capture.bodySha256 || !/^[a-f0-9]{64}$/.test(capture.bodySha256)) throw new Error("Bound body hash required");
  if (capture.archiveId) return readCapturedText(config.dataDir, capture.archiveId, capture.bodySha256);
  const id = capture.manualArchiveId!;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error("Invalid manual archive id");
  const root = path.join(config.dataDir, "fishery-manual-archives"), dir = path.join(root, id), file = path.join(dir, "body.txt");
  if (!(await lstat(root)).isDirectory() || !(await lstat(dir)).isDirectory()) throw new Error("Invalid manual archive directory");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Manual source body missing or oversized");
  const bytes = await readFile(file);
  if (bytes.length > 4 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== capture.bodySha256) throw new Error("Manual source body hash mismatch");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
