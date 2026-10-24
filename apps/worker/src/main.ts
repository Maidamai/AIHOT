// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
import { assertProductionSecrets } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss, workModuleQueues } from "@aihot/backend/jobs/queue";
import { startModuleWorkerProfile,installModules,serverModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { registerContentJobs } from "@aihot/backend/jobs/content";
import { registerSourceJobs } from "@aihot/backend/jobs/sources";
import { registerEventJobs } from "@aihot/backend/jobs/events";
import { registerNotifyJobs } from "@aihot/backend/jobs/notify";
import { registerPublicationJobs } from "@aihot/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@aihot/backend/notify/deliver";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";

installModules(SERVER_MODULES);
const profile=process.env.WORKER_PROFILE??"full";
let stopProfile:(()=>Promise<void>)|undefined;
const stopOwnerships:Array<()=>Promise<void>>=[];
if(profile!=="full") {
  stopProfile=await startModuleWorkerProfile(profile);
} else {
  try{
  for(const module of serverModules())if(module.processing?.fullWorkerLease)stopOwnerships.push(await module.processing.fullWorkerLease());
  for(const module of serverModules()){const required=await module.processing?.workerProfile?.();if(required)throw new Error(`Module ${module.name} requires WORKER_PROFILE=${required}; stop the generic worker before switching`);}
  assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);
  await ensureContentTargets();
  const boss = await getBoss();
  await registerContentJobs(boss);
  if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
  await registerEventJobs(boss);
  await registerNotifyJobs(boss);
  await registerPublicationJobs(boss);
  await workModuleQueues(boss);
  await registerSchedules(boss);
  }catch(error){await stopBoss();for(const stop of stopOwnerships.reverse())await stop();await closeDb();throw error;}
}
const heartbeat = startHeartbeat(profile==="full"?"worker":`worker.${profile}`);
console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const started = performance.now();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  clearInterval(heartbeat);
  if(stopProfile)await stopProfile();else await stopBoss();
  for(const stop of stopOwnerships.reverse())await stop();
  const closing = performance.now();
  await closeDb();
  console.log(JSON.stringify({ level: "info", msg: "worker stopped", elapsedMs: Math.round(performance.now() - started),
    databaseCloseMs: Math.round(performance.now() - closing) }));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
