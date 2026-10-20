import { randomUUID, createHash } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { documentSchema, observationSchema, reviewSchema, sourceSchema, withdrawSchema, canExportSummary, type SourceProfile } from "../contracts.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export class NotFound extends Error { statusCode = 404; }

export async function registerSource(sourceId: string, input: unknown, actor: string) {
  const { expectedRevision, ...profile } = sourceSchema.parse(input);
  return sql.begin(async (tx) => {
    const [source] = await tx`SELECT id FROM sources WHERE id = ${sourceId} FOR UPDATE`;
    if (!source) throw new NotFound("Source not found");
    const [before] = await tx`SELECT * FROM fishery_sources WHERE source_id = ${sourceId}`;
    if ((before?.revision ?? 0) !== expectedRevision) throw new Conflict("Source profile changed; reload before editing");
    const revision = expectedRevision + 1;
    await tx`INSERT INTO fishery_sources (source_id, revision, profile) VALUES (${sourceId}, ${revision}, ${tx.json(profile)})
      ON CONFLICT (source_id) DO UPDATE SET revision = EXCLUDED.revision, profile = EXCLUDED.profile, updated_at = now()`;
    await audit(actor, "fishery.source", `source:${sourceId}`, null, before ?? null, { revision, profile }, { db: tx });
    return { sourceId, revision, profile };
  });
}

export async function createDocument(input: unknown, actor: string) {
  const data = documentSchema.parse(input);
  return sql.begin(async (tx) => {
    if (!(await tx`SELECT 1 FROM fishery_sources WHERE source_id = ${data.sourceId}`).length) throw new NotFound("Register the source first");
    if (data.articleId && !(await tx`SELECT 1 FROM articles WHERE id = ${data.articleId} AND source_id = ${data.sourceId}`).length)
      throw new NotFound("Linked article must belong to this source");
    const id = randomUUID();
    const [row] = await tx`INSERT INTO fishery_documents (id, source_id, article_id, issuer, document_number, canonical_url)
      VALUES (${id}, ${data.sourceId}, ${data.articleId}, ${data.issuer}, ${data.documentNumber}, ${data.canonicalUrl})
      ON CONFLICT (source_id, canonical_url) DO NOTHING RETURNING *`;
    if (!row) throw new Conflict("This source URL is registered; append an observation to its document");
    await audit(actor, "fishery.document", `fishery:${id}`, null, null, row, { db: tx });
    return row;
  });
}

export async function lockDocument(db: Db, id: string) {
  const [row] = await db`SELECT * FROM fishery_documents WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new NotFound("Document not found");
  return row;
}

export async function observe(id: string, input: unknown, actor: string) {
  const { expectedRevision, ...payload } = observationSchema.parse(input);
  return sql.begin(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.withdrawn_reason) throw new Conflict("Document withdrawn");
    const [previous] = await tx`SELECT revision FROM fishery_observations WHERE document_id = ${id} ORDER BY revision DESC LIMIT 1`;
    if ((previous?.revision ?? 0) !== expectedRevision) throw new Conflict("Observation changed; reload before appending");
    const [row] = await tx`INSERT INTO fishery_observations (document_id, revision, actor, content_hash, payload)
      VALUES (${id}, ${expectedRevision + 1}, ${actor}, ${hash(payload)}, ${tx.json(payload)}) RETURNING *`;
    await audit(actor, "fishery.observe", `fishery:${id}`, null, { revision: expectedRevision }, { revision: row.revision, contentHash: row.content_hash }, { db: tx });
    return row;
  });
}

export async function review(id: string, input: unknown, actor: string) {
  const data = reviewSchema.parse(input);
  return sql.begin(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.withdrawn_reason) throw new Conflict("Document withdrawn");
    const [source] = await tx`SELECT revision FROM fishery_sources WHERE source_id = ${doc.source_id} FOR SHARE`;
    const [latest] = await tx`SELECT revision FROM fishery_observations WHERE document_id = ${id} ORDER BY revision DESC LIMIT 1`;
    if (latest?.revision !== data.revision || source?.revision !== data.sourceRevision) throw new Conflict("Observation or rights changed; reload before reviewing");
    const [row] = await tx`INSERT INTO fishery_reviews (document_id, revision, source_revision, decision, applicability_reviewed, note, actor)
      VALUES (${id}, ${data.revision}, ${data.sourceRevision}, ${data.decision}, ${data.applicabilityReviewed}, ${data.note}, ${actor}) RETURNING *`;
    await audit(actor, "fishery.review", `fishery:${id}`, data.note, null, row, { db: tx });
    return row;
  });
}

export async function withdraw(id: string, input: unknown, actor: string) {
  const data = withdrawSchema.parse(input);
  return sql.begin(async (tx) => {
    const doc = await lockDocument(tx, id);
    const [latest] = await tx`SELECT revision FROM fishery_observations WHERE document_id = ${id} ORDER BY revision DESC LIMIT 1`;
    if (latest?.revision !== data.expectedRevision) throw new Conflict("Observation changed; reload before withdrawing");
    await tx`UPDATE fishery_documents SET withdrawn_reason = ${data.reason} WHERE id = ${id}`;
    await audit(actor, "fishery.withdraw", `fishery:${id}`, data.reason, { reason: doc.withdrawn_reason }, { reason: data.reason }, { db: tx });
    return { id, withdrawn: true };
  });
}

export async function sourceHealth(now: number) {
  const rows = await sql<{ source_id: string; profile: SourceProfile }[]>`SELECT source_id, profile FROM fishery_sources`;
  return rows.filter(({ profile: p }) => !canExportSummary(p, now))
    .map((r) => `渔业来源 ${r.source_id}：许可未知、受限或已到复核期限，素材导出关闭`);
}
export async function listSources() {
  return sql`SELECT f.*, s.name, s.health, s.last_fetch_at, s.last_ok_at, s.last_error FROM fishery_sources f JOIN sources s ON s.id = f.source_id ORDER BY f.source_id`;
}
export async function listDocuments() {
  return sql`SELECT d.*, o.revision, o.observed_at, o.payload->>'title' AS title,
    r.decision, r.revision AS reviewed_revision, r.source_revision AS reviewed_source_revision, s.revision AS source_revision
    FROM fishery_documents d JOIN fishery_sources s ON s.source_id = d.source_id
    LEFT JOIN LATERAL (SELECT * FROM fishery_observations WHERE document_id = d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT * FROM fishery_reviews WHERE document_id = d.id ORDER BY id DESC LIMIT 1) r ON true
    ORDER BY d.created_at DESC LIMIT 100`;
}
export async function documentHistory(id: string) {
  const [document] = await sql`SELECT * FROM fishery_documents WHERE id = ${id}`;
  if (!document) throw new NotFound("Document not found");
  const observations = await sql`SELECT * FROM fishery_observations WHERE document_id = ${id} ORDER BY revision`;
  const reviews = await sql`SELECT * FROM fishery_reviews WHERE document_id = ${id} ORDER BY id`;
  return { document, observations, reviews };
}
