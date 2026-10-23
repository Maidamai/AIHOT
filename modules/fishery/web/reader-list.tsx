import { redirect } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { filterParams, listPath, readFilters } from "@aihot/web/lib/seo";
import type { LoaderArgs } from "@aihot/web/lib/route-types";
import { readerHeaders } from "./reader-shell.tsx";

export const headers=readerHeaders;
export async function loader({request}:LoaderArgs) {
  await adminGet<unknown>(request,"/api/admin/me");
  const params=new URL(request.url).searchParams,filters=readFilters(params);
  const page=params.get("page"),q=params.get("q")?.trim().slice(0,200)||null;
  // Article projections keep the legacy category keys; unknown filters are discarded by readFilters.
  const target=listPath("/all",{...filterParams(filters),tag:filters.tag?.slice(0,60),q,
    tab:params.get("tab")==="relevance"?"relevance":null,
    page:page&&/^[1-9]\d*$/.test(page)&&Number(page)<=50&&Number(page)>1?Number(page):null});
  throw redirect(target,{headers:readerHeaders()});
}
export default function ReaderList(){return null;}
