import { BUSINESS_TOPICS } from "../business-topics.ts";
import { beijingAt } from "@aihot/contracts/time";
import type postgres from "postgres";
// A normal core material identity and editorial projection; qualification remains owned by the
// existing reviewers and is re-read on every publication query. This grants no redistribution right.
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { eligibleReaderItems } from "./reader.ts";
import { eligibleBusinessGuideItems, businessGuideReaderItem } from "./business-guides.ts";
import { hash } from "./store.ts";

type Projection = { kind: "article" | "business_guide"; id: string; documentId: string; title: string; summary: string; category: string; tags: string[]; url: string; publicationTime: string | null; binding: string };

async function currentProjections(now: Date): Promise<Projection[]> {
  const articles = await eligibleReaderItems(now);
  const tasks = await sql`SELECT DISTINCT ON (document_id) document_id,id,snapshot,human_decision,draft,quality_review
    FROM fishery_flow_tasks WHERE document_id=ANY(${articles.map(item => item.id)}::text[]) ORDER BY document_id,created_at DESC,id DESC`;
  const taskBindings = new Map(tasks.map(task => [task.document_id, task]));
  const guides = await sql.begin(tx => eligibleBusinessGuideItems(tx, now));
  return [
    ...articles.map(item => ({ kind: "article" as const, id: item.id, documentId: item.id, title: item.title,
      summary: item.summary.map(s => s.sentence).join("\n"), category: item.category.id, tags: [], url: item.source.url,
      publicationTime: item.dates.published.precision === "day" ? item.dates.published.value : null,
      binding: hash({ task: taskBindings.get(item.id), title: item.title, source: item.source, category: item.category, summary: item.summary, dates: item.dates, verification: item.verification }) })),
    ...guides.map(item => {
      const topic = BUSINESS_TOPICS.find(topic => topic.id === item.payload.topicId);
      if (!topic) throw new Conflict("Reviewed guide topic is absent from the configured business topics");
      const tags = [topic.label, "资料"];
      return { kind: "business_guide" as const, id: item.id, documentId: item.documentId, title: item.payload.title.value,
      summary: item.payload.summary.map(s => s.value).join("\n"), category: "reference", tags, url: item.source.url,
      publicationTime: item.payload.dates.published.value.precision === "day" ? item.payload.dates.published.value.value : null,
      binding: hash({ tags, revision: item.revision, payload: item.payload, source: item.source, snapshot: item.snapshot, evidence: item.evidence, verifiedAt: item.verifiedAt }) };
    }),
  ];
}

// Opaque database-state token, not an alternative approval rule. Capture before canonical JS
// qualification and compare inside its final SQL statement so concurrent revocation fails closed.
function qualificationState(documentId: postgres.PendingQuery<postgres.Row[]>, kind: postgres.PendingQuery<postgres.Row[]>, itemId: postgres.PendingQuery<postgres.Row[]>) {
  return sql`encode(sha256(convert_to(jsonb_build_object(
    'document', (SELECT to_jsonb(d) FROM fishery_documents d WHERE d.id=${documentId}),
    'source', (SELECT jsonb_build_object('profile',to_jsonb(f),'name',s.name,'kind',s.kind,
      'participation',s.participation_mode,'tier',s.tier,'siteFulltext',s.site_fulltext,'syndicateFulltext',s.syndicate_fulltext)
      FROM fishery_documents d JOIN fishery_sources f ON f.source_id=d.source_id JOIN sources s ON s.id=d.source_id WHERE d.id=${documentId}),
    'observation', (SELECT to_jsonb(o) FROM fishery_observations o WHERE o.document_id=${documentId} ORDER BY o.revision DESC LIMIT 1),
    'materialReview', (SELECT to_jsonb(r) FROM fishery_reviews r WHERE r.document_id=${documentId} ORDER BY r.id DESC LIMIT 1),
    'task', (SELECT to_jsonb(t) FROM fishery_flow_tasks t WHERE t.document_id=${documentId} ORDER BY t.created_at DESC,t.id DESC LIMIT 1),
    'guide', (SELECT to_jsonb(g) FROM fishery_business_guides g WHERE ${kind}='business_guide' AND g.id=${itemId}),
    'guideAI', (SELECT jsonb_build_object('review',to_jsonb(a),'receipt',
      (SELECT jsonb_build_object('id',r.id,'status',r.status,'purpose',r.purpose,'subject',r.subject,'response',r.response) FROM receipts r WHERE r.id=a.receipt_id))
      FROM fishery_business_ai_reviews a WHERE ${kind}='business_guide' AND a.guide_id=${itemId} ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
    'linkedArticle', (SELECT jsonb_build_object('publication',to_jsonb(p),'sourceMode',s.participation_mode)
      FROM fishery_documents d JOIN publications p ON p.article_id=d.article_id JOIN sources s ON s.id=p.source_id WHERE d.id=${documentId}),
    'sourceArticle', (SELECT jsonb_build_object('material',to_jsonb(a),'publication',to_jsonb(p))
      FROM fishery_documents d JOIN articles a ON a.source_id=d.source_id AND (a.id=d.article_id OR a.raw->>'fisheryDocumentId'=d.id)
      LEFT JOIN publications p ON p.article_id=a.id WHERE d.id=${documentId} ORDER BY a.created_at DESC LIMIT 1)
  )::text,'UTF8')),'hex')`;
}

