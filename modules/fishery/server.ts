import { defineServerModule } from "@aihot/backend/modules";
import { adminHandler, type AdminHandler } from "@aihot/api/routes/admin-auth";
import { sendProblem } from "@aihot/api/http/respond";
import { exportSchema, idSchema } from "./contracts.ts";
import { createDocument, documentHistory, listDocuments, listSources, NotFound, observe, registerSource, review, sourceHealth, withdraw } from "./backend/store.ts";
import { exportMaterial, materialMarkdown } from "./backend/export.ts";
import { materialDetail, workbench } from "./backend/workbench.ts";
import { z } from "zod";
import { config } from "@aihot/backend/config";
import { batchIdSchema, listBatches } from "./backend/column-batches.ts";
import { importBatch } from "./backend/import-batch.ts";

import { reconcileFlow, revisionContext, createHumanRevision, createFlow, flowDetail, listFlows, enqueueFlow, retryFlow, decideFlow, flowQueue } from "./backend/flow.ts";

import { readerPage, readerItem, READER_CATEGORIES } from "./backend/reader.ts";

const guarded = (handler: AdminHandler) => adminHandler(async (req, reply, admin) => {
  try { return await handler(req, reply, admin); }
  catch (error) {
    if (error instanceof NotFound) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "No such fishery record." });
    throw error;
  }
});
const param = (req: { params: unknown }) => idSchema.parse((req.params as Record<string, string>).id);

export default defineServerModule({
  name: "fishery", sourceHealth, queues:[flowQueue],
  http(app) {
    app.get("/api/admin/fishery/reader", guarded(async req=>readerPage(z.strictObject({category:z.enum(Object.keys(READER_CATEGORIES) as [keyof typeof READER_CATEGORIES,...(keyof typeof READER_CATEGORIES)[]]).optional(),page:z.coerce.number().int().positive().max(100000).optional()}).parse(req.query))));
    app.get("/api/admin/fishery/reader/:id", guarded(async req=>readerItem(param(req))));
    app.get("/api/admin/fishery/documents/:id/flows", guarded(async req=>({rows:await listFlows(param(req))})));
    app.post("/api/admin/fishery/documents/:id/flows", guarded(async(req,reply,admin)=>reply.code(201).send(await createFlow(param(req),req.body,admin.name))));
    app.get("/api/admin/fishery/flows/:id", guarded(async req=>flowDetail(param(req))));
    app.get("/api/admin/fishery/flows/:id/revision", guarded(async req=>revisionContext(param(req))));
    app.post("/api/admin/fishery/flows/:id/revision", guarded(async(req,reply,admin)=>reply.code(201).send(await createHumanRevision(param(req),req.body,admin.name))));
    app.post("/api/admin/fishery/flows/:id/run", guarded(async req=>enqueueFlow(param(req))));
    app.post("/api/admin/fishery/flows/:id/reconcile", guarded(async(req,_reply,admin)=>reconcileFlow(param(req),req.body,admin.name)));
    app.post("/api/admin/fishery/flows/:id/retry", guarded(async(req,_reply,admin)=>retryFlow(param(req),req.body,admin.name)));
    app.post("/api/admin/fishery/flows/:id/decision", guarded(async(req,_reply,admin)=>decideFlow(param(req),req.body,admin.name)));
    app.get("/api/admin/fishery/workbench", guarded(async req => workbench(z.object({ page:z.coerce.number().int().positive().max(100000).optional(),q:z.string().max(200).optional(),scope:z.enum(["real","test","all"]).optional(),state:z.enum(["pending","failed","unverified","stale","rejected","approved","withdrawn"]).optional().or(z.literal("")) }).parse(req.query))));
    app.get("/api/admin/fishery/batches", guarded(async () => ({rows:await listBatches(config.dataDir)})));
    app.post("/api/admin/fishery/batches/:id/flows", guarded(async(req,_reply,admin)=>{
      const {identity}=z.strictObject({identity:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)}).parse(req.body);
      const imported=await importBatch(batchIdSchema.parse((req.params as {id:string}).id),admin.name);
      const tasks=[];for(const document of imported.rows) tasks.push(await createFlow(document.id,{identity},admin.name));
      return {batchId:imported.batchId,tasks,modelCalls:0,published:false};
    }));
    app.post("/api/admin/fishery/batches/:id/import", guarded(async (req,_reply,admin) => importBatch(batchIdSchema.parse((req.params as {id:string}).id),admin.name)));
    app.get("/api/admin/fishery/documents/:id/detail", guarded(async req => materialDetail(param(req))));
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
