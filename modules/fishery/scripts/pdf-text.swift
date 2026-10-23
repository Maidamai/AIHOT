// Local macOS PDFKit reader; no networking, OCR or installation.
import Foundation
import PDFKit
let file = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: file), !document.isEncrypted else { fatalError("Unreadable or encrypted PDF") }
guard document.pageCount > 0 && document.pageCount <= 200 else { fatalError("PDF page count limit exceeded") }
let pages = (0..<document.pageCount).map { document.page(at: $0)?.string ?? "" }
// The caller checks every physical page and keeps all textless pages unverified, including mixed scans.
let output: [String: Any] = ["pages": document.pageCount, "text": pages.enumerated().map { "--- Page \($0.offset + 1) ---\n\($0.element)" }.joined(separator: "\n\n")]
print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
