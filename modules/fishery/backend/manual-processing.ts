// This consumer handles only administrator-enqueued flows; it never registers business schedules.
import type { PgBoss } from "pg-boss";
import { sql } from "@aihot/backend/db";
import { ensureQueue } from "@aihot/backend/jobs/queue";
import { flowQueue } from "./flow.ts";

export async function registerManualFlowConsumer(boss:PgBoss,run=flowQueue.run) {
  const lease=await sql.reserve();
  let locked=false;
  const release=async()=>{
    try {if(locked) await lease`SELECT pg_advisory_unlock(hashtextextended('fishery.manual-flow-consumer',0))`;}
    finally {locked=false;lease.release();}
  };
  try {
    const [row]=await lease`SELECT pg_try_advisory_lock(hashtextextended('fishery.manual-flow-consumer',0)) AS locked`;
    locked=row!.locked;
    if(!locked) throw new Error("Fishery manual processor already running; only one instance is allowed");
    await ensureQueue(flowQueue.name,flowQueue.options);
    // ensureQueue does not alter an existing queue. Refuse incompatible deployed settings.
    const actual=await boss.getQueue(flowQueue.name);
    if(!actual||actual.retryLimit!==0||!(Number(actual.expireInSeconds)>=600)) throw new Error("fishery.flow queue requires retryLimit=0 and expireInSeconds>=600; reconcile deployed queue before starting");
    await boss.work<{id:string}>(flowQueue.name,{batchSize:1,localConcurrency:1},async jobs=>run(jobs.map(job=>job.data)));
    return release;
  } catch(error) {await release();throw error;}
}
