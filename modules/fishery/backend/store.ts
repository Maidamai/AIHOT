import { capturedTransaction } from "./column-lease.ts";
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

// The existing issuer column stores source attribution, never verified publishing authority.
export const sourceAttributionOf = (issuer: string) => ({ issuer, sourceAttribution: issuer, legacyIssuerMeaning: "source_attribution_only" as const });

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
    return Object.assign({}, row, sourceAttributionOf(row.issuer));
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
  return sql`SELECT f.*, s.name, s.health, s.last_fetch_at, s.last_ok_at, s.last_error, s.enabled, s.participation_mode FROM fishery_sources f JOIN sources s ON s.id = f.source_id ORDER BY f.source_id`;
}
export async function listDocuments() {
  const rows = await sql`SELECT d.*, o.revision, o.observed_at, o.actor, o.content_hash, o.payload, o.payload->>'title' AS title,
    r.decision, r.note, r.reviewed_at, r.actor AS reviewer, r.applicability_reviewed, r.revision AS reviewed_revision, r.source_revision AS reviewed_source_revision, s.revision AS source_revision
    FROM fishery_documents d JOIN fishery_sources s ON s.source_id = d.source_id
    LEFT JOIN LATERAL (SELECT * FROM fishery_observations WHERE document_id = d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT * FROM fishery_reviews WHERE document_id = d.id ORDER BY id DESC LIMIT 1) r ON true
    ORDER BY coalesce(o.observed_at, d.created_at) DESC, d.id DESC`;
  return rows.map(row => (Object.assign({}, row, sourceAttributionOf(row.issuer))));
}

// Idempotency compares the latest evidence, not any historic hash (A → B → A is a new version).
export function evidenceIdentity(input: unknown) {
  const { expectedRevision: _, ...payload } = observationSchema.parse(input);
  const capture = payload.sourceCapture;
  if (capture) { const { capturedAt: _time, attachmentCapturedAt: _attachmentTime, archiveId: _archive, manualArchiveId: _manualArchive, ...stable } = capture; return hash({ ...payload, sourceCapture: stable }); }
  return hash(payload);
}
type CaptureColumn={id:string;name:string;issuer:string};
type CapturedImport={id:string;revision:number;unchanged:boolean};
export function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string,options:{existingOnly:true}):Promise<CapturedImport|null>;
export function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string):Promise<CapturedImport>;
export async function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string,options:{existingOnly?:boolean}={}) {
  const { expectedRevision: _, ...payload } = observationSchema.parse(input);
  const sourceId = `fishery-column-${column.id}`;
  // A configured column owner is attribution only; do not infer a page publisher or policy issuer.
  const sourceAttribution = column.issuer;
  return capturedTransaction(column.id,async tx => {
    // Take the same source -> document lock order as normal imports. An unrelated URL must never be registered here.
    if(options.existingOnly) {
      await tx`SELECT id FROM sources WHERE id=${sourceId} FOR UPDATE`;
      if(!(await tx`SELECT id FROM fishery_documents WHERE source_id=${sourceId} AND canonical_url=${canonicalUrl} FOR UPDATE`).length) return null;
    }
    await tx`INSERT INTO sources (id,name,kind,enabled,participation_mode,site_fulltext,next_fetch_at)
      VALUES (${sourceId},${column.name},'external',false,'editorial',false,'2100-01-01') ON CONFLICT (id) DO NOTHING`;
    // Lock the source to serialize imports of the same URL and preserve operator rights settings.
    const [registered] = await tx`SELECT id,participation_mode FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if (registered?.participation_mode === "isolated") throw new Conflict("Source is isolated; captured imports are disabled");
    if (!(await tx`SELECT 1 FROM fishery_sources WHERE source_id=${sourceId}`).length) {
      const { expectedRevision: _revision, ...profile } = sourceSchema.parse({ expectedRevision: 0, attribution: sourceAttribution, healthNote: column.id.startsWith("manual-") ? "人工核验公开官方归档；非自动采集器，HTTP回执不是网站签名，尚需普通人工审核，转载权未知" : "手动官方栏目试采；自动采集关闭，转载权未知" });
      await tx`INSERT INTO fishery_sources(source_id,revision,profile) VALUES (${sourceId},1,${tx.json(profile)})`;
      await audit(actor,"fishery.source",`source:${sourceId}`,"Manual batch registration",null,{ revision:1, profile },{db:tx});
    }
    let [doc] = await tx`SELECT * FROM fishery_documents WHERE source_id=${sourceId} AND canonical_url=${canonicalUrl} FOR UPDATE`;
    if (!doc) {
      [doc] = await tx`INSERT INTO fishery_documents(id,source_id,issuer,canonical_url) VALUES (${randomUUID()},${sourceId},${sourceAttribution},${canonicalUrl}) RETURNING *`;
      await audit(actor,"fishery.document",`fishery:${doc!.id}`,null,null,doc!,{db:tx});
    }
    if (doc!.withdrawn_reason) throw new Conflict("Document withdrawn; batch cannot restore it");
    const [previous] = await tx`SELECT revision,payload FROM fishery_observations WHERE document_id=${doc!.id} ORDER BY revision DESC LIMIT 1`;
    if (previous && evidenceIdentity({ ...previous.payload, expectedRevision:0 }) === evidenceIdentity({ ...payload, expectedRevision:0 })) return { id:doc!.id as string, revision:previous.revision as number, unchanged:true };
    const revision = (previous?.revision ?? 0) + 1;
    await tx`INSERT INTO fishery_observations(document_id,revision,actor,content_hash,payload) VALUES (${doc!.id},${revision},${actor},${hash(payload)},${tx.json(payload)})`;
    await audit(actor,"fishery.observe",`fishery:${doc!.id}`,"Manual captured batch; unreviewed",{revision:previous?.revision??0},{revision,contentHash:hash(payload)},{db:tx});
    return { id:doc!.id as string, revision, unchanged:false };
  });
}
export async function documentHistory(id: string) {
  const [document] = await sql`SELECT * FROM fishery_documents WHERE id = ${id}`;
  if (!document) throw new NotFound("Document not found");
  const observations = await sql`SELECT * FROM fishery_observations WHERE document_id = ${id} ORDER BY revision`;
  const reviews = await sql`SELECT * FROM fishery_reviews WHERE document_id = ${id} ORDER BY id`;
  return { document: Object.assign({}, document, sourceAttributionOf(document.issuer)), observations, reviews };
}

export async function recordCapturedAcquisition(columnId:string,canonicalUrl:string,record:{batchId:string;archiveId:string;outcome:"ready"|"irrelevant"|"unavailable";capture:unknown;relevance:unknown;reason:string},actor:string) {
  return capturedTransaction(columnId,async tx=>{
    const [document]=await tx`SELECT id FROM fishery_documents WHERE source_id=${`fishery-column-${columnId}`} AND canonical_url=${canonicalUrl} FOR UPDATE`;
    if(!document) return null;
    const subject=`fishery:${document.id}`;
    if(!(await tx`SELECT 1 FROM audit_log WHERE subject=${subject} AND action='fishery.acquisition' AND after->>'batchId'=${record.batchId} AND after->>'archiveId'=${record.archiveId} LIMIT 1`).length)
      await audit(actor,"fishery.acquisition",subject,record.outcome==="unavailable"?"Acquisition unavailable; no confirmed source-body change":"Verified archived acquisition result",null,record,{db:tx});
    return {documentId:String(document.id),...record};
  });
}
