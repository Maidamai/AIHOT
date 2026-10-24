// The engine's own model: one OpenAI-compatible model (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL) runs every
// step of the analysis when nothing picks another one for a step.
import { stub, tag } from "./setup.ts";
import { analysisStep, SELECTING_SCORE, type AnalysisStep } from "./analysis-steps.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { CAPABILITIES, type Capability } from "@aihot/backend/editorial/models";
import { installModules } from "@aihot/backend/modules";
import { ModelOutputError } from "@aihot/backend/providers/receipts";
import { stopBoss } from "@aihot/backend/jobs/queue";

// Nothing chosen per step: every capability falls back to the `default` model (a step the site
// gives a model of its own is sent back to it by its environment variable).
for (const c of Object.values(CAPABILITIES) as Capability[]) {
  if (c.default === "default") delete process.env[c.env];
  else process.env[c.env] = "default";
}

const T = tag();
const SOURCE = `test-default-model-${T}`;
let truncateWriting = false;
const seen: Array<{ model: string; step: AnalysisStep }> = [];
const provider = await stub((_hit, req) => {
  const step = analysisStep(req.body);
  seen.push({ model: (JSON.parse(req.body) as { model: string }).model, step });
  const content =
    step === "prefilter" ? { label: "PASS", reason: "测试" }
    : step === "score" ? { attentionScore: SELECTING_SCORE }
    : step === "understand" ? { itemType: "product_launch", authorRole: "principal", tags: ["产品更新"], editorialJudgment: "理由", titleZh: "一个模型的标题", summaryZh: "一个模型写的摘要。第二句。" }
    : step === "structure" ? { category: "ai-products", tags: ["产品更新"], subjects: [], fact: null }
    : "title_zh: 标题\nsummary_zh: 摘要。";
  return { id: `stub-${seen.length}`, choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: truncateWriting && step === "understand" ? "length" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "one-model", MODEL_CALLS_ENABLED: "true" });

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Test default model', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

test("one model runs the prefilter, both scores, the writing and the structure", async () => {
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}`, title: `A product launch ${T}`, bodyText: `A company launched a product with pricing and availability. ${T} `.repeat(6),
    bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  } as never);
  const res = await analyzeArticle(articleId);
  assert.equal(res!.output!.selected, true);
  assert.equal(res!.output!.titleZh, "一个模型的标题");
  assert.deepEqual(seen.map((r) => r.step).sort(), ["prefilter", "score", "score", "structure", "understand"]);
  assert.ok(seen.every((r) => r.model === "one-model"), "every request names the configured model");
  const services = await sql<{ service: string }[]>`SELECT DISTINCT service FROM receipts WHERE subject LIKE ${`article:${articleId}%`}`;
  assert.deepEqual(services.map((s) => s.service), ["llm"]);
});


test("a bounded writer cannot publish a token-truncated response even when its JSON is valid", async () => {
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}/bounded`, title: `A bounded product launch ${T}`,
    bodyText: `A company launched a product with pricing and availability. ${T} `.repeat(6), bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  } as never);
  truncateWriting = true;
  installModules([{ name: "bounded-test", modelRequests: {
    prepare: async request => ({ maxTokens: Math.min(request.maxTokens, 2048), rejectTruncated: true }),
    send: async (_request, send) => send(),
  } }]);
  try {
    await assert.rejects(analyzeArticle(articleId), error => error instanceof ModelOutputError && /output token limit/.test(error.message));
    const [receipt] = await sql`SELECT status,response,usage FROM receipts WHERE subject LIKE ${`article:${articleId}%`} AND purpose='understand_article'`;
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.response.choices[0].finish_reason, "length", "the billed raw answer remains available for reconciliation");
    assert.ok(receipt.usage);
    assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${articleId}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=${articleId}`).length, 0);
  } finally { truncateWriting = false; installModules([]); }
});
