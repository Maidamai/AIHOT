// Explicit source archive permission/status; never enables the core source or paid processing.
import {parseArgs} from 'node:util';
import {createArchiveController} from '../backend/archive-worker.ts';
import {closeDb} from '@aihot/backend/db';
const {values}=parseArgs({options:{column:{type:'string',default:'moa'},status:{type:'boolean'},enable:{type:'boolean'},disable:{type:'boolean'},mode:{type:'string'},'run-id':{type:'string'},'interval-seconds':{type:'string'},resume:{type:'boolean'},'acknowledge-stopped':{type:'boolean'},reason:{type:'string'}}});
if(!['moa','npfc'].includes(values.column!))throw new Error('Use --column moa|npfc; other sources are not authorized for this worker');
const {archiveStatus,configureArchive,reconcileArchive}=createArchiveController(values.column as 'moa'|'npfc');
try{
  if(values.status)console.log(JSON.stringify(await archiveStatus(),null,2));
  else if(values.resume){if(!values['acknowledge-stopped']||!values.reason)throw new Error('Resume requires --acknowledge-stopped --reason with stopped-runner evidence');console.log(JSON.stringify(await reconcileArchive(values.reason),null,2));}
  else{
    if(!!values.enable===!!values.disable||!['hourly','six_hourly','validation'].includes(values.mode??'')||!values['run-id'])throw new Error('Use --column moa|npfc --enable|--disable --mode hourly|six_hourly|validation --run-id <operator-run-id> [--interval-seconds 60 for bounded two-round validation]');
    console.log(JSON.stringify(await configureArchive({enabled:!!values.enable,mode:values.mode as 'hourly'|'six_hourly'|'validation',runId:values['run-id'],intervalSeconds:values['interval-seconds']?Number(values['interval-seconds']):undefined}),null,2));
  }
}finally{await closeDb();}
