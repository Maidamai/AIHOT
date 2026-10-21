// Changes dispatch scope only; never changes reviews, paid authorization, archive cadence or credentials.
import {parseArgs} from 'node:util';
import {sql,closeDb} from '@aihot/backend/db';
import {configureAutomaticFlows,AUTOMATIC_FLOW_KEY} from '../backend/automatic-flows.ts';
const {values}=parseArgs({options:{status:{type:'boolean'},enable:{type:'boolean'},disable:{type:'boolean'},after:{type:'string'},documents:{type:'string'},reason:{type:'string'}}});
try{
 if(values.status){const [r]=await sql`SELECT value FROM settings WHERE key=${AUTOMATIC_FLOW_KEY}`;console.log(JSON.stringify(r?.value??{enabled:false},null,2));}
 else{
  if(!!values.enable===!!values.disable||!values.after||!values.reason)throw new Error('Use --enable|--disable --after <ISO time> [--documents uuid,...] --reason <operator reason>');
  console.log(JSON.stringify(await configureAutomaticFlows({enabled:!!values.enable,sourceId:'fishery-column-moa',createdAfter:values.after,...values.documents?{documentIds:values.documents.split(',')}:{}},'authorized-agent:automatic-dispatch',values.reason),null,2));
 }
}finally{await closeDb();}
