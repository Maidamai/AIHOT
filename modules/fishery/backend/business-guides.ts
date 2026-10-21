// Human editorial records; independent of model tasks, receipts and publication permissions.
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { itemAvailability } from "@aihot/backend/publication/availability";
import { BUSINESS_TOPICS } from "../business-topics.ts";
import { businessGuidePayloadSchema, createBusinessGuideSchema, updateBusinessGuideSchema, decideBusinessGuideSchema,
  type BusinessGuideContext, type BusinessGuidePayload, type BusinessGuideAdminRecord, type BusinessGuideReaderItem, type BusinessGuideReaderPage } from "../business-contracts.ts";
import { buildEvidenceCatalog, type EvidenceCatalog } from "./evidence.ts";
import { readSourceBody } from "./source-body.ts";
import { hash, NotFound } from "./store.ts";
import { sha256 } from "./source-adapters.ts";

const iso = (value: string | Date) => new Date(value).toISOString();

async function contextFor(documentId: string, db: Db): Promise<BusinessGuideContext> {
  const [doc] = await db`SELECT * FROM fishery_documents WHERE id=${documentId} FOR SHARE`;
  if (!doc) throw new NotFound("Business guide source document not found");
  if (doc.withdrawn_reason) throw new Conflict("Source document withdrawn");
  const [source] = await db`SELECT f.*,s.name FROM fishery_sources f JOIN sources s ON s.id=f.source_id WHERE f.source_id=${doc.source_id} FOR SHARE OF f`;
  const [observation] = await db`SELECT * FROM fishery_observations WHERE document_id=${documentId} ORDER BY revision DESC LIMIT 1`;
  const [review] = await db`SELECT * FROM fishery_reviews WHERE document_id=${documentId} ORDER BY id DESC LIMIT 1`;
  if (!source || !observation || !review || review.decision !== "approved" || review.revision !== observation.revision || review.source_revision !== source.revision)
    throw new Conflict("Current source observation requires ordinary material approval");
  if (/^(?:ISOLATED TEST|Synthetic fixture|SYNTHETIC TEST)/.test(source.profile.attribution ?? "") || /^ISOLATED TEST/.test(doc.issuer))
    throw new Conflict("Synthetic test materials cannot enter business reading");
  const capture = observation.payload.sourceCapture;
  if (!capture || capture.httpStatus !== 200 || capture.parseStatus !== "parsed" || !capture.bodySha256 || capture.conflicts.length)
    throw new Conflict("Parsed, complete source capture required");
  if (doc.article_id) {
    const available = (await itemAvailability([doc.article_id]))[doc.article_id];
    if (!available || !["public", "summary-only"].includes(available.status)) throw new Conflict("Linked article unavailable");
  }
  let body: string | null;
  try { body = await readSourceBody(capture); }
  catch (error) { throw new Conflict(`Source body unavailable: ${(error as Error).message}`); }
  if (!body && !capture.archiveId && !capture.manualArchiveId) {
    const [article] = await db`SELECT body_text FROM articles WHERE source_id=${doc.source_id} AND (id=${doc.article_id} OR raw->>'fisheryDocumentId'=${documentId}) ORDER BY created_at DESC LIMIT 1`;
    body = article?.body_text ?? null;
  }
  if (!body || sha256(body) !== capture.bodySha256) throw new Conflict("Complete archived body missing or changed");
  let pages: { page: number; text: string }[] | undefined;
  if (capture.attachmentPages) {
    const markers = [...body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
    if (markers.length !== capture.attachmentPages || markers.some((m, i) => Number(m[1]) !== i + 1)) throw new Conflict("PDF coverage incomplete");
    pages = markers.map((m, i) => ({ page: i + 1, text: body.slice(m.index! + m[0].length, markers[i + 1]?.index ?? body.length).trim() }));
  }
  let catalog: EvidenceCatalog;
  try { catalog = buildEvidenceCatalog({ body, bodySha256: capture.bodySha256, observationRevision: observation.revision, pages }); }
  catch (error) { throw new Conflict(`Business evidence unavailable: ${(error as Error).message}`); }
  const snapshot: BusinessGuideContext["snapshot"] = {
    version: "fishery-business-guide/1", documentId, sourceId: doc.source_id, articleId: doc.article_id, canonicalUrl: doc.canonical_url, sourceRevision: source.revision, sourceProfileHash: hash(source.profile),
    observationRevision: observation.revision, observationHash: observation.content_hash, rawSha256: capture.rawSha256, bodySha256: capture.bodySha256,
    materialReviewId: review.id, materialReviewHash: hash(review), catalogHash: catalog.hash, catalogVersion: catalog.version,
  };
  return { documentId, snapshot, snapshotHash: hash(snapshot), catalog, source: { name: source.name, url: doc.canonical_url, originalTitle: observation.payload.originalTitle,
    published: observation.payload.dates.published, publishedAt: capture.publishedAt ?? null, publicationLiteral: capture.publicationLiteral ?? null, capturedAt: capture.capturedAt } };
}

export async function businessGuideContext(documentId: string) {
  return sql.begin(tx => contextFor(documentId, tx));
}

function evidenceIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => key === "evidence" ? child as string[] : Array.isArray(child) ? child.flatMap(evidenceIds) : evidenceIds(child));
}

