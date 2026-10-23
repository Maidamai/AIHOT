import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, writeFile, readFile, readdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { preparePdfBlankReview, recordPdfBlankReview, loadVerifiedPdfBlankReview } from "../backend/pdf-blank-review.ts";
import { verifyManualSource } from "../backend/manual-sources.ts";
import { pdfBlankProofSchema } from "../backend/pdf-blank-proof.ts";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { sql, closeDb } from "@aihot/backend/db";
import { createDocument, observe, registerSource, review } from "../backend/store.ts";
import { sha256 } from "../backend/source-adapters.ts";
import { buildEvidenceCatalog } from "../backend/evidence.ts";
import { prepareNotice } from "../backend/fujian-notices.ts";
import { noticeFixture } from "./fixtures.ts";
import { observationFixture } from "./fixtures.ts";
import { businessGuideContext, createBusinessGuide, updateBusinessGuide, businessGuideAdminDetail, businessGuideReaderItem, decideBusinessGuide } from "../backend/business-guides.ts";
import type { BusinessGuideContext, BusinessGuidePayload } from "../business-contracts.ts";
import { assessGuideAIResult, buildGuideAIReviewRequest, guideAIClaims, createGuideAIReview, getCurrentGuideAIReview, processGuideAIReview, resumeGuideAIReview, resumeUnsentGuideAIReview, preflightGuideAIReview, guideAIResultToWire, guideAIOutputEnvelopeBytes, type GuideAIInvoke, type GuideAIResult } from "../backend/business-ai-review.ts";
import { acquireProcessingLease } from "../backend/processing-lease.ts";
import { trialCapacity, TRIAL } from "../backend/trial-transport.ts";
import { authorizationKey } from "../backend/authorization.ts";
import { chatJson } from "@aihot/backend/providers/llm";

