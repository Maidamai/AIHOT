// Synthetic local replay only. Never connects to a production database or calls a collector/model.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sourceFixture, observationFixture } from "../tests/fixtures.ts";

const database = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset");
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/_(test|ci)$/.test(database.pathname))
  throw new Error("Demo requires an explicitly configured local *_test or *_ci database, migrated first");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("Use --output <local output directory>");
const output = path.resolve(process.argv[outputIndex + 1]);
process.env.AIHOT_CREDENTIALS_DIR = "/nonexistent-test-credentials";
for (const name of ["COLLECT_ENABLED", "MODEL_CALLS_ENABLED", "FEISHU_CONTENT_PUSH_ENABLED", "FEISHU_INTERNAL_ENABLED", "INDEXNOW_SUBMIT_ENABLED"]) process.env[name] = "false";
const { sql, closeDb } = await import("@aihot/backend/db");
const { registerSource, createDocument, observe, review } = await import("../backend/store.ts");
const { exportMaterial, materialMarkdown } = await import("../backend/export.ts");
try {
  const sourceId = `fixture-${randomUUID()}`;
  await sql`INSERT INTO sources (id, name, kind, enabled, next_fetch_at) VALUES (${sourceId}, 'Synthetic offline demo', 'external', false, '2100-01-01')`;
  await registerSource(sourceId, sourceFixture, "offline-demo");
  const document = await createDocument({ sourceId, issuer: "Synthetic fixture issuer", documentNumber: "FIXTURE-CMM-01", canonicalUrl: `https://example.org/${sourceId}` }, "offline-demo");
  await observe(document.id, observationFixture, "offline-demo");
  await review(document.id, { revision: 1, sourceRevision: 1, decision: "approved", applicabilityReviewed: false, note: "Synthetic local demonstration; no real source or legal verification" }, "offline-demo");
  const bundle = await exportMaterial(document.id, 1, "offline-demo");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "fishery-fixture.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  await writeFile(path.join(output, "fishery-fixture.md"), materialMarkdown(bundle));
  console.log(`Synthetic JSON and Markdown written to ${output}; no source bytes fetched or Easel upload performed.`);
} finally { await closeDb(); }
