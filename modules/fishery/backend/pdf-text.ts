// Read local archived bytes only. No network, OCR, password bypass or automatic approval.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256, type PdfText } from "./source-adapters.ts";

type Execute = (file: string, args: string[], options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;
const execute: Execute = promisify(execFile);
const OUTPUT_LIMIT = 4 * 1024 * 1024;
export async function extractPdf(original: Buffer, options: { platform?: NodeJS.Platform; execute?: Execute } = {}): Promise<PdfText> {
  let result: PdfText = { status: "unverified", parser: "unavailable-pdf-parser", rawSha256: sha256(original), text: "", pages: 0 };
  if (original.length > 10 * 1024 * 1024 || !original.subarray(0, 5).equals(Buffer.from("%PDF-")))
    return { ...result, status: "failed", error: "Invalid PDF signature or size limit" };
  const snapshot = Buffer.from(original);
  const platform = options.platform ?? process.platform, run = options.execute ?? execute;
  if (platform !== "darwin" && platform !== "linux") return result;
  const deadline = Date.now() + 60_000;
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TMPDIR: tmpdir() };
  const command = async (program: string, args: string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("PDF document deadline exceeded");
    const output = await run(program, args, { timeout: remaining, maxBuffer: OUTPUT_LIMIT, env });
    if (Buffer.byteLength(output.stdout) > OUTPUT_LIMIT) throw new Error("PDF output byte limit exceeded");
    return output;
  };
  let scratch: string | null = null;
  try {
    scratch = await mkdtemp(path.join(tmpdir(), "fishery-pdf-"));
    const file = path.join(scratch, "original.pdf");
    await writeFile(file, snapshot, { flag: "wx", mode: 0o600 });
    if (platform === "darwin") {
      result.parser = "Apple PDFKit/v1";
      const { stdout } = await command("/usr/bin/swift", ["-module-cache-path", path.join(scratch, "cache"), path.join(import.meta.dirname, "../scripts/pdf-text.swift"), path.resolve(file)]);
      const parsed = JSON.parse(stdout);
      if (!Number.isInteger(parsed.pages) || parsed.pages < 1 || parsed.pages > 200 || typeof parsed.text !== "string" || !parsed.text.trim())
        throw new Error("PDF page count or text is invalid");
      result = { ...result, status: "parsed", pages: parsed.pages, text: parsed.text };
    } else {
      const infoVersion = await command("pdfinfo", ["-v"]), textVersion = await command("pdftotext", ["-v"]);
      const version = (name: string, output: { stdout: string; stderr: string }) => new RegExp(`${name} version ([0-9.]+)`).exec(output.stdout + output.stderr)?.[1];
      const iv = version("pdfinfo", infoVersion), tv = version("pdftotext", textVersion);
      if (!iv || !tv) throw new Error("Cannot identify Poppler versions");
      result.parser = `Poppler ${iv}/${tv}; per-page/v1`;
      const info = await command("pdfinfo", ["-enc", "UTF-8", path.resolve(file)]);
      const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
      if (info.stderr.trim() || !/^Encrypted:\s+no\s*$/m.test(info.stdout) || !Number.isInteger(pages) || pages < 1 || pages > 200)
        throw new Error("Unreadable, encrypted or excessive-page PDF");
      const parts: string[] = []; let bytes = 0, hasText = false;
      for (let page = 1; page <= pages; page++) {
        const extracted = await command("pdftotext", ["-f", String(page), "-l", String(page), "-enc", "UTF-8", "-eol", "unix", "-layout", "-nopgbrk", path.resolve(file), "-"]);
        if (extracted.stderr.trim()) throw new Error("PDF text extraction diagnostics require review");
        hasText ||= !!extracted.stdout.trim();
        const part = `--- Page ${page} ---\n${extracted.stdout}`;
        bytes += Buffer.byteLength(part) + (parts.length ? 2 : 0);
        if (bytes > OUTPUT_LIMIT) throw new Error("PDF output byte limit exceeded");
        parts.push(part);
      }
      if (!hasText) return { ...result, status: "unverified", error: "PDF has no verified text; no automatic OCR" };
      result = { ...result, status: "parsed", pages, text: parts.join("\n\n") };
    }
  } catch (error) {
    result = { ...result, status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "unverified" : "failed", pages: 0, text: "", error: String((error as Error).message).slice(0, 300) };
  } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  return result;
}
