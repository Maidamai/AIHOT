// One cumulative authorization key in the application's DB. Operators must transfer the existing
// ledger before enabling a new deployment; this module never initializes or resets an allowance.
import { sql } from "@aihot/backend/db";
import { TRIAL, installTrialTransport, trialCapacity, type trialUsage } from "./trial-transport.ts";
export const authorizationKey=`fishery.trial.${TRIAL.id}`;
type Entry={id:number;state:"pending"|"received"|"refused"|"unknown";wireBytes:number;reservedMicroCny:number;responseModel?:string|null;usage?:ReturnType<typeof trialUsage>|null};
type Ledger={id:string;entries:Entry[];maxRequests:number;maxReservedMicroCny:number};
export async function assertFisheryCapacity(requiredCalls=1) {
  const [row]=await sql<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey}`;
  if(!row||row.value.id!==TRIAL.id||row.value.maxRequests!==TRIAL.maxRequests||row.value.maxReservedMicroCny!==TRIAL.maxReservedMicroCny) throw new Error("Existing cumulative authorization ledger missing/changed");
  if(requiredCalls!==0) trialCapacity(row.value.entries,requiredCalls);
}
let active=false;
export async function withFisheryAuthorization<T>(run:()=>Promise<T>):Promise<T> {
  if(active) throw new Error("Fishery authorization transport already in use; explicit retry required");
  if(process.env.LLM_MODEL!==TRIAL.model||process.env.LLM_BASE_URL!=="https://api.deepseek.com"||process.env.LLM_REASONING_TOKENS!=="0"||process.env.LLM_EXTRA_JSON!=='{"thinking":{"type":"disabled"}}') throw new Error("Fishery model/endpoint configuration refused");
  active=true;
  const restore=installTrialTransport({reserve:async wireBytes=>sql.begin(async tx=>{
    const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    if(!row||row.value.id!==TRIAL.id||row.value.maxRequests!==TRIAL.maxRequests||row.value.maxReservedMicroCny!==TRIAL.maxReservedMicroCny) throw new Error("Existing cumulative authorization ledger missing/changed; no new allowance created");
    trialCapacity(row.value.entries);
    const id=row.value.entries.length+1;row.value.entries.push({id,state:"pending",wireBytes,reservedMicroCny:TRIAL.reserveMicroCny});
    await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;return id;
  }),settle:async(id,state,usage,responseModel)=>sql.begin(async tx=>{
    const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    const entry=row?.value.entries.find(e=>e.id===id);
    if(!entry||entry.state!=="pending") throw new Error("Cumulative reservation mismatch");
    entry.state=state;entry.usage=usage;entry.responseModel=responseModel??null;
    await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;
  })});
  try{return await run();}finally{restore();active=false;}
}
