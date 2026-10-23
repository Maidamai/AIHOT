import { withReceiptPolicy } from "@aihot/backend/providers/receipts";
// One cumulative authorization key in the application's DB. Operators must transfer the existing
// ledger before enabling a new deployment; this module never initializes or resets an allowance.
import { createHash } from "node:crypto";
import { audit } from "@aihot/backend/audit";
import { sql } from "@aihot/backend/db";
import { assertProcessingLease } from "./processing-lease.ts";
import { TRIAL, installTrialTransport, trialCapacity, type trialUsage, trialBudget, validateTrialLedger, amountOnlyPolicy } from "./trial-transport.ts";
export const authorizationKey=`fishery.trial.${TRIAL.id}`;
type Entry={id:number;state:"pending"|"received"|"refused"|"unknown";wireBytes:number;reservedMicroCny:number;responseModel?:string|null;usage?:ReturnType<typeof trialUsage>|null};
type Ledger={id:string;entries:Entry[];maxRequests:number|null;policy?:string;maxReservedMicroCny:number};
export async function assertFisheryCapacity(requiredCalls=1) {
  const [row]=await sql<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey}`;
  validateTrialLedger(row?.value);
  if(requiredCalls!==0) trialCapacity(row.value.entries,requiredCalls);
}
export async function fisheryAuthorizationReport() {
  const [row]=await sql<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey}`;
  validateTrialLedger(row?.value);
  return {authorization:TRIAL.id,policy:amountOnlyPolicy,maxRequests:null,maxReservedMicroCny:TRIAL.maxReservedMicroCny,entryCount:row.value.entries.length,...trialBudget(row.value.entries),historicalReservedMicroCny:row.value.entries.reduce((sum,e)=>sum+e.reservedMicroCny,0),states:row.value.entries.map(e=>e.state)};
}
let active=false;
export async function withFisheryAuthorization<T>(run:()=>Promise<T>,options:{receiptAttemptTag?:string;assertAuthorized?:()=>Promise<void>}={}):Promise<T> {
  await assertProcessingLease();
  if(active) throw new Error("Fishery authorization transport already in use; explicit retry required");
  if(process.env.LLM_MODEL!==TRIAL.model||process.env.LLM_BASE_URL!=="https://api.deepseek.com"||process.env.LLM_REASONING_TOKENS!=="0"||process.env.LLM_EXTRA_JSON!=='{"thinking":{"type":"disabled"}}') throw new Error("Fishery model/endpoint configuration refused");
  active=true;
  const restore=installTrialTransport({reserve:async wireBytes=>sql.begin(async tx=>{
    const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    validateTrialLedger(row?.value);
    // The ledger row is locked before checking the retained session lease. Never reserve after
    // a disconnect/reconnect, even if another process has not acquired the lock yet.
    await assertProcessingLease();
    await options.assertAuthorized?.();
    trialCapacity(row.value.entries);
    const id=row.value.entries.length+1;row.value.entries.push({id,state:"pending",wireBytes,reservedMicroCny:TRIAL.reserveMicroCny});
    await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;return id;
  }),beforeSend:async()=>{await assertProcessingLease();await options.assertAuthorized?.();},settle:async(id,state,usage,responseModel)=>sql.begin(async tx=>{
    const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    const entry=row?.value.entries.find(e=>e.id===id);
    if(!entry||entry.state!=="pending") throw new Error("Cumulative reservation mismatch");
    if(usage) trialBudget([{...entry,state:"received",usage}]);
    entry.state=state;entry.usage=usage;entry.responseModel=responseModel??null;
    await tx`UPDATE settings SET value=${tx.json(row.value)},updated_at=now() WHERE key=${authorizationKey}`;
  })});
  try{return await withReceiptPolicy({retryFailed:false,attemptTag:options.receiptAttemptTag,assertAuthorized:options.assertAuthorized},run);}finally{restore();active=false;}
}

// Explicit operator action only: preserve every original entry and audit the prior snapshot.
export async function upgradeExistingTrialToAmountOnly(actor:string,reason:string) {
  if(!actor.trim()||!reason.trim()) throw new Error("Authorization upgrade requires actor and reason");
  return sql.begin(async tx=>{
    const [row]=await tx<{value:Ledger}[]>`SELECT value FROM settings WHERE key=${authorizationKey} FOR UPDATE`;
    const ledger=row?.value;
    if(!ledger||ledger.id!==TRIAL.id||ledger.maxRequests!==20||ledger.maxReservedMicroCny!==TRIAL.maxReservedMicroCny||ledger.policy!==undefined||!Array.isArray(ledger.entries)||ledger.entries.length>20||ledger.entries.some((e,i)=>e.id!==i+1)) throw new Error("Expected original cumulative 20-request authorization; upgrade refused");
    const budget=trialBudget(ledger.entries);
    if(budget.occupiedMicroCny>TRIAL.maxReservedMicroCny) throw new Error("Existing cumulative budget exceeded");
    const ledgerHash=createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
    const before={ledgerHash,maxRequests:20,entryCount:ledger.entries.length,...budget};
    ledger.maxRequests=null;ledger.policy=amountOnlyPolicy;
    validateTrialLedger(ledger);
    await tx`UPDATE settings SET value=${tx.json(ledger)},updated_at=now() WHERE key=${authorizationKey}`;
    const result={policy:amountOnlyPolicy,maxRequests:null,maxReservedMicroCny:TRIAL.maxReservedMicroCny,entryCount:ledger.entries.length,...budget,previousLedgerHash:ledgerHash,modelCalls:0};
    await audit(actor,"fishery.authorization.amount_only",authorizationKey,reason,before,result,{db:tx});
    return result;
  });
}
