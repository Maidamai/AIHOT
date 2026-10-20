// Dedicated manual queue consumer. No general worker, schedules, recovery sweeps or automatic retries.
import { closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { registerManualFlowConsumer } from "../backend/manual-processing.ts";

let release:(()=>Promise<void>)|undefined;
let stopping:Promise<void>|undefined;
let ready=false,stopRequested=false;
const shutdown=()=>stopping??=(async()=>{
  try {await stopBoss();}
  finally {try {await release?.();} finally {await closeDb();}}
})();
const requestStop=()=>{stopRequested=true;if(ready) void shutdown().catch(()=>{process.exitCode=1;});};
process.on("SIGTERM",requestStop);
process.on("SIGINT",requestStop);
try {
  const boss=await getBoss({schedule:false,supervise:false});
  release=await registerManualFlowConsumer(boss);
  ready=true;
  if(stopRequested) await shutdown();
  else console.log(JSON.stringify({level:"info",msg:"fishery manual processor started",queue:"fishery.flow",concurrency:1,schedules:false,automaticRetry:false}));
} catch(error) {
  console.error(JSON.stringify({status:"stopped",message:(error as Error).message,noAutomaticRetry:true}));
  process.exitCode=1;
  await shutdown();
}
