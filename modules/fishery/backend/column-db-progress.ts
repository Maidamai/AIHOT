// Controlled archive rounds share the core source cursor, fetch ledger and failure backoff.
import { withColumnLease, columnTransaction } from './column-lease.ts';
import { isDeepStrictEqual } from 'node:util';
import { sql } from '../../../packages/backend/src/db.ts';
import { recordFetch } from '../../../packages/backend/src/sources/collect.ts';
import { initialColumnProgress, migrateColumnProfile, advanceColumnProgress, parseColumnProgress, type ColumnProgress, type ColumnProgressStore } from './column-progress.ts';
import {config} from '@aihot/backend/config';
import {audit} from '@aihot/backend/audit';
import {readBatch,verifyBatchListing} from './column-batches.ts';
import type { ColumnId } from './official-columns.ts';
export const COLUMN_CURSOR_KEY='fisheryColumnProgress';
const sourceId=(column:ColumnId)=>`fishery-column-${column}`;
const same=isDeepStrictEqual;
function state(column:ColumnId,cursor:Record<string,unknown>|null):ColumnProgress {
  const value=cursor?.[COLUMN_CURSOR_KEY];
  return value===undefined?initialColumnProgress(column):parseColumnProgress(column,value);
}
function binding(source:{id:string;kind:string;config:unknown;enabled:boolean;participation_mode:string},column:ColumnId) {
  if(source.id!==sourceId(column)||source.kind!=='external'||source.enabled!==false) throw new Error('Column source binding changed');
  if(source.participation_mode==='isolated') throw new Error('Column source is isolated; acquisition is disabled');
  return JSON.stringify({id:source.id,kind:source.kind,config:source.config});
}
export const columnDbProgress:ColumnProgressStore={
  async load(column) {
    const [source]=await sql`SELECT id,kind,config,enabled,cursor,participation_mode FROM sources WHERE id=${sourceId(column)}`;
    if(!source) throw new Error(`Missing registered source ${sourceId(column)}`);
    binding(source as never,column);return state(column,source.cursor);
  },
  async intent(column,roundId,before) {
    await columnTransaction(column,async tx=>{
      const [source]=await tx`SELECT id,kind,config,enabled,cursor,participation_mode FROM sources WHERE id=${sourceId(column)} FOR UPDATE`;
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
      const [source]=await tx`SELECT id,kind,config,enabled,cursor,participation_mode FROM sources WHERE id=${sourceId(column)} FOR UPDATE`;
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
      // Core health records whether the source listing can be read; failed article bodies are
      // reported in the same cursor/run detail and never accumulate whole-source suspension.
      if(after.health!.outcome==='success'||after.health!.listingSucceededAt) await recordFetch(tx,source.id,run.id,{...counts,cursor:{...source.cursor,[COLUMN_CURSOR_KEY]:after}});
      else await recordFetch(tx,source.id,run.id,{...counts,error:after.health!.reason??'Partial archive round',budget:false});
    });
  }
};
export async function columnDbStatus() {
  return await sql`SELECT id,enabled,health,fail_count,last_fetch_at,last_ok_at,last_error,next_fetch_at,cursor FROM sources WHERE id IN ('fishery-column-moa','fishery-column-fujian','fishery-column-iotc','fishery-column-npfc','fishery-column-fujian-notices','fishery-column-jfa-press','fishery-column-itf-fisheries','fishery-column-fao-tuna','fishery-column-mpa-port') ORDER BY id`;
}

