import { enqueuePublication, publicationDecisionHash } from "./publication-queue.ts";
// Human editorial authorship with independent AI comparison and explicit final human approval.
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { sourceArticleAvailable } from "./source-availability.ts";
import { BUSINESS_TOPICS } from "../business-topics.ts";
import { projectBusinessTimeliness } from "../business-timeliness.ts";
import { businessGuidePayloadSchema, createBusinessGuideSchema, updateBusinessGuideSchema, decideBusinessGuideSchema,
  type BusinessGuideAIReview, type BusinessGuideContext, type BusinessGuidePayload, type BusinessGuideAdminRecord, type BusinessGuideReaderItem, type BusinessGuideReaderPage } from "../business-contracts.ts";
import { noticeEvidenceSections } from "./fujian-notices.ts";
import { buildEvidenceCatalog, type EvidenceCatalog } from "./evidence.ts";
import { readSourceBody } from "./source-body.ts";
import { hash, NotFound } from "./store.ts";
import { sha256 } from "./source-adapters.ts";

import { getCurrentGuideAIReview } from "./business-ai-review.ts";

const iso = (value: string | Date) => new Date(value).toISOString();

async function contextFor(documentId: string, db: Db): Promise<BusinessGuideContext> {
  const [doc] = await db`SELECT * FROM fishery_documents WHERE id=${documentId} FOR SHARE`;
  if (!doc) throw new NotFound("Business guide source document not found");
  if (doc.withdrawn_reason) throw new Conflict("Source document withdrawn");
  const [source] = await db`SELECT f.*,s.name,s.participation_mode FROM fishery_sources f JOIN sources s ON s.id=f.source_id WHERE f.source_id=${doc.source_id} FOR SHARE OF f`;
  if (source?.participation_mode === "isolated") throw new Conflict("Source is isolated; guide processing is disabled");
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
    if (!await sourceArticleAvailable(doc.article_id, db)) throw new Conflict("Linked article unavailable");
  }
  let body: string | null;
  try { body = await readSourceBody(capture); }
  catch (error) { throw new Conflict(`Source body unavailable: ${(error as Error).message}`); }
  if (!body && !capture.archiveId && !capture.manualArchiveId) {
    const [article] = await db`SELECT body_text FROM articles WHERE source_id=${doc.source_id} AND (id=${doc.article_id} OR raw->>'fisheryDocumentId'=${documentId}) ORDER BY created_at DESC LIMIT 1`;
    body = article?.body_text ?? null;
  }
  if (!body || sha256(body) !== capture.bodySha256) throw new Conflict("Complete archived body missing or changed");
  let sections: EvidenceCatalog["sections"];
  try { sections = capture.adapter === "fujian-notices" ? noticeEvidenceSections(body, capture) : undefined; }
  catch (error) { throw new Conflict(`Business evidence unavailable: ${(error as Error).message}`); }
  let pages: { page: number; text: string }[] | undefined;
  if (!sections && capture.attachmentPages) {
    const markers = [...body.matchAll(/^--- Page (\d+) ---\r?\n/gm)];
    if (markers.length !== capture.attachmentPages || markers.some((m, i) => Number(m[1]) !== i + 1)) throw new Conflict("PDF coverage incomplete");
    pages = markers.map((m, i) => ({ page: i + 1, text: body.slice(m.index! + m[0].length, markers[i + 1]?.index ?? body.length).trim() }));
  }
  let catalog: EvidenceCatalog;
  try { catalog = buildEvidenceCatalog({ body, bodySha256: capture.bodySha256, observationRevision: observation.revision, pages, sections }); }
  catch (error) { throw new Conflict(`Business evidence unavailable: ${(error as Error).message}`); }
  const snapshot: BusinessGuideContext["snapshot"] = {
    version: "fishery-business-guide/1", documentId, sourceId: doc.source_id, articleId: doc.article_id, canonicalUrl: doc.canonical_url, sourceRevision: source.revision, sourceProfileHash: hash(source.profile),
    observationRevision: observation.revision, observationHash: observation.content_hash, rawSha256: capture.rawSha256, bodySha256: capture.bodySha256,
    materialReviewId: review.id, materialReviewHash: hash(review), catalogHash: catalog.hash, catalogVersion: catalog.version,
  };
  return { documentId, snapshot, snapshotHash: hash(snapshot), catalog, source: { name: source.name, url: doc.canonical_url, originalTitle: observation.payload.originalTitle,
    published: observation.payload.dates.published, publishedAt: capture.publishedAt ?? null, publicationLiteral: capture.publicationLiteral ?? null, capturedAt: capture.capturedAt } };
}

