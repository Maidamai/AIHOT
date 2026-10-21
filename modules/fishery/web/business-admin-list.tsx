import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs } from "@aihot/web/lib/route-types";
import { AdminPage, Badge, Button, Card, KV } from "@aihot/web/features/admin/ui";
import type { BusinessGuideAdminRecord } from "../business-contracts.ts";
import { noStore, useFreshMaterial } from "./shared.tsx";
import { BUSINESS_KINDS } from "./business-shared.tsx";
export const headers=noStore;
export async function loader({request}:LoaderArgs){return adminGet<{rows:BusinessGuideAdminRecord[]}>(request,"/api/admin/fishery/business-guides");}
export function guideReviewLabel(r:BusinessGuideAdminRecord){
  if(r.readable)return "完整审核链已完成";
  if(r.status==="approved"&&!r.aiReview.receiptId)return "旧审核批准，AI核查待补，未完成完整审核链";
  return r.status==="approved"?"编审已记录，完整审核链未完成":({draft:"编审草稿，待核查",rejected:"已拒绝",withdrawn:"已撤销"}[r.status]);
}
export default function BusinessAdminList({loaderData:d}:ComponentProps<typeof loader>){
  const fresh=useFreshMaterial();
  return <AdminPage title="业务指南待核查" subtitle="未完成完整审核链的内容仅在管理员后台可见。" actions={<><Link className="text-[13px] text-accent" to="/admin/fishery/guides/new">新建编审草稿 →</Link><Button busy={fresh.state==="loading"} onClick={()=>fresh.revalidate()}>重新核对</Button></>}>
    <p className="business-notice">编审整理和最终审核不能替代AI核查。当前版本须完成AI核查并经最终批准，才能进入读者列表、详情与主题计数。旧审核批准不自动沿用为最终批准。此页面不发起模型调用。</p>
    <div className="space-y-5">{d.rows.map(r=><Card key={r.id} title={<Link to={"/admin/fishery/guides/"+r.id} className="text-accent">{r.payload.title.value}</Link>}><div className="mb-3 flex flex-wrap gap-2"><Badge>{BUSINESS_KINDS[r.payload.kind]}</Badge><Badge tone={r.readable?"ok":"warn"}>{guideReviewLabel(r)}</Badge></div><KV items={[["内容编写","编审整理"],["当前指南版本",r.revision],["AI核查状态",r.aiReview.status],["AI核查绑定当前版本",r.aiReview.current?"是":"否"],["AI核查结果",r.aiReview.current&&r.aiReview.pass?"通过":"未通过或待核查"],["当前AI回执",r.aiReview.receiptId??"无"],["读者可见",r.readable?"完整审核链已完成":"不可见"],["阻断原因",r.blockedReason??"无"]]}/><Link to={"/admin/fishery/guides/"+r.id} className="mt-4 block text-[13px] text-accent">打开指南与审核链 →</Link></Card>)}</div>
    {!d.rows.length&&<Card title="暂无待核查指南"><Link to="/admin/fishery/guides/new" className="text-[13px] text-accent">从当前素材新建编审草稿 →</Link></Card>}
  </AdminPage>;
}