export async function fisheryPublicationCondition(now: Date) {
  const bindings = await sql`SELECT b.*,${qualificationState(sql`b.document_id`, sql`b.kind`, sql`b.item_id`)} AS qualification_state FROM fishery_publication_bindings b`;
  const projections = await currentProjections(now);
  const current = new Map(projections.map(p => [`${p.kind}:${p.id}`, p]));
  const allowed = bindings.filter(b => current.get(`${b.kind}:${b.item_id}`)?.binding === b.projection_hash).map(b => ({ article_id: String(b.article_id), state: b.qualification_state, projection_hash: b.projection_hash, tags: current.get(`${b.kind}:${b.item_id}`)!.tags }));
  return { condition: sql`(
    NOT EXISTS (SELECT 1 FROM fishery_sources managed WHERE managed.source_id = p.source_id)
    AND NOT EXISTS (SELECT 1 FROM fishery_publication_bindings managed WHERE managed.article_id = p.article_id)
    OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(${sql.json(allowed)}) approved(article_id text,state text,projection_hash text,tags text[])
      JOIN fishery_publication_bindings binding ON binding.article_id=approved.article_id
      JOIN articles material ON material.id = binding.article_id
      JOIN fishery_documents document ON document.id = binding.document_id
      WHERE binding.article_id = p.article_id AND material.revision = binding.material_revision
        AND binding.projection_hash=approved.projection_hash
        AND ${qualificationState(sql`binding.document_id`, sql`binding.kind`, sql`binding.item_id`)}=approved.state
        AND p.title = binding.title AND p.summary = binding.summary AND p.category = binding.category AND p.url = binding.url
        AND p.source_id = document.source_id AND material.source_id = document.source_id AND p.tags = approved.tags
        AND p.body_mode = 'summary' AND NOT p.syndicate AND p.score IS NULL AND NOT p.selected))` };
}

export async function allowFisheryUndatedArchive(articleId: string, db: Db): Promise<boolean> {
  return (await db`SELECT 1 FROM fishery_publication_bindings WHERE article_id=${articleId}`).length > 0;
}

