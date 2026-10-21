import { sql } from "@aihot/backend/db";
import { sourceArticleAvailability } from "./source-availability.ts";
import { createHash } from "node:crypto";
import { readSourceBody } from "./source-body.ts";
import { documentHistory, listDocuments, listSources, NotFound, sourceAttributionOf } from "./store.ts";
import { exportBlockers } from "./export.ts";
import type { MaterialDetail, MaterialObservation, MaterialReview, MaterialRow, MaterialSource, Workbench } from "../ui-contracts.ts";

const iso = (value: Date | string) => new Date(value).toISOString();
const observationOf = (r: Record<string, any>): MaterialObservation => ({ revision: r.revision, observedAt: iso(r.observed_at), actor: r.actor, contentHash: r.content_hash, payload: r.payload });
const reviewOf = (r: Record<string, any>): MaterialReview => ({ revision: r.revision, sourceRevision: r.source_revision, decision: r.decision, note: r.note, actor: r.actor, reviewedAt: iso(r.reviewed_at), applicabilityReviewed: r.applicability_reviewed });
const sources = async (): Promise<MaterialSource[]> => (await listSources()).map(s => ({ id: s.source_id, name: s.name, revision: s.revision, profile: s.profile,
  enabled: s.enabled, participationMode: s.participation_mode, testOnly: s.profile.attribution.startsWith("ISOLATED TEST FIXTURE") }));

function rowOf(d: Record<string, any>, source: MaterialSource, latest: MaterialObservation | null, review: MaterialReview | null, linkedStatus?: string): MaterialRow {
  const c = latest?.payload.sourceCapture;
  const state = d.withdrawn_reason ? "withdrawn" : c && (c.httpStatus !== 200 || ["failed", "missing"].includes(c.parseStatus)) ? "failed"
    : c && (c.parseStatus === "unverified" || !c.bodySha256 || c.conflicts.length) ? "unverified"
    : review && (review.revision !== latest?.revision || review.sourceRevision !== source.revision) ? "stale"
    : review?.decision === "rejected" ? "rejected" : review?.decision === "approved" ? "approved" : "pending";
  return { id: d.id, sourceId: d.source_id, title: latest?.payload.title ?? "尚无观察记录", ...sourceAttributionOf(d.issuer), canonicalUrl: d.canonical_url,
    documentNumber: d.document_number, articleId: d.article_id, withdrawnReason: d.withdrawn_reason, source, latest, review, state,
    testOnly: source.testOnly || d.issuer.startsWith("ISOLATED TEST"), blockers: exportBlockers({ withdrawn_reason: d.withdrawn_reason, article_id: d.article_id },
      { revision: source.revision, profile: source.profile, participation_mode: source.participationMode },
      latest, review ? { revision: review.revision, source_revision: review.sourceRevision, decision: review.decision } : null, linkedStatus, new Date()) };
}

export async function workbench(query: { page?: number; q?: string; scope?: string; state?: string } = {}): Promise<Workbench> {
  const [docs, registered] = await Promise.all([listDocuments(), sources()]);
  const availability = await sourceArticleAvailability(docs.flatMap(d => d.article_id ? [d.article_id] : []));
  const all = docs.map(d => rowOf(d, registered.find(s => s.id === d.source_id)!,
    d.revision ? observationOf(d) : null, d.decision ? reviewOf({ ...d, revision: d.reviewed_revision, source_revision: d.reviewed_source_revision, actor: d.reviewer }) : null,
    d.article_id ? availability[d.article_id]?.status : undefined));
  const scope = query.scope ?? "real", q = query.q?.trim().toLocaleLowerCase() ?? "";
  const scoped = all.filter(r => scope === "all" || r.testOnly === (scope === "test"));
  const sourceCaptures:Workbench["sourceCaptures"]={};
  for(const row of scoped) {
    const capture=row.latest?.payload.sourceCapture,previous=sourceCaptures[row.sourceId];
    if(capture&&(!previous||Date.parse(capture.capturedAt)>Date.parse(previous.capturedAt))) sourceCaptures[row.sourceId]={documentId:row.id,observationRevision:row.latest!.revision,capturedAt:capture.capturedAt,httpStatus:capture.httpStatus,parseStatus:capture.parseStatus,acquisitionMode:capture.acquisitionMode};
  }
  const counts: Workbench["counts"] = { pending:0, failed:0, unverified:0, stale:0, rejected:0, approved:0, withdrawn:0 };
  for (const row of scoped) counts[row.state]++;
  const filtered = scoped.filter(r => (!query.state || r.state === query.state) && (!q || [r.title,r.issuer,r.source.name,r.canonicalUrl,r.documentNumber].join(" ").toLocaleLowerCase().includes(q)));
  const limit = 25, page = Math.min(Math.max(1,query.page ?? 1),Math.max(1,Math.ceil(filtered.length/limit)));
  return { limit, page, total:filtered.length, counts, sourceCaptures, sources: registered, scopeCounts: { real:all.filter(r=>!r.testOnly).length,test:all.filter(r=>r.testOnly).length,all:all.length }, rows:filtered.slice((page-1)*limit,page*limit) };
}

export async function materialDetail(id: string): Promise<MaterialDetail> {
  const history = await documentHistory(id), registered = await sources();
  const source = registered.find(s => s.id === history.document.source_id);
  if (!source) throw new NotFound("Source profile not found");
  const observations = history.observations.map(observationOf), reviews = history.reviews.map(reviewOf);
  const latest = observations.at(-1) ?? null, review = reviews.at(-1) ?? null, d = history.document;
  const linkedStatus = d.article_id ? (await sourceArticleAvailability([d.article_id]))[d.article_id]?.status : undefined;
  // Only this document's privately archived evidence. Never render upstream HTML or expose its raw JSON.
  const [stored] = await sql<{ body_text: string | null; mode: string | null }[]>`SELECT body_text, raw->>'mode' AS mode FROM articles
    WHERE source_id = ${d.source_id} AND ((id = ${d.article_id} AND ${d.article_id}::text IS NOT NULL) OR raw->>'fisheryDocumentId' = ${id}) LIMIT 1`;
  let body = stored?.body_text, mode = stored?.mode;
  const capture = latest?.payload.sourceCapture;
  if (capture?.archiveId || capture?.manualArchiveId) {
    body = null; mode = capture.acquisitionMode;
    // Never fall back to another version's text if the bound archive is missing or changed.
    if (capture.bodySha256) try { body = await readSourceBody(capture); } catch { body = null; }
  }
  return { ...rowOf(d, source, latest, review, linkedStatus), observations, reviews, text: body ? {
    body: body.slice(0, 65536), truncated: body.length > 65536, acquisitionMode: mode ?? null,
    hashMatches: createHash("sha256").update(body).digest("hex") === latest?.payload.sourceCapture?.bodySha256 } : null };
}
