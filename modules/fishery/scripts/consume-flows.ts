import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
// Dedicated flow consumer. No general worker/schedules; opt-in dispatch only wakes current approved materials.
import { closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { registerManualFlowConsumer } from "../backend/manual-processing.ts";

let release:(()=>Promise<void>)|undefined;
let stopping:Promise<void>|undefined;
let ready=false,stopRequested=false;
const shutdown=()=>stopping??=(async()=>{
  try {await release?.();}
  finally {try {await stopBoss();} finally {await closeDb();}}
})();
const requestStop=()=>{stopRequested=true;if(ready) void shutdown().catch(()=>{process.exitCode=1;});};
process.on("SIGTERM",requestStop);
process.on("SIGINT",requestStop);
try {
  installModules(SERVER_MODULES);
  if(!SERVER_MODULES.some(module=>module.name==="fishery")) throw new Error("Fishery module is not enabled for this site");
  const boss=await getBoss({schedule:false,supervise:false});
  release=await registerManualFlowConsumer(boss,undefined,{onLeaseLost:()=>{process.exitCode=1;requestStop();}});
  ready=true;
  if(stopRequested) await shutdown();
  else console.log(JSON.stringify({level:"info",msg:"fishery manual processor started",queue:"fishery.flow",publicationQueue:"fishery.publication",sourcePublicationQueue:"publication.republish-source",concurrency:1,schedules:false,automaticPaidRetry:false}));
} catch(error) {
  console.error(JSON.stringify({status:"stopped",message:(error as Error).message,noAutomaticRetry:true}));
  process.exitCode=1;
  await shutdown();
}
