import Foundation
import WebKit

/// Descargas con WKDownload. Los archivos se guardan en Documentos/Descargas, visibles en
/// la app Archivos (En mi iPhone → ICARUS). Solo se marcan como completadas cuando WebKit
/// llama a `downloadDidFinish`.
@MainActor
final class DownloadsStore: NSObject, ObservableObject, WKDownloadDelegate {
    enum Status: String, Codable {
        case inProgress, completed, failed, cancelled
    }

    struct Item: Codable, Identifiable, Equatable {
        let id: String
        var name: String
        let sourceURL: String
        var filePath: String?
        var status: Status
        var progress: Double
        let startedAt: Date
        var error: String?

        var fileURL: URL? { filePath.map { URL(fileURLWithPath: $0) } }
    }

    @Published private(set) var items: [Item] = []
    private var active: [ObjectIdentifier: String] = [:]
    private var observers: [String: NSKeyValueObservation] = [:]
    private let file: URL

    static var folder: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Descargas", isDirectory: true)
    }

    init(directory: URL) {
        file = directory.appendingPathComponent("downloads.json")
        super.init()
        if let data = try? Data(contentsOf: file), let stored = try? JSONDecoder().decode([Item].self, from: data) {
            // Una descarga que estaba en curso cuando se cerró la app no terminó.
            items = stored.map { item in
                var copy = item
                if copy.status == .inProgress {
                    copy.status = .failed
                    copy.error = "Se interrumpió al cerrar la app."
                }
                return copy
            }
        }
    }

    func track(_ download: WKDownload, name: String) {
        let id = UUID().uuidString
        let item = Item(id: id, name: name, sourceURL: download.originalRequest?.url?.absoluteString ?? "", filePath: nil,
                        status: .inProgress, progress: 0, startedAt: Date(), error: nil)
        items.insert(item, at: 0)
        active[ObjectIdentifier(download)] = id
        download.delegate = self
        observers[id] = download.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            let value = progress.fractionCompleted
            Task { @MainActor in self?.update(id) { $0.progress = value } }
        }
        save()
    }

    func remove(_ item: Item, deleteFile: Bool) {
        if deleteFile, let url = item.fileURL { try? FileManager.default.removeItem(at: url) }
        items.removeAll { $0.id == item.id }
        save()
    }

    private func update(_ id: String, _ change: (inout Item) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: file, options: .atomic) }
    }

    /// Nombre libre en la carpeta de descargas («archivo (2).pdf» si ya existe).
    private func destination(for suggested: String) -> URL {
        let folder = DownloadsStore.folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let clean = suggested.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        let name = clean.isEmpty ? "descarga" : clean
        var candidate = folder.appendingPathComponent(name)
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)")
            counter += 1
        }
        return candidate
    }

    // MARK: WKDownloadDelegate

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let url = destination(for: suggestedFilename)
        if let id = active[ObjectIdentifier(download)] {
            update(id) {
                $0.name = url.lastPathComponent
                $0.filePath = url.path
            }
            save()
        }
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let id = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
        observers[id] = nil
        update(id) {
            $0.status = .completed
            $0.progress = 1
        }
        save()
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let id = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
        observers[id] = nil
        update(id) {
            $0.status = .failed
            $0.error = error.localizedDescription
        }
        save()
    }
}
