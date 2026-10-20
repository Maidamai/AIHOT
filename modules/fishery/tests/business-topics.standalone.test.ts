import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSINESS_TOPICS, prepareBusinessTopicCards } from "../business-topics.ts";
import type { FisheryReaderItem } from "../ui-contracts.ts";

function reference(id: string, historical: boolean): FisheryReaderItem {
  return {
    id, title: "合成会议与政策背景摘要", source: { name: "Synthetic source", url: "https://example.org/reference", originalTitle: "合成背景原文" },
    category: { id: "reference", label: "资料" }, summary: [{ sentence: "会议交流了相关工作。", evidence: [{ quote: "会议交流了相关工作。", paragraph: 1, page: null, url: "https://example.org/reference" }] }],
    dates: { published: { precision: "day", value: "2026-01-01" }, event: { precision: "unknown", value: null } },
    age: { referenceDate: "2026-10-20", days: historical ? 292 : 0, historical, label: historical ? "历史资料" : "时效待核" },
    verification: { status: "internally_qualified", label: "摘要已完成内部核对", legalApplicability: "未完成法律适用性核验" },
  };
}

test("fixed business topics retain all ten requested stages and four first-release priorities", () => {
  assert.deepEqual(BUSINESS_TOPICS.map(t => t.label), ["补贴融资", "船舶购租改造检修", "船员/外籍用工", "许可配额履约", "备航油料补给保险", "捕捞禁区/休渔/鱼情", "气象应急", "转运追溯", "销售通关回款", "回港维修换班结算退出"]);
  assert.equal(new Set(BUSINESS_TOPICS.map(t => t.id)).size, 10);
  assert.deepEqual(BUSINESS_TOPICS.filter(t => t.firstRelease).map(t => t.focus), ["补贴申报", "船员用工", "出海合规", "备航港口服务"]);
});

test("empty topics remain explicit evidence gaps with unknown conditions, dates and service entry", () => {
  const cards = prepareBusinessTopicCards();
  assert.equal(cards.length, 10);
  for (const card of cards) {
    assert.equal(card.state, "needs_evidence"); assert.match(card.emptyMessage, /待补/);
    const fields = [card.audience, card.opportunity, card.restrictions, card.materials, card.documentStatus, card.officialDocument, card.serviceEntry, card.evidenceVersions,
      ...Object.values(card.applicability), ...Object.values(card.dates)];
    for (const field of fields) assert.deepEqual(field, { state: "unknown", value: null, evidence: [] });
    assert.deepEqual(card.humanReview, { state: "unreviewed", reviewedAt: null, note: null });
    assert.deepEqual(card.eligibility, { canApply: null, canFish: null }); assert.deepEqual(card.references, []);
  }
});

test("four internally qualified historical or auxiliary items cannot become application or fishing guides", () => {
  const refs = [reference("history1", true), reference("history2", true), reference("auxiliary1", false), reference("auxiliary2", false)];
  const before = structuredClone(refs);
  const cards = prepareBusinessTopicCards({ funding: refs, compliance: refs });
  const funding = cards.find(c => c.topicId === "funding")!;
  assert.equal(funding.references.length, 4);
  assert.deepEqual(funding.references.map(r => r.context), ["historical_reference", "historical_reference", "auxiliary_reference", "auxiliary_reference"]);
  for (const card of cards) {
    assert.equal(card.state, "needs_evidence"); assert.equal(card.serviceEntry.state, "unknown");
    assert.equal(card.documentStatus.state, "unknown"); assert.equal(card.humanReview.state, "unreviewed");
    assert.deepEqual(card.eligibility, { canApply: null, canFish: null });
    assert.ok(card.references.every(r => r.evidenceVersion.state === "unknown"));
  }
  assert.deepEqual(refs, before, "projection must not edit reader items or their existing verification");
  assert.equal(cards.find(c => c.topicId === "crew")!.references.length, 0, "no topic is inferred from title keywords");
  funding.references[0]!.published.value = "2099-01-01";
  assert.deepEqual(refs, before, "card date edits cannot alter reader evidence dates");
});
