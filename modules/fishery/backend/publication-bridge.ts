import type { ReferenceMetadata } from "@aihot/contracts/site";
import { projectBusinessTimeliness } from "../business-timeliness.ts";
import { publicationDecisionCurrent, type PublicationJob } from "./publication-queue.ts";
import { CATEGORIES } from "@aihot/industry/taxonomy";
import { BUSINESS_TOPICS } from "../business-topics.ts";
import { beijingAt, beijingDate } from "@aihot/contracts/time";
import type postgres from "postgres";
// A normal core material identity and editorial projection; qualification remains owned by the
// existing reviewers and is re-read on every publication query. This grants no redistribution right.
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { eligibleReaderItems } from "./reader.ts";
import { eligibleBusinessGuideItems, businessGuideReaderItem } from "./business-guides.ts";
import { lockDocument, hash } from "./store.ts";

type Projection = { reference?: ReferenceMetadata; kind: "article" | "business_guide"; id: string; documentId: string; title: string; summary: string; category: string; tags: string[]; score: number | null; url: string; publicationTime: string | null; binding: string };

async function currentProjections(now: Date, db: Db = sql, target?: { kind: "article" | "business_guide"; id: string }): Promise<Projection[]> {
  const articles = target?.kind === "business_guide" ? [] : (await eligibleReaderItems(now)).filter(item => !target || item.id === target.id);
  const tasks = await db`SELECT DISTINCT ON (t.document_id) t.document_id,t.id,t.snapshot,t.human_decision,t.draft,t.quality_review,t.selection,
    EXISTS (SELECT 1 FROM articles a JOIN fishery_documents d ON d.id=t.document_id
      WHERE a.source_id=d.source_id AND a.url=d.canonical_url AND a.raw->>'fisheryDocumentId'=d.id AND a.raw->>'mode'='verified-news-candidate') AS news
    FROM fishery_flow_tasks t WHERE t.document_id=ANY(${articles.map(item => item.id)}::text[]) ORDER BY t.document_id,t.created_at DESC,t.id DESC`;
  const taskBindings = new Map(tasks.map(task => [task.document_id, task]));
  const guides = target?.kind === "article" ? [] : db === sql
    ? await sql.begin(tx => eligibleBusinessGuideItems(tx, now, target?.id ?? null))
    : await eligibleBusinessGuideItems(db, now, target?.id ?? null);
  return [
    ...articles.flatMap(item => {
      const { selection, news, ...task } = taskBindings.get(item.id)!;
      const outcome = selection?.outcome;
      const score = news && outcome?.label === "SCORED" && outcome.attentionCandidate && Number.isInteger(outcome.average) ? outcome.average : null;
      // Preserve the approved news score, without inventing the missing core fact/grouping decision.
      if (news && score === null) return [];
      return [{ kind: "article" as const, id: item.id, documentId: item.id, title: item.title,
        summary: item.summary.map(s => s.sentence).join("\n"), category: item.category.id, tags: [CATEGORIES.find(c=>c.key===item.category.id)!.label], score, url: item.source.url,
        publicationTime: item.dates.published.precision === "day" ? item.dates.published.value : null,
        binding: hash({ task, title: item.title, source: item.source, category: item.category, summary: item.summary, dates: item.dates, verification: item.verification, ...(news ? { selection } : {}) }) }];
    }),
    ...guides.map(item => {
      const topic = BUSINESS_TOPICS.find(topic => topic.id === item.payload.topicId);
      if (!topic) throw new Conflict("Reviewed guide topic is absent from the configured business topics");
      const tags = [topic.label, "资料"];
      const time = projectBusinessTimeliness(item.payload.dates, now);
      const dateLabels = { published: "原文发布日期", effectiveFrom: "文载生效日期", deadline: "办理截止日期", expiresAt: "文载失效日期" };
      const fromMetadata = item.payload.dates.published.value.precision === "unknown" && item.source.published.precision !== "unknown";
      const published = fromMetadata ? item.source.published : item.payload.dates.published.value;
      const dates = Object.entries(item.payload.dates).map(([key, field]) => key === "published" && fromMetadata
        ? `来源元数据发布日期：${published.value}（${published.precision}；正文日期证据未核实）`
        : `${dateLabels[key as keyof typeof dateLabels]}：${field.value.value ?? "未知"}（${field.value.precision}）`).join("；");
      const nature = item.payload.documentStatus.value === "formal" ? "正式文件" : item.payload.documentStatus.value === "consultation" ? "征求意见稿" : "未知";
      const notice = `读取时状态（对照${beijingDate(now)}，${time.timeZone}）：${time.label}；${dates}；文件性质：${nature}；法律效力未知，办理截止不等于政策废止；${item.qualification.label}。核查时间和采集时间均不是原文发布日期。`;
      return { reference: { kind: "business_guide" as const, checkedAt: time.checkedAt, deadlineDate: time.deadline.lastDate, expiryDate: time.expiry.lastDate,
        lifecycle: { timeZone: time.timeZone, dates: item.payload.dates, documentStatus: item.payload.documentStatus,
          deadlinePassed: time.deadline.state === "unknown" ? null : time.deadline.state === "elapsed",
          policyExpired: time.expiry.state === "unknown" ? null : time.expiry.state === "elapsed",
          applicationStatus: "unknown" as const, legalValidity: "unknown" as const, verifiedAt: item.verifiedAt,
          qualification: item.qualification, evidence: Object.fromEntries(Object.entries(item.evidence).map(([id, anchor]) => [id, { ...anchor, quote: anchor.quote.slice(0, 240) }])), notice } }, kind: "business_guide" as const, id: item.id, documentId: item.documentId, title: item.payload.title.value,
      summary: item.payload.summary.map(s => s.value).join("\n"), category: "reference", tags, score: null, url: item.source.url,
      publicationTime: published.precision === "day" ? published.value : null,
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

export async function fisheryPublicationCondition(now: Date, db: Db = sql) {
  const bindings = await db`SELECT b.*,${qualificationState(sql`b.document_id`, sql`b.kind`, sql`b.item_id`)} AS qualification_state FROM fishery_publication_bindings b`;
  const projections = await currentProjections(now, db);
  const current = new Map(projections.map(p => [`${p.kind}:${p.id}`, p]));
  const allowed = bindings.filter(b => current.get(`${b.kind}:${b.item_id}`)?.binding === b.projection_hash).map(b => ({ article_id: String(b.article_id), state: b.qualification_state, projection_hash: b.projection_hash, score: current.get(`${b.kind}:${b.item_id}`)!.score, tags: current.get(`${b.kind}:${b.item_id}`)!.tags }));
  return { condition: sql`(
    NOT EXISTS (SELECT 1 FROM fishery_sources managed WHERE managed.source_id = p.source_id)
    AND NOT EXISTS (SELECT 1 FROM fishery_publication_bindings managed WHERE managed.article_id = p.article_id)
    OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(${sql.json(allowed)}) approved(article_id text,state text,projection_hash text,score numeric,tags text[])
      JOIN fishery_publication_bindings binding ON binding.article_id=approved.article_id
      JOIN articles material ON material.id = binding.article_id
      JOIN fishery_documents document ON document.id = binding.document_id
      WHERE binding.article_id = p.article_id AND material.revision = binding.material_revision
        AND binding.projection_hash=approved.projection_hash
        AND ${qualificationState(sql`binding.document_id`, sql`binding.kind`, sql`binding.item_id`)}=approved.state
        AND p.title = binding.title AND p.summary = binding.summary AND p.category = binding.category AND p.url = binding.url
        AND p.source_id = document.source_id AND material.source_id = document.source_id AND p.tags = approved.tags
        AND p.body_mode = 'summary' AND NOT p.syndicate AND p.score IS NOT DISTINCT FROM approved.score AND NOT p.selected))` };
}

export async function allowFisheryUndatedArchive(articleId: string, db: Db): Promise<boolean> {
  return (await db`SELECT 1 FROM fishery_publication_bindings WHERE article_id=${articleId}`).length > 0;
}

/** Reversible local replay of already-qualified content, with ordinary material and editorial audit. */
export async function syncFisheryPublications(actor: string, now = new Date(), options: { target?: { kind: "article" | "business_guide"; id: string }; expectedDecision?: PublicationJob; assertHeld?: () => Promise<void> } = {}) {
  const projections = await currentProjections(now, sql, options.target), result = [];
  if (options.expectedDecision && projections.length === 0 && await publicationDecisionCurrent(options.expectedDecision))
    throw new Conflict("Current approved publication is temporarily unreadable; bounded non-paid retry required");
  for (const projection of projections) {
    await options.assertHeld?.();
    const linked = await sql.begin(async tx => {
      // Match the editorial write lock order: guide, document, source profile.
      if (projection.kind === "business_guide") await tx`SELECT id FROM fishery_business_guides WHERE id=${projection.id} FOR UPDATE`;
      const document = await lockDocument(tx, projection.documentId);
      await tx`SELECT id FROM sources WHERE id=${document.source_id} FOR SHARE`;
      await tx`SELECT source_id FROM fishery_sources WHERE source_id=${document.source_id} FOR SHARE`;
      await options.assertHeld?.();
      if (options.expectedDecision && !await publicationDecisionCurrent(options.expectedDecision, tx)) return null;
      const fresh = (await currentProjections(now, tx, { kind: projection.kind, id: projection.id }))[0];
      if (!fresh || fresh.binding !== projection.binding) return null;
      const [before] = await tx`SELECT * FROM fishery_publication_bindings WHERE kind=${projection.kind} AND item_id=${projection.id} FOR UPDATE`;
      const [news]=projection.kind==='article'?await tx`SELECT id AS "articleId" FROM articles
        WHERE source_id=${document.source_id} AND url=${projection.url} AND raw->>'fisheryDocumentId'=${projection.documentId} AND raw->>'mode'='verified-news-candidate' ORDER BY discovered_at LIMIT 1`:[];
      const material = news ?? await upsertMaterial({ sourceId: document.source_id, url: projection.url, title: projection.title,
        identityKey: `fishery-publication:${projection.kind}:${projection.id}`, language: "zh", publicationTime: projection.publicationTime,
        publishedAt: projection.publicationTime ? beijingAt(projection.publicationTime, "00:00") : null,
        bodyStatus: "none", via: "fishery-reviewed-publication", backfill: "reviewed-reference-archive",
        raw: { fisheryPublicationKind: projection.kind, fisheryPublicationId: projection.id, fisheryPublicationDocumentId: projection.documentId },
      }, tx);
      const [article] = await tx`SELECT revision FROM articles WHERE id=${material.articleId}`;
      const fields = { title: projection.title, summary: projection.summary, category: projection.category, relevance: "pass", score: projection.score, selected: false, tags: projection.tags };
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
          { kind: projection.kind, itemId: projection.id, documentId: projection.documentId, projectionHash: projection.binding, materialRevision: article!.revision, selected: false, score: projection.score }, { db: tx });
      await options.assertHeld?.();
      return { kind: projection.kind, itemId: projection.id, articleId: material.articleId, eligible: publication !== null };
    });
    if (linked) result.push(linked);
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

/** Only approved public guide date boundaries, never source bodies or review drafts. */
export async function fisheryReferenceMetadata(articleIds: string[], now: Date): Promise<Record<string, ReferenceMetadata>> {
  if (!articleIds.length) return {};
  const bindings = await sql`SELECT article_id,item_id,projection_hash FROM fishery_publication_bindings
    WHERE article_id=ANY(${articleIds}::text[]) AND kind='business_guide'`;
  const projections = await currentProjections(now);
  const byId = new Map(projections.filter(p => p.kind === "business_guide").map(p => [p.id, p]));
  return Object.fromEntries(bindings.flatMap(binding => {
    const projection = byId.get(binding.item_id);
    return projection?.reference && projection.binding === binding.projection_hash ? [[binding.article_id, projection.reference]] : [];
  }));
}
