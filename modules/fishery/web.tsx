import { defineWebModule } from "@aihot/web/modules";
import { ReaderShell, ReaderError } from "./web/reader-shell.tsx";
export default defineWebModule({ name: "fishery", root:{shell:{matches:path=>path==="/fishery"||path.startsWith("/fishery/"),title:"远洋渔业资料预览",Component:ReaderShell,Error:ReaderError}},admin: { content: [{ to: "/admin/fishery", label: "渔业素材" },{to:"/admin/fishery/manual-sources",label:"人工来源导入"},{to:"/fishery",label:"行业阅读预览"}] } });
