import { withColumnLease } from "./column-lease.ts";
import { config } from "@aihot/backend/config";
import { COLUMNS, isNewsColumn } from "./official-columns.ts";
import { readBatch, verifyBatchItem } from "./column-batches.ts";
import { importCapturedMaterial,recordCapturedAcquisition,storeCapturedNews } from "./store.ts";
import { sha256 } from "./source-adapters.ts";

export async function importBatch(id:string,actor:string):Promise<Awaited<ReturnType<typeof importBatchContents>>> {
  const batch=await readBatch(config.dataDir,id),columns=[...new Set(batch.items.map(item=>item.column))];
  if(columns.length===1)return withColumnLease(columns[0],()=>importBatchContents(id,actor));
  return importBatchContents(id,actor);
}
async function importBatchContents(id: string, actor: string) {
  const batch = await readBatch(config.dataDir,id);
  if (batch.status !== "complete") throw new Error("Batch is still running");
  // Reconstruct non-ready captures too: their valid new body can supersede an already registered URL.
  // Verify all archives before mutations; completed acquisitions must keep their archived proof.
  const verified = await Promise.all(batch.items.map(async item=>{
    try {return {item,result:await verifyBatchItem(config.dataDir,batch,item),error:null};}
    catch(error) {if(item.state==="ready"||item.state==="needs_review") throw error;return {item,result:null,error:String((error as Error).message).slice(0,500)};}
  }));
  const rows = [],evidenceUpdates = [],acquisitions = [],materials = [];
  for (const {item,result:r,error} of verified) {
    let confirmedChange=false;
    const capture = r?.sourceCapture;
    const confirmedBody=!!r?.body&&capture?.httpStatus===200&&capture.parseStatus==="parsed"&&!capture.conflicts.length&&sha256(r.body)===capture.bodySha256;
    const outcome=confirmedBody?(r!.readyForReview?"ready" as const:"irrelevant" as const):"unavailable" as const;
    const relevance=r&&"relevance" in r?r.relevance:null;
    // NPFC reconstruction verifies PDF acquisition before interpreting its measure/date claims.
    // A contradictory new PDF still changes the evidence, while a URL-only change needs verified landing identity.
    const changedDependency=capture?.httpStatus===200&&(item.column==='fujian-notices'&&!capture.conflicts.length&&!!capture.noticeContext||item.column==='jfa-press'&&!capture.conflicts.length&&!!capture.jfaContext||item.column==='npfc'&&!!capture.attachmentUrl&&(!capture.conflicts.length||capture.attachmentHttpStatus===200&&!!capture.attachmentSha256));
    if(confirmedBody||changedDependency) {
      const input={expectedRevision:0,originalTitle:r!.title,title:r!.title,
        summaryZh:!confirmedBody?"必需附件已确认变更，但完整正文尚未核验；旧审核失效，待补证。":outcome==="ready"?"待人工核对原文；尚未生成业务摘要，关键词命中仅是检索线索。":"最新归档正文未提供明确远洋渔业证据；仅保留变更证据，旧摘要不可继承，待人工核对。",
        language:item.column==='jfa-press'?'ja':item.column === "iotc"||item.column==='npfc' ? "en" : "zh",rawSha256:capture!.rawSha256,dates:r!.dates,policyStatus:capture?.noticeContext?.nature==='consultation'?'draft':'unknown',sourceCapture:capture,
        ...("policyContext" in r! && r!.policyContext ? {policyContext:r!.policyContext} : {}),
        scope:{regions:[],species:[],flags:[],activities:[],unknownFields:["regions","species","flags","activities"]},
        evidence:"evidence" in r! ? r!.evidence : [{url:capture!.sourceUrl,sha256:capture!.rawSha256,page:null,section:"官方栏目正文；日期、地域及政策适用性待核"}],
      };
      if(outcome==="ready") {
        const row=await importCapturedMaterial({id:item.column,...COLUMNS[item.column]},item.url,input,actor);rows.push(row);
        if(isNewsColumn(item.column))materials.push(await storeCapturedNews(item.column,row.id,r!.body!,actor));
      }
      else {
        const update=await importCapturedMaterial({id:item.column,...COLUMNS[item.column]},item.url,input,actor,{existingOnly:true,...(!confirmedBody?{changedRequiredEvidenceOnly:true}:{})});
        if(update){evidenceUpdates.push(update);confirmedChange=!update.unchanged;}
      }
    }
    const acquisition=await recordCapturedAcquisition(item.column,item.url,{batchId:id,archiveId:item.archiveId,outcome,confirmedChange,
      capture:capture?{capturedAt:capture.capturedAt,httpStatus:capture.httpStatus,rawSha256:capture.rawSha256,bodySha256:capture.bodySha256,parser:capture.parser,parseStatus:capture.parseStatus}:null,
      relevance,reason:[item.error,error,...(r?.warnings??[])].filter(Boolean).join("; ").slice(0,1000)||
        (outcome==="ready"?"Verified source body; awaiting material review":outcome==="irrelevant"?"Verified source body; no explicit DWF evidence":"No verified source body")},actor);
    if(acquisition) acquisitions.push(acquisition);
  }
  // Only ready imports can seed new processing tasks; irrelevant updates merely invalidate old evidence snapshots.
  const {dispatchAutomaticDocuments}=await import('./automatic-flows.ts');
  const automatic=await dispatchAutomaticDocuments(rows.map(row=>String(row.id)));
  return { batchId:id,rows,evidenceUpdates,acquisitions,materials,automatic,reviewState:"unreviewed",published:false };
}
