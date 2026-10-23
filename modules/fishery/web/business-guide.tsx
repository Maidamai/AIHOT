import { redirect } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { LoaderArgs } from "@aihot/web/lib/route-types";
import { readerHeaders } from "./reader-shell.tsx";

export const headers=readerHeaders;
export async function loader({request,params}:LoaderArgs) {
  const target=await adminGet<{url:string}>(request,`/api/admin/fishery/reader-target/business_guide/${encodeURIComponent(params.id!)}`);
  throw redirect(target.url,{headers:readerHeaders()});
}
export default function BusinessGuide(){return null;}
