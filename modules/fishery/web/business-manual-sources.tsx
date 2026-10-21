import { useState } from "react";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, KV } from "@aihot/web/features/admin/ui";
import { dateLabel, noStore, useFreshMaterial } from "./shared.tsx";
import { SafeSource } from "./business-shared.tsx";
export const headers=noStore;
interface ManualSource {
  id:string;importable:boolean;error:string|null;title?:string;url?:string;name?:string;attribution?:string;parser?:string;pages?:number|null;bodySha256?:string;
  dates?:{published:{precision:string;value:string|null}};published?:{precision:string;value:string|null};publishedAt?:string|null;publicationLiteral?:string|null;capturedAt?:string|null;
}
interface ImportResult {archiveId:string;rows:{id:string}[];modelCalls:0;published:false}
export async function loader({request}:LoaderArgs){return adminGet<{rows:ManualSource[]}>(request,"/api/admin/fishery/manual-sources");}
export default function ManualSources({loaderData:d}:ComponentProps<typeof loader>){
  const fresh=useFreshMaterial(),{run,busy}=useAdminAction(),[results,setResults]=useState<Record<string,ImportResult>>({});
  return <AdminPage title="人工来源导入" subtitle={<Link to="/admin/fishery" className="text-accent">← 返回素材工作台</Link>} actions={<Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>重新检查归档</Button>}>
    <p className="business-notice">导入已由操作人员提供的官方原件归档。系统检查回执、哈希与完整正文后导入素材；新建或已有素材的当前审核状态请查看素材详情。不重新采集、不调用模型、不自动批准，也不公开发布。原文日期、适用范围和权利仍须在普通素材审核中核对。</p>
    <div className="space-y-5">{d.rows.map(row=><Card key={row.id} title={row.title??row.id}><div className="mb-4 flex flex-wrap gap-2"><Badge tone={row.importable?"ok":"bad"}>{row.importable?"归档检查通过，可导入":"归档不可导入"}</Badge><Badge>审核状态见素材详情</Badge></div>
      <KV items={[["归档 ID",row.id],["来源",row.name??"未知"],["来源归属",row.attribution??"未知"],["官方原文",row.url?<SafeSource url={row.url}>{row.url}</SafeSource>:"未知"],["原文发布日期",row.dates?.published?dateLabel(row.dates.published):row.published?dateLabel(row.published):"未知"],["原文日期字面",row.publicationLiteral??"未知"],["原文发布时刻",row.publishedAt??"未知"],["归档采集时刻（非发布日期）",row.capturedAt??"未知"],["解析方式",row.parser??"未知"],["PDF 页数",row.pages??"不适用或未知"],["正文 SHA-256",row.bodySha256??"未知"]]}/>
      {row.error&&<p role="alert" className="mt-4 whitespace-pre-wrap break-words text-[13px] text-hot">{row.error}</p>}
      <div className="mt-4"><Button tone="primary" disabled={busy||!row.importable||!!results[row.id]} onClick={async()=>{const result=await run<ImportResult>("POST",`/api/admin/fishery/manual-sources/${encodeURIComponent(row.id)}/import`,{},{success:"导入完成，当前审核状态见素材详情"});if(result)setResults(old=>({...old,[row.id]:result}));}}>{results[row.id]?"已导入素材":"导入素材"}</Button></div>
      {results[row.id]&&<div role="status" className="mt-4 space-y-2 text-[13px]"><p>导入完成，当前审核状态见素材详情。未公开发布 · 模型调用 0 次</p>{results[row.id]!.rows.map(material=><Link key={material.id} to={"/admin/fishery/"+encodeURIComponent(material.id)} className="block break-words text-accent">打开素材，查看当前审核状态 → {material.id}</Link>)}</div>}
    </Card>)}</div>
    {!d.rows.length&&<Card title="暂无人工归档"><p className="text-[13px] text-ink-3">请由操作人员先提供官方原件与对应归档回执，再重新检查。此页面不发起外部采集。</p></Card>}
  </AdminPage>;
}
