import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { createDocument, observe, registerSource } from "../backend/store.ts";
import { workbench } from "../backend/workbench.ts";
import { observationFixture } from "./fixtures.ts";

after(closeDb);
test("source capture summary includes a newer failed capture outside the current page and filters",async()=>{
  const sourceId="source-pagination-summary";
  await sql`INSERT INTO sources(id,name,kind,enabled,next_fetch_at) VALUES (${sourceId},'Pagination source','external',false,'2100-01-01')`;
  await registerSource(sourceId,{expectedRevision:0},"tester");
  let latestDocument="";
  for(let i=0;i<26;i++) {
    const document=await createDocument({sourceId,issuer:"Synthetic source attribution",canonicalUrl:`https://example.org/pagination-${i}`} ,"tester");
    const latest=i===0;
    await observe(document.id,{...observationFixture,title:latest?"Latest failed acquisition":"Older searchable material",sourceCapture:{adapter:"moa",sourceUrl:`https://example.org/pagination-${i}`,capturedAt:latest?"2026-10-20T01:00:00Z":"2026-10-19T23:00:00+08:00",httpStatus:latest?503:200,rawSha256:observationFixture.rawSha256,bodySha256:latest?null:"b".repeat(64),parser:"synthetic/v1",parseStatus:latest?"failed":"parsed",attachmentSha256:null,conflicts:[]}},"tester");
    await sql`UPDATE fishery_observations SET observed_at=${latest?"2026-01-01T00:00:00Z":`2026-10-19T00:00:${String(i).padStart(2,"0")}Z`} WHERE document_id=${document.id}`;
    if(latest) latestDocument=document.id;
  }
  const first=await workbench({page:1,scope:"real"});
  assert.equal(first.total,26);assert.equal(first.rows.length,25);assert.ok(first.rows.every(row=>row.id!==latestDocument));
  const summary=first.sourceCaptures[sourceId]!;
  assert.deepEqual(summary,{documentId:latestDocument,observationRevision:1,capturedAt:"2026-10-20T01:00:00Z",httpStatus:503,parseStatus:"failed",acquisitionMode:"unknown"});
  assert.deepEqual((await workbench({page:2,scope:"real"})).sourceCaptures[sourceId],summary);
  const filtered=await workbench({q:"Older searchable",state:"pending",scope:"real"});
  assert.equal(filtered.total,25);assert.deepEqual(filtered.sourceCaptures[sourceId],summary,"an old HTTP 200 in filtered rows cannot replace the latest imported failure");
  assert.equal((await workbench({scope:"test"})).sourceCaptures[sourceId],undefined,"test/real scope remains separate");
});
