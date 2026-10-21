// Durable, non-paid continuation of a successful final editorial decision.
import { defineQueue } from "@aihot/backend/modules";
import { sql, type Db } from "@aihot/backend/db";
import { enqueueOn, getBoss } from "@aihot/backend/jobs/queue";
import { hash } from "./store.ts";
import { assertProcessingLease } from "./processing-lease.ts";

export interface PublicationJob { kind: "article" | "business_guide"; itemId: string; decisionId: string; decisionHash: string; actor: string; }
export const publicationDecisionHash = (decision: unknown, revision: number | null = null) => hash({ decision, revision });
export async function publicationDecisionCurrent(job: PublicationJob, db: Db = sql): Promise<boolean> {
  const [row] = job.kind === "article"
    ? await db`SELECT t.id,t.status,t.human_decision,NULL::integer AS revision,d.withdrawn_reason FROM fishery_flow_tasks t JOIN fishery_documents d ON d.id=t.document_id WHERE t.document_id=${job.itemId} ORDER BY t.created_at DESC,t.id DESC LIMIT 1`
    : await db`SELECT g.id,g.status,g.human_decision,g.revision,d.withdrawn_reason FROM fishery_business_guides g JOIN fishery_documents d ON d.id=g.document_id WHERE g.id=${job.itemId}`;
  return !!row && !row.withdrawn_reason && row.id === job.decisionId && row.status === (job.kind === "article" ? "qualified" : "approved")
    && publicationDecisionHash(row.human_decision, row.revision) === job.decisionHash;
}
export const publicationQueue = defineQueue<PublicationJob>({
  name: "fishery.publication", options: { policy: "short", retryLimit: 2, retryDelay: 5, expireInSeconds: 300 },
  worker: { batchSize: 1, localConcurrency: 1 },
  run: async jobs => {
    await assertProcessingLease();
    const { syncFisheryPublications } = await import("./publication-bridge.ts");
    for (const job of jobs) {
      await assertProcessingLease();
      await syncFisheryPublications(job.actor, new Date(), { target: { kind: job.kind, id: job.itemId }, expectedDecision: job, assertHeld: assertProcessingLease });
    }
  },
});
export async function enqueuePublication(job: PublicationJob, tx: Db) {
  await getBoss({ schedule: false, supervise: false });
  return enqueueOn(publicationQueue, job, { singletonKey: `${job.kind}:${job.itemId}:${job.decisionHash}` }, tx);
}