/** Reversible local replay of already-qualified content, with ordinary material and editorial audit. */
export async function syncFisheryPublications(actor: string, now = new Date()) {
  const projections = await currentProjections(now), result = [];
  for (const projection of projections) {
    result.push(await sql.begin(async tx => {
      const [document] = await tx`SELECT source_id FROM fishery_documents WHERE id=${projection.documentId} FOR SHARE`;
      if (!document) throw new Conflict("Qualified source document disappeared");
      const [before] = await tx`SELECT * FROM fishery_publication_bindings WHERE kind=${projection.kind} AND item_id=${projection.id} FOR UPDATE`;
      const material = await upsertMaterial({ sourceId: document.source_id, url: projection.url, title: projection.title,
        identityKey: `fishery-publication:${projection.kind}:${projection.id}`, language: "zh", publicationTime: projection.publicationTime,
        publishedAt: projection.publicationTime ? beijingAt(projection.publicationTime, "00:00") : null,
        bodyStatus: "none", via: "fishery-reviewed-publication", backfill: "reviewed-reference-archive",
        raw: { fisheryPublicationKind: projection.kind, fisheryPublicationId: projection.id, fisheryPublicationDocumentId: projection.documentId },
      }, tx);
      const [article] = await tx`SELECT revision FROM articles WHERE id=${material.articleId}`;
      const fields = { title: projection.title, summary: projection.summary, category: projection.category, relevance: "pass", score: null, selected: false, tags: projection.tags };
      const [oldOverride] = await tx`SELECT fields,version FROM editorial_overrides WHERE article_id=${material.articleId}`;
      if (hash(oldOverride?.fields ?? null) !== hash(fields)) {
        await tx`INSERT INTO editorial_overrides(article_id,fields,reason,version,updated_by)
          VALUES (${material.articleId},${tx.json(fields)},'Existing reviewed fishery summary/reference projection',1,${actor})
          ON CONFLICT(article_id) DO UPDATE SET fields=EXCLUDED.fields,reason=EXCLUDED.reason,
            version=editorial_overrides.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()`;
        await audit(actor, "content.override", `content:${material.articleId}`, "Existing reviewed fishery summary/reference projection", oldOverride?.fields ?? null, fields, { db: tx });
      }
      await tx`INSERT INTO fishery_publication_bindings(kind,item_id,article_id,document_id,projection_hash,material_revision,title,summary,category,url,actor)
        VALUES (${projection.kind},${projection.id},${material.articleId},${projection.documentId},${projection.binding},${article!.revision},${projection.title},${projection.summary},${projection.category},${projection.url},${actor})
        ON CONFLICT(kind,item_id) DO UPDATE SET projection_hash=EXCLUDED.projection_hash,material_revision=EXCLUDED.material_revision,
          title=EXCLUDED.title,summary=EXCLUDED.summary,category=EXCLUDED.category,url=EXCLUDED.url,actor=EXCLUDED.actor,updated_at=now()`;
      // The source's full-body licence is separate from this reviewed summary projection.
      const publication = await publishArticleTx(tx, material.articleId, { now });
      if (!before || before.projection_hash !== projection.binding || before.material_revision !== article!.revision)
        await audit(actor, "fishery.publication.bridge", `content:${material.articleId}`, "Associate existing qualified material with core publication", before ?? null,
          { kind: projection.kind, itemId: projection.id, documentId: projection.documentId, projectionHash: projection.binding, materialRevision: article!.revision, selected: false, score: null }, { db: tx });
      return { kind: projection.kind, itemId: projection.id, articleId: material.articleId, eligible: publication !== null };
    }));
  }
  return { rows: result, modelCalls: 0 };
}

/** Safe structured details travel through the original item endpoint after its current read gate. */
export async function fisheryPublicationItemDetails(articleId: string) {
  const [binding] = await sql`SELECT item_id FROM fishery_publication_bindings WHERE article_id=${articleId} AND kind='business_guide'`;
  if (!binding) return null;
  try {
    const guide = await businessGuideReaderItem(binding.item_id);
    return { kind: "business_guide", guide: { ...guide, evidence: Object.fromEntries(Object.entries(guide.evidence)
      .map(([id, anchor]) => [id, { ...anchor, quote: anchor.quote.length > 240 ? `${anchor.quote.slice(0, 240)}…` : anchor.quote }])) } };
  }
  catch (error) { if (error instanceof Conflict || (error as { statusCode?: number }).statusCode === 404) return null; throw error; }
}
