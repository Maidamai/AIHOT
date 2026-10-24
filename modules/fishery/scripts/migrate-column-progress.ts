// Explicit migration of persisted acquisition cursors; no collection, import or paid dispatch.
import {parseArgs} from 'node:util';
import {columnIdSchema} from '../backend/official-columns.ts';
import {migrateColumnDbProgress} from '../backend/column-db-progress.ts';
import {closeDb} from '@aihot/backend/db';
const {values}=parseArgs({options:{column:{type:'string'},'expected-profile-hash':{type:'string'},'recover-round':{type:'string'},reason:{type:'string'}}});
if(!values.column||!values['expected-profile-hash']||!values.reason)throw new Error('Use --column <id> --expected-profile-hash <existing hash> --reason <inspection evidence> [--recover-round <exact finalized round id>]');
try {console.log(JSON.stringify(await migrateColumnDbProgress(columnIdSchema.parse(values.column),{expectedProfileHash:values['expected-profile-hash'],reason:values.reason,recoverRoundId:values['recover-round']},'fishery-column-migration'),null,2));}
finally {await closeDb();}
