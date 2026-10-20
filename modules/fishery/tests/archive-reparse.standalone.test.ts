import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { batchRoot, listBatches, readBatch, readCapturedText, reparseArchivedIotc, verifyBatchItem, type ColumnBatch } from "../backend/column-batches.ts";
import { prepareIotc, discoverIotc } from "../backend/iotc-columns.ts";
import { sha256, type PdfText } from "../backend/source-adapters.ts";
import { COLUMNS } from "../backend/official-columns.ts";
import { observationSchema } from "../contracts.ts";
import { observationFixture } from "./fixtures.ts";

async function originalBatch(dataDir:string) {
  const id="original-iotc",url="https://iotc.org/cmm/resolution-2603-synthetic",pdfUrl="https://iotc.org/sites/default/files/synthetic.pdf";
  const archiveId=`${id}_${sha256("iotc"+url).slice(0,16)}`,root=path.join(batchRoot(dataDir),id);
  await mkdir(path.join(root,"raw"),{recursive:true});await mkdir(path.join(root,"body"));
  const listing=Buffer.from(`<table class="views-table"><tbody><tr><td class="views-field-title-1"><a href="${url}">Resolution 26/03 Synthetic measure</a></td><td class="views-field-nothing"><b>Active &amp; supersedes</b></td><td class="views-field-field-cmm-adoption-date"><span class="date-display-single">2026</span></td></tr></tbody></table>`);
  const landing=Buffer.from(`<h1>Resolution 26/03 Synthetic measure</h1><div id="content"><div class="node-cmm"><a href="${pdfUrl}">PDF</a><div class="field-name-field-cmm-status">Active &amp; supersedes</div><div class="field-name-field-cmm-adoption-date"><span class="date-display-single">2026</span></div></div></div>`);
  const robots=await readFile(new URL("./fixtures/iotc-robots.txt",import.meta.url)),pdf=Buffer.from("%PDF-1.4\nSynthetic original PDF bytes. Never modified.");
  const acquiredAt="2026-04-01T01:02:03Z";
  const receipt=(requestedUrl:string,bytes:Buffer)=>({requestedUrl,finalUrl:requestedUrl,status:200,startedAt:"2026-04-01T01:02:00Z",finishedAt:acquiredAt,bytes:bytes.length,sha256:sha256(bytes),contentType:requestedUrl.endsWith(".pdf")?"application/pdf":"text/html"});
  const oldText="--- Page 1 ---\nRESOLUTION 26/03. Minimum weight 200 g3.\n3 Synthetic footnote explanation.";
  const oldParsed:PdfText={status:"parsed",rawSha256:sha256(pdf),parser:"synthetic legacy layout/v1",text:oldText,pages:1};
  const prepared=prepareIotc(discoverIotc(listing.toString()).candidates[0]!,receipt(url,landing),landing,{receipt:receipt(pdfUrl,pdf),bytes:pdf,parsed:oldParsed});prepared.sourceCapture.archiveId=archiveId;
  prepared.evidence.push({url:COLUMNS.iotc.url,sha256:sha256(listing),page:null,section:"Archived current CMM listing; discovery identity"});
  const {body,...metadata}=prepared;assert.ok(body);
  const batch:ColumnBatch={version:"fishery-column-batch/0.1",id,startedAt:"2026-04-01T01:01:00Z",finishedAt:acquiredAt,status:"complete",sources:[{id:"iotc",listed:1,titleFiltered:0,attempted:1,error:null}],items:[{column:"iotc",url,discoveryTitle:"Resolution 26/03 Synthetic measure",listDate:null,state:"ready",archiveId,prepared:metadata,error:null}]};
  for(const [name,requestedUrl,bytes] of [["iotc-robots","https://iotc.org/robots.txt",robots],["iotc-list",COLUMNS.iotc.url,listing],[archiveId,url,landing],[`${archiveId}-pdf`,pdfUrl,pdf]] as const) {
    await writeFile(path.join(root,"raw",`${name}.bin`),bytes);await writeFile(path.join(root,"raw",`${name}.receipt.json`),JSON.stringify(receipt(requestedUrl,bytes),null,3)+"\n");
  }
  await writeFile(path.join(root,"body",`${archiveId}.txt`),body);await writeFile(path.join(root,"manifest.json"),JSON.stringify(batch,null,4)+"\n");
  const parsed:PdfText={...oldParsed,parser:"synthetic structured footnotes/v2",text:oldText.replace("g3","g[footnote 3]")};
  return {batch,pdf,parsed,root,acquiredAt};
}
async function treeSnapshot(root:string) {
  const files:Record<string,string>={};
  for(const directory of ["raw","body"]) for(const name of await readdir(path.join(root,directory))) files[`${directory}/${name}`]=sha256(await readFile(path.join(root,directory,name)));
  files["manifest.json"]=sha256(await readFile(path.join(root,"manifest.json")));return files;
}

