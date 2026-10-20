// Offline archived PDF transformation only. The normal administrator UI performs any later import.
import { parseArgs } from "node:util";
import { reparseArchivedIotc } from "../backend/column-batches.ts";
const {values}=parseArgs({options:{"data-dir":{type:"string"},"source-batch":{type:"string"},id:{type:"string"}}});
if(!values["data-dir"]||!values["source-batch"]||!values.id) throw new Error("Use --data-dir <existing-private-data> --source-batch <complete-original-IOTC-batch> --id <new-exclusive-batch-id>");
const batch=await reparseArchivedIotc({dataDir:values["data-dir"],sourceBatchId:values["source-batch"],id:values.id});
console.log(JSON.stringify({id:batch.id,sourceBatchId:batch.reparse!.sourceBatchId,sourceManifestSha256:batch.reparse!.sourceManifestSha256,reparsedAt:batch.reparse!.reparsedAt,items:batch.items.length,acquisitionMode:"archive_replay",networkRequests:0,modelCalls:0,databaseReads:0,databaseWrites:0,imported:false,published:false}));
