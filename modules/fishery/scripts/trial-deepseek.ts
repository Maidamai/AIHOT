// Explicit CLI only. No worker/recovery, public reads, production content writes or fallback.
import {parseArgs} from "node:util";
import {TRIAL,installTrialTransport,trialCapacity,trialUsage,trialBudget,validateTrialLedger,amountOnlyPolicy} from "../backend/trial-transport.ts";
import {buildFisheryDraftRequest,validateFisheryDraft} from "../backend/ai-draft.ts";
import {reviewFisheryDraft,buildFisheryReviewRequest,assertFisheryPairFits} from "../backend/ai-review.ts";
import {readBatch,verifyBatchItem} from "../backend/column-batches.ts";
import {buildEvidenceCatalog,evidenceBinding,assertSavedEvidenceArtifact} from "../backend/evidence.ts";
import {sha256} from "../backend/source-adapters.ts";
function assertReusable(previous:{id:number;status:string;logical_key:string;model:string;request:Record<string,unknown>},options:{attemptTag?:string;promptVersion:string;system:string;user:unknown;temperature?:number;maxTokens?:number}) {
  if(!["received","completed"].includes(previous.status)) throw new Error(`Existing ${previous.status} receipt ${previous.id}; no blind retry`);
  const q=previous.request;
  if(!previous.logical_key.endsWith(`:${options.attemptTag}`)||previous.model!==TRIAL.model||q.promptVersion!==options.promptVersion||q.systemHash!==sha256(options.system)||q.userHash!==sha256(options.user as string)||q.temperature!==(options.temperature??0.2)||q.maxTokens!==(options.maxTokens??1500)) throw new Error("Existing receipt belongs to another request version/attempt tag; select a new explicit identity after reconciliation");
}
const {values}=parseArgs({options:{initialize:{type:"boolean"},report:{type:"boolean"},"upgrade-authorization":{type:"boolean"},attempt:{type:"string"},"review-attempt":{type:"string"},"archive-id":{type:"string",multiple:true},stage:{type:"string"},"capture-dir":{type:"string"},"batch-id":{type:"string"}}});
if(process.env.DATABASE_URL!=="postgres://fishery_trial@fishery-ai-trial-db:5432/fishery_ai_trial"||process.env.FISHERY_TRIAL_ISOLATED!=="true") throw new Error("Refuse non-isolated trial database");
if(process.env.LLM_MODEL!==TRIAL.model||process.env.LLM_BASE_URL!=="https://api.deepseek.com"||process.env.LLM_REASONING_TOKENS!=="0"||process.env.LLM_EXTRA_JSON!=='{"thinking":{"type":"disabled"}}') throw new Error("Refuse model/endpoint/extra overrides");
const {sql,closeDb}=await import("@aihot/backend/db");
const key=`fishery.trial.${TRIAL.id}`;
type Entry={id:number;state:"pending"|"received"|"refused"|"unknown";wireBytes:number;reservedMicroCny:number;responseModel?:string|null;usage?:ReturnType<typeof trialUsage>|null};
type Ledger={id:string;entries:Entry[];maxRequests:number|null;policy?:string;maxReservedMicroCny:number;verifiedVersion:string;verifiedAt:string};
try {
  if(values.report) {
    const records=await sql`SELECT key,value FROM settings WHERE key LIKE ${key+"%"} ORDER BY key`;
    const receipts=await sql`SELECT id,status,model,purpose,usage,cost,currency FROM receipts ORDER BY id`;
    console.log(JSON.stringify({authorization:TRIAL.id,records,receipts,approved:false,published:false}));
  } else if(values["upgrade-authorization"]) {
    const {upgradeExistingTrialToAmountOnly}=await import("../backend/authorization.ts");
    console.log(JSON.stringify(await upgradeExistingTrialToAmountOnly("trial-cli","Explicit --upgrade-authorization: user cancelled request count cap, cumulative CNY10 unchanged")));
  } else if(values.initialize) {
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if((await tx`SELECT 1 FROM settings WHERE key=${key}`).length) throw new Error("Trial already initialized; never reset its allowance");
      if((await tx`SELECT 1 FROM receipt_attempts LIMIT 1`).length) throw new Error("Missing ledger in non-empty receipt database; stop");
      const ledger:Ledger={id:TRIAL.id,entries:[],maxRequests:TRIAL.maxRequests,policy:amountOnlyPolicy,maxReservedMicroCny:TRIAL.maxReservedMicroCny,verifiedVersion:TRIAL.verifiedVersion,verifiedAt:TRIAL.verifiedAt};
      await tx`INSERT INTO settings(key,value) VALUES (${key},${tx.json(ledger)})`;
      await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES ('llm',20,20,20,'Cumulative amount-only fishery trial; CNY10 ceiling') ON CONFLICT(service) DO UPDATE SET per_minute=20,per_hour=20,per_day=20,note=EXCLUDED.note`;
    });
    console.log(JSON.stringify({initialized:true,authorization:TRIAL.id,maxRequests:TRIAL.maxRequests,reservedCeilingCny:10,apiCalls:0}));
  } else {
    if(!values.attempt||!/^[-a-zA-Z0-9_]{1,64}$/.test(values.attempt)||!values["archive-id"]?.length||!["generation","review","both"].includes(values.stage??"")) throw new Error("Explicit attempt identity, archive-id selection and stage (generation/review/both) required");
    if(!values["capture-dir"]||!values["batch-id"]) throw new Error("Specify the existing public capture batch");
    if(values["review-attempt"]&&!/^[-a-zA-Z0-9_]{1,64}$/.test(values["review-attempt"])) throw new Error("Invalid review attempt identity");
    const batch=await readBatch(values["capture-dir"],values["batch-id"]);
    const prepared=await Promise.all(batch.items.filter(i=>i.state==="ready"&&values["archive-id"]!.includes(i.archiveId)).map(async item=>({item,result:await verifyBatchItem(values["capture-dir"]!,batch,item)})));
    if(!prepared.length||prepared.some(p=>!p.result.readyForReview)) throw new Error("Verified public article bodies required");
    const restore=installTrialTransport({
      reserve:async wireBytes=>sql.begin(async tx=>{
        const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${key} FOR UPDATE`;
        validateTrialLedger(row?.value);
        trialCapacity(row.value.entries);
        const id=row.value.entries.length+1;
        row.value.entries.push({id,state:"pending",wireBytes,reservedMicroCny:TRIAL.reserveMicroCny});
        await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${key}`;
        return id;
      }),
      settle:async(id,state,usage,responseModel)=>sql.begin(async tx=>{
        const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${key} FOR UPDATE`;
        const entry=row?.value.entries.find(e=>e.id===id);
        if(!row||!entry||entry.state!=="pending") throw new Error("Trial reservation mismatch");
        if(usage) trialBudget([{...entry,state:"received",usage}]);
        entry.state=state;entry.usage=usage;entry.responseModel=responseModel??null;
        await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${key}`;
      }),
    });
    const {chatJson}=await import("@aihot/backend/providers/llm");
    const {completeReceipt}=await import("@aihot/backend/providers/receipts");
    try {
      for(const {item,result} of prepared) {
        const sourceKey=`${key}.attempt.${values.attempt}.${item.archiveId}`;
        const input={documentId:`capture-${item.archiveId}`,observationRevision:1,body:result.body!,bodySha256:result.sourceCapture.bodySha256!,language:"zh"};
        const request=buildFisheryDraftRequest(input,"default");
        request.subject+=`:attempt:${values.attempt}`;
        request.attemptTag=`fishery-trial:${values.attempt}:generation`;
        request.system+="\n本轮输出简短JSON：摘要最多2句，每句只陈述一条有完整所附引证支持的具体事实，允许每句最多4引句，每条证据仅选择完整目录ID，地点最多4条。不确定就保留未知。";
        request.promptVersion=`${request.promptVersion}:trial:${sha256(request.system)}`;
        const [saved]=await sql<{value:{draft:unknown;bodySha256:string;promptVersion:string;schemaVersion:string;evidenceCatalog:ReturnType<typeof evidenceBinding>}}[]>`SELECT value FROM settings WHERE key=${sourceKey+".generation"}`;
        if(saved) assertSavedEvidenceArtifact(input,saved.value,{promptVersion:request.promptVersion,schemaVersion:"fishery-draft-wire-v5"});
        let draft=saved?validateFisheryDraft(input,saved.value.draft):undefined;
        if(saved&&saved.value.bodySha256!==input.bodySha256) throw new Error("Attempt source changed; use a new explicit attempt identity");
        const [previous]=!draft?await sql<{id:number;status:string;logical_key:string;model:string;request:Record<string,unknown>}[]>`SELECT id,status,logical_key,model,request FROM receipts WHERE subject=${request.subject} AND purpose='fishery_draft' ORDER BY id DESC LIMIT 1`:[];
        if(previous) assertReusable(previous,request);
        if(!draft&&values.stage==="both") {
          assertFisheryPairFits(input,request);
          const [ledger]=await sql<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${key}`;
          validateTrialLedger(ledger?.value);
          trialCapacity(ledger.value.entries,previous?1:2);
        }
        if(!draft&&values.stage!=="review") {
          const answer=await chatJson(request);draft=validateFisheryDraft(input,answer.data);
          const value={status:"needs_review",sourceUrl:item.url,bodySha256:input.bodySha256,observationRevision:input.observationRevision,evidenceCatalog:evidenceBinding(buildEvidenceCatalog(input)),schemaVersion:"fishery-draft-wire-v5",promptVersion:request.promptVersion,receiptId:answer.receiptId,model:answer.model,draft};
          await sql.begin(async tx=>{
            await tx`INSERT INTO settings(key,value) VALUES (${sourceKey+".generation"},${tx.json(value)})`;
            await completeReceipt(tx,answer.receiptId);
          });
          console.log(JSON.stringify({sourceUrl:item.url,stage:"generation",receiptId:answer.receiptId,status:"draft_saved_not_approved"}));
        }
        if(values.stage!=="generation") {
          const reviewKey=sourceKey+".review."+(values["review-attempt"]??values.attempt);
          if(!draft) throw new Error("Review stage requires a saved successful generation in this attempt");
          const [savedReview]=await sql<{value:Parameters<typeof assertSavedEvidenceArtifact>[1]}[]>`SELECT value FROM settings WHERE key=${reviewKey}`;
          if(savedReview) {
            assertSavedEvidenceArtifact(input,savedReview.value,{promptVersion:buildFisheryReviewRequest(input,draft,"default").promptVersion,schemaVersion:"fishery-review-wire-v3"});
            console.log(JSON.stringify({sourceUrl:item.url,stage:"review",status:"reused_saved_review"}));continue;
          }
          const review=await reviewFisheryDraft(input,draft,"default",async options=>{
            options.subject+=`:attempt:${values.attempt}:review:${values["review-attempt"]??values.attempt}`;
            options.attemptTag=`fishery-trial:${values.attempt}:review:${values["review-attempt"]??values.attempt}`;
            const [previous]=await sql<{id:number;status:string;logical_key:string;model:string;request:Record<string,unknown>}[]>`SELECT id,status,logical_key,model,request FROM receipts WHERE subject=${options.subject} AND purpose='fishery_quality_review' ORDER BY id DESC LIMIT 1`;
            if(previous) assertReusable(previous,options);
            return chatJson(options);
          });
          await sql.begin(async tx=>{
            await tx`INSERT INTO settings(key,value) VALUES (${reviewKey},${tx.json(review)})`;
            await completeReceipt(tx,review.receiptId);
          });
          console.log(JSON.stringify({sourceUrl:item.url,stage:"review",receiptId:review.receiptId,status:review.status,approved:false,published:false}));
        }
      }
    } finally {restore();}
  }
} catch(error) {
  console.error(JSON.stringify({status:"stopped",errorType:(error as Error).name,receiptId:(error as {receiptId?:number}).receiptId??null,noAutomaticRetry:true}));process.exitCode=2;
} finally {await closeDb();}