test("static archived PDF reparse keeps original bytes/times, verifies new import evidence and refuses target reuse or tampering",async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),"fishery-static-reparse-"));
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Static reparse must perform zero GET/model requests");});
  try {
    const original=await originalBatch(dataDir),before=await treeSnapshot(original.root);let parses=0;
    const parsePdf=async(bytes:Buffer)=>{parses++;assert.deepEqual(bytes,original.pdf);return structuredClone(original.parsed);};
    const batch=await reparseArchivedIotc({dataDir,sourceBatchId:original.batch.id,id:"reparsed-iotc",parsePdf});
    await mkdir(path.join(batchRoot(dataDir),"interrupted-other-batch"));
    const listed=await listBatches(dataDir);
    assert.equal(listed.find(b=>b.id===original.batch.id)?.status,"complete");assert.equal(listed.find(b=>b.id===batch.id)?.status,"complete");
    assert.equal(listed.find(b=>b.id==="interrupted-other-batch")?.status,"unreadable");
    assert.equal(parses,1);assert.equal(batch.networkRequests,0);assert.equal(batch.reparsedItems,1);assert.equal(batch.sources[0]!.attempted,0);assert.equal(batch.sources[0]!.listed,0);assert.equal(batch.reparse!.sourceSummary[0]!.attempted,1);assert.deepEqual(await treeSnapshot(original.root),before);
    const item=batch.items[0]!,capture=item.prepared!.sourceCapture;
    assert.equal(capture.acquisitionMode,"archive_replay");assert.equal(capture.capturedAt,original.acquiredAt);assert.equal(capture.attachmentCapturedAt,original.acquiredAt);
    assert.equal(capture.rawSha256,original.batch.items[0]!.prepared!.sourceCapture.rawSha256);assert.equal(capture.attachmentSha256,sha256(original.pdf));
    assert.equal(capture.parser,original.parsed.parser);assert.notEqual(capture.bodySha256,original.batch.items[0]!.prepared!.sourceCapture.bodySha256);
    assert.equal(await readCapturedText(dataDir,item.archiveId,capture.bodySha256!),original.parsed.text);
    assert.equal(batch.reparse!.sourceManifestSha256,before["manifest.json"]);assert.equal(batch.reparse!.items[0]!.oldParser,"synthetic legacy layout/v1");
    for(const artifact of batch.reparse!.artifacts) assert.deepEqual(await readFile(path.join(batchRoot(dataDir),batch.id,artifact.targetName)),await readFile(path.join(original.root,artifact.sourceName)));
    const stored=await readBatch(dataDir,batch.id),verified=await verifyBatchItem(dataDir,stored,stored.items[0]!,{parsePdf});
    assert.equal(verified.sourceCapture.acquisitionMode,"archive_replay");assert.equal(verified.sourceCapture.capturedAt,original.acquiredAt);assert.equal(verified.body,original.parsed.text);
    if(!("policyContext" in verified)) throw new Error("Expected IOTC prepared capture");
    observationSchema.parse({...observationFixture,rawSha256:verified.sourceCapture.rawSha256,dates:verified.dates,sourceCapture:verified.sourceCapture,policyContext:verified.policyContext,evidence:verified.evidence});
    await assert.rejects(reparseArchivedIotc({dataDir,sourceBatchId:original.batch.id,id:batch.id,parsePdf}),/already exists/);assert.equal(parses,2,"existing target refuses before parser execution");
    stored.items[0]!.prepared!.sourceCapture.acquisitionMode="live_capture";stored.items[0]!.prepared!.sourceCapture.capturedAt="2099-01-01T00:00:00Z";
    const reconstructed=await verifyBatchItem(dataDir,stored,stored.items[0]!,{parsePdf});assert.equal(reconstructed.sourceCapture.acquisitionMode,"archive_replay");assert.equal(reconstructed.sourceCapture.capturedAt,original.acquiredAt,"edited manifest cannot forge fresh acquisition");
    const changed=structuredClone(stored);changed.reparse!.sourceManifestSha256="a".repeat(64);await assert.rejects(verifyBatchItem(dataDir,changed,changed.items[0]!,{parsePdf}),/provenance marker/);
    const removed=structuredClone(stored);delete removed.reparse;await assert.rejects(verifyBatchItem(dataDir,removed,removed.items[0]!,{parsePdf}),/provenance marker/);
    const sourceManifestFile=path.join(original.root,"manifest.json"),sourceManifest=await readFile(sourceManifestFile);
    await writeFile(sourceManifestFile,sourceManifest.toString()+" ");await assert.rejects(verifyBatchItem(dataDir,stored,stored.items[0]!,{parsePdf}),/manifest hash changed/);await writeFile(sourceManifestFile,sourceManifest);
    const receiptFile=path.join(batchRoot(dataDir),batch.id,"raw",`${item.archiveId}.receipt.json`),receiptBytes=await readFile(receiptFile);await writeFile(receiptFile,receiptBytes.toString()+" ");
    await assert.rejects(verifyBatchItem(dataDir,stored,stored.items[0]!,{parsePdf}),/raw\/receipt hash mismatch/);await writeFile(receiptFile,receiptBytes);
    await assert.rejects(verifyBatchItem(dataDir,stored,stored.items[0]!,{parsePdf:async()=>({...original.parsed,parser:"unexpected parser"})}),/parser\/body provenance mismatch/);
    const failedTarget=path.join(batchRoot(dataDir),"reparse-parser-failed");
    await assert.rejects(reparseArchivedIotc({dataDir,sourceBatchId:original.batch.id,id:"reparse-parser-failed",parsePdf:async()=>({...original.parsed,status:"failed",text:"",pages:0})}),/Static PDF reparse failed/);
    await assert.rejects(access(failedTarget));
    const originalPdfFile=path.join(original.root,"raw",`${original.batch.items[0]!.archiveId}-pdf.bin`);
    await assert.rejects(reparseArchivedIotc({dataDir,sourceBatchId:original.batch.id,id:"reparse-source-raced",parsePdf:async()=>{await writeFile(originalPdfFile,"tampered during extraction");return original.parsed;}}),/raw hash mismatch|Source artifact changed/);
    await assert.rejects(access(path.join(batchRoot(dataDir),"reparse-source-raced")));await writeFile(originalPdfFile,original.pdf);
    await writeFile(path.join(original.root,"body",`${original.batch.items[0]!.archiveId}.txt`),"tampered historical body");
    await assert.rejects(reparseArchivedIotc({dataDir,sourceBatchId:original.batch.id,id:"reparse-bad-source",parsePdf}),/body hash mismatch/);
  } finally {await rm(dataDir,{recursive:true,force:true});}
});
