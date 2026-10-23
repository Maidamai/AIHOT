import { newsQueue, composeApprovedReports, type NewsJob } from "./news-editorial.ts";
import { publicationQueue, type PublicationJob } from "./publication-queue.ts";
// Approved flows and their core publication/event continuations share one serial consumer.
import type { PgBoss } from "pg-boss";
import { sql } from "@aihot/backend/db";
import { ensureQueue, QUEUES, work } from "@aihot/backend/jobs/queue";
import { runSourceRepublish } from "@aihot/backend/jobs/publication";
import { flowQueue } from "./flow.ts";
import { authorizationKey } from "./authorization.ts";
import { acquireProcessingLease, type ProcessingLease } from "./processing-lease.ts";
import { dispatchAutomaticDocuments } from './automatic-flows.ts';
import type {FlowJob} from './flow.ts';

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
export async function registerManualFlowConsumer(boss:PgBoss,run=flowQueue.run,options:{onLeaseLost?:(error:Error)=>void;watchIntervalMs?:number;publicationRun?:typeof publicationQueue.run;publicationMaintenanceMs?:number}={}) {
  const lease=await acquireProcessingLease();
  // PgBoss concurrency applies per queue; all handlers share the transport and must serialize too.
  let serial:Promise<unknown>=Promise.resolve();
  const serialRun=<T>(run:()=>Promise<T>):Promise<T>=>{
    const next=serial.then(()=>lease.run(run));serial=next.catch(()=>{});return next;
  };
  let stopping=false,currentTask:string|null=null,stopWatch=()=>{},stopHeartbeat=()=>{},stopPublicationMaintenance=()=>{},publicationMaintenance:Promise<void>=Promise.resolve();
  const release=async()=>{
    stopping=true;stopWatch();stopHeartbeat();stopPublicationMaintenance();
    // Stop fetching first and let any already-sent response settle before releasing ownership.
    // stopBoss/shutdownSignal is called by the entry point only after this drain completes.
    await publicationMaintenance;
    try {await Promise.all([boss.offWork(newsQueue.name,{wait:true}),boss.offWork(flowQueue.name,{wait:true}),boss.offWork(publicationQueue.name,{wait:true}),boss.offWork(QUEUES.republishSource,{wait:true})]);} finally {await lease.release();}
  };
  try {
    await ensureQueue(flowQueue.name,flowQueue.options);
    const actual=await boss.getQueue(flowQueue.name);
    if(!actual||actual.retryLimit!==0||!(Number(actual.expireInSeconds)>=600)) throw new Error("fishery.flow queue requires retryLimit=0 and expireInSeconds>=600; reconcile deployed queue before starting");
    await lease.assertHeld();
    await boss.work<FlowJob>(flowQueue.name,{batchSize:1,localConcurrency:1},async jobs=>{
      if(stopping) throw new Error("Fishery processor stopped; no new task may be claimed");
      return serialRun(async()=>{
        await lease.assertHeld();currentTask=jobs[0]?.data.id??null;
        try {return await run(jobs.map(job=>job.data));} finally {currentTask=null;}
      });
    });
    await ensureQueue(publicationQueue.name,publicationQueue.options);
    const publication=await boss.getQueue(publicationQueue.name);
    if(!publication||publication.retryLimit!==2||publication.expireInSeconds!==300) throw new Error("fishery.publication queue requires bounded non-paid retry policy");
    const runPublication=options.publicationRun??publicationQueue.run;
    await boss.work<PublicationJob>(publicationQueue.name,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:0.5},async jobs=>{
      if(stopping) throw new Error("Fishery processor stopped; no publication task may be claimed");
      return serialRun(async()=>{await lease.assertHeld();return runPublication(jobs.map(job=>job.data));});
    });
    await ensureQueue(newsQueue.name,newsQueue.options);
    const news=await boss.getQueue(newsQueue.name);
    if(!news||news.retryLimit!==0)throw new Error('fishery.news must not automatically retry paid calls');
    await boss.work<NewsJob>(newsQueue.name,{batchSize:1,localConcurrency:1},async jobs=>{
      if(stopping)throw new Error('Fishery processor stopped');
      return serialRun(async()=>{await lease.assertHeld();return newsQueue.run(jobs.map(j=>j.data));});
    });
    // Admin source edits use the core projection job; reuse it without enabling general paid workers.
    await work(boss,QUEUES.republishSource,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:2},async data=>{
      if(stopping) throw new Error("Fishery processor stopped; no source projection may be claimed");
      return serialRun(async()=>{await lease.assertHeld();return runSourceRepublish(data);});
    });
    let maintaining=false;
    const maintain=async()=>{
      if(stopping) return;if(maintaining) return publicationMaintenance;maintaining=true;
      try {await lease.assertHeld();await boss.supervise(publicationQueue.name);await boss.supervise(newsQueue.name);await boss.supervise(QUEUES.republishSource);await dispatchAutomaticDocuments(undefined,{assertHeld:lease.assertHeld});await serialRun(()=>composeApprovedReports());}
      catch {if(!stopping) console.error(JSON.stringify({level:"error",msg:"fishery publication queue maintenance failed",queue:publicationQueue.name}));}
      finally {maintaining=false;}
    };
    const publicationTimer=setInterval(()=>{publicationMaintenance=maintain();},options.publicationMaintenanceMs??10000);publicationTimer.unref();
    stopPublicationMaintenance=()=>clearInterval(publicationTimer);await maintain();
    stopHeartbeat=startProcessingHeartbeat(lease,()=>currentTask);
    stopWatch=lease.watch(error=>{
      stopping=true;stopHeartbeat();stopPublicationMaintenance();
      console.error(JSON.stringify({level:"error",msg:"fishery processing lease lost",instanceId:lease.instanceId,pid:process.pid,leaseBackendPid:lease.backendPid,taskId:currentTask,noAutomaticRetry:true}));
      void Promise.all([boss.offWork(newsQueue.name,{wait:false}),boss.offWork(flowQueue.name,{wait:false}),boss.offWork(publicationQueue.name,{wait:false}),boss.offWork(QUEUES.republishSource,{wait:false})]).catch(()=>{});
      options.onLeaseLost?.(error);
    },options.watchIntervalMs);
    return release;
  } catch(error) {await release();throw error;}
}
