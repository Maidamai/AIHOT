import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGuideReviewCLI, runGuideReviewCLI, type GuideReviewCLIDeps } from "../scripts/review-business-guides.ts";

function fixture() {
  const calls: string[] = [], events: unknown[] = []; let lost: (() => void) | undefined;
  const metrics = (id: string) => ({ guideId: id, editorialRevision: 1, payloadHash: "p", snapshotHash: "s", bindingHash: "b".repeat(64), requiredCalls: 1 });
  const deps: GuideReviewCLIDeps = {
    modelCallsEnabled: true, acquire: async () => { calls.push("acquire"); return { assertHeld: async () => { calls.push("held"); }, run: async fn => fn(), watch: fn => { lost = () => fn(new Error("lost")); return () => { calls.push("unwatch"); }; }, release: async () => { calls.push("release"); } }; },
    close: async () => { calls.push("close"); }, preflight: async id => { calls.push(`preflight:${id}`); return metrics(id); }, budget: async () => ({ states: ["received"], entryCount: 18 }), legacyBudget: async () => ({ states: ["received"], entryCount: 18 }),
    guideVersion: async () => ({ revision: 1, payloadHash: "p", snapshotHash: "s" }), create: async (id, data) => { calls.push(`create:${id}`); assert.match((data as { identity: string }).identity, /^cli-b+$/); return { id: `task-${id}`, status: "queued" }; },
    current: async id => ({ id: `task-${id}`, current: true, pass: false, status: "failed" }), process: async id => { calls.push(`process:${id}`); return { status: "needs_final_human", pass: true, source: "PRIVATE_SOURCE", actor: "PRIVATE_ACTOR", reason: "PRIVATE_REASON" }; }, resume: async id => { calls.push(`resume:${id}`); }, upgrade: async () => { calls.push("upgrade"); return { maxRequests: null }; },
  };
  return { deps, calls, events, lose: () => lost?.(), emit: (v: unknown) => events.push(v) };
}
test("argv requires bounded explicit unique IDs; mutation modes and budget upgrade cannot combine", () => {
  assert.equal(parseGuideReviewCLI(["--id", "guide-a"]).mode, "preflight");
  for (const args of [[], ["--execute", "--id", "a"], ["--id", "a", "--id", "a"], ["--execute", "--resume-cache", "--id", "a", "--actor", "operator"], ["--upgrade-budget", "--id", "a", "--actor", "operator", "--reason", "audit"], ["--upgrade-budget", "--actor", "operator"], Array.from({length: 9}, (_, i) => ["--id", `guide-${i}`]).flat()]) assert.throws(() => parseGuideReviewCLI(args));
});
test("default is zero-call read-only preflight, with no lease or task creation", async () => {
  const f = fixture(); await runGuideReviewCLI(parseGuideReviewCLI(["--id", "a"]), f.deps, f.emit);
  assert.deepEqual(f.calls, ["preflight:a", "close"]); assert.equal(f.events.length, 2);
});
test("explicit execute preflights the whole batch then processes serially under lease and closes", async () => {
  const f = fixture(); await runGuideReviewCLI(parseGuideReviewCLI(["--execute", "--id", "a", "--id", "b", "--actor", "operator"]), f.deps, f.emit);
  assert.deepEqual(f.calls.filter(c => c.startsWith("create") || c.startsWith("process")), ["create:a", "process:task-a", "create:b", "process:task-b"]);
  assert.ok(f.calls.indexOf("preflight:b") < f.calls.indexOf("create:a")); assert.deepEqual(f.calls.slice(-3), ["unwatch", "release", "close"]);
  assert.equal(JSON.stringify(f.events).includes("PRIVATE_"), false);
});
test("lease loss drains the in-flight result and stops before next guide", async () => {
  const f = fixture(); f.deps.process = async id => { f.calls.push(`process:${id}`); f.lose(); return { status: "needs_final_human" }; };
  await assert.rejects(runGuideReviewCLI(parseGuideReviewCLI(["--execute", "--id", "a", "--id", "b", "--actor", "operator"]), f.deps, f.emit), /stopped/);
  assert.equal(f.calls.includes("create:b"), false); assert.deepEqual(f.calls.slice(-3), ["unwatch", "release", "close"]);
});
test("unknown charge or disabled model valve prevents every task and call", async () => {
  for (const kind of ["unknown", "disabled"]) {
    const f = fixture(); if (kind === "unknown") f.deps.budget = async () => ({ states: ["received", "unknown"] }); else f.deps.modelCallsEnabled = false;
    await assert.rejects(runGuideReviewCLI(parseGuideReviewCLI(["--execute", "--id", "a", "--actor", "operator"]), f.deps, f.emit));
    assert.equal(f.calls.some(c => c.startsWith("create") || c.startsWith("process")), false); assert.equal(f.calls.at(-1), "close");
  }
});
test("cache recovery cannot create paid attempt or retry without received cache", async () => {
  const f = fixture(), options = parseGuideReviewCLI(["--resume-cache", "--id", "a", "--actor", "operator"]);
  await assert.rejects(runGuideReviewCLI(options, f.deps, f.emit), /paid request/);
  assert.equal(f.calls.some(c => c.startsWith("create") || c.startsWith("process") || c.startsWith("resume")), false);
  const cached = fixture(), preflight = cached.deps.preflight; cached.deps.preflight = async id => ({ ...await preflight(id), requiredCalls: 0 });
  await runGuideReviewCLI(options, cached.deps, cached.emit);
  assert.deepEqual(cached.calls.filter(c => /^(resume|process|create)/.test(c)), ["resume:task-a", "process:task-a"]);
});
test("budget upgrade is a separate zero-model action, blocks unresolved old ledger and never processes guides", async () => {
  const options = parseGuideReviewCLI(["--upgrade-budget", "--actor", "operator", "--reason", "Explicit monetary-only authorization"]), f = fixture();
  await runGuideReviewCLI(options, f.deps, f.emit); assert.equal(f.calls.includes("upgrade"), true); assert.equal(f.calls.some(c => /^(create|process|resume)/.test(c)), false);
  const unknown = fixture(); unknown.deps.legacyBudget = async () => ({ states: ["unknown"] });
  await assert.rejects(runGuideReviewCLI(options, unknown.deps, unknown.emit), /reconciliation/); assert.equal(unknown.calls.includes("upgrade"), false);
});
test("failed review is never silently resumed by execute; stopping before execution sends nothing", async () => {
  const options = parseGuideReviewCLI(["--execute", "--id", "a", "--actor", "operator"]), f = fixture(); f.deps.create = async () => ({ id: "task-a", status: "failed" });
  await assert.rejects(runGuideReviewCLI(options, f.deps, f.emit), /reconciliation/); assert.equal(f.calls.some(c => c.startsWith("process") || c.startsWith("resume")), false);
  const stopped = fixture(); await assert.rejects(runGuideReviewCLI(options, stopped.deps, stopped.emit, () => true), /stopped/); assert.deepEqual(stopped.calls, ["close"]);
});