/** Offline archive reconciliation; never makes a GET, imports material, resets a budget or enables a source. */
export async function migrateColumnDbProgress(column:ColumnId,input:{expectedProfileHash:string;reason:string;recoverRoundId?:string},actor:string) {
  if(input.reason.trim().length<12)throw new Error('Cursor migration requires a concrete inspection reason');
  return withColumnLease(column,()=>columnTransaction(column,async tx=>{
    const [source]=await tx`SELECT * FROM sources WHERE id=${sourceId(column)} FOR UPDATE`;
    if(!source)throw new Error('Missing registered column source');
    const sourceBinding=binding(source as never,column),before=source.cursor?.[COLUMN_CURSOR_KEY];
    if(!before)throw new Error('No existing cursor to migrate; never initialize during recovery');
    if((await tx`SELECT 1 FROM fetch_runs WHERE source_id=${source.id} AND finished_at IS NULL AND detail ? 'fisheryColumnRound' LIMIT 1`).length)throw new Error('Unfinished round must be reconciled under its original identity first');
    let after=migrateColumnProfile(column,before,input.expectedProfileHash);
    const proofs:{batchId:string;listingSucceededAt:string}[]=[];
    if(input.recoverRoundId) {
      const runs=await tx`SELECT * FROM fetch_runs WHERE source_id=${source.id} AND detail->'fisheryColumnRound'->>'roundId'=${input.recoverRoundId} ORDER BY id FOR UPDATE`;
      if(runs.length!==1||!runs[0].finished_at)throw new Error('Exactly one finalized recovery round required');
      const run=runs[0],intent=run.detail.fisheryColumnRound;
      if(intent.column!==column||intent.sourceBinding!==sourceBinding||!same(intent.before,before)||!Array.isArray(intent.batches)||!intent.batches.length)throw new Error('Recovery round does not bind the current cursor/source');
      const [newer]=await tx`SELECT 1 FROM fetch_runs WHERE source_id=${source.id} AND id>${run.id} LIMIT 1`;
      if(newer)throw new Error('Recovery round was superseded; inspect the latest source state');
      const priorRuns=await tx`SELECT detail FROM fetch_runs WHERE source_id=${source.id} AND finished_at IS NOT NULL AND id<=${run.id}
        AND detail->'fisheryColumnRound'->>'column'=${column} ORDER BY id LIMIT 1001`;
      if(priorRuns.length>1000)throw new Error('Recovery archive bound reached; inspect and migrate in a separately reviewed batch');
      // Recover the earliest archived discovery, including old partial rounds whose cursor was
      // never committed. Missing/corrupt archives remain an explicit migration error.
      for(const prior of priorRuns)for(const id of prior.detail.fisheryColumnRound.batches??[]) {
        const batch=await readBatch(config.dataDir,id);
        if(batch.sources[0]?.error)continue;
        const listing=await verifyBatchListing(config.dataDir,batch,column);
        after.firstSeen??={};
        for(const c of listing.candidates)if(!after.firstSeen[c.url]||Date.parse(listing.at)<Date.parse(after.firstSeen[c.url].at))after.firstSeen[c.url]={at:listing.at,batchId:batch.id};
        if(Object.keys(after.firstSeen).length>4096)throw new Error('Recovery first-seen identity bound reached; preserve archives for review');
        proofs.push({batchId:batch.id,listingSucceededAt:listing.at});
      }
      for(const id of intent.batches) {
        const batch=await readBatch(config.dataDir,id),listing=await verifyBatchListing(config.dataDir,batch,column);
        // The old round's immutable bytes prove which candidates were already discovered.
        batch.sources[0].listingSucceededAt=listing.at;
        batch.sources[0].firstSeen=Object.fromEntries(listing.candidates.map(c=>[c.url,after.firstSeen?.[c.url]??{at:listing.at,batchId:batch.id}]));
        after=advanceColumnProgress(after,batch);
      }
      after.revision=before.revision+1;
      // Only independently verified list success can repair the legacy whole-source body-failure counter.
      await tx`UPDATE sources SET fail_count=0,last_error=NULL,health='ok',last_ok_at=${after.health!.listingSucceededAt!},next_fetch_at=now(),updated_at=now() WHERE id=${source.id}`;
    }
    await tx`UPDATE sources SET cursor=${tx.json({...source.cursor,[COLUMN_CURSOR_KEY]:after})},updated_at=now() WHERE id=${source.id}`;
    await audit(actor,'fishery.column.migrate',`source:${source.id}`,input.reason,before,{after,recoveredRoundId:input.recoverRoundId??null,proofs,modelCalls:0},{db:tx});
    return {sourceId:source.id,before,after,proofs,modelCalls:0,sourceEnabled:false};
  }));
}
