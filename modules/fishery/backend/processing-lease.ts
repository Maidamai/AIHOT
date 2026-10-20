// One retained PostgreSQL session owns every manual processor, single-task runner and reconciliation.
// Connection loss invalidates the old owner permanently; a replacement owner needs a new lease.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { config } from "@aihot/backend/config";

export interface ProcessingLease {
  readonly instanceId:string;
  readonly backendPid:number;
  assertHeld:()=>Promise<void>;
  run:<T>(run:()=>Promise<T>)=>Promise<T>;
  watch:(onLost:(error:Error)=>void,intervalMs?:number)=>()=>void;
  release:()=>Promise<void>;
}
const context=new AsyncLocalStorage<ProcessingLease>();
const lockKey="fishery.manual-flow-consumer";
export async function assertProcessingLease() {
  const lease=context.getStore();
  if(!lease) throw new Error("Fishery processing lease guard required; no paid request permitted");
  await lease.assertHeld();
}
export async function acquireProcessingLease():Promise<ProcessingLease> {
  let invalid:Error|null=null,released=false;
  const listeners=new Set<(error:Error)=>void>(),watchStops=new Set<()=>void>();
  const invalidate=(error:Error)=>{
    if(invalid) return;
    invalid=error;
    for(const listener of [...listeners]) listener(error);
  };
  // A dedicated one-connection client lets onclose invalidate this owner immediately. A shared
  // pool must never lend its replacement connection back to an old advisory-lock owner.
  const client=postgres(config.databaseUrl,{max:1,idle_timeout:0,max_lifetime:0,connect_timeout:5,onnotice:()=>{},
    connection:{application_name:"fishery-processing-lease"},onclose:()=>{if(!released) invalidate(new Error("Fishery processing lease connection closed; restart/reconcile required"));}});
  let session:Awaited<ReturnType<typeof client.reserve>>|undefined;
  try {
    session=await client.reserve();
    const [claimed]=await session`SELECT pg_backend_pid() AS pid,pg_try_advisory_lock(hashtextextended(${lockKey},0)) AS locked`;
    if(!claimed?.locked) throw new Error("Fishery processing already running; global execution lease unavailable");
    const backendPid=Number(claimed.pid),instanceId=randomUUID();
    const assertHeld=async()=>{
      if(invalid) throw invalid;
      try {
        const [row]=await session!`SELECT pg_backend_pid() AS pid,EXISTS(SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND mode='ExclusiveLock' AND objsubid=1
          AND classid=((hashtextextended(${lockKey},0)>>32)&4294967295)::oid
          AND objid=(hashtextextended(${lockKey},0)&4294967295)::oid) AS held`;
        if(Number(row?.pid)!==backendPid||!row?.held) throw new Error("Fishery processing lease PID changed or lock disappeared; restart/reconcile required");
      } catch(error) {invalidate(new Error("Fishery processing lease check failed; restart/reconcile required",{cause:error}));}
      if(invalid) throw invalid;
    };
    const lease:ProcessingLease={instanceId,backendPid,assertHeld,
      run:async run=>{await assertHeld();return context.run(lease,run);},
      watch:(onLost,intervalMs=1000)=>{
        let checking=false,notified=false,stopped=false;
        const notify=(error:Error)=>{if(!stopped&&!notified){notified=true;clearInterval(timer);listeners.delete(notify);onLost(error);}};
        const check=()=>{if(checking||stopped) return;checking=true;void assertHeld().catch(notify).finally(()=>{checking=false;});};
        const timer=setInterval(check,intervalMs);timer.unref();
        const stop=()=>{stopped=true;clearInterval(timer);listeners.delete(notify);watchStops.delete(stop);};
        watchStops.add(stop);listeners.add(notify);check();
        return stop;
      },
      release:async()=>{
        if(released) return;
        released=true;for(const stop of [...watchStops]) stop();listeners.clear();
        try {if(!invalid) await session!`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;}
        finally {invalidate(new Error("Fishery processing lease released; old owner cannot resume"));session!.release();await client.end({timeout:1});}
      }};
    await assertHeld();
    return lease;
  } catch(error) {
    released=true;session?.release();await client.end({timeout:1});throw error;
  }
}
