# Explicit review of a textless PDF page

Text extraction cannot distinguish a blank page from a scan. Automatic collectors still reject textless pages. This narrow administrative path handles an individually inspected original PDF in the existing manual official archive, without OCR or a new collector.

1. `preparePdfBlankReview(dataDir, originalBytes, physicalPages)` renders the selected complete media boxes using the existing local PDFKit or Poppler. It stores the original hash, physical page count, renderer/version/options, and content-addressed PNG files. This is a draft render receipt, **not approval**.
2. An authorized reviewer views those exact files. `recordPdfBlankReview` requires the draft review ID, expected original hash and image hashes, explicit `confirmed_blank`, reason, and the actual executor kind (`authorized_agent` or `human`). It rerenders on the same host, compares every image, and records the decision in `audit_log`. Renderer overrides are test-only.
3. A manual PDF manifest may reference `blankReviewId` only. `verifyManualSource` loads the audit and verifies original/PNG hashes, reextracts all pages, requires the confirmed set to equal the entire textless-page set, and compares the complete archived body byte for byte. A manifest cannot authorize itself.
4. All physical page markers remain. Reviewed blank pages create no factual spans. The optional proof is bound into a new `fishery-spans-v4-reviewed-blanks` catalog; ordinary v2 catalogs retain their serialization and hash. Source-body reads revalidate the registered proof before article or guide processing and before current qualification is projected.

This confirms only the inspected blank pages. Nonempty text on another page does not prove that every image, annotation or scanned region was extracted. A scan with no reliable text remains unverified. The decision does not establish policy validity, eligibility, an open application window, republication rights, material approval or article approval.

The first exact supported Fujian PDF identity is the 2025 edition of the funding-policy booklet:

`https://hyyyj.fujian.gov.cn/xxgk/tzgg/202507/P020250728594612073287.pdf`

It contains 34 physical pages, with pages 2 and 4 visually blank. Keep it as historical policy reference with unknown current legal/application status. The PDF route keeps web publication metadata unknown; file-path dates and signature dates are not substituted. Its notification page and PDF remain separate archive identities, and the earlier unverified notice batch is retained.

Zero-call capacity checks are still mandatory. The inspected PDFKit extraction has 15,227 UTF-16 characters and 730 evidence spans. Its ordinary article generation request alone exceeds the 96,000-byte wire limit, so that path stays blocked. The compact guide-review transport can retain the complete body within that limit for a small diagnostic candidate; this does not approve a real guide or guarantee every candidate will fit. Do not truncate pages or increase limits to force a result.
