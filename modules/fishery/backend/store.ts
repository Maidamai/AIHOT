import {columnPublishedAt} from "./official-columns.ts";
import {businessDependencyChanged} from './business-capture.ts';
import { capturedTransaction } from "./column-lease.ts";
import { randomUUID, createHash } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { upsertMaterial, reviseMaterial, contentHash, decideTimeline, explicitBackfill } from "@aihot/backend/content/materials";
import { collapseWhitespace } from "@aihot/backend/lib/text";
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
    a.discovered_at AS material_discovered_at,a.backfill_reason AS material_backfill_reason,cs.cursor->'fisheryColumnProgress'->'firstSeen'->d.canonical_url->>'at' AS first_seen_at,
    r.decision, r.note, r.reviewed_at, r.actor AS reviewer, r.applicability_reviewed, r.revision AS reviewed_revision, r.source_revision AS reviewed_source_revision, s.revision AS source_revision
    FROM fishery_documents d JOIN fishery_sources s ON s.source_id = d.source_id
    JOIN sources cs ON cs.id=d.source_id
    LEFT JOIN LATERAL (SELECT discovered_at,backfill_reason FROM articles WHERE raw->>'fisheryDocumentId'=d.id::text AND raw->>'mode'='verified-news-candidate' ORDER BY created_at LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT * FROM fishery_observations WHERE document_id = d.id ORDER BY revision DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT * FROM fishery_reviews WHERE document_id = d.id ORDER BY id DESC LIMIT 1) r ON true
    ORDER BY coalesce(o.observed_at, d.created_at) DESC, d.id DESC`;
  return rows.map(row => (Object.assign({}, row, sourceAttributionOf(row.issuer))));
}

// New captures compare the latest evidence (a genuinely new A → B → A capture is a new version).
export function evidenceIdentity(input: unknown) {
  const { expectedRevision: _, ...payload } = observationSchema.parse(input);
  const capture = payload.sourceCapture;
  if(capture?.businessContext?.versionHash&&capture.parseStatus==='parsed'){
    // Revisit page chrome is acquisition evidence, not a content revision. Keep the old
    // immutable observation on equality; new originals remain in the capture audit/archive.
    return hash({...payload,rawSha256:null,evidence:payload.evidence.map(({sha256:_,...e})=>e),sourceCapture:{adapter:capture.adapter,parser:capture.parser,sourceUrl:capture.sourceUrl,parseStatus:capture.parseStatus,versionHash:capture.businessContext.versionHash}});
  }
  if (capture) { const { capturedAt: _time, attachmentCapturedAt: _attachmentTime, archiveId: _archive, manualArchiveId: _manualArchive, ...stable } = capture; return hash({ ...payload, sourceCapture: stable }); }
  return hash(payload);
}
type CaptureColumn={id:string;name:string;issuer:string;tier?:"T1"};
/** Explicit registration does not acquire, grant rights, enable core collection or approve material. */
export async function registerCaptureSource(column:CaptureColumn,actor:string){
  return capturedTransaction(column.id,tx=>ensureCaptureSource(column,actor,tx));
}
async function ensureCaptureSource(column:CaptureColumn,actor:string,tx:Db){
  const sourceId=`fishery-column-${column.id}`,sourceAttribution=column.issuer;
    // Verified official columns declare their tier; arbitrary/manual imports keep the core default.
    // Never overwrite an operator's existing classification or imply redistribution permission.
    await tx`INSERT INTO sources (id,name,kind,tier,first_party,enabled,participation_mode,site_fulltext,next_fetch_at)
      VALUES (${sourceId},${column.name},'external',${column.tier??"T2"},${column.tier==='T1'},false,'editorial',false,'2100-01-01') ON CONFLICT (id) DO NOTHING`;
    // Lock the source to serialize imports of the same URL and preserve operator rights settings.
    const [registered] = await tx`SELECT id,participation_mode FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if (registered?.participation_mode === "isolated") throw new Conflict("Source is isolated; captured imports are disabled");
    if (!(await tx`SELECT 1 FROM fishery_sources WHERE source_id=${sourceId}`).length) {
      const { expectedRevision: _revision, ...profile } = sourceSchema.parse({ expectedRevision: 0, attribution: sourceAttribution, healthNote: column.id.startsWith("manual-") ? "人工核验公开官方归档；非自动采集器，HTTP回执不是网站签名，尚需普通人工审核，转载权未知" : "手动官方栏目试采；自动采集关闭，转载权未知" });
      await tx`INSERT INTO fishery_sources(source_id,revision,profile) VALUES (${sourceId},1,${tx.json(profile)})`;
      await audit(actor,"fishery.source",`source:${sourceId}`,"Manual batch registration",null,{ revision:1, profile },{db:tx});
    }
  return {sourceId,enabled:false,rightsGranted:false};
}
type CapturedImport={id:string;revision:number;unchanged:boolean};
export function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string,options:{existingOnly:true;changedRequiredEvidenceOnly?:boolean;nativeFirstSeenAt?:Date}):Promise<CapturedImport|null>;
export function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string,options?:{nativeFirstSeenAt?:Date}):Promise<CapturedImport>;
export async function importCapturedMaterial(column:CaptureColumn,canonicalUrl:string,input:unknown,actor:string,options:{existingOnly?:boolean;changedRequiredEvidenceOnly?:boolean;nativeFirstSeenAt?:Date}={}) {
  const { expectedRevision: _, ...payload } = observationSchema.parse(input);
  const sourceId = `fishery-column-${column.id}`;
  const archiveId=payload.sourceCapture?.archiveId;
  const batchId=archiveId?.match(/^([a-zA-Z0-9-]{1,64})_[a-f0-9]{16}$/)?.[1];
  if(archiveId&&(!batchId||archiveId!==`${batchId}_${createHash("sha256").update(column.id+canonicalUrl).digest("hex").slice(0,16)}`))
    throw new Conflict("Captured archive identity does not match its batch, column and URL");
  const proofHash=hash(payload),receiptSubject=`fishery-capture:${archiveId}`;
  // Persist even no-op imports in the same transaction: acquisition auditing happens afterwards.
  const remember=async(tx:Db,result:CapturedImport|null)=>{
    if(archiveId)await audit(actor,"fishery.capture_import",receiptSubject,"Verified archive import committed",null,
      {batchId,archiveId,sourceId,canonicalUrl,proofHash,result},{db:tx});
    return result;
  };
  const replay=async(tx:Db,documentId:string|null,revision:number)=>{
    if(!archiveId)return {seen:false,result:null};
    const [receipt]=await tx`SELECT after FROM audit_log WHERE subject=${receiptSubject} AND action='fishery.capture_import' ORDER BY id LIMIT 1`;
    if(receipt){
      const prior=receipt.after;
      if(prior.batchId!==batchId||prior.archiveId!==archiveId||prior.sourceId!==sourceId||prior.canonicalUrl!==canonicalUrl||prior.proofHash!==proofHash)
        throw new Conflict("Captured archive identity was already imported with conflicting source proof");
      return {seen:true,result:prior.result&&documentId?{id:documentId,revision,unchanged:true}:null};
    }
    if(documentId){
      // Older imports already retain their complete proof in observations, including a crash before acquisition audit.
      const [legacy]=await tx`SELECT payload FROM fishery_observations WHERE document_id=${documentId} AND payload->'sourceCapture'->>'archiveId'=${archiveId} ORDER BY revision LIMIT 1`;
      if(legacy){
        if(hash(legacy.payload)!==proofHash)throw new Conflict("Captured archive identity was already imported with conflicting source proof");
        return {seen:true,result:await remember(tx,{id:documentId,revision,unchanged:true})};
      }
      if((await tx`SELECT 1 FROM audit_log WHERE subject=${`fishery:${documentId}`} AND action='fishery.acquisition' AND after->>'batchId'=${batchId!} AND after->>'archiveId'=${archiveId} LIMIT 1`).length)
        throw new Conflict("Legacy archive import has incomplete source proof; explicit recovery required");
    }
    return {seen:false,result:null};
  };
  // A configured column owner is attribution only; do not infer a page publisher or policy issuer.
  const sourceAttribution = column.issuer;
  return capturedTransaction(column.id,async tx => {
    // Take the same source -> document lock order as normal imports. An unrelated URL must never be registered here.
    if(options.existingOnly) {
      await tx`SELECT id FROM sources WHERE id=${sourceId} FOR UPDATE`;
      if(!(await tx`SELECT id FROM fishery_documents WHERE source_id=${sourceId} AND canonical_url=${canonicalUrl} FOR UPDATE`).length) {
        const prior=await replay(tx,null,0);
        return prior.seen?prior.result:remember(tx,null);
      }
    }
    await ensureCaptureSource(column,actor,tx);
    let [doc] = await tx`SELECT * FROM fishery_documents WHERE source_id=${sourceId} AND canonical_url=${canonicalUrl} FOR UPDATE`;
    const newDocument=!doc;
    if (!doc) {
      [doc] = await tx`INSERT INTO fishery_documents(id,source_id,issuer,canonical_url) VALUES (${randomUUID()},${sourceId},${sourceAttribution},${canonicalUrl}) RETURNING *`;
      await audit(actor,"fishery.document",`fishery:${doc!.id}`,null,null,doc!,{db:tx});
    }
    if (doc!.withdrawn_reason) throw new Conflict("Document withdrawn; batch cannot restore it");
    const [previous] = await tx`SELECT revision,payload FROM fishery_observations WHERE document_id=${doc!.id} ORDER BY revision DESC LIMIT 1`;
    const prior=await replay(tx,String(doc!.id),previous?.revision??0);
    if(prior.seen)return prior.result;
    if(options.changedRequiredEvidenceOnly){
      const {noticeAttachmentChanged}=await import('./fujian-notices.ts');
      const {jfaAttachmentChanged}=await import('./jfa-press.ts');
      const c=payload.sourceCapture,old=previous?.payload.sourceCapture;
      const verifiedNpfcPdf=c?.adapter==='npfc'&&c.attachmentHttpStatus===200&&!!c.attachmentSha256;
      const changed=c?.httpStatus===200&&(businessDependencyChanged(old,c)||c.adapter==='fujian-notices'&&!c.conflicts.length&&noticeAttachmentChanged(old?.noticeContext,c.noticeContext)||
        c.adapter==='jfa-press'&&!c.conflicts.length&&jfaAttachmentChanged(old?.jfaContext,c.jfaContext)||
        c.adapter==='npfc'&&old?.adapter==='npfc'&&!!c.attachmentUrl&&!!old.attachmentUrl&&((!c.conflicts.length||verifiedNpfcPdf)&&c.attachmentUrl!==old.attachmentUrl||verifiedNpfcPdf&&!!old.attachmentSha256&&c.attachmentSha256!==old.attachmentSha256));
      if(!changed)return remember(tx,null);
    }
    if (previous && evidenceIdentity({ ...previous.payload, expectedRevision:0 }) === evidenceIdentity({ ...payload, expectedRevision:0 })) return remember(tx,{ id:doc!.id as string, revision:previous.revision as number, unchanged:true });
    const revision = (previous?.revision ?? 0) + 1;
    await tx`INSERT INTO fishery_observations(document_id,revision,actor,content_hash,payload) VALUES (${doc!.id},${revision},${actor},${hash(payload)},${tx.json(payload)})`;
    await audit(actor,"fishery.observe",`fishery:${doc!.id}`,"Manual captured batch; unreviewed",{revision:previous?.revision??0},{revision,contentHash:hash(payload)},{db:tx});
    if(options.nativeFirstSeenAt&&payload.sourceCapture?.parseStatus==='parsed') {
      const publicationTime=payload.sourceCapture.publishedAt??(payload.dates.published.precision==='day'?payload.dates.published.value:null);
      const native=(await tx`SELECT 1 FROM fishery_document_purposes WHERE document_id=${doc!.id} AND purpose='native'`).length>0;
      if(native||newDocument&&!decideTimeline(columnPublishedAt(column.id,publicationTime),options.nativeFirstSeenAt).backfill) {
        const {assignNativeDocumentPurpose}=await import('./native-permit.ts');
        await assignNativeDocumentPurpose(String(doc!.id),tx);
      }
    }
    return remember(tx,{ id:doc!.id as string, revision, unchanged:false });
  });
}
export async function documentHistory(id: string) {
  const [document] = await sql`SELECT * FROM fishery_documents WHERE id = ${id}`;
  if (!document) throw new NotFound("Document not found");
  const observations = await sql`SELECT * FROM fishery_observations WHERE document_id = ${id} ORDER BY revision`;
  const reviews = await sql`SELECT * FROM fishery_reviews WHERE document_id = ${id} ORDER BY id`;
  return { document: Object.assign({}, document, sourceAttributionOf(document.issuer)), observations, reviews };
}

