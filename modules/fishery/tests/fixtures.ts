export const unknownDate = { precision: "unknown" as const, value: null };
export const sourceFixture = {
  expectedRevision: 0, rightsStatus: "permitted", rightsCheckedAt: "2020-01-01T00:00:00Z",
  reviewDueAt: "2099-01-01T00:00:00Z", evidenceUrl: "https://example.org/terms",
  allowedSummary: true, allowedPublication: true, attribution: "Synthetic fixture only",
};
export const observationFixture = {
  expectedRevision: 0, originalTitle: "Synthetic policy", title: "离线政策测试样例", summaryZh: "仅作本地行为测试的人工摘要。",
  language: "en", rawSha256: "a".repeat(64), policyStatus: "adopted",
  dates: { published: { precision: "day", value: "2026-04-17" }, adopted: unknownDate,
    effectiveFrom: { precision: "day", value: "2028-01-01" }, effectiveUntil: unknownDate },
  scope: { regions: ["NPFC"], species: [], flags: [], activities: ["fishing"], unknownFields: ["species", "flags"] },
  evidence: [{ url: "https://example.org/policy.pdf", sha256: "b".repeat(64), page: 3, section: null }],
};
