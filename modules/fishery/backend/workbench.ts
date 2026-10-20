import { sql } from "@aihot/backend/db";
import { itemAvailability } from "@aihot/backend/publication/availability";
import { createHash } from "node:crypto";
import { documentHistory, listDocuments, listSources, NotFound } from "./store.ts";
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
  return { id: d.id, sourceId: d.source_id, title: latest?.payload.title ?? "尚无观察记录", issuer: d.issuer, canonicalUrl: d.canonical_url,
    documentNumber: d.document_number, articleId: d.article_id, withdrawnReason: d.withdrawn_reason, source, latest, review, state,
    testOnly: source.testOnly || d.issuer.startsWith("ISOLATED TEST"), blockers: exportBlockers({ withdrawn_reason: d.withdrawn_reason, article_id: d.article_id },
      { revision: source.revision, profile: source.profile, participation_mode: source.participationMode },
      latest, review ? { revision: review.revision, source_revision: review.sourceRevision, decision: review.decision } : null, linkedStatus, new Date()) };
}

export async function workbench(): Promise<Workbench> {
  const [docs, registered] = await Promise.all([listDocuments(), sources()]);
  const availability = await itemAvailability(docs.flatMap(d => d.article_id ? [d.article_id] : []));
  return { limit: 100, sources: registered, rows: docs.map(d => rowOf(d, registered.find(s => s.id === d.source_id)!,
    d.revision ? observationOf(d) : null, d.decision ? reviewOf({ ...d, revision: d.reviewed_revision, source_revision: d.reviewed_source_revision, actor: d.reviewer }) : null,
    d.article_id ? availability[d.article_id]?.status : undefined)) };
}

export async function materialDetail(id: string): Promise<MaterialDetail> {
  const history = await documentHistory(id), registered = await sources();
  const source = registered.find(s => s.id === history.document.source_id);
  if (!source) throw new NotFound("Source profile not found");
  const observations = history.observations.map(observationOf), reviews = history.reviews.map(reviewOf);
  const latest = observations.at(-1) ?? null, review = reviews.at(-1) ?? null, d = history.document;
  const linkedStatus = d.article_id ? (await itemAvailability([d.article_id]))[d.article_id]?.status : undefined;
  // Only this document's privately archived evidence. Never render upstream HTML or expose its raw JSON.
  const [stored] = await sql<{ body_text: string | null; mode: string | null }[]>`SELECT body_text, raw->>'mode' AS mode FROM articles
    WHERE source_id = ${d.source_id} AND ((id = ${d.article_id} AND ${d.article_id}::text IS NOT NULL) OR raw->>'fisheryDocumentId' = ${id}) LIMIT 1`;
  const body = stored?.body_text;
  return { ...rowOf(d, source, latest, review, linkedStatus), observations, reviews, text: body ? {
    body: body.slice(0, 65536), truncated: body.length > 65536, acquisitionMode: stored.mode,
    hashMatches: createHash("sha256").update(body).digest("hex") === latest?.payload.sourceCapture?.bodySha256 } : null };
}
