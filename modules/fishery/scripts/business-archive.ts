// Operator-only registration. Existing sources and their rights are never overwritten.
import {parseArgs} from 'node:util';
import {closeDb} from '@aihot/backend/db';
import {isBusinessSource} from '../backend/business-capture.ts';
import {COLUMNS} from '../backend/official-columns.ts';
import {registerCaptureSource} from '../backend/store.ts';
const {values}=parseArgs({options:{column:{type:'string'},register:{type:'boolean'}}});
try{
 if(!values.register||!values.column||!isBusinessSource(values.column))throw new Error('Use --register --column itf-fisheries|fao-tuna|mpa-port; then explicitly configure the normal archive cadence');
 console.log(JSON.stringify(await registerCaptureSource({id:values.column,...COLUMNS[values.column]},'fishery-business-archive:operator')));
}finally{await closeDb();}
