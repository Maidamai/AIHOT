// Isolated acceptance only. Archived originals are never relabelled as fresh network acquisition.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { prepareOfficial, Adapter } from "../backend/source-adapters.ts";

const { values } = parseArgs({ options: { archives: { type: "string" }, "live-captures": { type: "string" }, output: { type: "string" }, base: { type: "string" },
  "probe-failures": { type: "string" }, "exercise-test-review": { type: "boolean", default: false } } });
const database = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset");
const base = new URL(values.base ?? "http://127.0.0.1:39872");
if (process.env.AIHOT_ENVIRONMENT !== "test" || process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost", "[::1]", "fishery-db"].includes(database.hostname) || !/_test$/.test(database.pathname) ||
  base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password)
  throw new Error("Pilot requires test environment, a local or isolated fishery-db *_test DB and loopback HTTP API");
if (!!values.archives === !!values["live-captures"] || !values.output || (values.archives && !values["probe-failures"]))
  throw new Error("Use --archives <archive> --probe-failures <JSON>, or --live-captures <capture directory>; also --output <new directory> [--exercise-test-review]");
process.env.AIHOT_CREDENTIALS_DIR = "/nonexistent-test-credentials";
for (const name of ["COLLECT_ENABLED", "MODEL_CALLS_ENABLED", "FEISHU_CONTENT_PUSH_ENABLED", "FEISHU_INTERNAL_ENABLED", "INDEXNOW_SUBMIT_ENABLED"]) process.env[name] = "false";
const { sql, closeDb } = await import("@aihot/backend/db");
const { audit } = await import("@aihot/backend/audit");
const { upsertMaterial } = await import("@aihot/backend/content/materials");
const { setVisibility } = await import("@aihot/backend/admin/content");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { itemAvailability } = await import("@aihot/backend/publication/availability");
const { observationSchema } = await import("../contracts.ts");
const { sha256 } = await import("../backend/source-adapters.ts");
const output = path.resolve(values.output), archives = path.resolve((values.archives ?? values["live-captures"])!);
const live = !!values["live-captures"], captureMode = live ? "live_capture" : "offline_archive_replay";
const input = (source: Adapter, type: "receipt" | "html" | "pdf" | "pdf-receipt") => live
  ? path.join(archives, source, ({ receipt: "page.receipt.json", html: "page.bin", pdf: "attachment.bin", "pdf-receipt": "attachment.receipt.json" })[type])
  : path.join(archives, `${type.startsWith("pdf") ? "iotc-pdf" : source}${type.endsWith("receipt") ? "-request.json" : type === "pdf" ? ".pdf" : ".html"}`);
await mkdir(output, { recursive: false });
const run = promisify(execFile), runId = randomUUID().slice(0, 8), actor = "ISOLATED TEST ONLY; not business approval";
const probeFailures = values["probe-failures"] ? JSON.parse(await readFile(values["probe-failures"], "utf8")) : null;
const checks: Array<{ path: string; method: string; expected: number; actual: number }> = [];
const records: Array<Record<string, unknown>> = [];
const save = () => writeFile(path.join(output, "acceptance.json"), JSON.stringify({ runId, mode: "isolated_test", recordedAt: new Date().toISOString(),
  networkAcquisitionSucceeded: live && records.some(r => r.readyForReview), archiveReplay: !live, captureMode, syntheticReviewExercise: values["exercise-test-review"], checks, records,
  limitations: ["No business human approval or real redistribution license", "No model calls or score/accuracy claims", "No export cache, public evidence URL or delivery queue exists in this module: cache/queue bypass checks are not applicable", "Previously saved offline files cannot be recalled", "Reprinted URLs are not independent corroboration; each replay and its workflow clone share one evidence family"] }, null, 2) + "\n");
