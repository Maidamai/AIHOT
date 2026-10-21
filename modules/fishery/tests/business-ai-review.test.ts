import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { createDocument, observe, registerSource, review } from "../backend/store.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { buildEvidenceCatalog } from "../backend/evidence.ts";
import { observationFixture } from "./fixtures.ts";
import { businessGuideContext, createBusinessGuide, updateBusinessGuide } from "../backend/business-guides.ts";
import type { BusinessGuideContext, BusinessGuidePayload } from "../business-contracts.ts";
import { assessGuideAIResult, buildGuideAIReviewRequest, guideAIClaims, createGuideAIReview, getCurrentGuideAIReview, processGuideAIReview, resumeGuideAIReview, type GuideAIInvoke, type GuideAIResult } from "../backend/business-ai-review.ts";
import { acquireProcessingLease } from "../backend/processing-lease.ts";
import { trialCapacity, TRIAL } from "../backend/trial-transport.ts";
import { chatJson } from "@aihot/backend/providers/llm";

after(closeDb);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Offline suite forbids network/model transport"); };
after(() => { globalThis.fetch = originalFetch; });
let sequence = 0;
const body = "本合成测试通知为正式文件，2026年10月21日发布。\n本合成测试仅适用远洋渔业企业，申请材料包括申请表。\n2026年11月1日截止。\n办理入口：https://example.org/service。\n本合成测试修改2020年第2号规定，并不废止整份规定。";
const unknown = () => ({ state: "unknown" as const, value: null, evidence: [] as [] });
async function fixture(options: { manual?: boolean; pdf?: boolean } = {}) {
  const sourceBody = options.pdf ? `--- Page 1 ---\n${body}\n--- Page 2 ---\n合成附件第二页，限定条件保留。` : body;
  const sourceId = `business-guide-${++sequence}`;
  await sql`INSERT INTO sources(id,name,kind,enabled,next_fetch_at) VALUES(${sourceId},'Synthetic official source','external',false,'2100-01-01')`;
  await registerSource(sourceId, { expectedRevision: 0 }, "synthetic-editor");
  const doc = await createDocument({ sourceId, issuer: "Synthetic source attribution", canonicalUrl: `https://example.org/${sourceId}` }, "synthetic-editor");
  const archiveId = `${sourceId}_${sha256(sourceId).slice(0, 16)}`, directory = options.manual ? path.join(config.dataDir, "fishery-manual-archives", sourceId) : path.join(config.dataDir, "fishery-batches", sourceId, "body"), filename = path.join(directory, options.manual ? "body.txt" : `${archiveId}.txt`);
  await mkdir(directory, { recursive: true }); await writeFile(filename, sourceBody);
  const observation = { ...observationFixture, originalTitle: "合成测试正式通知", title: "合成测试正式通知", rawSha256: sha256(sourceBody), sourceCapture: {
    adapter: options.manual ? "manual_official" : "moa", acquisitionMode: "live_capture", ...(options.manual ? { manualArchiveId: sourceId } : { archiveId }), sourceUrl: `https://example.org/${sourceId}`, capturedAt: "2026-10-21T00:00:00Z",
    httpStatus: 200, rawSha256: sha256(sourceBody), bodySha256: sha256(sourceBody), parser: "synthetic-business/v1", parseStatus: "parsed", attachmentSha256: options.pdf ? sha256("Synthetic PDF bytes") : null,
    attachmentPages: options.pdf ? 2 : null, attachmentUrl: options.pdf ? "https://example.org/synthetic.pdf" : null, conflicts: [],
  } };
  await observe(doc.id, observation, "synthetic-editor");
  await review(doc.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic ordinary source review, not rights permission" }, "synthetic-reviewer");
  return { id: String(doc.id), sourceId, observation, filename };
}
function payload(c: Pick<BusinessGuideContext, "catalog">): BusinessGuidePayload {
  const ids = c.catalog.spans.map(s => s.id), date = () => ({ value: { precision: "unknown" as const, value: null }, evidence: [] });
  return {
    topicId: "funding", kind: "policy_reference", title: { value: "合成通知信息", evidence: [ids[0]!] }, summary: [{ value: "本合成测试仅适用远洋渔业企业，申请材料包括申请表。", evidence: [ids[1]!] }],
    audience: { state: "documented", value: "远洋渔业企业", evidence: [ids[1]!] }, opportunity: unknown(), restrictions: unknown(), materials: unknown(),
    applicability: { countriesOrRegions: unknown(), flagStates: unknown(), species: unknown(), fishingMethods: unknown() },
    documentStatus: { state: "documented", value: "formal", evidence: [ids[0]!] },
    dates: { published: date(), effectiveFrom: date(), deadline: { value: { precision: "day", value: "2026-11-01" }, evidence: [ids[2]!] }, expiresAt: date() },
    serviceEntry: { state: "documented", label: "合成官方信息入口", url: "https://example.org/service", evidence: [ids[3]!] },
    relations: [{ type: "amends", title: "2020年第2号规定", url: null, evidence: [ids[4]!] }],
  };
}

const input = { body, bodySha256: sha256(body), observationRevision: 1 };
function answer(p: BusinessGuidePayload): GuideAIResult {
  return { coverage: "complete_input", findings: guideAIClaims(p).map(c => ({ claimId: c.id, verdict: "supported", evidence: c.evidenceIds, reason: "Synthetic support" })), omissions: ["conditions_exceptions", "materials_completeness", "amounts_dates", "applicability", "attachments_scope"].map(field => ({ field, verdict: "none", evidence: [], reason: "Synthetic no omission" })) } as GuideAIResult;
}
async function guide() {
  const f = await fixture(), c = await businessGuideContext(f.id), p = payload(c);
  const g = await createBusinessGuide({ documentId: f.id, snapshotHash: c.snapshotHash, payload: p, reason: "PRIVATE_REASON_NEVER_MODEL" }, "PRIVATE_ACTOR_NEVER_MODEL");
  return { f, c, p, g };
}
async function request(g: Awaited<ReturnType<typeof guide>>["g"], identity = "first") {
  return createGuideAIReview(g.id, { identity, expectedRevision: g.revision, payloadHash: g.payloadHash, snapshotHash: g.snapshotHash }, "private-actor");
}
async function receipt(task: Record<string, any>, status = "received", response: unknown = { offline: true }) {
  const [r] = await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${task.id},'deepseek','fake',${task.request_intent.purpose},${task.request_intent.subject},${status},${sql.json(response as never)}) RETURNING id`;
  return Number(r!.id);
}
function fake(data: GuideAIResult, receiptId: number, onCall = () => {}) {
  return (async options => { onCall(); return { data: options.schema.parse(data), receiptId, model: "offline-fake", usage: null, reused: true }; }) as GuideAIInvoke;
}

test("claim and omission checks independently block contradiction, missing evidence, ambiguous, unknown coverage and omitted restrictions", () => {
  const p = payload({ catalog: buildEvidenceCatalog(input) }), good = answer(p);
  assert.equal(assessGuideAIResult(input, p, good).pass, true);
  for (const verdict of ["contradicted", "not_found", "ambiguous"] as const) {
    const bad = structuredClone(good); bad.findings[0]!.verdict = verdict;
    assert.equal(assessGuideAIResult(input, p, bad).pass, false);
  }
  const missing = structuredClone(good); missing.omissions[0]!.verdict = "material_omission"; missing.omissions[0]!.evidence = ["p2s1"];
  assert.equal(assessGuideAIResult(input, p, missing).confirmedConflict, true);
  const unknown = structuredClone(good); unknown.coverage = "unknown";
  assert.equal(assessGuideAIResult(input, p, unknown).pass, false);
  const changed = structuredClone(good); changed.findings[0]!.evidence = ["p2s1"];
  assert.throws(() => assessGuideAIResult(input, p, changed), /original claim anchors/);
  changed.findings[0]!.verdict = "contradicted";
  assert.equal(assessGuideAIResult(input, p, changed).confirmedConflict, true);
  changed.findings[0]!.evidence = ["p999s1"];
  assert.throws(() => assessGuideAIResult(input, p, changed), /current evidence/);
  const dup = structuredClone(good); dup.findings[1] = dup.findings[0]!;
  assert.throws(() => assessGuideAIResult(input, p, dup), /exactly once/);
});

test("whole source and guide are isolated from human metadata, oversized wire fails without truncation", () => {
  const p = payload({ catalog: buildEvidenceCatalog(input) }), request = buildGuideAIReviewRequest(input, p).request;
  assert.equal(JSON.parse(String(request.user)).source.body, body);
  assert.equal(String(request.user).includes("PRIVATE_REASON"), false);
  assert.equal(String(request.user).includes("PRIVATE_ACTOR"), false);
  const full = body + "\n" + Array.from({ length: 120 }, (_, i) => `${i}公开全文限定条件${"条件".repeat(100)}。`).join("\n");
  assert.throws(() => buildGuideAIReviewRequest({ body: full, bodySha256: sha256(full), observationRevision: 1 }, p), /wire capacity/);
});

test("create/read/deduplicate are zero-call; fake success awaits human, final approval preserves editorial revision, same-payload edit invalidates", async () => {
  const { g, c, p } = await guide(); const task = await request(g);
  assert.equal((await request(g)).id, task.id);
  assert.equal((await request(g, "different_identity")).id, task.id);
  assert.equal((await getCurrentGuideAIReview(g.id)).status, "queued");
  const r = await receipt(task), data = answer(p); let calls = 0;
  const result = await processGuideAIReview(task.id, fake(data, r, () => calls++));
  assert.equal(calls, 1); assert.equal(result.pass, true); assert.equal(result.status, "needs_final_human");
  await assert.rejects(processGuideAIReview(task.id, fake(data, r, () => calls++)), /not queued/);
  assert.equal(calls, 1);
  await sql`UPDATE fishery_business_guides SET status='approved',revision=revision+1,human_decision=${sql.json({ mode: "final", revision: g.revision + 1, aiEditorialRevision: g.revision })} WHERE id=${g.id}`;
  assert.equal((await getCurrentGuideAIReview(g.id)).pass, true);
  await updateBusinessGuide(g.id, { expectedRevision: g.revision + 1, snapshotHash: c.snapshotHash, payload: p, reason: "Same payload still a new editorial revision" }, "editor");
  assert.equal((await getCurrentGuideAIReview(g.id)).current, false);
});

test("contradiction and omission never qualify; unknown receipt never invokes and failed attempt cannot be recreated", async () => {
  for (const kind of ["contradiction", "omission", "unknown"] as const) {
    const { g, p } = await guide(), task = await request(g); let calls = 0;
    const data = answer(p), r = await receipt(task, kind === "unknown" ? "unknown" : "received");
    if (kind === "contradiction") data.findings[0]!.verdict = "contradicted";
    if (kind === "omission") { data.omissions[0]!.verdict = "material_omission"; data.omissions[0]!.evidence = ["p2s1"]; }
    if (kind === "unknown") {
      await assert.rejects(processGuideAIReview(task.id, fake(data, r, () => calls++)), /unknown receipt/);
      assert.equal(calls, 0); assert.equal((await request(g)).id, task.id);
      await assert.rejects(processGuideAIReview(task.id, fake(data, r, () => calls++)), /not queued/);
    } else {
      const result = await processGuideAIReview(task.id, fake(data, r));
      assert.equal(result.pass, false); assert.equal(result.confirmedConflict, true);
    }
  }
});

test("received cache can recover explicitly under retained lease, source changes invalidate, unknown and failed receipts cannot resume", async () => {
  const { g, p, f } = await guide(), task = await request(g), r = await receipt(task);
  await sql`UPDATE fishery_business_ai_reviews SET status='running' WHERE id=${task.id}`;
  const lease = await acquireProcessingLease();
  try { await lease.run(() => resumeGuideAIReview(task.id, "operator")); } finally { await lease.release(); }
  assert.equal((await processGuideAIReview(task.id, fake(answer(p), r))).pass, true);
  await review(f.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "New material review invalidates old AI" }, "reviewer");
  assert.equal((await getCurrentGuideAIReview(g.id)).current, false);
  for (const state of ["failed", "unknown", "pending"]) {
    const next = await guide(), t = await request(next.g); await receipt(t, state);
    await sql`UPDATE fishery_business_ai_reviews SET status='failed' WHERE id=${t.id}`;
    const lease = await acquireProcessingLease();
    try { await lease.run(() => assert.rejects(resumeGuideAIReview(t.id, "operator"), /received cached response/)); } finally { await lease.release(); }
  }
});

test("same cumulative ledger cap and unresolved charges stop any future request", () => {
  const entries = Array.from({ length: 18 }, () => ({ state: "received", reservedMicroCny: 400000 }));
  assert.doesNotThrow(() => trialCapacity(entries, 1));
  assert.throws(() => trialCapacity([...entries, { state: "unknown", reservedMicroCny: TRIAL.reserveMicroCny }]));
  assert.throws(() => trialCapacity([...entries, ...entries.slice(0, 2)], 1));
});

test("chatJson replays its original cached raw response without a transport request", async () => {
  const { g, p } = await guide(), task = await request(g), result = answer(p);
  const prepared = buildGuideAIReviewRequest(input, p).request;
  prepared.subject = task.request_intent.subject; prepared.attemptTag = task.request_intent.attemptTag;
  const before = config.modelCallsEnabled, envBefore = { ...process.env };
  // Test-only credentials identify a nonexistent local endpoint; fetch above still forbids every send.
  config.modelCallsEnabled = true;
  process.env.LLM_MODEL = "offline-fake"; process.env.LLM_BASE_URL = "http://127.0.0.1:1"; process.env.LLM_API_KEY = "synthetic-test-only";
  try {
    const { logicalKeyFor } = await import("@aihot/backend/providers/receipts");
    const key = logicalKeyFor({ service: "llm", model: "offline-fake", purpose: prepared.purpose, subject: prepared.subject,
      identity: { model: "offline-fake", promptVersion: prepared.promptVersion, system: sha256(prepared.system), user: sha256(String(prepared.user)), temperature: 0, maxTokens: 2048, extra: null },
      requestSummary: {}, attemptTag: prepared.attemptTag });
    const raw = { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${key},'llm','offline-fake',${prepared.purpose},${prepared.subject},'received',${sql.json(raw)})`;
    const cached = await chatJson(prepared);
    assert.equal(cached.reused, true); assert.deepEqual(cached.data, result);
  } finally {
    config.modelCallsEnabled = before;
    for (const key of ["LLM_MODEL", "LLM_BASE_URL", "LLM_API_KEY"]) { if (envBefore[key] === undefined) delete process.env[key]; else process.env[key] = envBefore[key]; }
  }
});
