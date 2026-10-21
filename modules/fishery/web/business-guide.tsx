import { BusinessGuideBody } from "./original-guide.tsx";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { ComponentProps, LoaderArgs, MetaFunction } from "@aihot/web/lib/route-types";
import type { BusinessGuideReaderItem } from "../business-contracts.ts";
import { readerHeaders } from "./reader-shell.tsx";
import { useFreshMaterial } from "./shared.tsx";
export const headers=readerHeaders;
export const meta:MetaFunction<typeof loader>=({loaderData})=>[{title:`${loaderData?.payload.title.value??"指南暂不可读"} · 远洋渔业资料预览`},{name:"robots",content:"noindex, nofollow"}];
export async function loader({request,params}:LoaderArgs){return adminGet<BusinessGuideReaderItem>(request,"/api/admin/fishery/business-reader/"+encodeURIComponent(params.id!));}
export default function BusinessGuide({ loaderData: guide }: ComponentProps<typeof loader>) {
  useFreshMaterial();
  return <article className="reader-article">
    <Link className="reader-back" to={"/fishery/topics?topicId=" + guide.payload.topicId}>← 返回经营主题</Link>
    <h1>{guide.payload.title.value}</h1>
    <BusinessGuideBody guide={guide} />
  </article>;
}
