// Explicit bounded operational actions. No command initializes an allowance or enables external pushes.
import { parseArgs } from 'node:util';
import { stopBoss } from "@aihot/backend/jobs/queue";
import { acquireProcessingLease } from "../modules/fishery/backend/processing-lease.ts";
import { closeDb } from '@aihot/backend/db';
import { configureNativeProcessing, nativeProcessingStatus, dispatchNativeDocuments, retireLegacyNews } from '../modules/fishery/backend/native-processing.ts';
import { migrateOrdinaryDocumentPurpose, initializeReviewOnlyPurpose } from '../modules/fishery/backend/native-permit.ts';
import { installModules } from '@aihot/backend/modules';
import { SERVER_MODULES } from '@aihot/site/modules/server';
const {positionals,values}=parseArgs({allowPositionals:true,options:{sources:{type:'string'},'created-after':{type:'string'},enabled:{type:'string'},actor:{type:'string'},reason:{type:'string'},documents:{type:'string'},execute:{type:'boolean'}}});
try{
  installModules(SERVER_MODULES);
  const command=positionals[0]??'status';
  if(command==='status')console.log(JSON.stringify(await nativeProcessingStatus(),null,2));
  else if(command==='configure'){
    if(!values.sources||!values['created-after']||!['true','false'].includes(values.enabled??'')||!values.actor||!values.reason)throw new Error('configure --sources=fishery-column-moa,... --created-after=<ISO> --enabled=true|false --actor=<operator> --reason=<reason>');
    console.log(JSON.stringify(await configureNativeProcessing({enabled:values.enabled==='true',sourceIds:values.sources.split(','),createdAfter:values['created-after']},values.actor,values.reason),null,2));
  }else if(command==='handover'){
    const ids=values.documents?.split(',')??[];
    if(!ids.length||ids.length>20||ids.some(id=>!/^[-a-f0-9]{36}$/.test(id))||!values.actor||!values.reason)throw new Error('handover --documents=<1..20 explicit UUIDs> --actor=<operator> --reason=<reason>; defaults to read-only preflight, --execute performs handover; no automatic enqueue');
    const lease=values.execute?await acquireProcessingLease():null;
    try{const results=[];for(const id of ids)results.push(await migrateOrdinaryDocumentPurpose(id,values.actor,values.reason,{dryRun:!values.execute}));console.log(JSON.stringify(results,null,2));}finally{await lease?.release();}
  }else if(command==='retire-legacy'){
    if(!values.actor||!values.reason)throw new Error('retire-legacy --actor=<operator> --reason=<reason> [--execute]; defaults to read-only inspection');
    console.log(JSON.stringify(await retireLegacyNews(values.actor,values.reason,{execute:values.execute}),null,2));
  }else if(command==='initialize-review-only'){
    if(!values.execute)console.log(JSON.stringify({dryRun:true,documentId:'5f67141e-47ee-4521-bd66-7e842936c02f',purpose:'review_only',modelCalls:0}));
    else console.log(JSON.stringify(await initializeReviewOnlyPurpose(),null,2));
  }else if(command==='dispatch'){
    // The configured source/time scope and durable document purpose are checked again for each article.
    console.log(JSON.stringify(await dispatchNativeDocuments(values.documents?.split(',')),null,2));
  }else throw new Error('Expected status, configure, handover, initialize-review-only, retire-legacy or dispatch');
}finally{
  // Keep the command result machine-readable; graceful queue-drain diagnostics go to stderr.
  const output=console.log;console.log=console.error;
  try{await stopBoss();}finally{console.log=output;await closeDb();}
}
