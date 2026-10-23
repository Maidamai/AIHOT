// Structural proof only. Trust comes from the audited review loader, never a manifest assertion.
import { z } from "zod";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const pdfBlankPageImageSchema=z.strictObject({page:z.int().min(1).max(200),sha256:digest});
export const pdfBlankProofSchema=z.strictObject({
  version:z.literal('pdf-blank-review/1'),reviewId:z.uuid(),rawSha256:digest,physicalPages:z.int().min(2).max(200),
  pageImages:z.array(pdfBlankPageImageSchema).min(1).max(199),proofHash:digest,
}).superRefine((p,ctx)=>{
  if(p.pageImages.length>=p.physicalPages||p.pageImages.some((image,i)=>image.page>p.physicalPages||i>0&&image.page<=p.pageImages[i-1]!.page))
    ctx.addIssue({code:'custom',message:'Reviewed blank pages must be strictly increasing, within physical coverage, and cannot include every page'});
});
export type PdfBlankProof=z.infer<typeof pdfBlankProofSchema>;