after(async()=>{await stopBoss();await closeDb();});
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
  return { coverage: "complete_input", findings: guideAIClaims(p).map(c => ({ claimId: c.id, verdict: "supported", evidence: c.evidenceIds, reason: "Synthetic support" })), omissions: ["title_summary_scope", "audience", "conditions_exceptions", "materials_completeness", "amounts_dates", "applicability", "attachments_scope"].map(field => ({ field, verdict: "none", evidence: [], reason: "Synthetic no omission" })) } as GuideAIResult;
}
async function guide() {
  const f = await fixture(), c = await businessGuideContext(f.id), p = payload(c);
  const g = await createBusinessGuide({ documentId: f.id, snapshotHash: c.snapshotHash, payload: p, reason: "PRIVATE_REASON_NEVER_MODEL" }, "PRIVATE_ACTOR_NEVER_MODEL");
  return { f, c, p, g };
}
async function request(g: Awaited<ReturnType<typeof guide>>["g"], identity = "first") {
  return createGuideAIReview(g.id, { identity, expectedRevision: g.revision, payloadHash: g.payloadHash, snapshotHash: g.snapshotHash }, "private-actor");
}
async function receipt(task: Record<string, any>, status = "received", response: unknown = { choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) {
  const [r] = await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${task.id},'deepseek','fake',${task.request_intent.purpose},${task.request_intent.subject},${status},${sql.json(response as never)}) RETURNING id`;
  return Number(r!.id);
}
function fake(data: GuideAIResult, receiptId: number, onCall = () => {}) {
  return (async options => { onCall(); return { data: options.schema.parse(guideAIResultToWire(data, JSON.parse(String(options.user)).source.evidenceCatalog.spans.map((s: [number, string]) => s[1]), JSON.parse(String(options.user)).claims)), receiptId, model: "offline-fake", usage: null, reused: true }; }) as GuideAIInvoke;
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
  const source = JSON.parse(String(request.user)), catalog = buildEvidenceCatalog(input);
  const expectedIds = new Set(guideAIClaims(p).flatMap(c => c.evidenceIds));
  assert.equal(source.candidateAnchors.length, expectedIds.size);
  for (const anchor of source.candidateAnchors) {
    const span = catalog.spans[anchor.alias]!;
    assert.equal(anchor.id, span.id); assert.equal(anchor.quote, span.quote); assert.equal(anchor.quote, body.slice(span.start, span.end));
  }
  assert.equal(source.source.evidenceCatalog.spans.length, catalog.spans.length);
  const full = body + "\n" + Array.from({ length: 180 }, (_, i) => `${i}公开全文限定条件${"条件".repeat(100)}。`).join("\n");
  assert.throws(() => buildGuideAIReviewRequest({ body: full, bodySha256: sha256(full), observationRevision: 1 }, p), /wire capacity/);
});

test("scripted counterexample judgments block expanded subjects, omitted exceptions and day/month mismatch; these are output-gate tests, not model semantic proof", () => {
  for (const [sourceText, candidateText, outcome] of [
    ["仅适用远洋渔业企业。", "适用所有企业。", "contradicted"],
    ["应申报，但紧急救援除外。", "全部情况均应申报。", "contradicted"],
    ["应当提前六十日提出申请。", "应当提前六十个月提出申请。", "contradicted"],
  ] as const) {
    const full = body + "\n" + sourceText, source = { body: full, bodySha256: sha256(full), observationRevision: 1 }, catalog = buildEvidenceCatalog(source), p = payload({ catalog });
    p.summary = [{ value: candidateText, evidence: [catalog.spans.at(-1)!.id] }];
    const result = answer(p); result.findings.find(f => f.claimId === "summary.0")!.verdict = outcome;
    assert.equal(assessGuideAIResult(source, p, result).pass, false);
  }
});

test("compact wire retains seven checks, rejects all detail, partial coverage and unsupported omission anchors", () => {
  const p = payload({ catalog: buildEvidenceCatalog(input) }), prepared = buildGuideAIReviewRequest(input, p);
  const wire = guideAIResultToWire(answer(p), prepared.catalog.spans.map(s => s.id), guideAIClaims(p));
  assert.equal(wire.o.length, 7); assert.equal(prepared.request.schema.parse(wire).findings.length, guideAIClaims(p).length);
  const bad = structuredClone(wire); bad.f[0]![2] = [999];
  assert.throws(() => prepared.request.schema.parse(bad));
  const duplicate = structuredClone(wire); duplicate.o[1]![0] = duplicate.o[0]![0];
  assert.throws(() => prepared.request.schema.parse(duplicate), /exactly once/);
  const long = structuredClone(wire); long.f[0]![1] = 3; long.f[0]![3] = "字".repeat(11);
  assert.throws(() => prepared.request.schema.parse(long));
  for (const code of [0, 1, 2, 3]) {
    const detail = structuredClone(wire); detail.f[0]![1] = code; detail.f[0]![3] = "x";
    assert.throws(() => prepared.request.schema.parse(detail));
  }
  const partial = structuredClone(wire); partial.c = 1;
  assert.equal(assessGuideAIResult(input, p, prepared.request.schema.parse(partial)).pass, false);
  const emptyOmission = structuredClone(wire); emptyOmission.o[6]![1] = 4;
  assert.throws(() => prepared.request.schema.parse(emptyOmission), /requires source evidence/);
  assert.ok(guideAIOutputEnvelopeBytes(7, 5) <= 1900);
  assert.ok(guideAIOutputEnvelopeBytes(60, 999) > 1900);
  const aliases = Array.from({length: 12}, (_, i) => i + 100), detail = "";
  const envelope = { c: 2, f: Array.from({length: 7}, (_, i) => [i, 0, aliases, detail]), o: Array.from({length: 7}, (_, i) => [i, 4, aliases.slice(0, 4), detail]) };
  assert.equal(guideAIOutputEnvelopeBytes(7, 112), Buffer.byteLength(JSON.stringify(envelope)));
});

test("create/read/deduplicate are zero-call; fake success awaits human, final approval preserves editorial revision, same-payload edit invalidates", async () => {
  const { g, c, p } = await guide(); const task = await request(g);
  const metrics = await preflightGuideAIReview(g.id);
  assert.equal(metrics.requiredCalls, 1); assert.equal(metrics.omissionCount, 7); assert.ok(metrics.outputEnvelopeBytes < 1900); assert.equal("actor" in metrics, false);
  assert.equal((await request(g)).id, task.id);
  assert.equal((await request(g, "different_identity")).id, task.id);
  assert.equal((await getCurrentGuideAIReview(g.id)).status, "queued");
  const r = await receipt(task), data = answer(p); let calls = 0;
  const result = await processGuideAIReview(task.id, fake(data, r, () => calls++));
  assert.equal(calls, 1); assert.equal(result.pass, true); assert.equal(result.status, "needs_final_human");
  assert.equal((await preflightGuideAIReview(g.id)).requiredCalls, 0);
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

test("old rules failed cache remains preserved and cannot resume or become current under the new prompt/schema", async () => {
  const { g } = await guide(), task = await request(g), raw = { choices: [{ finish_reason: "stop", message: { content: '{"c":1,"o":[[6,4,[],""]]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, r = await receipt(task, "received", raw);
  await sql`UPDATE fishery_business_ai_reviews SET status='failed',receipt_id=${r},binding=binding || ${sql.json({ rulesVersion: "fishery-business-ai/2", schemaVersion: "fishery-business-review-compact-wire/2" })},binding_hash=${"0".repeat(64)} WHERE id=${task.id}`;
  const lease = await acquireProcessingLease();
  try { await lease.run(() => assert.rejects(resumeGuideAIReview(task.id, "operator"), /binding changed/)); } finally { await lease.release(); }
  assert.equal((await getCurrentGuideAIReview(g.id)).current, false);
  const [preserved] = await sql`SELECT t.status,r.response FROM fishery_business_ai_reviews t JOIN receipts r ON r.id=t.receipt_id WHERE t.id=${task.id}`;
  assert.equal(preserved!.status, "failed"); assert.deepEqual(preserved!.response, raw);
});

test("same cumulative ledger cap and unresolved charges stop any future request", () => {
  const entries = Array.from({ length: 18 }, () => ({ state: "received", reservedMicroCny: 400000 }));
  assert.doesNotThrow(() => trialCapacity(entries, 1));
  assert.throws(() => trialCapacity([...entries, { state: "unknown", reservedMicroCny: TRIAL.reserveMicroCny }]));
  assert.throws(() => trialCapacity(Array.from({ length: 25 }, () => ({ state: "received", reservedMicroCny: TRIAL.reserveMicroCny })), 1));
});

test("complete JSON with length finish reason or missing usage fails closed without second invocation", async () => {
  for (const response of [{ choices: [{ finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, { choices: [{ finish_reason: "stop" }] }]) {
    const { g, p } = await guide(), task = await request(g), r = await receipt(task, "received", response); let calls = 0;
    await assert.rejects(processGuideAIReview(task.id, fake(answer(p), r, () => calls++)), /stop|usage/);
    await assert.rejects(processGuideAIReview(task.id, fake(answer(p), r, () => calls++)), /not queued/);
    assert.equal(calls, 1); assert.equal((await getCurrentGuideAIReview(g.id)).pass, false);
  }
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
    const raw = { choices: [{ message: { content: JSON.stringify(guideAIResultToWire(result, buildEvidenceCatalog(input).spans.map(s => s.id), guideAIClaims(p))) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status,response) VALUES(${key},'llm','offline-fake',${prepared.purpose},${prepared.subject},'received',${sql.json(raw)})`;
    const cached = await chatJson(prepared);
    assert.equal(cached.reused, true); assert.equal(cached.data.coverage, result.coverage); assert.equal(assessGuideAIResult(input, p, cached.data).pass, true);
  } finally {
    config.modelCallsEnabled = before;
    for (const key of ["LLM_MODEL", "LLM_BASE_URL", "LLM_API_KEY"]) { if (envBefore[key] === undefined) delete process.env[key]; else process.env[key] = envBefore[key]; }
  }
});

