// Explicit one-shot runner: no queue consumer, schedules, final human decision or automatic retry.
import { parseArgs } from "node:util";

export interface GuideReviewCLIOptions { mode: "preflight" | "execute" | "resume-cache" | "upgrade-budget"; ids: string[]; actor: string; reason: string }
export function parseGuideReviewCLI(argv: string[]): GuideReviewCLIOptions {
  const { values } = parseArgs({ args: argv, options: { id: { type: "string", multiple: true }, execute: { type: "boolean" }, "resume-cache": { type: "boolean" }, "upgrade-budget": { type: "boolean" }, actor: { type: "string" }, reason: { type: "string" } } });
  const modes = [values.execute, values["resume-cache"], values["upgrade-budget"]].filter(Boolean).length;
  if (modes > 1) throw new Error("Execution, cache recovery and budget upgrade are separate invocations");
  const mode = values.execute ? "execute" : values["resume-cache"] ? "resume-cache" : values["upgrade-budget"] ? "upgrade-budget" : "preflight";
  const ids = values.id ?? [], actor = values.actor?.trim() ?? "", reason = values.reason?.trim() ?? "";
  if (ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new Error("Use at most eight unique explicit guide IDs");
  if (mode === "upgrade-budget" ? ids.length !== 0 : ids.length === 0) throw new Error("Guide IDs are required except for a separate budget upgrade");
  if (mode !== "preflight" && (!actor || actor.length > 200)) throw new Error("Explicit operator actor is required");
  if (mode === "upgrade-budget" && (!reason || reason.length > 2000)) throw new Error("Budget upgrade requires an explicit audit reason");
  if (mode !== "upgrade-budget" && reason) throw new Error("Reason is only accepted for a separate budget upgrade");
  return { mode, ids, actor, reason };
}
interface Lease { assertHeld(): Promise<void>; run<T>(fn: () => Promise<T>): Promise<T>; watch(fn: (error: Error) => void): () => void; release(): Promise<void> }
type Metrics = { guideId: string; editorialRevision: number; payloadHash: string; snapshotHash: string; bindingHash: string; requiredCalls: number; [key: string]: unknown };
type Budget = { states: string[]; [key: string]: unknown };
export interface GuideReviewCLIDeps {
  modelCallsEnabled: boolean; acquire(): Promise<Lease>; close(): Promise<void>;
  preflight(id: string): Promise<Metrics>; budget(): Promise<Budget>; legacyBudget(): Promise<Budget>;
  guideVersion(id: string): Promise<{ revision: number; payloadHash: string; snapshotHash: string }>;
  create(id: string, data: unknown, actor: string): Promise<{ id: string; status: string }>;
  current(id: string): Promise<{ id?: string; current: boolean; pass: boolean; status: string; [key: string]: unknown }>;
  process(id: string): Promise<unknown>; resume(id: string, actor: string): Promise<unknown>; upgrade(actor: string, reason: string): Promise<unknown>;
}
export async function runGuideReviewCLI(options: GuideReviewCLIOptions, deps: GuideReviewCLIDeps, emit: (value: unknown) => void, isStopped = () => false) {
  let lease: Lease | undefined, stopWatch = () => {}, lost = false;
  const check = async () => { if (lost || isStopped()) throw new Error("Processing stopped; no next action permitted"); await lease?.assertHeld(); };
  const settled = (budget: Budget) => { if (budget.states.some(state => state !== "received")) throw new Error("Unresolved cumulative charges require reconciliation"); };
  const reviewStatus = (value: unknown) => {
    const data = value as Record<string, unknown>;
    return Object.fromEntries(["id", "current", "pass", "status", "guideRevision", "receiptId", "decisionStatus", "reviewHash", "confirmedConflict"].filter(key => key in data).map(key => [key, data[key]]));
  };
  try {
    if (options.mode === "upgrade-budget") {
      lease = await deps.acquire(); stopWatch = lease.watch(() => { lost = true; emit({ event: "lease_lost", noAutomaticRetry: true }); });
      await lease.run(async () => { await check(); const before = await deps.legacyBudget(); emit({ event: "budget_before", budget: before }); settled(before); await check();
        const result = await deps.upgrade(options.actor, options.reason); emit({ event: "budget_upgraded", result }); emit({ event: "budget_after", budget: await deps.budget() }); });
      return;
    }
    // All selected complete sources must fit before creating any review or calling a provider.
    for (const id of options.ids) { await check(); emit({ event: "preflight", metrics: await deps.preflight(id) }); }
    const budget = await deps.budget(); emit({ event: "budget_before", budget });
    if (options.mode === "preflight") return;
    if (!deps.modelCallsEnabled) throw new Error("Explicit model-call valve is required even for cached chatJson recovery");
    settled(budget);
    lease = await deps.acquire(); stopWatch = lease.watch(() => { lost = true; emit({ event: "lease_lost", noAutomaticRetry: true }); });
    await lease.run(async () => {
      for (const id of options.ids) {
        await check(); settled(await deps.budget()); const metrics = await deps.preflight(id); emit({ event: "execution_preflight", metrics }); await check();
        let taskId: string;
        if (options.mode === "resume-cache") {
          if (metrics.requiredCalls !== 0) throw new Error("Cache recovery cannot create a paid request");
          const current = await deps.current(id); if (!current.current || !current.id) throw new Error("Current interrupted review required for cache recovery");
          taskId = current.id; await check(); await deps.resume(taskId, options.actor);
        } else {
          const version = await deps.guideVersion(id);
          if (version.payloadHash !== metrics.payloadHash || version.snapshotHash !== metrics.snapshotHash) throw new Error("Guide changed after preflight");
          await check(); const task = await deps.create(id, { identity: `cli-${metrics.bindingHash.slice(0, 48)}`, expectedRevision: version.revision, payloadHash: metrics.payloadHash, snapshotHash: metrics.snapshotHash }, options.actor);
          taskId = task.id;
          if (["needs_final_human", "needs_evidence"].includes(task.status)) { emit({ event: "existing_review", guideId: id, review: reviewStatus(await deps.current(id)) }); continue; }
          if (task.status !== "queued") throw new Error("Failed/running review requires explicit reconciliation or cache recovery");
        }
        await check(); emit({ event: "review_result", guideId: id, review: reviewStatus(await deps.process(taskId)), finalHumanApproval: false }); await check();
      }
    });
    emit({ event: "budget_after", budget: await deps.budget() });
  } finally { stopWatch(); try { await lease?.release(); } finally { await deps.close(); } }
}
async function productionDeps(): Promise<GuideReviewCLIDeps> {
  const [{ config }, { sql, closeDb }, core, auth, { acquireProcessingLease }, { TRIAL, trialBudget }] = await Promise.all([
    import("@aihot/backend/config"), import("@aihot/backend/db"), import("../backend/business-ai-review.ts"), import("../backend/authorization.ts"), import("../backend/processing-lease.ts"), import("../backend/trial-transport.ts"),
  ]);
  return { modelCallsEnabled: config.modelCallsEnabled, acquire: acquireProcessingLease, close: closeDb, preflight: core.preflightGuideAIReview,
    budget: auth.fisheryAuthorizationReport, legacyBudget: async () => {
      const [row] = await sql`SELECT value FROM settings WHERE key=${auth.authorizationKey}`;
      const ledger = row?.value;
      if (!ledger || ledger.id !== TRIAL.id || ledger.maxRequests !== 20 || ledger.maxReservedMicroCny !== TRIAL.maxReservedMicroCny || !Array.isArray(ledger.entries)) throw new Error("Existing legacy cumulative ledger required");
      return { authorization: TRIAL.id, maxRequests: ledger.maxRequests, maxReservedMicroCny: ledger.maxReservedMicroCny, entryCount: ledger.entries.length, ...trialBudget(ledger.entries), states: ledger.entries.map((e: { state: string }) => e.state) };
    }, guideVersion: async id => {
      const [row] = await sql`SELECT revision,payload_hash,snapshot_hash FROM fishery_business_guides WHERE id=${id}`;
      if (!row) throw new Error("Guide not found"); return { revision: row.revision, payloadHash: row.payload_hash, snapshotHash: row.snapshot_hash };
    }, create: core.createGuideAIReview as GuideReviewCLIDeps["create"], current: core.getCurrentGuideAIReview, process: core.processGuideAIReview, resume: core.resumeGuideAIReview, upgrade: auth.upgradeExistingTrialToAmountOnly };
}
if (import.meta.main) {
  let stopping = false;
  const requestStop = () => { stopping = true; };
  process.on("SIGTERM", requestStop); process.on("SIGINT", requestStop);
  try { const options = parseGuideReviewCLI(process.argv.slice(2)); await runGuideReviewCLI(options, await productionDeps(), value => console.log(JSON.stringify(value)), () => stopping); }
  catch (error) { console.error(JSON.stringify({ event: "stopped", errorType: (error as Error).name, noAutomaticRetry: true, finalHumanApproval: false })); process.exitCode = 2; }
  finally { process.off("SIGTERM", requestStop); process.off("SIGINT", requestStop); }
}