async function api(route: string, method = "GET", payload?: unknown, expected = 200, csrf = "dev") {
  const res = await fetch(new URL(`/api/admin/fishery/${route}`, base), { method, headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  checks.push({ path: route, method, expected, actual: res.status });
  await save();
  assert.equal(res.status, expected, `${method} ${route}: ${text.slice(0, 1000)}`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  return { text, json: () => JSON.parse(text) };
}
async function source(id: string, label: string, input: Record<string, unknown>) {
  await sql`INSERT INTO sources (id, name, kind, enabled, participation_mode, site_fulltext, next_fetch_at)
    VALUES (${id}, ${label}, 'external', false, 'editorial', false, '2100-01-01')`;
  await api(`sources/${id}`, "PUT", input);
}
const summaries: Record<Adapter, string> = {
  jinjiang: "离线原件复核素材：晋江报道的船队从厦门远海通达码头出发；发布日期与出航事件日期分开保存，不从出发港反推船队归属。未进行业务审核。",
  iotc: "离线原件复核素材：IOTC Resolution 26/01 仍为 Pending；2026-11-18 是延长的异议截止日，生效日未知；限额条款年份为 2027、2028。未作法律适用性审核。",
  fuzhou: live ? "本次服务器获取失败记录：HTTP 404，没有取得原文正文。没有搜索缓存回填，不能推断官方撤稿。" : "离线获取失败记录：此前原始响应为 HTTP 404，没有取得原文正文；本轮网络探测另因保留地址防护拒绝。没有搜索缓存回填，不能推断官方撤稿。",
};
try {
  for (const adapter of ["jinjiang", "iotc", "fuzhou"] as const) {
    const receipt = JSON.parse(await readFile(input(adapter, "receipt"), "utf8"));
    const html = await readFile(input(adapter, "html"));
    assert.equal(sha256(html), receipt.sha256);
    const replay = path.join(output, adapter);
    const args = [path.join(import.meta.dirname, "prepare-official.ts"), "--source", adapter, "--receipt", input(adapter, "receipt"),
      "--html", input(adapter, "html"), "--output", replay, "--capture-mode", live ? "live_capture" : "archive_replay"];
    let pdf: Buffer | null = null;
    if (adapter === "iotc" && existsSync(input(adapter, "pdf")) && existsSync(input(adapter, "pdf-receipt"))) {
      const pr = JSON.parse(await readFile(input(adapter, "pdf-receipt"), "utf8"));
      pdf = await readFile(input(adapter, "pdf")); assert.equal(sha256(pdf), pr.sha256);
      args.push("--pdf-receipt", input(adapter, "pdf-receipt"), "--pdf", input(adapter, "pdf"));
    }
    await run(process.execPath, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
    const capture = JSON.parse(await readFile(path.join(replay, "capture.json"), "utf8")) as Omit<ReturnType<typeof prepareOfficial>, "body">;
    const body = capture.readyForReview ? await readFile(path.join(replay, "body.txt"), "utf8") : null;
    assert.equal(capture.sourceCapture.capturedAt, receipt.finishedAt);
    assert.equal(body ? sha256(body) : null, capture.sourceCapture.bodySha256);
    const sourceId = `pilot-${runId}-${adapter}`, family = `official:${receipt.requestedUrl}`;
    await source(sourceId, `ISOLATED TEST ${captureMode}: ${adapter}`, { expectedRevision: 0, healthNote: live ? "Fresh server capture; real source rights remain unknown." : "Real source rights remain unknown. Archived response replay; no fresh successful capture." });
    await audit(actor, live ? "fishery.pilot.network_capture" : "fishery.pilot.network_probe", `source:${sourceId}`, null, null,
      live ? { mode: captureMode, ...receipt } : { mode: "current_failed_probe", ...probeFailures.freshApplicationAttempts[adapter] });
    const made = await api("documents", "POST", { sourceId, issuer: adapter === "iotc" ? "IOTC" : adapter === "jinjiang" ? "晋江政府网转载报道" : "福州市海洋与渔业局（未取得原文）",
      canonicalUrl: receipt.requestedUrl, documentNumber: adapter === "iotc" ? "Resolution 26/01" : null }, 201);
    const id = made.json().id as string;
    const observation = observationSchema.parse({ expectedRevision: 0, originalTitle: capture.title ?? "[获取失败记录] 未取得原文正文", title: `[隔离${live ? "实时采集" : "离线回放"}] ${capture.title ?? `HTTP ${receipt.status} 获取失败`}`,
      summaryZh: live ? summaries[adapter].replace(/^离线原件复核素材：/, "实时原件待审素材：") : summaries[adapter], language: adapter === "iotc" ? "en" : "zh", rawSha256: capture.sourceCapture.rawSha256, dates: capture.dates,
      policyStatus: "unknown", ...(capture.policyContext ? { policyContext: capture.policyContext } : {}), sourceCapture: capture.sourceCapture,
      scope: { regions: [], species: [], flags: [], activities: [], unknownFields: ["regions", "species", "flags", "activities"] }, evidence: capture.evidence });
    await api(`documents/${id}/observations`, "POST", observation, 201);
    const pending = (await api(`documents/${id}`)).json();
    assert.equal(pending.observations.length, 1); assert.equal(pending.reviews.length, 0);
    await api(`documents/${id}/export`, "POST", { revision: 1 }, 409);
    await api(`documents/${id}/reviews`, "POST", { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Must be refused without CSRF" }, 403, "wrong");
    let articleId: string | null = null;
    if (body) {
      const material = await upsertMaterial({ sourceId, url: receipt.requestedUrl, title: capture.title!, bodyText: body, bodyStatus: "ok", via: live ? "fishery-isolated-live" : "fishery-isolated-replay",
        publishedAt: capture.sourceCapture.publishedAt ? new Date(capture.sourceCapture.publishedAt) : null,
        publicationTime: capture.sourceCapture.publishedAt ?? capture.dates.published.value, backfill: live ? "isolated-live-pilot" : "isolated-offline-archive-replay",
        raw: { mode: captureMode, evidenceFamily: family, fisheryDocumentId: id, receipt, htmlBase64: html.toString("base64"), pdfBase64: pdf?.toString("base64") ?? null,
          recordedAt: new Date().toISOString(), currentFailedProbe: probeFailures?.freshApplicationAttempts[adapter] ?? null } });
      articleId = material.articleId;
      // Private evidence storage only. This local visibility choice is not an official withdrawal.
      await setVisibility(articleId, { visibility: "withdrawn", version: 0, reason: "ISOLATED TEST private evidence archive; not an official source withdrawal" }, actor);
      const [stored] = await sql`SELECT body_text, raw, published_at, publication_time FROM articles WHERE id = ${articleId}`;
      assert.equal(sha256(stored.body_text), capture.sourceCapture.bodySha256);
      assert.equal(sha256(Buffer.from(stored.raw.htmlBase64, "base64")), receipt.sha256);
      if (pdf) assert.equal(sha256(Buffer.from(stored.raw.pdfBase64, "base64")), capture.sourceCapture.attachmentSha256);
      assert.equal((await itemAvailability([articleId]))[articleId].status, "unavailable");
    } else assert.equal(capture.readyForReview, false);
    const record: Record<string, unknown> = { adapter, sourceId, documentId: id, articleId, evidenceFamily: family, captureMode, capturedAt: receipt.finishedAt,
      readyForReview: capture.readyForReview, state: body ? "awaiting_human_review" : "acquisition_failed_no_body", currentProbe: live ? `http_${receipt.status}` : "blocked_before_HTTP", actualRights: "unknown",
      originalRawSha256: receipt.sha256, bodySha256: capture.sourceCapture.bodySha256, attachmentSha256: capture.sourceCapture.attachmentSha256 };
    records.push(record); await save();
    if (!values["exercise-test-review"]) continue;
    const flowSource = `${sourceId}-flow`;
    const syntheticRights = { expectedRevision: 0, rightsStatus: "permitted", rightsCheckedAt: new Date(Date.now() - 60_000).toISOString(), reviewDueAt: new Date(Date.now() + 86400_000).toISOString(),
      evidenceUrl: "https://example.org/isolated-test-permission", allowedSummary: true, allowedPublication: true,
      attribution: "ISOLATED TEST FIXTURE; not a real redistribution license", healthNote: "Synthetic permission for isolated workflow acceptance only" };
    await source(flowSource, `ISOLATED TEST workflow clone: ${adapter}`, syntheticRights);
    const flowId = (await api("documents", "POST", { sourceId: flowSource, issuer: "ISOLATED TEST workflow clone; no business approval", canonicalUrl: receipt.requestedUrl }, 201)).json().id as string;
    const route = `documents/${flowId}`;
    await api(`${route}/observations`, "POST", observation, 201);
    await api(`${route}/export`, "POST", { revision: 1 }, 409);
    const approve = (revision: number, sourceRevision = 1) => api(`${route}/reviews`, "POST", { revision, sourceRevision, decision: "approved", applicabilityReviewed: false,
      note: "ISOLATED TEST REVIEW ONLY. Synthetic permission; no business human approval or legal applicability decision." }, 201);
    await approve(1);
    if (!body) {
      await api(`${route}/export`, "POST", { revision: 1 }, 409);
      record.workflow = { documentId: flowId, syntheticReview: true, failedCaptureStillBlocked: true }; await save(); continue;
    }
    const first = (await api(`${route}/export`, "POST", { revision: 1 })).json();
    assert.equal(first.editorial.confidence, "isolated_test_workflow_not_business_approval");
    await writeFile(path.join(replay, "TEST-ONLY-export-r1.json"), JSON.stringify(first, null, 2) + "\n");
    const markdown = await api(`${route}/export`, "POST", { revision: 1, format: "markdown" });
    assert.ok(markdown.text.includes("不代表人工业务批准或真实转载授权"));
    await writeFile(path.join(replay, "TEST-ONLY-export-r1.md"), markdown.text);
    const changed = structuredClone(observation); changed.expectedRevision = 1;
    if (pdf) {
      const bytes = Buffer.concat([pdf, Buffer.from("\n% ISOLATED TEST attachment byte replacement; no new network fetch\n")]);
      await writeFile(path.join(replay, "TEST-ONLY-mutated-attachment.pdf"), bytes);
      changed.sourceCapture!.attachmentSha256 = sha256(bytes);
      changed.evidence = changed.evidence.map(e => e.url === capture.sourceCapture.attachmentUrl ? { ...e, sha256: sha256(bytes), section: "Synthetic local byte replacement; not freshly fetched" } : e);
    } else {
      const bytes = Buffer.concat([html, Buffer.from("\n<!-- ISOLATED TEST changed body fixture; no new network fetch -->")]);
      const changedBody = `${body}\nISOLATED TEST BODY REVISION ONLY`;
      await writeFile(path.join(replay, "TEST-ONLY-mutated-page.html"), bytes);
      await writeFile(path.join(replay, "TEST-ONLY-mutated-body.txt"), changedBody);
      changed.rawSha256 = sha256(bytes); changed.sourceCapture!.rawSha256 = sha256(bytes); changed.sourceCapture!.bodySha256 = sha256(changedBody);
      changed.evidence = changed.evidence.map(e => e.url === receipt.finalUrl ? { ...e, sha256: sha256(bytes), section: "Synthetic local body replacement; not freshly fetched" } : e);
    }
    await api(`${route}/observations`, "POST", changed, 201);
    await api(`${route}/export`, "POST", { revision: 1 }, 409);
    await api(`${route}/export`, "POST", { revision: 2 }, 409);
    const history = (await api(route)).json(); assert.equal(history.observations.length, 2);
    assert.equal(history.observations[0].payload.rawSha256, observation.rawSha256);
    await approve(2); await api(`${route}/export`, "POST", { revision: 2 });
    await api(`sources/${flowSource}`, "PUT", { ...syntheticRights, expectedRevision: 1 });
    await api(`${route}/export`, "POST", { revision: 2 }, 409);
    await approve(2, 2); await api(`${route}/export`, "POST", { revision: 2 });
    await api(`${route}/withdraw`, "POST", { expectedRevision: 2, reason: "ISOLATED TEST withdrawal only; no assertion about official source status" });
    await api(`${route}/export`, "POST", { revision: 1 }, 409);
    await api(`${route}/export`, "POST", { revision: 2 }, 409);
    record.workflow = { documentId: flowId, syntheticReview: true, exportFormats: ["json", "markdown"], syntheticByteChangeInvalidatedReview: true,
      sameCanonicalUrl: receipt.requestedUrl, observationsRetained: 2, sourceRevisionChangeInvalidatedReview: true, withdrawalBlockedAllExports: true };
    if (pdf) {
      // Same real bytes and extracted text; only the declared parser version changes in this synthetic clone.
      const parserId = (await api("documents", "POST", { sourceId: flowSource, issuer: "ISOLATED TEST parser-version exercise", canonicalUrl: "https://example.org/isolated-parser-version" }, 201)).json().id as string;
      const parserRoute = `documents/${parserId}`;
      await api(`${parserRoute}/observations`, "POST", observation, 201);
      const parserReview = (revision: number) => api(`${parserRoute}/reviews`, "POST", { revision, sourceRevision: 2, decision: "approved", applicabilityReviewed: false, note: "ISOLATED TEST parser-version gate only; no business approval" }, 201);
      await parserReview(1); await api(`${parserRoute}/export`, "POST", { revision: 1 });
      const parserChanged = structuredClone(observation); parserChanged.expectedRevision = 1;
      parserChanged.sourceCapture!.parser += "; synthetic-version-change";
      await api(`${parserRoute}/observations`, "POST", parserChanged, 201);
      await api(`${parserRoute}/export`, "POST", { revision: 1 }, 409);
      await api(`${parserRoute}/export`, "POST", { revision: 2 }, 409);
      const ph = (await api(parserRoute)).json();
      assert.notEqual(ph.observations[0].content_hash, ph.observations[1].content_hash);
      assert.equal(ph.observations[0].payload.sourceCapture.attachmentSha256, ph.observations[1].payload.sourceCapture.attachmentSha256);
      await parserReview(2); await api(`${parserRoute}/export`, "POST", { revision: 2 });
      await api(`${parserRoute}/withdraw`, "POST", { expectedRevision: 2, reason: "ISOLATED TEST parser exercise completed" });
      await api(`${parserRoute}/export`, "POST", { revision: 2 }, 409);
      record.parserVersionWorkflow = { documentId: parserId, sameBytes: true, oldReviewInvalidated: true, reapprovedLatestOnly: true, withdrawn: true };
    }
    await save();
  }
  console.log(JSON.stringify({ runId, records: records.length, httpChecks: checks.length, output, archiveReplay: !live, captureMode, syntheticReview: values["exercise-test-review"], modelCalls: 0 }));
} finally { await save(); await stopBoss(); await closeDb(); }
