// Internal source validation precedes publication qualification. Calling the public availability
// reader here would recurse into the very review whose source is being validated.
import { sql, type Db } from "@aihot/backend/db";
import type { ItemAvailability } from "@aihot/contracts/site";
import { hasItemPage, publicSourceName } from "@aihot/backend/publication/rules";
export async function sourceArticleAvailable(id: string, db: Db = sql): Promise<boolean> {
  const [row] = await db`SELECT p.visibility,s.participation_mode FROM publications p
    JOIN sources s ON s.id=p.source_id WHERE p.article_id=${id}`;
  return !!row && hasItemPage({ visibility: row.visibility, sourceMode: row.participation_mode });
}

export async function sourceArticleAvailability(ids: string[], db: Db = sql): Promise<Record<string, ItemAvailability>> {
  const result: Record<string, ItemAvailability> = Object.fromEntries(ids.map(id => [id, { status: "unavailable" }]));
  if (!ids.length) return result;
  const rows = await db`SELECT p.article_id,p.visibility,s.participation_mode,s.name FROM publications p
    JOIN sources s ON s.id=p.source_id WHERE p.article_id=ANY(${ids}::text[])`;
  for (const row of rows) if (hasItemPage({ visibility: row.visibility, sourceMode: row.participation_mode }))
    result[row.article_id] = { status: row.visibility === "summary-only" ? "summary-only" : "public", sourceName: publicSourceName(row.name) };
  return result;
}