export async function recordCapturedAcquisition(columnId:string,canonicalUrl:string,record:{batchId:string;archiveId:string;outcome:"ready"|"irrelevant"|"unavailable";confirmedChange?:boolean;capture:unknown;relevance:unknown;reason:string},actor:string) {
  return capturedTransaction(columnId,async tx=>{
    const [document]=await tx`SELECT id FROM fishery_documents WHERE source_id=${`fishery-column-${columnId}`} AND canonical_url=${canonicalUrl} FOR UPDATE`;
    if(!document) return null;
    const subject=`fishery:${document.id}`;
    const [prior]=await tx`SELECT after FROM audit_log WHERE subject=${subject} AND action='fishery.acquisition' AND after->>'batchId'=${record.batchId} AND after->>'archiveId'=${record.archiveId} LIMIT 1`;
    if(prior&&hash(prior.after.capture)!==hash(record.capture))throw new Conflict("Captured archive identity has conflicting acquisition source proof");
    if(!prior)
      await audit(actor,"fishery.acquisition",subject,record.confirmedChange?"Confirmed source page or required-attachment change; previous approval invalidated":record.outcome==="unavailable"?"Acquisition unavailable; no confirmed source-body change":"Verified archived acquisition result",null,record,{db:tx});
    return {documentId:String(document.id),...record};
  });
}

