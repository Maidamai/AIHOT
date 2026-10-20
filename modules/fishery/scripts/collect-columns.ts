import { parseArgs } from "node:util";
import { collectColumns } from "../backend/column-batches.ts";
import { columnIdSchema } from "../backend/official-columns.ts";

const { values } = parseArgs({ options: { id: { type: "string" }, "data-dir": { type: "string" }, columns: { type: "string", default: "moa,fujian" }, limit: { type: "string", default: "3" } } });
if (!values.id || !values["data-dir"]) throw new Error("Use --id <new-run-id> --data-dir <private-directory> [--columns moa,fujian] [--limit 1..5]");
const batch = await collectColumns({ id: values.id, dataDir: values["data-dir"], columns: values.columns!.split(",").map(c => columnIdSchema.parse(c)), limit: Number(values.limit) });
console.log(JSON.stringify({ id: batch.id, sources: batch.sources, attempted: batch.items.length, ready: batch.items.filter(i => i.state === "ready").length, failed: batch.items.filter(i => i.state === "failed").length, irrelevant: batch.items.filter(i => i.state === "irrelevant").length, reviewState: "unreviewed", modelCalls: 0, imported: false, published: false }, null, 2));
