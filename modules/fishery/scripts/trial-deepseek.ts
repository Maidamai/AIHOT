// Explicit CLI only. No worker/recovery, public reads, production content writes or fallback.
import {parseArgs} from "node:util";
import {TRIAL,installTrialTransport,trialCapacity,trialUsage} from "../backend/trial-transport.ts";
import {buildFisheryDraftRequest,validateFisheryDraft} from "../backend/ai-draft.ts";
import {readBatch,verifyBatchItem} from "../backend/column-batches.ts";
import {sha256} from "../backend/source-adapters.ts";
const {values}=parseArgs({options:{initialize:{type:"boolean"},report:{type:"boolean"},"capture-dir":{type:"string"},"batch-id":{type:"string"}}});
if(process.env.DATABASE_URL!=="postgres://fishery_trial@fishery-ai-trial-db:5432/fishery_ai_trial"||process.env.FISHERY_TRIAL_ISOLATED!=="true") throw new Error("Refuse non-isolated trial database");
if(process.env.LLM_MODEL!==TRIAL.model||process.env.LLM_BASE_URL!=="https://api.deepseek.com"||process.env.LLM_REASONING_TOKENS!=="0"||process.env.LLM_EXTRA_JSON!=='{"thinking":{"type":"disabled"}}') throw new Error("Refuse model/endpoint/extra overrides");
const {sql,closeDb}=await import("@aihot/backend/db");
const key=`fishery.trial.${TRIAL.id}`;
type Entry={id:number;state:"pending"|"received"|"refused"|"unknown";wireBytes:number;reservedMicroCny:number;usage?:ReturnType<typeof trialUsage>|null};
type Ledger={id:string;entries:Entry[];maxRequests:number;maxReservedMicroCny:number;verifiedVersion:string;verifiedAt:string};
try {
  if(values.report) {
    const records=await sql`SELECT key,value FROM settings WHERE key LIKE ${key+"%"} ORDER BY key`;
    const receipts=await sql`SELECT id,status,model,purpose,usage,cost,currency FROM receipts ORDER BY id`;
    console.log(JSON.stringify({authorization:TRIAL.id,records,receipts,approved:false,published:false}));
  } else if(values.initialize) {
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if((await tx`SELECT 1 FROM settings WHERE key=${key}`).length) throw new Error("Trial already initialized; never reset its allowance");
      if((await tx`SELECT 1 FROM receipt_attempts LIMIT 1`).length) throw new Error("Missing ledger in non-empty receipt database; stop");
      const ledger:Ledger={id:TRIAL.id,entries:[],maxRequests:TRIAL.maxRequests,maxReservedMicroCny:TRIAL.maxReservedMicroCny,verifiedVersion:TRIAL.verifiedVersion,verifiedAt:TRIAL.verifiedAt};
      await tx`INSERT INTO settings(key,value) VALUES (${key},${tx.json(ledger)})`;
      await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES ('llm',4,4,4,'Isolated four-request fishery trial') ON CONFLICT(service) DO UPDATE SET per_minute=4,per_hour=4,per_day=4,note=EXCLUDED.note`;
    });
    console.log(JSON.stringify({initialized:true,authorization:TRIAL.id,maxRequests:4,reservedCeilingCny:1.6,apiCalls:0}));
  } else {
    if(!values["capture-dir"]||!values["batch-id"]) throw new Error("Specify the existing public capture batch");
    const batch=await readBatch(values["capture-dir"],values["batch-id"]);
    const prepared=await Promise.all(batch.items.filter(i=>i.state==="ready").slice(0,4).map(async item=>({item,result:await verifyBatchItem(values["capture-dir"]!,batch,item)})));
    if(!prepared.length||prepared.some(p=>!p.result.readyForReview)) throw new Error("Verified public article bodies required");
    const restore=installTrialTransport({
      reserve:async wireBytes=>sql.begin(async tx=>{
        const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${key} FOR UPDATE`;
        if(!row||row.value.id!==TRIAL.id||row.value.maxRequests!==TRIAL.maxRequests||row.value.maxReservedMicroCny!==TRIAL.maxReservedMicroCny) throw new Error("Trial ledger missing/changed");
        trialCapacity(row.value.entries);
        const id=row.value.entries.length+1;
        row.value.entries.push({id,state:"pending",wireBytes,reservedMicroCny:TRIAL.reserveMicroCny});
        await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${key}`;
        return id;
      }),
      settle:async(id,state,usage)=>sql.begin(async tx=>{
        const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${key} FOR UPDATE`;
        const entry=row?.value.entries.find(e=>e.id===id);
        if(!row||!entry||entry.state!=="pending") throw new Error("Trial reservation mismatch");
        entry.state=state;entry.usage=usage;
        await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${key}`;
      }),
    });
    const {chatJson}=await import("@aihot/backend/providers/llm");
    const {completeReceipt}=await import("@aihot/backend/providers/receipts");
    try {
      for(const {item,result} of prepared) {
        const sourceKey=`${key}.draft.${item.archiveId}`;
        if((await sql`SELECT 1 FROM settings WHERE key=${sourceKey}`).length) continue;
        const input={documentId:`capture-${item.archiveId}`,observationRevision:1,body:result.body!,bodySha256:result.sourceCapture.bodySha256!,language:"zh"};
        const request=buildFisheryDraftRequest(input,"default");
        request.maxTokens=TRIAL.maxOutputTokens;request.system+="\n本轮输出简短JSON：摘要最多2句，每个引句不超过80字符，每字段最多1条证据，地点最多4条。不确定就保留未知。";
        request.promptVersion=`fishery-trial-v1:${sha256(request.system)}`;
        const [previous]=await sql<{id:number;status:string}[]>`SELECT id,status FROM receipts WHERE subject=${request.subject} ORDER BY id DESC LIMIT 1`;
        if(previous) {
          console.log(JSON.stringify({sourceUrl:item.url,status:"skipped_existing_receipt",receiptId:previous.id,receiptStatus:previous.status,noRetry:true}));
          continue;
        }
        const answer=await chatJson(request),draft=validateFisheryDraft(input,answer.data);
        const value={status:"needs_review",inputKind:"unimported_public_capture",sourceUrl:item.url,bodySha256:input.bodySha256,promptVersion:request.promptVersion,modelAlias:TRIAL.model,versionVerified:TRIAL.verifiedVersion,verifiedAt:TRIAL.verifiedAt,receiptId:answer.receiptId,usage:trialUsage(answer.usage),draft};
        await sql.begin(async tx=>{
          await tx`INSERT INTO settings(key,value) VALUES (${sourceKey},${tx.json(value)}) ON CONFLICT(key) DO NOTHING`;
          await completeReceipt(tx,answer.receiptId);
        });
        console.log(JSON.stringify({sourceUrl:item.url,bodySha256:input.bodySha256,receiptId:answer.receiptId,status:"draft_saved_not_approved",modelAlias:TRIAL.model}));
      }
    } finally {restore();}
  }
} catch(error) {
  console.error(JSON.stringify({status:"stopped",errorType:(error as Error).name,receiptId:(error as {receiptId?:number}).receiptId??null,noAutomaticRetry:true}));process.exitCode=2;
} finally {await closeDb();}
