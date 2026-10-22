// Source-scoped, retained-session ownership for both scheduled archives and explicit DB CLI rounds.
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { config } from '@aihot/backend/config';
import { sql, type Tx } from '@aihot/backend/db';
import type { ColumnId } from './official-columns.ts';
export interface ColumnLease {
  column:ColumnId; backendPid:number; signal:AbortSignal;
  assertHeld:()=>Promise<void>;
  transaction:<T>(fn:(tx:Tx)=>Promise<T>)=>Promise<T>;
  release:()=>Promise<void>;
}
const invalidators=new Set<()=>void>();
export function cancelColumnArchives(){for(const cancel of invalidators)cancel();}
const context=new AsyncLocalStorage<Map<ColumnId,ColumnLease>>();
export const currentColumnLease=(column?:ColumnId)=>column?context.getStore()?.get(column):context.getStore()?.values().next().value;
export async function assertColumnLeases(){for(const lease of context.getStore()?.values()??[])await lease.assertHeld();}
export async function acquireColumnLease(column:ColumnId):Promise<ColumnLease> {
  const controller=new AbortController(),key=`fishery.column-archive.${column}`;
  let invalid:Error|null=null,released=false,inTransaction=false;
  let transactionTail:Promise<unknown>=Promise.resolve();
  const invalidate=(error:Error)=>{if(!invalid){invalid=error;controller.abort(error);}};
  const client=postgres(config.databaseUrl,{max:1,idle_timeout:0,max_lifetime:0,connect_timeout:5,onnotice:()=>{},
    connection:{application_name:`fishery-column-lease-${column}`},onclose:()=>{if(!released)invalidate(new Error('Column archive lease connection lost; explicit reconciliation required'));}});
  let session:Awaited<ReturnType<typeof client.reserve>>|undefined;
  try {
    session=await client.reserve();
    const [row]=await session`SELECT pg_backend_pid() AS pid,pg_try_advisory_lock(hashtextextended(${key},0)) AS held`;
    if(!row.held) throw new Error(`Column ${column} archive lease unavailable`);
    const cancel=()=>invalidate(new Error('Column archive worker stopping; explicit reconciliation required'));invalidators.add(cancel);
    const backendPid=Number(row.pid);
    const check=async(db:Tx|typeof session)=>{
      if(invalid)throw invalid;
      try {
        const [owner]=await db!`SELECT pg_backend_pid() AS pid,EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory'
          AND pid=pg_backend_pid() AND granted AND objsubid=1 AND mode='ExclusiveLock'
          AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${key},0)&4294967295)::oid) AS held`;
        if(Number(owner.pid)!==backendPid||!owner.held)throw new Error('Column archive lease session/lock changed');
      } catch(error) {invalidate(new Error('Column archive lease invalid; explicit reconciliation required',{cause:error}));}
      if(invalid)throw invalid;
    };
    const lease:ColumnLease={column,backendPid,signal:controller.signal,assertHeld:()=>check(session),
      transaction:fn=>{
        const run=transactionTail.then(async()=>{
          if(invalid)throw invalid;
          // postgres ReservedSql has no runtime begin(): explicitly bracket this retained session.
          inTransaction=true;
          try{await session!.unsafe('BEGIN');await check(session);const result=await fn(session as unknown as Tx);await check(session);await session!.unsafe('COMMIT');return result;}
          catch(error){if(!invalid)await session!.unsafe('ROLLBACK').catch(()=>{});throw error;}
          finally{inTransaction=false;}
        });
        transactionTail=run.catch(()=>{});return run;
      },
      release:async()=>{if(released)return;released=true;invalidators.delete(cancel);clearInterval(watch);
        try{if(!invalid)await session!`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;}
        finally{invalidate(new Error('Column archive lease released'));session!.release();await client.end({timeout:1});}}
    };
    let checking=false;
    const watch=setInterval(()=>{if(checking||invalid||inTransaction)return;checking=true;void lease.assertHeld().catch(()=>{}).finally(()=>{checking=false;});},200);watch.unref();
    return lease;
  } catch(error) {released=true;session?.release();await client.end({timeout:1});throw error;}
}
export async function withColumnLease<T>(column:ColumnId,run:(lease:ColumnLease)=>Promise<T>):Promise<T> {
  const active=context.getStore()?.get(column);
  if(active){await active.assertHeld();return run(active);}
  const lease=await acquireColumnLease(column);
  try{return await context.run(new Map([...(context.getStore()??[]),[column,lease]]),()=>run(lease));}finally{await lease.release();}
}
export async function columnTransaction<T>(column:ColumnId,run:(tx:Tx)=>Promise<T>):Promise<T> {
  return withColumnLease(column,lease=>lease.transaction(run));
}
// Only archive import paths use this helper; other manual sources keep their original transaction.
export async function capturedTransaction<T>(column:string,run:(tx:Tx)=>Promise<T>):Promise<T> {
  if(column==='moa'||column==='fujian'||column==='iotc'||column==='npfc')return columnTransaction(column,run);
  return await sql.begin(run) as T;
}

export async function withColumnLeases<T>(columns:ColumnId[],run:()=>Promise<T>):Promise<T>{
  const [column,...rest]=[...new Set(columns)].sort();
  return column?withColumnLease(column,()=>withColumnLeases(rest,run)):run();
}
