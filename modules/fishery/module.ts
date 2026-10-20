import { defineModule } from "@aihot/contracts/modules";

export default defineModule({ name: "fishery", apiPaths: [/^\/api\/admin\/fishery(?:\/|$)/], adminPages: [
  { path: "admin/fishery", file: "web/list.tsx", id: "fishery-materials" },
  { path: "admin/fishery/:id", file: "web/detail.tsx", id: "fishery-material" },
] });
