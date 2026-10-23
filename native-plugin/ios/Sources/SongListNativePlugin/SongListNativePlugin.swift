import Foundation
import Capacitor
import MessageUI
import UIKit
import Vision
import VisionKit

/// SongLists egna iOS-funktioner:
/// - Filer i appens iCloud-behållare (backup och synk mellan iPhone och iPad)
/// - Dokumentskanning med kameran (VisionKit) och textigenkänning på enheten (Vision)
/// - E-post med bifogade filer (MessageUI)
@objc(SongListNativePlugin)
public class SongListNativePlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate,
    MFMailComposeViewControllerDelegate {
    public let identifier = "SongListNativePlugin"
    public let jsName = "SongListNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "iCloudStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "composeMail", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "se.otimo.songlist.native", qos: .userInitiated)
    private var scanCall: CAPPluginCall?
    private var mailCall: CAPPluginCall?

    // MARK: - iCloud

    private func containerURL() -> URL? {
        // nil = första iCloud-behållaren i appens entitlements
        return FileManager.default.url(forUbiquityContainerIdentifier: nil)
    }

    /// scope "documents" syns i appen Filer (iCloud Drive › SongList), "data" är dold.
    private func resolveURL(scope: String, path: String) -> URL? {
        guard let root = containerURL() else { return nil }
        let base = scope == "documents"
            ? root.appendingPathComponent("Documents", isDirectory: true)
            : root.appendingPathComponent("Data", isDirectory: true)
        let clean = path
            .split(separator: "/")
            .filter { $0 != ".." && $0 != "." && !$0.isEmpty }
            .joined(separator: "/")
        return clean.isEmpty ? base : base.appendingPathComponent(clean)
    }

    private func error(_ message: String, code: Int = 1) -> NSError {
        return NSError(domain: "SongListNative", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    @objc func iCloudStatus(_ call: CAPPluginCall) {
        queue.async {
            let signedIn = FileManager.default.ubiquityIdentityToken != nil
            let container = signedIn ? self.containerURL() : nil
            call.resolve([
                "available": container != nil,
                "signedIn": signedIn
            ])
        }
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let text = call.getString("data") else {
            call.reject("path och data krävs")
            return
        }
        let scope = call.getString("scope") ?? "data"
        // base64 = binärfil (t.ex. PDF eller bild), annars text
        let bytes: Data
        if call.getBool("base64") ?? false {
            guard let decoded = Data(base64Encoded: text, options: .ignoreUnknownCharacters) else {
                call.reject("Ogiltig base64-data")
                return
            }
            bytes = decoded
        } else {
            bytes = Data(text.utf8)
        }
        queue.async {
            guard let url = self.resolveURL(scope: scope, path: path) else {
                call.reject("iCloud är inte tillgängligt", "ICLOUD_UNAVAILABLE")
                return
            }
            do {
                try FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                var coordinationError: NSError?
                var writeError: Error?
                NSFileCoordinator(filePresenter: nil).coordinate(
                    writingItemAt: url, options: .forReplacing, error: &coordinationError
                ) { target in
                    do {
                        try bytes.write(to: target, options: .atomic)
                    } catch {
                        writeError = error
                    }
                }
                if let e = coordinationError ?? writeError { throw e }
                call.resolve()
            } catch {
                call.reject("Kunde inte skriva till iCloud: \(error.localizedDescription)")
            }
        }
    }

    /// Ser till att en iCloud-fil finns lokalt (laddar ner den vid behov).
    private func ensureDownloaded(_ url: URL, timeout: TimeInterval = 30) throws {
        let fm = FileManager.default
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent("." + url.lastPathComponent + ".icloud")
        let exists = fm.fileExists(atPath: url.path)
        if !exists && !fm.fileExists(atPath: placeholder.path) {
            throw error("Filen finns inte", code: 404)
        }
        if exists {
            let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
            if values?.isUbiquitousItem != true || values?.ubiquitousItemDownloadingStatus == .current {
                return
            }
        }
        try fm.startDownloadingUbiquitousItem(at: url)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            var u = url
            u.removeAllCachedResourceValues()
            if fm.fileExists(atPath: u.path) {
                let status = (try? u.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
                    .ubiquitousItemDownloadingStatus
                if status == nil || status == .current { return }
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        // Tidsgräns: använd den version som finns lokalt om någon
        if fm.fileExists(atPath: url.path) { return }
        throw error("Tidsgräns vid nedladdning från iCloud", code: 408)
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path krävs")
            return
        }
        let scope = call.getString("scope") ?? "data"
        queue.async {
            guard let url = self.resolveURL(scope: scope, path: path) else {
                call.reject("iCloud är inte tillgängligt", "ICLOUD_UNAVAILABLE")
                return
            }
            do {
                try self.ensureDownloaded(url)
                var coordinationError: NSError?
                var result: String?
                var readError: Error?
                NSFileCoordinator(filePresenter: nil).coordinate(
                    readingItemAt: url, options: [], error: &coordinationError
                ) { target in
                    do {
                        let data = try Data(contentsOf: target)
                        result = String(data: data, encoding: .utf8)
                    } catch {
                        readError = error
                    }
                }
                if let e = coordinationError ?? readError { throw e }
                call.resolve(["data": result ?? ""])
            } catch let e as NSError where e.code == 404 {
                call.reject("Filen finns inte", "NOT_FOUND")
            } catch {
                call.reject("Kunde inte läsa från iCloud: \(error.localizedDescription)")
            }
        }
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        let scope = call.getString("scope") ?? "data"
        queue.async {
            guard let dir = self.resolveURL(scope: scope, path: path) else {
                call.reject("iCloud är inte tillgängligt", "ICLOUD_UNAVAILABLE")
                return
            }
            let fm = FileManager.default
            guard fm.fileExists(atPath: dir.path) else {
                call.resolve(["files": []])
                return
            }
            do {
                let items = try fm.contentsOfDirectory(
                    at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey], options: [])
                var files: [[String: Any]] = []
                for item in items {
                    var name = item.lastPathComponent
                    var downloaded = true
                    if name.hasPrefix(".") && name.hasSuffix(".icloud") {
                        // Platshållare för en fil som inte laddats ner ännu
                        name = String(name.dropFirst().dropLast(".icloud".count))
                        downloaded = false
                        try? fm.startDownloadingUbiquitousItem(at: dir.appendingPathComponent(name))
                    } else if name.hasPrefix(".") {
                        continue
                    }
                    let values = try? item.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                    let modified = (values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
                    files.append([
                        "name": name,
                        "modifiedAt": modified,
                        "size": values?.fileSize ?? 0,
                        "downloaded": downloaded
                    ])
                }
                call.resolve(["files": files])
            } catch {
                call.reject("Kunde inte lista filer: \(error.localizedDescription)")
            }
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path krävs")
            return
        }
        let scope = call.getString("scope") ?? "data"
        queue.async {
            guard let url = self.resolveURL(scope: scope, path: path) else {
                call.reject("iCloud är inte tillgängligt", "ICLOUD_UNAVAILABLE")
                return
            }
            var coordinationError: NSError?
            var deleteError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(
                writingItemAt: url, options: .forDeleting, error: &coordinationError
            ) { target in
                do {
                    try FileManager.default.removeItem(at: target)
                } catch {
                    deleteError = error
                }
            }
            if let e = coordinationError ?? deleteError {
                call.reject("Kunde inte radera: \(e.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }

    // MARK: - Dokumentskanning

    @objc func scanDocument(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Dokumentskanning stöds inte på den här enheten", "UNSUPPORTED")
            return
        }
        DispatchQueue.main.async {
            self.scanCall = call
            let controller = VNDocumentCameraViewController()
            controller.delegate = self
            self.bridge?.viewController?.present(controller, animated: true)
        }
    }

    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
    ) {
        var images: [UIImage] = []
        for i in 0..<scan.pageCount {
            images.append(scan.imageOfPage(at: i))
        }
        controller.dismiss(animated: true)
        guard let call = scanCall else { return }
        scanCall = nil
        queue.async {
            do {
                var pages: [[String: Any]] = []
                for image in images {
                    pages.append(try self.recognize(image))
                }
                var result: [String: Any] = ["pages": pages]
                if let first = images.first, let preview = self.jpegDataURL(first, maxSize: 1800) {
                    result["imageDataUrl"] = preview
                }
                call.resolve(result)
            } catch {
                call.reject("Textigenkänningen misslyckades: \(error.localizedDescription)")
            }
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        scanCall?.reject("Skanningen avbröts", "CANCELLED")
        scanCall = nil
    }

    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController, didFailWithError error: Error
    ) {
        controller.dismiss(animated: true)
        scanCall?.reject("Skanningen misslyckades: \(error.localizedDescription)")
        scanCall = nil
    }

    // MARK: - E-post

    /// Öppnar Apples mejlfönster med mottagare, ämne, text och bifogade filer ifyllda.
    @objc func composeMail(_ call: CAPPluginCall) {
        guard MFMailComposeViewController.canSendMail() else {
            call.reject("Det finns inget e-postkonto i appen Mail", "NO_MAIL")
            return
        }
        let to = call.getArray("to", String.self) ?? []
        let subject = call.getString("subject") ?? ""
        let body = call.getString("body") ?? ""
        let attachments = call.getArray("attachments", JSObject.self) ?? []
        DispatchQueue.main.async {
            let controller = MFMailComposeViewController()
            controller.mailComposeDelegate = self
            controller.setToRecipients(to)
            controller.setSubject(subject)
            controller.setMessageBody(body, isHTML: false)
            for attachment in attachments {
                guard let name = attachment["name"] as? String,
                      let mime = attachment["mime"] as? String,
                      let base64 = attachment["data"] as? String,
                      let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { continue }
                controller.addAttachmentData(data, mimeType: mime, fileName: name)
            }
            self.mailCall = call
            self.bridge?.viewController?.present(controller, animated: true)
        }
    }

    public func mailComposeController(
        _ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?
    ) {
        controller.dismiss(animated: true)
        guard let call = mailCall else { return }
        mailCall = nil
        if let error = error {
            call.reject("Mejlet kunde inte skickas: \(error.localizedDescription)")
            return
        }
        let value: String
        switch result {
        case .sent: value = "sent"
        case .saved: value = "saved"
        case .cancelled: value = "cancelled"
        case .failed: value = "failed"
        @unknown default: value = "unknown"
        }
        call.resolve(["result": value])
    }

    // MARK: - Textigenkänning

    @objc func recognizeImage(_ call: CAPPluginCall) {
        guard var base64 = call.getString("image") else {
            call.reject("image krävs")
            return
        }
        if let comma = base64.firstIndex(of: ","), base64.hasPrefix("data:") {
            base64 = String(base64[base64.index(after: comma)...])
        }
        queue.async {
            guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
                  let image = UIImage(data: data) else {
                call.reject("Kunde inte läsa bilden")
                return
            }
            do {
                call.resolve(["page": try self.recognize(image)])
            } catch {
                call.reject("Textigenkänningen misslyckades: \(error.localizedDescription)")
            }
        }
    }

    /// Kör Vision och returnerar rader och ord med normaliserade koordinater (origo uppe till vänster).
    private func recognize(_ image: UIImage) throws -> [String: Any] {
        guard let cgImage = image.cgImage else { throw error("Ogiltig bild") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Språkkorrigering förstör ofta ackordnamn (t.ex. "F#m7"), så den stängs av.
        request.usesLanguageCorrection = false
        request.minimumTextHeight = 0.008
        if let supported = try? request.supportedRecognitionLanguages() {
            let wanted = ["sv-SE", "en-US", "de-DE"].filter { supported.contains($0) }
            if !wanted.isEmpty { request.recognitionLanguages = wanted }
        }

        let handler = VNImageRequestHandler(
            cgImage: cgImage, orientation: cgOrientation(image.imageOrientation), options: [:])
        try handler.perform([request])

        var lines: [[String: Any]] = []
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let text = candidate.string
            var words: [[String: Any]] = []
            var index = text.startIndex
            while index < text.endIndex {
                while index < text.endIndex && text[index].isWhitespace {
                    index = text.index(after: index)
                }
                let start = index
                while index < text.endIndex && !text[index].isWhitespace {
                    index = text.index(after: index)
                }
                if start < index, let box = try? candidate.boundingBox(for: start..<index) {
                    var word = rectDict(box.boundingBox)
                    word["text"] = String(text[start..<index])
                    words.append(word)
                }
            }
            var line = rectDict(observation.boundingBox)
            line["text"] = text
            line["words"] = words
            lines.append(line)
        }
        return [
            "width": Double(image.size.width * image.scale),
            "height": Double(image.size.height * image.scale),
            "lines": lines
        ]
    }

    private func rectDict(_ r: CGRect) -> [String: Any] {
        // Vision har origo nere till vänster
        return [
            "x": Double(r.origin.x),
            "y": Double(1 - r.origin.y - r.size.height),
            "w": Double(r.size.width),
            "h": Double(r.size.height)
        ]
    }

    private func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }

    private func jpegDataURL(_ image: UIImage, maxSize: CGFloat) -> String? {
        let size = image.size
        let scale = min(1, maxSize / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let data = resized.jpegData(compressionQuality: 0.7) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }
}
