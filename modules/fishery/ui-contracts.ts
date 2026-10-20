import type { Observation, SourceProfile } from "./contracts.ts";

export const MATERIAL_STATES = { pending: "待审核", failed: "获取失败", unverified: "待核验", stale: "审核已失效", rejected: "已拒绝", approved: "已审核", withdrawn: "已撤回" } as const;
export const ACQUISITION_MODES = { live_capture: "实时获取收据", archive_replay: "归档回放", unknown: "获取方式未标记" } as const;
export type MaterialState = keyof typeof MATERIAL_STATES;
export interface Blocker { code: string; message: string; }
export interface MaterialSource {
  id: string; name: string; revision: number; profile: SourceProfile; enabled: boolean;
  participationMode: string; testOnly: boolean;
}
export interface MaterialObservation { revision: number; observedAt: string; actor: string; contentHash: string; payload: Observation; }
export interface MaterialReview { revision: number; sourceRevision: number; decision: "approved" | "rejected"; note: string; actor: string; reviewedAt: string; applicabilityReviewed: boolean; }
export interface MaterialRow {
  id: string; sourceId: string; title: string; issuer: string; canonicalUrl: string; documentNumber: string | null;
  articleId: string | null; withdrawnReason: string | null; source: MaterialSource; latest: MaterialObservation | null;
  review: MaterialReview | null; state: MaterialState; blockers: Blocker[]; testOnly: boolean;
}
export interface Workbench { rows: MaterialRow[]; sources: MaterialSource[]; limit: number; page: number; total: number; counts: Record<MaterialState, number>; scopeCounts: { real: number; test: number; all: number }; }
export interface MaterialDetail extends MaterialRow {
  observations: MaterialObservation[]; reviews: MaterialReview[];
  text: { body: string; truncated: boolean; hashMatches: boolean; acquisitionMode: string | null } | null;
}
