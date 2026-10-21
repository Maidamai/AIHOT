// Explicit single task runner. No schedules, recovery sweep, queue subscription or fallback.
import { parseArgs } from "node:util";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { assertFisheryCapacity, withFisheryAuthorization } from "../backend/authorization.ts";
import { flowDetail, runFlow, flowRequiredCalls, assertSelectionFlowCurrent } from "../backend/flow.ts";
import { acquireProcessingLease, type ProcessingLease } from "../backend/processing-lease.ts";
import { startProcessingHeartbeat } from "../backend/manual-processing.ts";
const {values}=parseArgs({options:{id:{type:"string"},"run-once":{type:"boolean"}}});
let lease:ProcessingLease|undefined,stopWatch=()=>{},stopHeartbeat=()=>{};
const drain=()=>console.log(JSON.stringify({level:"info",msg:"fishery single-task runner draining",id:values.id??null}));
process.on("SIGTERM",drain);process.on("SIGINT",drain);
try {
  if(!values.id||!values["run-once"]||!config.modelCallsEnabled) throw new Error("Explicit --id --run-once and MODEL_CALLS_ENABLED=true required");
  lease=await acquireProcessingLease();
  stopWatch=lease.watch(()=>{process.exitCode=2;console.error(JSON.stringify({status:"lease_lost",instanceId:lease!.instanceId,leaseBackendPid:lease!.backendPid,noAutomaticRetry:true}));});
  stopHeartbeat=startProcessingHeartbeat(lease,()=>values.id!);
  await lease.run(async()=>{
    const task=await flowDetail(values.id!);
    if(task.stale||!task.authoritative||task.status!=="queued") throw new Error("Only current queued tasks can run; failed/running tasks need reconciliation");
    await assertFisheryCapacity(await flowRequiredCalls(values.id!));
    const result=await withFisheryAuthorization(()=>runFlow(values.id!,chatJson),{assertAuthorized:()=>assertSelectionFlowCurrent(values.id!)});
    console.log(JSON.stringify({id:result.id,status:result.status,stage:result.stage,stale:result.stale,error:result.error??null,published:false}));
    if(result.status==="failed") process.exitCode=2;
  });
} catch(error) {console.error(JSON.stringify({status:"stopped",errorType:(error as Error).name,message:(error as Error).message,noAutomaticRetry:true}));process.exitCode=2;}
finally {stopWatch();stopHeartbeat();try {await lease?.release();} finally {await closeDb();}}