export function validateBusinessGuidePayload(input: unknown, context: Pick<BusinessGuideContext, "catalog">): BusinessGuidePayload {
  const payload = businessGuidePayloadSchema.parse(input), spans = new Map(context.catalog.spans.map(s => [s.id, s]));
  for (const id of evidenceIds(payload)) if (!spans.has(id)) throw new Conflict(`Evidence ID ${id} absent from current source catalog`);
  for (const field of Object.values(payload.dates)) {
    if (field.value.precision === "unknown") continue;
    const value = field.value.value, parts = value.split("-").map(Number);
    const chinese = `${parts[0]}年` + (parts.length > 1 ? `${parts[1]}月` : "") + (parts.length > 2 ? `${parts[2]}日` : "");
    if (!field.evidence.some(id => { const quote = spans.get(id)!.quote; return new RegExp(`(?<!\\d)${value}(?!\\d)`).test(quote) || new RegExp(`(?<!\\d)${chinese}`).test(quote); }))
      throw new Conflict("Date must have its complete original literal in one selected source span; do not borrow or combine dates");
  }
  if (payload.serviceEntry.state === "documented") {
    const expected = payload.serviceEntry.url;
    const explicit = payload.serviceEntry.evidence.some(id => [...spans.get(id)!.quote.matchAll(/https:\/\/[^\s<>）。，、；"']+/g)].some(m => {
      try { return new URL(m[0]).href === expected; } catch { return false; }
    }));
    if (!explicit) throw new Conflict("Service entry needs an explicit URL in current source evidence; source URL is not an application entry");
  }
  for (const relation of payload.relations) {
    const quotes = relation.evidence.map(id => spans.get(id)!.quote);
    if (!quotes.some(quote => quote.includes(relation.title))) throw new Conflict("Related document title must be literal in selected source evidence");
    const wording = { amends: /修改|修订|amend/i, repeals: /废止|废除|repeal|revok/i, interprets: /解释|解读|interpret/i, supersedes: /代替|替代|取代|supersed|replace/i };
    if (!quotes.some(quote => wording[relation.type].test(quote)) || relation.type === "repeals" && quotes.some(quote => /(?:不|未|并非|不是).{0,6}(?:废止|废除)|\bnot\b.{0,20}(?:repeal|revok)/i.test(quote)))
      throw new Conflict("Related document operation needs explicit matching evidence; amendment is not wholesale repeal");
    if (relation.url && !quotes.some(quote => quote.includes(relation.url!))) throw new Conflict("Related document URL unknown; do not invent an older link");
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > 24000) throw new Conflict("Guide payload exceeds short internal information capacity");
  return payload;
}

function assertStored(row: Record<string, any>) {
  if (hash(row.snapshot) !== row.snapshot_hash || hash(row.payload) !== row.payload_hash) throw new Conflict("Stored business guide hash mismatch");
}
async function currentReadable(row: Record<string, any>, db: Db): Promise<BusinessGuideContext> {
  assertStored(row);
  if (row.status !== "approved" || !row.verified_at || row.human_decision?.decision !== "approved" || row.human_decision.payloadHash !== row.payload_hash || row.human_decision.snapshotHash !== row.snapshot_hash || row.human_decision.revision !== row.revision)
    throw new Conflict("Business guide is not currently approved");
  const context = await contextFor(row.document_id, db);
  if (context.snapshotHash !== row.snapshot_hash) throw new Conflict("Source evidence or ordinary material review changed; business approval is stale");
  validateBusinessGuidePayload(row.payload, context);
  return context;
}
async function adminRecord(row: Record<string, any>, db: Db): Promise<BusinessGuideAdminRecord> {
  let blockedReason: string | null = null;
  try { await currentReadable(row, db); } catch (error) { blockedReason = (error as Error).message; }
  return { id: row.id, documentId: row.document_id, revision: row.revision, status: row.status, snapshot: row.snapshot, snapshotHash: row.snapshot_hash,
    payload: row.payload, payloadHash: row.payload_hash, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), verifiedAt: row.verified_at ? iso(row.verified_at) : null,
    humanDecision: row.human_decision, readable: blockedReason === null, blockedReason };
}
async function lockGuide(id: string, db: Db) {
  const [row] = await db`SELECT * FROM fishery_business_guides WHERE id=${id} FOR UPDATE`;
  if (!row) throw new NotFound("Business guide not found");
  return row;
}

