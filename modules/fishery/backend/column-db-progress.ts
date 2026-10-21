// Controlled archive rounds share the core source cursor, fetch ledger and failure backoff.
import { columnTransaction } from './column-lease.ts';
import { isDeepStrictEqual } from 'node:util';
import { sql } from '../../../packages/backend/src/db.ts';
import { recordFetch } from '../../../packages/backend/src/sources/collect.ts';
import { initialColumnProgress, parseColumnProgress, type ColumnProgress, type ColumnProgressStore } from './column-progress.ts';
import type { ColumnId } from './official-columns.ts';
export const COLUMN_CURSOR_KEY='fisheryColumnProgress';
const sourceId=(column:ColumnId)=>`fishery-column-${column}`;
const same=isDeepStrictEqual;
function state(column:ColumnId,cursor:Record<string,unknown>|null):ColumnProgress {
  const value=cursor?.[COLUMN_CURSOR_KEY];
  return value===undefined?initialColumnProgress(column):parseColumnProgress(column,value);
}
function binding(source:{id:string;kind:string;config:unknown;enabled:boolean},column:ColumnId) {
  if(source.id!==sourceId(column)||source.kind!=='external'||source.enabled!==false) throw new Error('Column source binding changed');
  return JSON.stringify({id:source.id,kind:source.kind,config:source.config});
}
export const columnDbProgress:ColumnProgressStore={
  async load(column) {
    const [source]=await sql`SELECT id,kind,config,enabled,cursor FROM sources WHERE id=${sourceId(column)}`;
    if(!source) throw new Error(`Missing registered source ${sourceId(column)}`);
    binding(source as never,column);return state(column,source.cursor);
  },
  async intent(column,roundId,before) {
    await columnTransaction(column,async tx=>{
      const [source]=await tx`SELECT id,kind,config,enabled,cursor FROM sources WHERE id=${sourceId(column)} FOR UPDATE`;
      if(!source) throw new Error('Missing registered column source');
      parseColumnProgress(column,before);
      const sourceBinding=binding(source as never,column);
      const runs=await tx`SELECT id,source_id,detail FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId'=${roundId} AND detail->'fisheryColumnRound'->>'column'=${column} ORDER BY id FOR UPDATE`;
      if(runs.length>1) throw new Error('Duplicate round audit intent');
      if(runs[0]) {
        const intent=runs[0].detail.fisheryColumnRound;
        if(runs[0].source_id!==source.id||intent.sourceBinding!==sourceBinding||!same(intent.before,before)) throw new Error('Fetch run source/profile binding mismatch');
        return;
      }
      if((await tx`SELECT id FROM fetch_runs WHERE source_id=${source.id} AND finished_at IS NULL AND detail ? 'fisheryColumnRound' LIMIT 1`).length)throw new Error('Unfinished source round; explicit reconciliation required');
      if(!same(state(column,source.cursor),before)) throw new Error('Column cursor changed before intent');
      await tx`INSERT INTO fetch_runs (source_id,detail) VALUES (${source.id},${tx.json({fisheryColumnRound:{roundId,column,sourceBinding,before}})})`;
    });
  },
  async finish(column,roundId,before,after,batches,found) {
    await columnTransaction(column,async tx=>{
      const [source]=await tx`SELECT id,kind,config,enabled,cursor FROM sources WHERE id=${sourceId(column)} FOR UPDATE`;
      if(!source) throw new Error('Missing registered column source');
      parseColumnProgress(column,before);
      const sourceBinding=binding(source as never,column);
      const runs=await tx`SELECT * FROM fetch_runs WHERE detail->'fisheryColumnRound'->>'roundId'=${roundId} AND detail->'fisheryColumnRound'->>'column'=${column} ORDER BY id FOR UPDATE`;
      if(runs.length!==1) throw new Error('Missing or duplicate round intent');
      parseColumnProgress(column,after);
      const run=runs[0]!,intent=run.detail.fisheryColumnRound;
      if(run.source_id!==source.id||intent.sourceBinding!==sourceBinding||!same(intent.before,before)||after.profileHash!==before.profileHash||after.column!==column) throw new Error('Fetch run source/profile binding mismatch');
      if(run.finished_at) {
        if(!same(intent.after,after)||!same(intent.batches,batches)) throw new Error('Finalized run evidence differs');
        return;
      }
      if(!same(state(column,source.cursor),before)) throw new Error('Column cursor changed before commit');
      const detail={fisheryColumnRound:{...intent,after,batches},outcome:after.health!.outcome,archiveOnly:true};
      const counts={found,created:0,detail};
      if(after.health!.outcome==='success') await recordFetch(tx,source.id,run.id,{...counts,cursor:{...source.cursor,[COLUMN_CURSOR_KEY]:after}});
      else await recordFetch(tx,source.id,run.id,{...counts,error:after.health!.reason??'Partial archive round',budget:false});
    });
  }
};
export async function columnDbStatus() {
  return await sql`SELECT id,enabled,health,fail_count,last_fetch_at,last_ok_at,last_error,next_fetch_at,cursor FROM sources WHERE id IN ('fishery-column-moa','fishery-column-fujian','fishery-column-iotc') ORDER BY id`;
}
