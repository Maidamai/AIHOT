import { parseArgs } from "node:util";
import { collectColumns } from "../backend/column-batches.ts";
import { columnIdSchema } from "../backend/official-columns.ts";
import {collectColumnRound,listColumnProgress,listColumnRounds} from "../backend/column-progress.ts";

const { values } = parseArgs({ options: { id: { type: "string" }, "data-dir": { type: "string" }, columns: { type: "string", default: "moa,fujian" }, limit: { type: "string", default: "3" }, "iotc-select": { type: "string" },incremental:{type:"boolean"},pages:{type:"string",default:"2"},resume:{type:"boolean"},"acknowledge-stopped":{type:"boolean"},reason:{type:"string"},status:{type:"boolean"},storage:{type:"string",default:"file"} } });
if(!["file","db"].includes(values.storage!)) throw new Error("--storage must be file or db");
// Retain the adapter for historical evidence and offline tests, not new operational acquisition.
if(!values.status && values.columns!.split(",").includes("iotc")) throw new Error("IOTC business source is retired; new acquisition is disabled by operator policy");
if(values.storage==="db"&&!values.incremental&&!values.status) throw new Error("DB storage requires --incremental or --status");
const db=values.storage==="db"?await import("../backend/column-db-progress.ts"):null;
if(values.status) {
  if(!values["data-dir"]) throw new Error("Status needs --data-dir");
  console.log(JSON.stringify({storage:values.storage,sourceState:db?await db.columnDbStatus():null,progress:await listColumnProgress(values["data-dir"],db?.columnDbProgress),rounds:await listColumnRounds(values["data-dir"]),modelCalls:0},null,2));
} else if(values.incremental) {
  if(!values.id||!values["data-dir"]||values["iotc-select"]) throw new Error("Use --incremental --id <exclusive-round-id, max40> --data-dir <private-dir> [--columns moa,fujian,iotc] [--limit 1..5] [--pages 1..3]; no direct IOTC selection");
  if(values.resume&&(!values["acknowledge-stopped"]||!values.reason)) throw new Error("Resume requires --acknowledge-stopped --reason explaining how the old runner was verified stopped");
  if(!values.resume&&(values["acknowledge-stopped"]||values.reason)) throw new Error("Stopped-runner assertion only belongs to an explicit resume");
  const round=await collectColumnRound({storage:values.storage as "file"|"db",store:db?.columnDbProgress,id:values.id,dataDir:values["data-dir"],columns:values.columns!.split(",").map(c=>columnIdSchema.parse(c)),limit:Number(values.limit),maxPages:Number(values.pages),resume:values.resume?{acknowledgeStopped:true,reason:values.reason!}:undefined});
  console.log(JSON.stringify({round,modelCalls:0,imported:false,published:false},null,2));
  if(round.outcome!=="success") process.exitCode=2;
} else {
if(values.resume||values["acknowledge-stopped"]||values.reason) throw new Error("Recovery flags require --incremental");
if (!values.id || !values["data-dir"]) throw new Error("Use --id <new-run-id> --data-dir <private-directory> [--columns moa,fujian,iotc] [--limit 1..5] [--iotc-select 26/03,26/01]");
const batch = await collectColumns({ id: values.id, dataDir: values["data-dir"], columns: values.columns!.split(",").map(c => columnIdSchema.parse(c)), limit: Number(values.limit), iotcSelect: values["iotc-select"]?.split(",").map(v => v.trim()) });
console.log(JSON.stringify({ id: batch.id, sources: batch.sources, attempted: batch.items.length, ready: batch.items.filter(i => i.state === "ready").length, failed: batch.items.filter(i => i.state === "failed").length, irrelevant: batch.items.filter(i => i.state === "irrelevant").length, reviewState: "unreviewed", modelCalls: 0, imported: false, published: false }, null, 2));
}

if(db) {const {closeDb}=await import("../../../packages/backend/src/db.ts");await closeDb();}
