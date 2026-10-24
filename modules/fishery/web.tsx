import { defineWebModule } from "@aihot/web/modules";
export default defineWebModule({ name: "fishery", itemDetails: () => import("./web/original-guide.tsx"), admin: { content: [{to:"/admin/fishery/guides",label:"指南待核查"},{ to: "/admin/fishery", label: "材料工作台" },{to:"/admin/fishery/manual-sources",label:"人工来源导入"},{to:"/all",label:"主站阅读入口"}] } });
