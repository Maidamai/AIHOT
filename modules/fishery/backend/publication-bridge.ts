// A normal core material identity and editorial projection; qualification remains owned by the
// existing reviewers and is re-read on every publication query. This grants no redistribution right.
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { eligibleReaderItems } from "./reader.ts";
import { eligibleBusinessGuideItems, businessGuideReaderItem } from "./business-guides.ts";
import { hash } from "./store.ts";

type Projection = { kind: "article" | "business_guide"; id: string; documentId: string; title: string; summary: string; category: string; url: string; publicationTime: string | null; binding: string };

async function currentProjections(now: Date): Promise<Projection[]> {
  const articles = await eligibleReaderItems(now);
  const tasks = await sql`SELECT DISTINCT ON (document_id) document_id,id,snapshot,human_decision,draft,quality_review
    FROM fishery_flow_tasks WHERE document_id=ANY(${articles.map(item => item.id)}::text[]) ORDER BY document_id,created_at DESC,id DESC`;
  const taskBindings = new Map(tasks.map(task => [task.document_id, task]));
  const guides = await sql.begin(tx => eligibleBusinessGuideItems(tx, now));
  return [
    ...articles.map(item => ({ kind: "article" as const, id: item.id, documentId: item.id, title: item.title,
      summary: item.summary.map(s => s.sentence).join("\n"), category: item.category.id, url: item.source.url,
      publicationTime: item.dates.published.precision === "day" ? item.dates.published.value : null,
      binding: hash({ task: taskBindings.get(item.id), title: item.title, source: item.source, category: item.category, summary: item.summary, dates: item.dates, verification: item.verification }) })),
    ...guides.map(item => ({ kind: "business_guide" as const, id: item.id, documentId: item.documentId, title: item.payload.title.value,
      summary: item.payload.summary.map(s => s.value).join("\n"), category: "reference", url: item.source.url,
      publicationTime: item.payload.dates.published.value.precision === "day" ? item.payload.dates.published.value.value : null,
      binding: hash({ revision: item.revision, payload: item.payload, source: item.source, snapshot: item.snapshot, evidence: item.evidence, verifiedAt: item.verifiedAt }) })),
  ];
}

export async function fisheryPublicationCondition(now: Date) {
  const projections = await currentProjections(now);
  const bindings = await sql`SELECT * FROM fishery_publication_bindings`;
  const current = new Map(projections.map(p => [`${p.kind}:${p.id}`, p]));
  const allowed = bindings.filter(b => current.get(`${b.kind}:${b.item_id}`)?.binding === b.projection_hash).map(b => String(b.article_id));
  return { condition: sql`(
    NOT EXISTS (SELECT 1 FROM fishery_sources managed WHERE managed.source_id = p.source_id)
    AND NOT EXISTS (SELECT 1 FROM fishery_publication_bindings managed WHERE managed.article_id = p.article_id)
    OR (p.article_id = ANY(${allowed}::text[]) AND EXISTS (
      SELECT 1 FROM fishery_publication_bindings binding JOIN articles material ON material.id = binding.article_id
      JOIN fishery_documents document ON document.id = binding.document_id
      WHERE binding.article_id = p.article_id AND material.revision = binding.material_revision
        AND p.title = binding.title AND p.summary = binding.summary AND p.category = binding.category AND p.url = binding.url
        AND p.source_id = document.source_id AND material.source_id = document.source_id AND cardinality(p.tags) = 0
        AND p.body_mode = 'summary' AND NOT p.syndicate AND p.score IS NULL AND NOT p.selected)))` };
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
        publishedAt: projection.publicationTime ? new Date(`${projection.publicationTime}T00:00:00+08:00`) : null,
        bodyStatus: "none", via: "fishery-reviewed-publication", backfill: "reviewed-reference-archive",
        raw: { fisheryPublicationKind: projection.kind, fisheryPublicationId: projection.id, fisheryPublicationDocumentId: projection.documentId },
      }, tx);
      const [article] = await tx`SELECT revision FROM articles WHERE id=${material.articleId}`;
      const fields = { title: projection.title, summary: projection.summary, category: projection.category, relevance: "pass", score: null, selected: false, tags: [] };
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