async function unsentFixture() {
  const f = await guide(), task = await request(f.g);
  await sql`UPDATE fishery_business_ai_reviews SET status='failed',error=${sql.json({reason:"Budget for llm exhausted (day)",noAutomaticRetry:true})} WHERE id=${task.id}`;
  return {...f,task};
}
async function seedUnsentLedger(state = "received", full = false) {
  assert.match(new URL(config.databaseUrl).pathname,/_(test|ci)$/);
  const entries = Array.from({length:full?25:1},(_,i)=>({id:i+1,state,reservedMicroCny:TRIAL.reserveMicroCny}));
  await sql`INSERT INTO settings(key,value) VALUES(${authorizationKey},${sql.json({id:TRIAL.id,maxRequests:null,policy:"amount-only/v1",maxReservedMicroCny:TRIAL.maxReservedMicroCny,entries})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
}
test("unsent recovery requires lease, exact day refusal, unchanged binding/intent and no receipt of any state",async()=>{
  await seedUnsentLedger(); const first=await unsentFixture();
  await assert.rejects(resumeUnsentGuideAIReview(first.task.id,"operator","Stopped old executor"),/lease/);
  const lease=await acquireProcessingLease();
  try { await lease.run(async()=>{
    await assert.rejects(resumeGuideAIReview(first.task.id,"operator"),/received cached response/);
    for(const status of ["pending","unknown","failed","received","completed"]) {
      const f=await unsentFixture(); await receipt(f.task,status);
      await assert.rejects(resumeUnsentGuideAIReview(f.task.id,"operator","Stopped old executor"),/existing receipt/);
    }
    for(const error of ["Budget for llm exhausted (hour)","Budget for llm exhausted (minute)","Provider unavailable","Budget for llm exhausted (day) extra"]) {
      const f=await unsentFixture();await sql`UPDATE fishery_business_ai_reviews SET error=${sql.json({reason:error,noAutomaticRetry:true})} WHERE id=${f.task.id}`;
      await assert.rejects(resumeUnsentGuideAIReview(f.task.id,"operator","Stopped old executor"),/day-budget/);
    }
    for(const change of ["state","binding","intent"]) {
      const f=await unsentFixture();
      if(change==="state") await sql`UPDATE fishery_business_ai_reviews SET status='running' WHERE id=${f.task.id}`;
      if(change==="binding") await sql`UPDATE fishery_business_ai_reviews SET binding_hash=${"0".repeat(64)} WHERE id=${f.task.id}`;
      if(change==="intent") await sql`UPDATE fishery_business_ai_reviews SET request_intent=request_intent||${sql.json({fingerprint:"changed"})} WHERE id=${f.task.id}`;
      await assert.rejects(resumeUnsentGuideAIReview(f.task.id,"operator","Stopped old executor"),/unsent|changed/);
    }
    await seedUnsentLedger("unknown");await assert.rejects(resumeUnsentGuideAIReview(first.task.id,"operator","Stopped old executor"),/unknown/);
    await seedUnsentLedger("received",true);await assert.rejects(resumeUnsentGuideAIReview(first.task.id,"operator","Stopped old executor"),/limit/);
    await seedUnsentLedger();
    const [before]=await sql`SELECT value FROM settings WHERE key=${authorizationKey}`;
    const recovered=await resumeUnsentGuideAIReview(first.task.id,"operator","Old executor stopped, receipt absence reconciled");
    assert.equal(recovered.id,first.task.id);assert.equal(recovered.reservationDelta,0);assert.equal(recovered.requiresExplicitExecute,true);
    const [after]=await sql`SELECT t.*,s.value AS ledger FROM fishery_business_ai_reviews t CROSS JOIN settings s WHERE t.id=${first.task.id} AND s.key=${authorizationKey}`;
    assert.equal(after!.status,"queued");assert.deepEqual(after!.request_intent,first.task.request_intent);assert.equal(after!.identity,first.task.identity);assert.deepEqual(after!.ledger,before!.value);
    const [audit]=await sql`SELECT before,after,reason FROM audit_log WHERE action='fishery.business.ai.resume_unsent' AND after->>'id'=${first.task.id}`;
    assert.equal(audit!.before.error.reason,"Budget for llm exhausted (day)");assert.equal(audit!.after.reservationDelta,0);assert.match(audit!.reason,/executor stopped/);
    await assert.rejects(resumeUnsentGuideAIReview(first.task.id,"operator","Again"),/failed unsent/);
  }); }finally{await lease.release();}
});

test("notice guide comparison and reader bind full webpage and two separate PDF Page1 sources",async()=>{
 const f=await fixture(),n=noticeFixture(),secondUrl=new URL('P0202507289999002.pdf',n.url).href;
 const raw=Buffer.from(n.landing().replace(n.title+'</div>',body+'</div>').replace('</ul>',`<li><a href="${secondUrl}">第二附件.pdf</a></li></ul>`)),r={requestedUrl:n.url,finalUrl:n.url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'};
 const files=[n.pdf,Buffer.from('%PDF-second-notice-guide')].map((bytes,i)=>({bytes,receipt:{...r,requestedUrl:i?secondUrl:n.pdfUrl,finalUrl:i?secondUrl:n.pdfUrl,sha256:sha256(bytes)},parsed:{status:'parsed' as const,rawSha256:sha256(bytes),parser:'synthetic/v1',pages:1,text:`--- Page 1 ---\n${i?'第二附件原文保留完整限定。':'第一附件原文完整保留。'}`}}));
 const prepared=prepareNotice(r,raw,files);assert.ok(prepared.body);await writeFile(f.filename,prepared.body);
 await observe(f.id,{...f.observation,expectedRevision:1,rawSha256:sha256(raw),sourceCapture:{...prepared.sourceCapture,archiveId:(f.observation.sourceCapture as {archiveId:string}).archiveId}},'synthetic-editor');
 await review(f.id,{revision:2,sourceRevision:1,decision:'approved',applicabilityReviewed:false,note:'Synthetic complete notice review'},'synthetic-reviewer');
 const c=await businessGuideContext(f.id);assert.equal(c.catalog.version,'fishery-spans-v3-sections');assert.equal(c.catalog.sections!.length,3);
 const p=payload(c),second=c.catalog.spans.find(s=>s.source?.id==='attachment-2')!;p.summary.push({value:second.quote,evidence:[second.id]});
 const g=await createBusinessGuide({documentId:f.id,snapshotHash:c.snapshotHash,payload:p,reason:'Synthetic notice guide'},'synthetic-editor');
 const task=await createGuideAIReview(g.id,{identity:'notice-guide',expectedRevision:g.revision,payloadHash:g.payloadHash,snapshotHash:g.snapshotHash},'synthetic-editor'),rid=await receipt(task);
 await processGuideAIReview(task.id,(async options=>{
  const source=JSON.parse(String(options.user)).source;assert.equal(source.body,prepared.body);assert.equal(source.sourceSections.length,3);
  assert.deepEqual(source.pageSources.map((v:{page:number;source:{id:string;url:string}})=>[v.source.id,v.page,v.source.url]),[['attachment-1',1,n.pdfUrl],['attachment-2',1,secondUrl]]);
  assert.equal(source.spanSources.find((v:{id:string})=>v.id===second.id).source.url,secondUrl);
  return fake(answer(p),rid)(options);
 }) as GuideAIInvoke);
 const checked=await businessGuideAdminDetail(g.id);assert.equal(checked.aiReview.pass,true);
 await decideBusinessGuide(g.id,{expectedRevision:checked.revision,payloadHash:checked.payloadHash,snapshotHash:checked.snapshotHash,decision:'approved',aiReviewHash:checked.aiReview.reviewHash!,reason:'Synthetic final notice approval'},'synthetic-reviewer');
 const item=await businessGuideReaderItem(g.id);assert.equal(item.evidence[second.id]!.url,secondUrl);assert.equal(item.evidence[second.id]!.sha256,sha256(files[1]!.bytes));assert.equal(item.evidence[second.id]!.sourceId,'attachment-2');assert.equal(item.evidence[second.id]!.page,1);
});

test("historical parsed PDF empty page blocks guide creation, AI preflight and a previously qualified reader",async()=>{
 const v=await guide(),task=await request(v.g,'legacy-empty-page'),rid=await receipt(task);
 await processGuideAIReview(task.id,fake(answer(v.p),rid));
 const checked=await businessGuideAdminDetail(v.g.id);assert.equal(checked.aiReview.pass,true);
 await decideBusinessGuide(v.g.id,{expectedRevision:checked.revision,payloadHash:checked.payloadHash,snapshotHash:checked.snapshotHash,decision:'approved',aiReviewHash:checked.aiReview.reviewHash!,reason:'Synthetic old qualified source'},'synthetic-reviewer');
 assert.ok(await businessGuideReaderItem(v.g.id));
 const source=`--- Page 1 ---\n${body}\n--- Page 2 ---\n`,capture={...v.f.observation.sourceCapture,bodySha256:sha256(source),attachmentPages:2,attachmentUrl:'https://example.org/legacy.pdf',attachmentSha256:sha256('legacy PDF')};
 await writeFile(v.f.filename,source);
 await observe(v.f.id,{...v.f.observation,expectedRevision:1,sourceCapture:capture},'synthetic-editor');
 await review(v.f.id,{revision:2,sourceRevision:1,decision:'approved',applicabilityReviewed:false,note:'Historical parsed metadata without textless-page flags'},'synthetic-reviewer');
 await assert.rejects(businessGuideContext(v.f.id),/page intervals/);
 await assert.rejects(createBusinessGuide({documentId:v.f.id,snapshotHash:v.c.snapshotHash,payload:v.p,reason:'Reject legacy empty-page guide'},'synthetic-editor'),/page intervals/);
 await assert.rejects(preflightGuideAIReview(v.g.id),/page intervals/);
 await assert.rejects(businessGuideReaderItem(v.g.id),/No current approved business information/);
});

const blankPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function blankRenderer(raw:Buffer,variant=0){
 let renders=0;
 const options={platform:'linux' as const,execute:async(program:string,args:string[])=>{
  if(args[0]==='-v')return {stdout:'',stderr:`${path.basename(program)} version 24.10.0`};
  if(program==='/usr/bin/pdfinfo'){assert.deepEqual(await readFile(args.at(-1)!),raw);return {stdout:args.includes('-box')?`Page ${args[1]} MediaBox: 0.00 0.00 595.28 841.89\n`:'Pages: 34\nEncrypted: no\n',stderr:''};}
  assert.equal(program,'/usr/bin/pdftoppm');assert.deepEqual(args.slice(0,8),['-f',args[1],'-l',args[1],'-r','144','-png','-singlefile']);assert.deepEqual(await readFile(args.at(-2)!),raw);
  const png=Buffer.from(blankPng);if(variant)png[png.length-1]=variant;await writeFile(args.at(-1)!+'.png',png);renders++;return {stdout:'',stderr:''};
 }};return {options,renders:()=>renders};
}
const blankRequest=(receipt:Awaited<ReturnType<typeof preparePdfBlankReview>>)=>({reviewId:receipt.reviewId,expectedRawSha256:receipt.rawSha256,expectedPageHashes:receipt.pageImages,confirmation:'confirmed_blank' as const,reason:'Authorized agent viewed both complete native-rendered page images; no automatic blank classification',executorKind:'authorized_agent' as const});
test('blank-review proof admits only bounded ordered partial physical-page coverage',()=>{
 const good={version:'pdf-blank-review/1',reviewId:'55555555-5555-4555-8555-555555555555',rawSha256:'a'.repeat(64),physicalPages:34,pageImages:[{page:2,sha256:'b'.repeat(64)},{page:4,sha256:'c'.repeat(64)}],proofHash:'d'.repeat(64)};
 assert.ok(pdfBlankProofSchema.safeParse(good).success);
 for(const pageImages of [[],[good.pageImages[1],good.pageImages[0]],[good.pageImages[0],good.pageImages[0]],[{page:35,sha256:'b'.repeat(64)}],Array.from({length:34},(_,i)=>({page:i+1,sha256:'b'.repeat(64)}))])assert.equal(pdfBlankProofSchema.safeParse({...good,pageImages}).success,false);
 assert.equal(pdfBlankProofSchema.safeParse({...good,blankPages:[2,4]}).success,false,'Manifest-style self declarations are not proof');
});
test('blank review rerenders the exact original, records an explicit agent audit and loads immutable PNG proof',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'blank-review-')),raw=Buffer.from('%PDF-synthetic-native-render-review'),native=blankRenderer(raw);
 try{
  const prepared=await preparePdfBlankReview(dir,raw,[2,4],native.options),subject=`pdf-blank-review:${prepared.reviewId}`;
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${subject}`).length,0,'Preparing images cannot authorize blank pages');
  const reviewDir=path.join(dir,'fishery-pdf-blank-reviews',prepared.reviewId);assert.equal((await readdir(reviewDir)).filter(f=>f.endsWith('.png')).length,1,'Identical native images share content-addressed bytes');
  const proof=await recordPdfBlankReview(dir,raw,blankRequest(prepared),'authorized-review-agent',native.options);assert.equal(native.renders(),4,'Registration independently rerenders both reviewed physical pages');
  assert.deepEqual(await loadVerifiedPdfBlankReview(dir,raw,prepared.reviewId),proof);assert.equal(proof.physicalPages,34);assert.deepEqual(proof.pageImages.map(p=>p.page),[2,4]);
  const [entry]=await sql`SELECT actor,action,after FROM audit_log WHERE subject=${subject}`;assert.equal(entry!.action,'fishery.pdf_blank_review');assert.equal(entry!.after.actor,'authorized-review-agent');assert.equal(entry!.after.confirmation,'confirmed_blank');assert.equal(entry!.after.executorKind,'authorized_agent');assert.match(entry!.after.renderer.options,/mediaBox; 144 dpi/);assert.equal(entry!.after.rawSha256,sha256(raw));
  await assert.rejects(recordPdfBlankReview(dir,raw,blankRequest(prepared),'authorized-review-agent',native.options),/already registered/);
  await assert.rejects(loadVerifiedPdfBlankReview(dir,Buffer.from('%PDF-replaced-original'),prepared.reviewId),/original PDF hash changed/);
  const altered={...entry!.after,reason:'changed audit reason'};await sql`UPDATE audit_log SET after=${sql.json(altered)} WHERE subject=${subject}`;
  await assert.rejects(loadVerifiedPdfBlankReview(dir,raw,prepared.reviewId),/audit.*changed/);await sql`UPDATE audit_log SET after=${sql.json(entry!.after)} WHERE subject=${subject}`;
  const png=path.join(reviewDir,proof.pageImages[0]!.sha256+'.png');await writeFile(png,Buffer.from(blankPng).fill(0,blankPng.length-1));await assert.rejects(loadVerifiedPdfBlankReview(dir,raw,prepared.reviewId),/PNG hash changed/);
  await rm(png);const other=path.join(dir,'copied.png');await writeFile(other,blankPng);await symlink(other,png);await assert.rejects(loadVerifiedPdfBlankReview(dir,raw,prepared.reviewId),/ELOOP|symbolic link/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('blank registration rejects caller-authored provenance, missing visual confirmation and full-document blanks with zero audit',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'blank-review-refusal-')),raw=Buffer.from('%PDF-synthetic-provenance-refusal'),native=blankRenderer(raw);
 try{
  await assert.rejects(preparePdfBlankReview(dir,raw,Array.from({length:34},(_,i)=>i+1),native.options),/partial physical coverage/);
  await assert.rejects(preparePdfBlankReview(dir,raw,[4,2],native.options),/strictly increasing/);
  const prepared=await preparePdfBlankReview(dir,raw,[2,4],native.options),request=blankRequest(prepared),subject=`pdf-blank-review:${prepared.reviewId}`;
  await assert.rejects(recordPdfBlankReview(dir,raw,{...request,confirmation:'unreviewed'},'agent',native.options));
  await assert.rejects(recordPdfBlankReview(dir,Buffer.from('%PDF-other'),request,'agent',native.options),/original PDF hash mismatch/);
  await assert.rejects(loadVerifiedPdfBlankReview(dir,raw,prepared.reviewId),/audited/);
  await assert.rejects(recordPdfBlankReview(dir,raw,request,'agent',blankRenderer(raw,1).options),/rerender differs/);
  const receiptFile=path.join(dir,'fishery-pdf-blank-reviews',prepared.reviewId,'render.json'),forged={...prepared,renderer:{...prepared.renderer,version:'caller-self-declared'}};await writeFile(receiptFile,JSON.stringify(forged));
  await assert.rejects(recordPdfBlankReview(dir,raw,request,'agent',native.options),/rerender differs/);assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${subject}`).length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('audited manual PDF blank pages bind v4 business context and invalidate existing guides when original proof changes',async()=>{
 const f=await fixture({manual:true}),raw=Buffer.from('%PDF-synthetic-reviewed-manual-source'),native=blankRenderer(raw),rendered=await preparePdfBlankReview(config.dataDir,raw,[2,4],native.options),proof=await recordPdfBlankReview(config.dataDir,raw,blankRequest(rendered),'authorized-review-agent',native.options);
 const text=Array.from({length:34},(_,i)=>`--- Page ${i+1} ---\n${[2,4].includes(i+1)?'':i===0?body:`合成其余物理页完整原文${i+1}。`}\n`).join('\n');
 const sourceDir=path.dirname(f.filename),url='https://hyyyj.fujian.gov.cn/xxgk/tzgg/202507/P020250728594612073287.pdf',manifest={version:'manual-official-source/1',id:f.sourceId,url,name:'Synthetic manual notice',attribution:'来源原文',title:'合成完整手工PDF',publishedAt:null,publicationLiteral:null,rawSha256:sha256(raw),bodySha256:sha256(text),parser:'manual-official-pdf/v1',blankReviewId:proof.reviewId};
 const sourceReceipt={requestedUrl:url,finalUrl:url,status:200,sha256:sha256(raw),finishedAt:'2026-10-23T00:00:00Z'};
 await writeFile(f.filename,text);await writeFile(path.join(sourceDir,'raw.bin'),raw);await writeFile(path.join(sourceDir,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(sourceDir,'receipt.json'),JSON.stringify(sourceReceipt));
 const prepared=await verifyManualSource(config.dataDir,f.sourceId,{parsePdf:async bytes=>({status:'parsed',rawSha256:sha256(bytes),parser:'synthetic/v1',pages:34,text})});
 await observe(f.id,{...f.observation,expectedRevision:1,rawSha256:sha256(raw),sourceCapture:prepared.sourceCapture},'synthetic-editor');
 await review(f.id,{revision:2,sourceRevision:1,decision:'approved',applicabilityReviewed:false,note:'Synthetic complete audited manual source'},'synthetic-reviewer');
 const c=await businessGuideContext(f.id);assert.equal(c.catalog.version,'fishery-spans-v4-reviewed-blanks');assert.equal(c.catalog.pages.length,34);assert.ok(c.catalog.spans.every(s=>s.page!==2&&s.page!==4));
 const p=payload(c),pages=c.catalog.pages.map(page=>({page:page.page,text:text.slice(page.start,page.end).trim()})),sourceInput={body:text,bodySha256:sha256(text),observationRevision:2,pages,pdfBlankReview:proof},comparison=buildGuideAIReviewRequest(sourceInput,p);
 assert.equal(comparison.catalog.hash,c.catalog.hash);assert.equal(JSON.parse(String(comparison.request.user)).source.reviewedBlankPages.proofHash,proof.proofHash);
 const g=await createBusinessGuide({documentId:f.id,snapshotHash:c.snapshotHash,payload:p,reason:'Synthetic proof-bound guide'},'synthetic-editor'),task=await createGuideAIReview(g.id,{identity:'reviewed-blank-guide',expectedRevision:g.revision,payloadHash:g.payloadHash,snapshotHash:g.snapshotHash},'synthetic-editor'),rid=await receipt(task);
 await processGuideAIReview(task.id,fake(answer(p),rid));const checked=await businessGuideAdminDetail(g.id);assert.equal(checked.aiReview.pass,true);
 await decideBusinessGuide(g.id,{expectedRevision:checked.revision,payloadHash:checked.payloadHash,snapshotHash:checked.snapshotHash,decision:'approved',aiReviewHash:checked.aiReview.reviewHash!,reason:'Synthetic final proof-bound guide'},'synthetic-reviewer');assert.ok(await businessGuideReaderItem(g.id));
 const [before]=await sql`SELECT count(*)::int AS n FROM receipts`,png=path.join(config.dataDir,'fishery-pdf-blank-reviews',proof.reviewId,proof.pageImages[0]!.sha256+'.png');
 await writeFile(png,Buffer.from(blankPng).fill(0,blankPng.length-1));await assert.rejects(businessGuideContext(f.id),/PNG hash changed/);await assert.rejects(preflightGuideAIReview(g.id),/PNG hash changed/);await assert.rejects(businessGuideReaderItem(g.id),/No current approved/);await writeFile(png,blankPng);
 await writeFile(path.join(sourceDir,'raw.bin'),Buffer.from('%PDF-altered-original'));await assert.rejects(businessGuideContext(f.id),/original PDF hash changed/);await writeFile(path.join(sourceDir,'raw.bin'),raw);
 await sql`UPDATE audit_log SET after=jsonb_set(after,'{renderer,version}','"tampered"'::jsonb) WHERE subject=${`pdf-blank-review:${proof.reviewId}`}`;await assert.rejects(businessGuideContext(f.id),/audit.*changed/);
 const [after]=await sql`SELECT count(*)::int AS n FROM receipts`;assert.equal(after!.n,before!.n,'Tampered proof cannot trigger any model request');
});
