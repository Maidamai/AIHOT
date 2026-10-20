import { defineServerModule } from "@aihot/backend/modules";
import { adminHandler, type AdminHandler } from "@aihot/api/routes/admin-auth";
import { sendProblem } from "@aihot/api/http/respond";
import { exportSchema, idSchema } from "./contracts.ts";
import { createDocument, documentHistory, listDocuments, listSources, NotFound, observe, registerSource, review, sourceHealth, withdraw } from "./backend/store.ts";
import { exportMaterial, materialMarkdown } from "./backend/export.ts";

const guarded = (handler: AdminHandler) => adminHandler(async (req, reply, admin) => {
  try { return await handler(req, reply, admin); }
  catch (error) {
    if (error instanceof NotFound) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "No such fishery record." });
    throw error;
  }
});
const param = (req: { params: unknown }) => idSchema.parse((req.params as Record<string, string>).id);

export default defineServerModule({
  name: "fishery", sourceHealth,
  http(app) {
    app.get("/api/admin/fishery/sources", guarded(async () => ({ rows: await listSources() })));
    app.put("/api/admin/fishery/sources/:id", guarded(async (req, _reply, admin) => registerSource(param(req), req.body, admin.name)));
    app.get("/api/admin/fishery/documents", guarded(async () => ({ rows: await listDocuments() })));
    app.post("/api/admin/fishery/documents", guarded(async (req, reply, admin) => reply.code(201).send(await createDocument(req.body, admin.name))));
    app.get("/api/admin/fishery/documents/:id", guarded(async (req) => documentHistory(param(req))));
    app.post("/api/admin/fishery/documents/:id/observations", guarded(async (req, reply, admin) => reply.code(201).send(await observe(param(req), req.body, admin.name))));
    app.post("/api/admin/fishery/documents/:id/reviews", guarded(async (req, reply, admin) => reply.code(201).send(await review(param(req), req.body, admin.name))));
    app.post("/api/admin/fishery/documents/:id/withdraw", guarded(async (req, _reply, admin) => withdraw(param(req), req.body, admin.name)));
    app.post("/api/admin/fishery/documents/:id/export", guarded(async (req, reply, admin) => {
      const id = param(req);
      const data = exportSchema.parse(req.body);
      const bundle = await exportMaterial(id, data.revision, admin.name);
      return reply.header("Content-Disposition", `attachment; filename="fishery-${id}-r${data.revision}.${data.format === "json" ? "json" : "md"}"`)
        .type(data.format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8")
        .send(data.format === "json" ? bundle : materialMarkdown(bundle));
    }));
  },
});
