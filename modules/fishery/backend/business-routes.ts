import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminHandler, type AdminHandler } from "@aihot/api/routes/admin-auth";
import { sendProblem } from "@aihot/api/http/respond";
import { businessGuideKindSchema, businessTopicIdSchema } from "../business-contracts.ts";
import { idSchema } from "../contracts.ts";
import { businessGuideAdminDetail, businessGuideContext, businessGuideHistory, businessGuideReaderItem, businessGuideReaderPage,
  createBusinessGuide, decideBusinessGuide, listBusinessGuides, updateBusinessGuide } from "./business-guides.ts";
import { NotFound } from "./store.ts";

const guarded = (handler: AdminHandler) => adminHandler(async (req, reply, admin) => {
  reply.header("Cache-Control", "private, no-store").header("X-Robots-Tag", "noindex, nofollow");
  try { return await handler(req, reply, admin); }
  catch (error) {
    if (error instanceof NotFound) return sendProblem(req, reply, { status: 404, code: "not_found", detail: error.message });
    throw error;
  }
});
const id = (req: { params: unknown }) => idSchema.parse((req.params as { id: string }).id);

/** Root integration calls this from the existing fishery server module; no new auth or public exit. */
export function registerBusinessGuideRoutes(app: FastifyInstance) {
  app.get("/api/admin/fishery/business-guides", guarded(async () => ({ rows: await listBusinessGuides() })));
  app.get("/api/admin/fishery/business-guides/context/:id", guarded(async req => businessGuideContext(id(req))));
  app.post("/api/admin/fishery/business-guides", guarded(async (req, reply, admin) => reply.code(201).send(await createBusinessGuide(req.body, admin.name))));
  app.get("/api/admin/fishery/business-guides/:id", guarded(async req => businessGuideAdminDetail(id(req))));
  app.put("/api/admin/fishery/business-guides/:id", guarded(async (req, _reply, admin) => updateBusinessGuide(id(req), req.body, admin.name)));
  app.post("/api/admin/fishery/business-guides/:id/decision", guarded(async (req, _reply, admin) => decideBusinessGuide(id(req), req.body, admin.name)));
  app.get("/api/admin/fishery/business-guides/:id/history", guarded(async req => ({ rows: await businessGuideHistory(id(req)) })));
  app.get("/api/admin/fishery/business-reader", guarded(async req => businessGuideReaderPage(z.strictObject({
    topicId: businessTopicIdSchema.optional(), kind: businessGuideKindSchema.optional(), page: z.coerce.number().int().min(1).max(10000).optional(),
  }).parse(req.query))));
  app.get("/api/admin/fishery/business-reader/:id", guarded(async req => businessGuideReaderItem(id(req))));
}