export async function createBusinessGuide(input: unknown, actor: string) {
  const data = createBusinessGuideSchema.parse(input);
  return sql.begin(async tx => {
    const context = await contextFor(data.documentId, tx);
    if (context.snapshotHash !== data.snapshotHash) throw new Conflict("Source evidence changed before save");
    const payload = validateBusinessGuidePayload(data.payload, context);
    const [row] = await tx`INSERT INTO fishery_business_guides(id,document_id,revision,status,snapshot,snapshot_hash,payload,payload_hash,actor)
      VALUES(${randomUUID()},${data.documentId},1,'draft',${tx.json(context.snapshot as never)},${context.snapshotHash},${tx.json(payload)},${hash(payload)},${actor}) RETURNING *`;
    await audit(actor, "fishery.business.create", `business-guide:${row!.id}`, data.reason, null, row!, { db: tx });
    return adminRecord(row!, tx);
  });
}
export async function updateBusinessGuide(id: string, input: unknown, actor: string) {
  const data = updateBusinessGuideSchema.parse(input);
  return sql.begin(async tx => {
    const before = await lockGuide(id, tx);
    if (before.status === "withdrawn") throw new Conflict("Withdrawn guide is immutable; retain history and create a new draft");
    if (before.revision !== data.expectedRevision) throw new Conflict("Guide changed; reload before editing");
    const context = await contextFor(before.document_id, tx);
    if (context.snapshotHash !== data.snapshotHash) throw new Conflict("Source evidence changed before edit");
    const payload = validateBusinessGuidePayload(data.payload, context);
    const [row] = await tx`UPDATE fishery_business_guides SET revision=revision+1,status='draft',snapshot=${tx.json(context.snapshot as never)},snapshot_hash=${context.snapshotHash},
      payload=${tx.json(payload)},payload_hash=${hash(payload)},human_decision=NULL,verified_at=NULL,actor=${actor},updated_at=now() WHERE id=${id} RETURNING *`;
    await audit(actor, "fishery.business.update", `business-guide:${id}`, data.reason, before, row!, { db: tx });
    return adminRecord(row!, tx);
  });
}
export async function decideBusinessGuide(id: string, input: unknown, actor: string) {
  const data = decideBusinessGuideSchema.parse(input);
  return sql.begin(async tx => {
    const before = await lockGuide(id, tx); assertStored(before);
    if (before.status === "withdrawn") throw new Conflict("Withdrawn guide cannot be restored");
    if (before.revision !== data.expectedRevision || before.payload_hash !== data.payloadHash || before.snapshot_hash !== data.snapshotHash)
      throw new Conflict("Guide revision, payload or snapshot changed; reload before decision");
    if (data.decision === "approved") {
      const context = await contextFor(before.document_id, tx);
      if (context.snapshotHash !== before.snapshot_hash) throw new Conflict("Source or material review changed; save a new draft first");
      validateBusinessGuidePayload(before.payload, context);
    }
    const at = new Date().toISOString(), decision = { decision: data.decision, actor, at, reason: data.reason, revision: before.revision + 1, payloadHash: before.payload_hash, snapshotHash: before.snapshot_hash };
    const [row] = await tx`UPDATE fishery_business_guides SET revision=revision+1,status=${data.decision},human_decision=${tx.json(decision)},
      verified_at=${data.decision === "approved" ? at : null},actor=${actor},updated_at=now() WHERE id=${id} RETURNING *`;
    await audit(actor, "fishery.business.decision", `business-guide:${id}`, data.reason, before, row!, { db: tx });
    return adminRecord(row!, tx);
  });
}
export async function businessGuideAdminDetail(id: string) {
  return sql.begin(async tx => { const [row] = await tx`SELECT * FROM fishery_business_guides WHERE id=${id} FOR SHARE`; if (!row) throw new NotFound("Business guide not found"); return adminRecord(row, tx); });
}
export async function listBusinessGuides() {
  return sql.begin(async tx => { const rows = await tx`SELECT * FROM fishery_business_guides ORDER BY updated_at DESC,id FOR SHARE`; const result = []; for (const row of rows) result.push(await adminRecord(row, tx)); return result; });
}
export async function businessGuideHistory(id: string) {
  await businessGuideAdminDetail(id);
  return sql`SELECT id,actor,action,reason,before,after,created_at FROM audit_log WHERE subject=${`business-guide:${id}`} ORDER BY id`;
}

