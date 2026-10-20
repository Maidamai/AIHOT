// Keep unmatched paths inside the same authenticated, private reader boundary.
import { data } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { LoaderArgs } from "@aihot/web/lib/route-types";
import { readerHeaders } from "./reader-shell.tsx";
export const headers=readerHeaders;
export async function loader({request}:LoaderArgs) {
  await adminGet<unknown>(request,"/api/admin/me");
  throw data({message:"not_found"},{status:404,headers:readerHeaders()});
}
export default function Unavailable(){return null;}