/** Verified news candidates enter the core URL/revision/timeline ledger before editorial review. */
export async function storeCapturedNews(columnId:string,documentId:string,body:string,actor:string,firstSeenAt?:Date) {
  return capturedTransaction(columnId,async tx=>{
    const [source]=await tx`SELECT id,participation_mode FROM sources WHERE id=${`fishery-column-${columnId}`} FOR SHARE`;
    if(source?.participation_mode!=='editorial')throw new Conflict('Source is isolated; news material import disabled');
    const doc=await lockDocument(tx,documentId);
    const [observation]=await tx`SELECT payload FROM fishery_observations WHERE document_id=${documentId} ORDER BY revision DESC LIMIT 1`;
    const payload=observation?.payload,capture=payload?.sourceCapture;
    if(capture&&capture.bodySha256!==createHash("sha256").update(body).digest("hex"))return {skipped:"Superseded archived body; current material retained"};
    if(doc.withdrawn_reason||!capture||capture.parseStatus!=="parsed"||capture.conflicts.length)
      throw new Conflict("Current verified news body required");
    // Previously published reference identities remain stable; no implicit migration or republishing.
    const [bound]=await tx`SELECT b.article_id FROM fishery_publication_bindings b JOIN articles a ON a.id=b.article_id WHERE b.kind='article' AND b.document_id=${documentId} AND a.raw->>'mode' IS DISTINCT FROM 'verified-news-candidate'`;
    if(bound) {
      const [news]=await tx`SELECT id FROM articles WHERE source_id=${doc.source_id} AND url=${doc.canonical_url}
        AND raw->>'fisheryDocumentId'=${documentId} AND raw->>'mode'='verified-news-candidate'`;
      if(!news)return {articleId:String(bound.article_id),existingPublication:true};
    }
    const publicationTime=capture.publishedAt??(payload.dates.published.precision==='day'?payload.dates.published.value:null);
    const title=collapseWhitespace(payload.originalTitle??payload.title).slice(0,1000)||doc.canonical_url;
    const publishedAt=columnPublishedAt(columnId,publicationTime);
    const material=await upsertMaterial({sourceId:doc.source_id,url:doc.canonical_url,title,
      language:payload.language,bodyText:body,bodyStatus:'ok',publicationTime,
      publishedAt,
      discoveredAt:firstSeenAt??new Date(doc.created_at),via:'fishery-news',raw:{fisheryDocumentId:documentId,mode:'verified-news-candidate'}},tx);
    const [current]=await tx`SELECT source_id,raw,title,body_text,excerpt,discovered_at,published_at_claim,publication_time,backfill_reason FROM articles WHERE id=${material.articleId} FOR UPDATE`;
    if(current.source_id!==doc.source_id||current.raw?.fisheryDocumentId!==documentId||current.raw?.mode!=='verified-news-candidate')
      throw new Conflict('Captured news identity is owned by another material; reconcile without overwriting it');
    const time=decideTimeline(publishedAt,new Date(current.discovered_at),explicitBackfill(current.backfill_reason));
    const bodyChanged=current.body_text!==body||current.title!==title;
    const dateChanged=(current.published_at_claim?.getTime()??null)!==(publishedAt?.getTime()??null)||current.publication_time!==publicationTime;
    if(bodyChanged||dateChanged){
      // Core subscriptions ignore previously seen renderings. This path has a freshly archived,
      // source-bound body: an A→B→A correction must match its current evidence, even for a known hash.
      const set:Parameters<typeof reviseMaterial>[2]['set']=sql`title=${title},body_text=${body},body_html=NULL,body_status='ok',language=${payload.language},
        published_at=${time.publishedAt},published_at_claim=${publishedAt},publication_time=${publicationTime},
        timeline_at=${time.timelineAt},backfill=${time.backfill},backfill_reason=${time.backfillReason}`;
      if(material.revised)await tx`UPDATE articles SET ${set} WHERE id=${material.articleId}`;
      else await reviseMaterial(tx,material.articleId,{set,hash:contentHash({title,bodyText:body,excerpt:current.excerpt}),title,bodyText:body});
      material.revised=true;material.backfill=time.backfill;
    }
    if((await tx`SELECT 1 FROM fishery_document_purposes WHERE document_id=${documentId} AND purpose='native'`).length){
      const {assignNativeDocumentPurpose}=await import('./native-permit.ts');await assignNativeDocumentPurpose(documentId,tx);
    }
    if(material.created||material.revised)await audit(actor,'fishery.news.material',`fishery:${documentId}`,'Verified body enters core material and timeline rules; no approval or publication',null,material,{db:tx});
    return material;
  });
}
