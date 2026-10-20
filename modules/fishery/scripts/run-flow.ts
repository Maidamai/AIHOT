// Explicit single task runner. No schedules, recovery sweep, queue subscription or fallback.
import { parseArgs } from "node:util";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { assertFisheryCapacity, withFisheryAuthorization } from "../backend/authorization.ts";
import { flowDetail, runFlow } from "../backend/flow.ts";
const {values}=parseArgs({options:{id:{type:"string"},"run-once":{type:"boolean"}}});
try {
  if(!values.id||!values["run-once"]||!config.modelCallsEnabled) throw new Error("Explicit --id --run-once and MODEL_CALLS_ENABLED=true required");
  const task=await flowDetail(values.id);
  if(task.stale||task.status!=="queued") throw new Error("Only current queued tasks can run; failed/running tasks need reconciliation");
  await assertFisheryCapacity(task.draft?1:2);
  const result=await withFisheryAuthorization(()=>runFlow(values.id!,chatJson));
  console.log(JSON.stringify({id:result.id,status:result.status,stage:result.stage,stale:result.stale,error:result.error??null,published:false}));
  if(result.status==="failed") process.exitCode=2;
} catch(error) {console.error(JSON.stringify({status:"stopped",errorType:(error as Error).name,message:(error as Error).message,noAutomaticRetry:true}));process.exitCode=2;}
finally {await closeDb();}
