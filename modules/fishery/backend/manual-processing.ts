// This consumer handles only administrator-enqueued flows; it never registers business schedules.
import type { PgBoss } from "pg-boss";
import { sql } from "@aihot/backend/db";
import { ensureQueue } from "@aihot/backend/jobs/queue";
import { flowQueue } from "./flow.ts";
import { authorizationKey } from "./authorization.ts";
import { acquireProcessingLease, type ProcessingLease } from "./processing-lease.ts";

export function startProcessingHeartbeat(lease:ProcessingLease,currentTask:()=>string|null) {
  let busy=false,stopped=false;
  const report=async()=>{
    if(busy||stopped) return;busy=true;
    try {
      await lease.assertHeld();
      const id=currentTask(),[task]=id?await sql`SELECT id,status,stage FROM fishery_flow_tasks WHERE id=${id}`:[];
      const [ledger]=await sql`SELECT value->'entries' AS entries FROM settings WHERE key=${authorizationKey}`;
      const entries=ledger?.entries as {state:string}[]|undefined;
      if(!stopped) console.log(JSON.stringify({level:"info",msg:"fishery processing heartbeat",instanceId:lease.instanceId,pid:process.pid,leaseBackendPid:lease.backendPid,leaseHeld:true,
        task:task?{id:task.id,status:task.status,stage:task.stage}:null,ledgerPresent:!!ledger,unresolvedCount:entries?entries.filter(e=>e.state!=="received").length:null,
        unresolved:entries?{pending:entries.filter(e=>e.state==="pending").length,unknown:entries.filter(e=>e.state==="unknown").length,refused:entries.filter(e=>e.state==="refused").length}:null}));
    } catch { /* The lease watchdog reports loss; never log private payloads or raw database errors. */ }
    finally {busy=false;}
  };
  const timer=setInterval(()=>{void report();},10000);timer.unref();void report();
  return ()=>{stopped=true;clearInterval(timer);};
}
export async function registerManualFlowConsumer(boss:PgBoss,run=flowQueue.run,options:{onLeaseLost?:(error:Error)=>void;watchIntervalMs?:number}={}) {
  const lease=await acquireProcessingLease();
  let stopping=false,currentTask:string|null=null,stopWatch=()=>{},stopHeartbeat=()=>{};
  const release=async()=>{
    stopping=true;stopWatch();stopHeartbeat();
    // Stop fetching first and let any already-sent response settle before releasing ownership.
    // stopBoss/shutdownSignal is called by the entry point only after this drain completes.
    try {await boss.offWork(flowQueue.name,{wait:true});} finally {await lease.release();}
  };
  try {
    await ensureQueue(flowQueue.name,flowQueue.options);
    const actual=await boss.getQueue(flowQueue.name);
    if(!actual||actual.retryLimit!==0||!(Number(actual.expireInSeconds)>=600)) throw new Error("fishery.flow queue requires retryLimit=0 and expireInSeconds>=600; reconcile deployed queue before starting");
    await lease.assertHeld();
    await boss.work<{id:string}>(flowQueue.name,{batchSize:1,localConcurrency:1},async jobs=>{
      if(stopping) throw new Error("Fishery processor stopped; no new task may be claimed");
      return lease.run(async()=>{
        await lease.assertHeld();currentTask=jobs[0]?.data.id??null;
        try {return await run(jobs.map(job=>job.data));} finally {currentTask=null;}
      });
    });
    stopHeartbeat=startProcessingHeartbeat(lease,()=>currentTask);
    stopWatch=lease.watch(error=>{
      stopping=true;stopHeartbeat();
      console.error(JSON.stringify({level:"error",msg:"fishery processing lease lost",instanceId:lease.instanceId,pid:process.pid,leaseBackendPid:lease.backendPid,taskId:currentTask,noAutomaticRetry:true}));
      void boss.offWork(flowQueue.name,{wait:false}).catch(()=>{});
      options.onLeaseLost?.(error);
    },options.watchIntervalMs);
    return release;
  } catch(error) {await release();throw error;}
}
