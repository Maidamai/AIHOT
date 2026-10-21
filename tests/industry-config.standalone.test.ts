import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATEGORIES, CATEGORY_TAGS, ENTITY_TAGS, RELEASE, TOPIC_TAGS } from "../industry/taxonomy.ts";
import { SELECTION } from "../industry/selection.ts";
import { SITE, ABOUT, REPORTS } from "../site/site.ts";

const topics = JSON.parse(readFileSync(new URL("../industry/topics.json", import.meta.url), "utf8")) as {
  groups: Array<{ key: string }>;
  topics: Array<{ slug: string; group: string; tags: string[] }>;
};
test("fishery browsing categories and business topics share the editorial vocabulary", () => {
  assert.deepEqual(CATEGORIES.map(c => c.key), ["policy", "safety", "market", "research", "equipment", "operations", "reference"]);
  const business = ["funding", "vessels", "crew", "compliance", "preparation", "fishing", "weather", "traceability", "sales", "return"];
  assert.deepEqual(topics.topics.filter(t => t.group === "field").map(t => t.slug), business);
  const vocabulary = new Set<string>([...CATEGORY_TAGS, ...TOPIC_TAGS]);
  for (const topic of topics.topics) {
    assert.ok(topics.groups.some(g => g.key === topic.group));
    assert.ok(topic.tags.length > 0 && topic.tags.every(t => vocabulary.has(t)), topic.slug);
  }
  assert.equal(new Set(topics.topics.map(t => t.slug)).size, topics.topics.length);
  assert.deepEqual(ENTITY_TAGS, []);
  assert.equal(RELEASE, null);
});
test("descriptive fishery identity does not promise publication or present-day eligibility", () => {
  assert.equal(SITE.name, "远洋渔业资讯");
  assert.equal(SITE.subject, "远洋渔业");
  assert.equal(SITE.organization.name, SITE.name);
  assert.doesNotMatch(SITE.description + ABOUT.lead + REPORTS.descriptions.daily, /每天|每日|实时|当前可申报/);
  assert.match(REPORTS.quiet.title, /暂无入选/);
});
test("domain adaptation retains score weights and uncalibrated thresholds", () => {
  assert.deepEqual(SELECTION.thresholds, { T1: 60, T1_5: 65, T2: 76 });
  assert.equal(SELECTION.understandFloor, 50);
  const score = readFileSync(new URL("../industry/prompts/selection-score.md", import.meta.url), "utf8");
  for (const row of ["model_release | 3 | 2 | 2 | 2 | 1", "product_launch | 2 | 2 | 1 | 2 | 3", "tool_or_prompt | 1 | 2 | 1 | 2 | 4", "research_paper | 5 | 3 | 1 | 0 | 1", "industry_event | 3 | 1 | 2 | 4 | 0", "opinion_analysis | 1 | 3 | 1 | 4 | 1", "tutorial_explainer | 1 | 1 | 1 | 3 | 4"]) assert.ok(score.includes(row));
  assert.match(score, /不可信/);
  assert.match(score, /历史/);
});
