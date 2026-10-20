import { config } from "@aihot/backend/config";
import { COLUMNS } from "./official-columns.ts";
import { readBatch, verifyBatchItem } from "./column-batches.ts";
import { importCapturedMaterial } from "./store.ts";

export async function importBatch(id: string, actor: string) {
  const batch = await readBatch(config.dataDir,id);
  if (batch.status !== "complete") throw new Error("Batch is still running");
  // Verify every selected archive before the first database mutation.
  const verified = await Promise.all(batch.items.filter(i=>i.state === "ready").map(async item=>({item,result:await verifyBatchItem(config.dataDir,batch,item)})));
  if (verified.some(v=>!v.result.readyForReview)) throw new Error("Archived batch is not ready; capture again");
  const rows = [];
  for (const {item,result:r} of verified) {
    const capture = r.sourceCapture;
    rows.push(await importCapturedMaterial({id:item.column,...COLUMNS[item.column]},item.url,{
      expectedRevision:0,originalTitle:r.title,title:r.title,summaryZh:"待人工核对原文；尚未生成业务摘要，关键词命中仅是检索线索。",
      language:"zh",rawSha256:capture.rawSha256,dates:r.dates,policyStatus:"unknown",sourceCapture:capture,
      scope:{regions:[],species:[],flags:[],activities:[],unknownFields:["regions","species","flags","activities"]},
      evidence:[{url:capture.sourceUrl,sha256:capture.rawSha256,page:null,section:"官方栏目正文；日期、地域及政策适用性待核"}],
    },actor));
  }
  return { batchId:id,rows,reviewState:"unreviewed",published:false };
}
