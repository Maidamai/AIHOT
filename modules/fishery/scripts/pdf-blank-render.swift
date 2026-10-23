// Render selected complete physical pages for explicit visual review. This does not classify blank pages.
import Foundation
import PDFKit
import AppKit
let args = CommandLine.arguments
guard args.count >= 4, let document = PDFDocument(url: URL(fileURLWithPath: args[1])), !document.isEncrypted,
      document.pageCount > 0, document.pageCount <= 200 else { fatalError("Readable bounded PDF and selected physical pages required") }
let output = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false)
let requested = try args.dropFirst(3).map { value -> Int in
    guard let page = Int(value), page > 0, page <= document.pageCount else { throw NSError(domain: "physical-page", code: 1) }
    return page
}
guard requested == Array(Set(requested)).sorted(), requested.count < document.pageCount else { fatalError("Unique ordered subset of physical pages required") }
var rendered: [[String: Any]] = []
var totalBytes = 0
for number in requested {
    guard let page = document.page(at: number - 1) else { fatalError("Physical page missing") }
    let box = page.bounds(for: .mediaBox)
    guard box.width > 0, box.height > 0, box.width <= 2000, box.height <= 2000 else { fatalError("Bounded media box required") }
    let image = page.thumbnail(of: NSSize(width: box.width * 2, height: box.height * 2), for: .mediaBox)
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Full-page PNG rendering failed") }
    totalBytes += png.count
    guard png.count <= 20 * 1024 * 1024, totalBytes <= 64 * 1024 * 1024 else { fatalError("Bounded render bytes required") }
    let name = "page-\(number).png"
    try png.write(to: output.appendingPathComponent(name), options: .withoutOverwriting)
    rendered.append(["page": number, "file": name, "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh,
                     "mediaBox": [box.origin.x, box.origin.y, box.width, box.height], "rotation": page.rotation])
}
let receipt: [String: Any] = ["renderer": "Apple PDFKit full-mediaBox thumbnail", "version": ProcessInfo.processInfo.operatingSystemVersionString,
                             "options": "mediaBox; requested 2 pixels/point; no crop, OCR or blank classification", "physicalPages": document.pageCount, "pages": rendered]
print(String(data: try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]), encoding: .utf8)!)
