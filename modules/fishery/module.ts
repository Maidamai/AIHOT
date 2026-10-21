import { defineModule } from "@aihot/contracts/modules";

export default defineModule({ name: "fishery", apiPaths: [/^\/api\/admin\/fishery(?:\/|$)/], pages:[
  {path:"fishery/topics",file:"web/business-topics.tsx",id:"fishery-business-topics"},
  {path:"fishery/guides/:id",file:"web/business-guide.tsx",id:"fishery-business-guide"},
  {path:"fishery",file:"web/reader-list.tsx",id:"fishery-reader"},
  {path:"fishery/:id",file:"web/reader-item.tsx",id:"fishery-reader-item"},
  {path:"fishery/*",file:"web/reader-unavailable.tsx",id:"fishery-reader-unavailable"},
], adminPages: [
  {path:"admin/fishery/guides",file:"web/business-admin-list.tsx",id:"fishery-business-admin-list"},
  {path:"admin/fishery/manual-sources",file:"web/business-manual-sources.tsx",id:"fishery-manual-sources"},
  {path:"admin/fishery/guides/:id",file:"web/business-admin.tsx",id:"fishery-business-admin"},
  { path: "admin/fishery", file: "web/list.tsx", id: "fishery-materials" },
  { path: "admin/fishery/collect", file: "web/collect.tsx", id: "fishery-batches" },
  { path: "admin/fishery/flows/:id", file: "web/flow.tsx", id: "fishery-flow" },
  { path: "admin/fishery/:id", file: "web/detail.tsx", id: "fishery-material" },
] });
