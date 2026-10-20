// Design-only configuration and DTO scaffolding. No routes, queue, database or model calls.
import type { FisheryReaderItem } from "./ui-contracts.ts";

export const BUSINESS_TOPICS = [
  { id: "funding", label: "补贴融资", firstRelease: true, focus: "补贴申报", evidenceNeeded: "正式申报通知、适用对象、申报期限、材料清单及主管部门办理入口" },
  { id: "vessels", label: "船舶购租改造检修", firstRelease: false, focus: "船舶服务", evidenceNeeded: "主管机关规则、船舶与作业条件、检验资质及适用服务入口" },
  { id: "crew", label: "船员/外籍用工", firstRelease: true, focus: "船员用工", evidenceNeeded: "船旗国及用工地正式规定、资质与劳动条件、办理材料及主管机关入口" },
  { id: "compliance", label: "许可配额履约", firstRelease: true, focus: "出海合规", evidenceNeeded: "正式许可与履约规定、适用船旗和海域鱼种渔法、时效及主管机关入口" },
  { id: "preparation", label: "备航油料补给保险", firstRelease: true, focus: "备航港口服务", evidenceNeeded: "官方港口与备航服务说明、作业条件、时间窗口及官方办理入口" },
  { id: "fishing", label: "捕捞禁区/休渔/鱼情", firstRelease: false, focus: "作业范围", evidenceNeeded: "正式禁限捕文件与坐标范围、日期、鱼种渔法及官方信息入口" },
  { id: "weather", label: "气象应急", firstRelease: false, focus: "预警与应急信息", evidenceNeeded: "官方预警原文、适用区域、发布与解除时间及官方应急信息入口" },
  { id: "traceability", label: "转运追溯", firstRelease: false, focus: "转运与追溯要求", evidenceNeeded: "正式转运报告和追溯规则、适用海域船旗、材料及主管机关入口" },
  { id: "sales", label: "销售通关回款", firstRelease: false, focus: "贸易与结算条件", evidenceNeeded: "官方贸易通关要求、国家地区与产品范围、材料及正式服务入口" },
  { id: "return", label: "回港维修换班结算退出", firstRelease: false, focus: "回港与退出条件", evidenceNeeded: "官方港口和退出规则、船员与船舶适用条件、时间材料及办理入口" },
] as const;

export type BusinessTopicId = (typeof BUSINESS_TOPICS)[number]["id"];
export type TopicDate = FisheryReaderItem["dates"]["published"];
export interface TopicEvidenceVersion {
  documentId: string;
  observationRevision: number;
  sourceRevision: number;
  rawSha256: string;
  bodySha256: string;
  parser: string;
  capturedAt: string;
}
export interface TopicEvidence {
  officialUrl: string;
  quote: string;
  paragraph: number;
  page: number | null;
  version: TopicEvidenceVersion;
}
export type TopicField<T> =
  | { state: "unknown"; value: null; evidence: [] }
  | { state: "documented"; value: T; evidence: [TopicEvidence, ...TopicEvidence[]] };

export interface TopicReference {
  documentId: string;
  title: string;
  originalTitle: string;
  sourceUrl: string;
  published: TopicDate;
  event: TopicDate;
  historical: boolean;
  context: "historical_reference" | "auxiliary_reference";
  internalVerification: FisheryReaderItem["verification"];
  // The current reader DTO omits these bindings. Never infer them from the title or source URL.
  evidenceVersion: TopicField<TopicEvidenceVersion>;
}

export interface BusinessTopicCard {
  topicId: BusinessTopicId;
  label: string;
  firstRelease: boolean;
  state: "needs_evidence";
  emptyMessage: string;
  audience: TopicField<string[]>;
  opportunity: TopicField<string>;
  restrictions: TopicField<string[]>;
  materials: TopicField<string[]>;
  applicability: {
    countriesOrRegions: TopicField<string[]>;
    flagStates: TopicField<string[]>;
    species: TopicField<string[]>;
    fishingMethods: TopicField<string[]>;
  };
  documentStatus: TopicField<"formal" | "consultation">;
  dates: {
    published: TopicField<TopicDate>;
    effectiveFrom: TopicField<TopicDate>;
    deadline: TopicField<TopicDate>;
    expiresAt: TopicField<TopicDate>;
    verifiedAt: TopicField<TopicDate>;
  };
  officialDocument: TopicField<{ title: string; url: string }>;
  serviceEntry: TopicField<{ label: string; url: string; authority: string }>;
  evidenceVersions: TopicField<TopicEvidenceVersion[]>;
  humanReview: { state: "unreviewed"; reviewedAt: null; note: null };
  references: TopicReference[];
  // An internally qualified summary is not a determination of an operator's entitlement.
  eligibility: { canApply: null; canFish: null };
}

const unknown = <T>(): TopicField<T> => ({ state: "unknown", value: null, evidence: [] });

/** Explicit topic associations only. The existing reader gate must still run on every runtime read. */
export function prepareBusinessTopicCards(
  references: Partial<Record<BusinessTopicId, readonly FisheryReaderItem[]>> = {},
): BusinessTopicCard[] {
  return BUSINESS_TOPICS.map(topic => ({
    topicId: topic.id, label: topic.label, firstRelease: topic.firstRelease,
    state: "needs_evidence", emptyMessage: "待补充经人工核验的正式依据、适用条件和官方办理或信息入口",
    audience: unknown(), opportunity: unknown(), restrictions: unknown(), materials: unknown(),
    applicability: { countriesOrRegions: unknown(), flagStates: unknown(), species: unknown(), fishingMethods: unknown() },
    documentStatus: unknown(),
    dates: { published: unknown(), effectiveFrom: unknown(), deadline: unknown(), expiresAt: unknown(), verifiedAt: unknown() },
    officialDocument: unknown(), serviceEntry: unknown(), evidenceVersions: unknown(),
    humanReview: { state: "unreviewed", reviewedAt: null, note: null },
    references: (references[topic.id] ?? []).map(item => ({
      documentId: item.id, title: item.title, originalTitle: item.source.originalTitle, sourceUrl: item.source.url,
      published: { ...item.dates.published }, event: { ...item.dates.event }, historical: item.age.historical,
      context: item.age.historical ? "historical_reference" : "auxiliary_reference",
      internalVerification: { ...item.verification }, evidenceVersion: unknown(),
    })),
    eligibility: { canApply: null, canFish: null },
  }));
}
