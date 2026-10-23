// Changes dispatch scope only; never changes reviews, paid authorization, archive cadence or credentials.
import {parseArgs} from 'node:util';
import {sql,closeDb} from '@aihot/backend/db';
import {configureAutomaticFlows,upgradeAutomaticFlowSources,AUTOMATIC_FLOW_KEY} from '../backend/automatic-flows.ts';
const {values}=parseArgs({options:{status:{type:'boolean'},'upgrade-source-scope':{type:'boolean'},enable:{type:'boolean'},disable:{type:'boolean'},sources:{type:'string'},after:{type:'string'},documents:{type:'string'},reason:{type:'string'}}});
try{
 if(values.status){const [r]=await sql`SELECT value FROM settings WHERE key=${AUTOMATIC_FLOW_KEY}`;console.log(JSON.stringify(r?.value??{enabled:false},null,2));}
 else if(values['upgrade-source-scope'])console.log(JSON.stringify(await upgradeAutomaticFlowSources('authorized-agent:automatic-dispatch'),null,2));
 else{
  if(!!values.enable===!!values.disable||!values.sources||!values.after||!values.reason)throw new Error('Use --enable|--disable --sources fishery-column-moa,... --after <ISO time> [--documents uuid,...] --reason <operator reason>');
  console.log(JSON.stringify(await configureAutomaticFlows({enabled:!!values.enable,sourceIds:values.sources.split(','),createdAfter:values.after,...values.documents?{documentIds:values.documents.split(',')}:{}},'authorized-agent:automatic-dispatch',values.reason),null,2));
 }
}finally{await closeDb();}