async function readableItems(db: Db): Promise<BusinessGuideReaderItem[]> {
  const rows = await db`SELECT * FROM fishery_business_guides WHERE status='approved' ORDER BY updated_at DESC,id FOR SHARE`, items: BusinessGuideReaderItem[] = [];
  for (const row of rows) {
    let context: BusinessGuideContext;
    try { context = await currentReadable(row, db); } catch (error) { if (error instanceof Conflict || error instanceof NotFound) continue; throw error; }
    const ids = new Set(evidenceIds(row.payload)), capture = context.catalog.pages.length > 0;
    const [observation] = await db`SELECT payload FROM fishery_observations WHERE document_id=${row.document_id} AND revision=${context.snapshot.observationRevision}`;
    const attachmentUrl = observation?.payload.sourceCapture?.attachmentUrl;
    items.push({ id: row.id, documentId: row.document_id, revision: row.revision, payload: row.payload, source: context.source, snapshot: context.snapshot,
      evidence: Object.fromEntries(context.catalog.spans.filter(s => ids.has(s.id)).map(s => [s.id, { quote: s.quote, paragraph: s.paragraph, page: s.page, url: capture && s.page !== null && attachmentUrl ? attachmentUrl : context.source.url }])),
      verifiedAt: iso(row.verified_at), verification: { origin: "human_editorial", label: "人工编审的内部信息参考；不构成申请或捕捞资格判断", legalApplicability: "not_determined" },
      eligibility: { canApply: null, canFish: null }, internalOnly: true });
  }
  return items;
}
export async function businessGuideReaderPage(query: { topicId?: string; kind?: string; page?: number } = {}): Promise<BusinessGuideReaderPage> {
  return sql.begin(async tx => {
    const all = await readableItems(tx), filtered = all.filter(i => (!query.topicId || i.payload.topicId === query.topicId) && (!query.kind || i.payload.kind === query.kind));
    const limit = 20, page = Math.min(Math.max(1, query.page ?? 1), Math.max(1, Math.ceil(filtered.length / limit)));
    return { rows: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit, internalOnly: true,
      topics: BUSINESS_TOPICS.map(t => { const count = all.filter(i => i.payload.topicId === t.id && (!query.kind || i.payload.kind === query.kind)).length; return { id: t.id, label: t.label, firstRelease: t.firstRelease, count, emptyMessage: count ? null : "待补充经人工审核的正式依据与适用信息" }; }) };
  });
}
export async function businessGuideReaderItem(id: string) {
  return sql.begin(async tx => { const item = (await readableItems(tx)).find(i => i.id === id); if (!item) throw new NotFound("No current approved business information"); return item; });
}