export async function businessGuideContext(documentId: string, db: Db = sql) {
  return db === sql ? sql.begin(tx => contextFor(documentId, tx)) : contextFor(documentId, db);
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
    const chinese = `${parts[0]}\\s*年` + (parts.length > 1 ? `\\s*${parts[1]}\\s*月` : "") + (parts.length > 2 ? `\\s*${parts[2]}\\s*日` : "");
    if (!field.evidence.some(id => { const quote = spans.get(id)!.quote; return new RegExp(`(?<!\\d)${value}(?!\\d)`).test(quote) || new RegExp(`(?<!\\d)${chinese}`).test(quote); }))
      throw new Conflict("Date must have its complete original literal in one selected source span; do not borrow or combine dates");
  }
  const timeliness = projectBusinessTimeliness(payload.dates, new Date());
  if (timeliness.deadline.state === "elapsed" || timeliness.expiry.state === "elapsed") {
    const fields = [payload.title.value, ...payload.summary.map(s => s.value), ...[payload.audience, payload.opportunity, payload.restrictions, payload.materials, ...Object.values(payload.applicability)].flatMap(f => f.state === "documented" ? [f.value] : [])];
    for (const text of fields) for (const clause of text.split(/[。！？；，\n]/)) {
      const historical = /^\s*(?:原公告|原通知|原文)(?:当时|发布时)/.test(clause);
      const claims = clause.matchAll(/正在申报|当前开放申报|申报窗口已开放|目前正在受理|现行有效(?!性)/g);
      for (const claim of claims) {
        const prefix = clause.slice(0, claim.index);
        if (historical && !/但|然而|如今|现今|现在|今日|目前|当前/.test(prefix)) continue;
        if (!/(?:并非|不是|不再|不能认定为?|尚未核实为?|是否)\s*$/.test(prefix))
          throw new Conflict("Elapsed source deadline or expiry cannot support an unqualified current application window or validity claim");
      }
    }
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
function editorialRevision(row: Record<string, any>): number {
  const human = row.human_decision;
  return row.status === "approved" && human?.mode === "final" && human.revision === row.revision && Number.isInteger(human.aiEditorialRevision)
    ? human.aiEditorialRevision : row.revision;
}
async function currentAIReview(row: Record<string, any>, db: Db = sql): Promise<BusinessGuideAIReview> {
  try {
    const ai = await getCurrentGuideAIReview(row.id, { payloadHash: row.payload_hash, snapshotHash: row.snapshot_hash, editorialRevision: editorialRevision(row) }, db);
    return { current: ai.current, pass: ai.pass, status: ai.status, reviewHash: ai.reviewHash, receiptId: ai.receiptId ?? null, guideRevision: ai.guideRevision ?? null, confirmedConflict: ai.confirmedConflict };
  } catch { return { current: false, pass: false, status: "unavailable", reviewHash: null, receiptId: null, guideRevision: null, confirmedConflict: false }; }
}
async function currentReadable(row: Record<string, any>, db: Db, aiReview?: BusinessGuideAIReview): Promise<BusinessGuideContext> {
  assertStored(row);
  if (row.status !== "approved" || !row.verified_at || row.human_decision?.decision !== "approved" || row.human_decision.payloadHash !== row.payload_hash || row.human_decision.snapshotHash !== row.snapshot_hash || row.human_decision.revision !== row.revision)
    throw new Conflict("Business guide is not currently approved");
  const context = await contextFor(row.document_id, db);
  if (context.snapshotHash !== row.snapshot_hash) throw new Conflict("Source evidence or ordinary material review changed; business approval is stale");
  validateBusinessGuidePayload(row.payload, context);
  const ai = aiReview ?? await currentAIReview(row, db), human = row.human_decision;
  if (!ai.current || !ai.pass || !ai.reviewHash || human.mode !== "final" || human.aiReviewHash !== ai.reviewHash || human.aiEditorialRevision !== ai.guideRevision)
    throw new Conflict("Current AI comparison and matching final human approval required");
  return context;
}
async function adminRecord(row: Record<string, any>, db: Db): Promise<BusinessGuideAdminRecord> {
  let blockedReason: string | null = null;
  const aiReview = await currentAIReview(row, db);
  try { await currentReadable(row, db, aiReview); } catch (error) { blockedReason = (error as Error).message; }
  return { id: row.id, documentId: row.document_id, revision: row.revision, status: row.status, snapshot: row.snapshot, snapshotHash: row.snapshot_hash,
    payload: row.payload, payloadHash: row.payload_hash, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), verifiedAt: row.verified_at ? iso(row.verified_at) : null,
    aiReview, humanDecision: row.human_decision, readable: blockedReason === null, blockedReason };
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
    let ai: BusinessGuideAIReview | null = null;
    if (data.decision === "approved") {
      const context = await contextFor(before.document_id, tx);
      if (context.snapshotHash !== before.snapshot_hash) throw new Conflict("Source or material review changed; save a new draft first");
      validateBusinessGuidePayload(before.payload, context);
      if (!data.aiReviewHash) throw new Conflict("Final approval requires the current AI review hash");
      ai = await currentAIReview(before, tx);
      if (!ai.current || !ai.pass || !ai.reviewHash || ai.reviewHash !== data.aiReviewHash || ai.guideRevision !== editorialRevision(before))
        throw new Conflict("Current passing AI comparison required before final human approval");
    }
    const at = new Date().toISOString(), decision = { decision: data.decision, executorKind: data.executorKind, actor, at, reason: data.reason, revision: before.revision + 1, payloadHash: before.payload_hash, snapshotHash: before.snapshot_hash, ...(ai ? { mode: data.approvalMode, aiReviewHash: ai.reviewHash!, aiEditorialRevision: ai.guideRevision! } : {}) };
    const [row] = await tx`UPDATE fishery_business_guides SET revision=revision+1,status=${data.decision},human_decision=${tx.json(decision)},
      verified_at=${data.decision === "approved" ? at : null},actor=${actor},updated_at=now() WHERE id=${id} RETURNING *`;
    if (data.decision === "approved") await enqueuePublication({ kind: "business_guide", itemId: id, decisionId: id, decisionHash: publicationDecisionHash(decision, row!.revision), actor }, tx);
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

export async function eligibleBusinessGuideItems(db: Db, now: Date, onlyId: string | null = null): Promise<BusinessGuideReaderItem[]> {
  const rows = await db`SELECT * FROM fishery_business_guides WHERE status='approved' AND (${onlyId}::text IS NULL OR id=${onlyId}) ORDER BY updated_at DESC,id FOR SHARE`, items: BusinessGuideReaderItem[] = [];
  for (const row of rows) {
    let context: BusinessGuideContext;
    try { context = await currentReadable(row, db); } catch (error) { if (error instanceof Conflict || error instanceof NotFound) continue; throw error; }
    const ids = new Set(evidenceIds(row.payload)), capture = context.catalog.pages.length > 0;
    const [observation] = await db`SELECT payload FROM fishery_observations WHERE document_id=${row.document_id} AND revision=${context.snapshot.observationRevision}`;
    const attachmentUrl = observation?.payload.sourceCapture?.attachmentUrl;
    items.push({ id: row.id, documentId: row.document_id, revision: row.revision, payload: row.payload, source: context.source, snapshot: context.snapshot,
      evidence: Object.fromEntries(context.catalog.spans.filter(s => ids.has(s.id)).map(s => [s.id, { quote: s.quote, paragraph: s.paragraph, page: s.page, url: s.source?.url ?? (capture && s.page !== null && attachmentUrl ? attachmentUrl : context.source.url), ...(s.source ? { sourceId: s.source.id, sha256: s.source.sha256 } : {}) }])),
      verifiedAt: iso(row.verified_at), timeliness: projectBusinessTimeliness(row.payload.dates, now), qualification: { status: "qualified", label: "AI对照核查及最终审核通过" }, verification: { executorKind: ["human", "authorized_agent"].includes(row.human_decision?.executorKind) ? row.human_decision.executorKind : "unspecified", origin: "human_editorial", aiStatus: "passed", label: "编审整理，经AI对照核查及最终审核的内部信息参考；不构成申请或捕捞资格判断", legalApplicability: "not_determined" },
      eligibility: { canApply: null, canFish: null }, internalOnly: true });
  }
  return items;
}
export async function businessGuideReaderPage(query: { topicId?: string; kind?: string; page?: number } = {}, now = new Date()): Promise<BusinessGuideReaderPage> {
  return sql.begin(async tx => {
    const all = await eligibleBusinessGuideItems(tx, now), filtered = all.filter(i => (!query.topicId || i.payload.topicId === query.topicId) && (!query.kind || i.payload.kind === query.kind));
    const limit = 20, page = Math.min(Math.max(1, query.page ?? 1), Math.max(1, Math.ceil(filtered.length / limit)));
    return { rows: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit, internalOnly: true,
      topics: BUSINESS_TOPICS.map(t => { const count = all.filter(i => i.payload.topicId === t.id && (!query.kind || i.payload.kind === query.kind)).length; return { id: t.id, label: t.label, firstRelease: t.firstRelease, count, emptyMessage: count ? null : "待补充经人工审核的正式依据与适用信息" }; }) };
  });
}
export async function businessGuideReaderItem(id: string, now = new Date()) {
  return sql.begin(async tx => { const item = (await eligibleBusinessGuideItems(tx, now)).find(i => i.id === id); if (!item) throw new NotFound("No current approved business information"); return item; });
}
