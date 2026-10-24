import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errores de una lista, con los mismos códigos que escritorio (docs/SHIELD.md).
public enum ListError: String, Codable, Error {
    case invalidURL = "invalid-url", network, http, tooLarge = "too-large", notAList = "not-a-list", empty, duplicate
}

public enum FetchResult {
    case ok(String)
    case failed(ListError)
}

public struct ShieldListInfo: Equatable, Identifiable {
    public let id: String
    public let name: String
    public let url: String?
    public let enabled: Bool
    public let builtIn: Bool
    public let ruleCount: Int
    /// Filtros que WebKit no puede expresar (solo en iPhone).
    public let skippedCount: Int
    public let lastUpdated: Date?
    public let error: ListError?
    public let updating: Bool
}

/// Configuración y listas de ICARUS Shield en iPhone (adaptación de shieldService.ts):
/// mismas listas, validación de descargas, copia anterior si falla una actualización y
/// renovación cada 4 días. El bloqueo lo hace WebKit con las reglas de `contentBlocker()`.
public final class ShieldLists {
    private struct ListConfig: Codable, Equatable {
        var id: String
        var name: String
        var url: String?
        var enabled: Bool
        var builtIn: Bool
    }

    private struct ListMeta: Codable, Equatable {
        var ruleCount = 0
        var lastUpdated: Date?
        var error: ListError?
    }

    private struct Config: Codable {
        var version = 1
        var enabled = true
        var lists: [ListConfig]
        var customRules = ""
        var exceptions: [String] = []
        var meta: [String: ListMeta] = [:]
    }

    public static let builtinId = "icarus-basic"
    public static let maxListBytes = 15 * 1024 * 1024
    public static let updateInterval: TimeInterval = 4 * 24 * 60 * 60
    private static let maxCustomRules = 200_000

    private static let defaultLists = [
        ListConfig(id: builtinId, name: "ICARUS básica", url: nil, enabled: true, builtIn: true),
        ListConfig(id: "easylist", name: "EasyList (anuncios)", url: "https://easylist.to/easylist/easylist.txt", enabled: true, builtIn: true),
        ListConfig(id: "easyprivacy", name: "EasyPrivacy (rastreadores)", url: "https://easylist.to/easylist/easyprivacy.txt", enabled: true, builtIn: true),
        ListConfig(id: "peter-lowe", name: "Peter Lowe (servidores de anuncios)",
                   url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext", enabled: false, builtIn: true),
    ]

    private let directory: URL
    private let builtinText: String
    private let suffixes: PublicSuffixList
    private let fetch: (String) async -> FetchResult
    private var config: Config
    private var updating = Set<String>()
    private var skipped: [String: Int] = [:]
    private let lock = NSLock()
    public var onChange: () -> Void = {}

    public init(directory: URL, builtinText: String, suffixes: PublicSuffixList, fetch: @escaping (String) async -> FetchResult = ShieldLists.httpFetch) {
        self.directory = directory
        self.builtinText = builtinText
        self.suffixes = suffixes
        self.fetch = fetch
        try? FileManager.default.createDirectory(at: directory.appendingPathComponent("lists"), withIntermediateDirectories: true)
        config = Config(lists: ShieldLists.defaultLists)
        if let data = try? Data(contentsOf: directory.appendingPathComponent("shield.json")), let stored = try? JSONDecoder().decode(Config.self, from: data) {
            config = ShieldLists.sanitize(stored)
        }
    }

    /// Las listas predefinidas siempre existen; se conserva su estado activado.
    private static func sanitize(_ stored: Config) -> Config {
        var result = stored
        var lists = defaultLists.map { builtIn -> ListConfig in
            var list = builtIn
            if let match = stored.lists.first(where: { $0.id == builtIn.id }) { list.enabled = match.enabled }
            return list
        }
        for list in stored.lists where !lists.contains(where: { $0.id == list.id }) && !list.builtIn {
            guard list.id.range(of: "^[a-zA-Z0-9-]{1,64}$", options: .regularExpression) != nil,
                  let url = list.url.flatMap(UrlUtils.parseWebURL), url.protocol == "https:", !url.hasCredentials else { continue }
            lists.append(ListConfig(id: list.id, name: String(list.name.prefix(80)), url: url.href, enabled: list.enabled, builtIn: false))
        }
        result.lists = lists
        result.customRules = String(stored.customRules.prefix(maxCustomRules))
        result.exceptions = stored.exceptions.filter { $0.range(of: "^[a-z0-9.-]{1,253}$", options: .regularExpression) != nil }.prefix(2000).map { $0 }
        return result
    }

    public var enabled: Bool { lock.locked { config.enabled } }
    public var customRules: String { lock.locked { config.customRules } }
    /// Dominios registrables donde Shield está desactivado.
    public var exceptions: [String] { lock.locked { config.exceptions } }

    public var lists: [ShieldListInfo] {
        lock.locked {
            config.lists.map { list in
                let meta = config.meta[list.id]
                return ShieldListInfo(id: list.id, name: list.name, url: list.url, enabled: list.enabled, builtIn: list.builtIn,
                                      ruleCount: meta?.ruleCount ?? 0, skippedCount: skipped[list.id] ?? 0, lastUpdated: meta?.lastUpdated,
                                      error: meta?.error, updating: updating.contains(list.id))
            }
        }
    }

    public func setEnabled(_ value: Bool) { change { $0.enabled = value } }

    public func setListEnabled(id: String, _ value: Bool) {
        change { config in
            if let index = config.lists.firstIndex(where: { $0.id == id }) { config.lists[index].enabled = value }
        }
    }

    public func setCustomRules(_ text: String) { change { $0.customRules = String(text.prefix(ShieldLists.maxCustomRules)) } }

    public func isSiteAllowed(_ pageURL: String) -> Bool {
        guard let host = UrlUtils.parseWebURL(pageURL)?.hostname else { return false }
        return exceptions.contains { PublicSuffixList.hostMatchesDomain(host, $0) }
    }

    /// Activa o desactiva Shield en un sitio (se guarda su dominio registrable).
    public func setSiteAllowed(host: String, _ allowed: Bool) {
        let lower = host.lowercased()
        let domain = suffixes.registrableDomain(lower)
        guard domain.range(of: "^[a-z0-9.-]{1,253}$", options: .regularExpression) != nil else { return }
        change { config in
            config.exceptions.removeAll { $0 == domain || PublicSuffixList.hostMatchesDomain(lower, $0) }
            if allowed { config.exceptions = (config.exceptions + [domain]).sorted() }
        }
    }

    public func needsDownload(id: String) -> Bool {
        lock.locked { config.lists.contains { $0.id == id && $0.enabled && $0.url != nil } } && !hasCachedText(id)
    }

    public func addList(name: String, url: String) async -> ListError? {
        guard let parsed = UrlUtils.parseWebURL(url.trimmed), parsed.protocol == "https:", !parsed.hasCredentials else { return .invalidURL }
        if lock.locked({ config.lists.contains { $0.url == parsed.href } }) { return .duplicate }
        let id = "custom-\(UUID().uuidString.prefix(8).lowercased())"
        switch await validatedDownload(parsed.href) {
        case .failure(let error): return error
        case .success(let (text, count)):
            change { config in
                let clean = String(name.trimmed.prefix(80))
                config.lists.append(ListConfig(id: id, name: clean.isEmpty ? parsed.hostname : clean, url: parsed.href, enabled: true, builtIn: false))
            }
            store(id: id, text: text, ruleCount: count)
            return nil
        }
    }

    public func removeList(id: String) {
        guard lock.locked({ config.lists.contains { $0.id == id && !$0.builtIn } }) else { return }
        try? FileManager.default.removeItem(at: listPath(id))
        change { config in
            config.lists.removeAll { $0.id == id }
            config.meta[id] = nil
        }
    }

    /// Descarga las listas activas (todas o solo las caducadas).
    public func updateLists(onlyStale: Bool, now: Date = Date()) async {
        for list in lock.locked({ config.lists }) where list.enabled && list.url != nil {
            let lastUpdated = lock.locked { config.meta[list.id]?.lastUpdated }
            let fresh = lastUpdated.map { now.timeIntervalSince($0) < ShieldLists.updateInterval } ?? false && hasCachedText(list.id)
            if onlyStale && fresh { continue }
            guard lock.locked({ updating.insert(list.id).inserted }) else { continue }
            onChange()
            switch await validatedDownload(list.url!) {
            case .success(let (text, count)): store(id: list.id, text: text, ruleCount: count)
            // Se conserva la copia anterior de la lista si existía.
            case .failure(let error): change { $0.meta[list.id, default: ListMeta()].error = error }
            }
            lock.locked { _ = updating.remove(list.id) }
            onChange()
        }
    }

    /// Filtros de las listas activas y de las reglas propias.
    public func activeFilters() -> [NetworkFilter] {
        let snapshot = lock.locked { config }
        var filters: [NetworkFilter] = []
        for list in snapshot.lists where list.enabled {
            let text = list.id == ShieldLists.builtinId ? builtinText : (try? String(contentsOf: listPath(list.id), encoding: .utf8))
            guard let text else { continue }
            filters.append(contentsOf: Filters.parseList(text).filters)
        }
        filters.append(contentsOf: Filters.parseList(snapshot.customRules).filters)
        return filters
    }

    /// Reglas de WebKit de todas las listas activas (las excepciones por sitio se aplican aparte).
    public func contentBlocker() -> ContentBlocker.Result {
        let snapshot = lock.locked { config }
        var perList: [String: Int] = [:]
        for list in snapshot.lists where list.enabled {
            let text = list.id == ShieldLists.builtinId ? builtinText : (try? String(contentsOf: listPath(list.id), encoding: .utf8))
            guard let text else { continue }
            perList[list.id] = ContentBlocker.convert(Filters.parseList(text).filters).skippedFilters
        }
        lock.locked { skipped = perList }
        return ContentBlocker.convert(activeFilters())
    }

    /// Huella estable de lo que entra en las reglas (listas activas, sus versiones y las
    /// reglas propias). Si no cambia, la app reutiliza las reglas que WebKit ya compiló.
    public var fingerprint: String {
        let snapshot = lock.locked { config }
        var parts = ["v1", "builtin:\(ShieldLists.fnv1a(builtinText))", "custom:\(ShieldLists.fnv1a(snapshot.customRules))"]
        for list in snapshot.lists where list.enabled {
            let updated = snapshot.meta[list.id]?.lastUpdated?.timeIntervalSince1970 ?? 0
            parts.append("\(list.id):\(updated):\(hasCachedText(list.id))")
        }
        return parts.joined(separator: "|")
    }

    /// FNV-1a de 64 bits (estable entre ejecuciones, a diferencia de `Hasher`).
    static func fnv1a(_ text: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return String(hash, radix: 16)
    }

    public var customStats: (rules: Int, invalid: Int) {
        let parsed = Filters.parseList(customRules)
        return (parsed.ruleCount, parsed.invalidCount)
    }

    private func validatedDownload(_ url: String) async -> Result<(String, Int), ListError> {
        switch await fetch(url) {
        case .failed(let error): return .failure(error)
        case .ok(let text):
            if Filters.looksLikeHTML(text) { return .failure(.notAList) }
            let parsed = Filters.parseList(text)
            if parsed.ruleCount == 0 { return .failure(.empty) }
            return .success((text, parsed.ruleCount))
        }
    }

    private func store(id: String, text: String, ruleCount: Int) {
        try? Data(text.utf8).write(to: listPath(id), options: .atomic)
        change { $0.meta[id] = ListMeta(ruleCount: ruleCount, lastUpdated: Date(), error: nil) }
    }

    private func listPath(_ id: String) -> URL { directory.appendingPathComponent("lists/\(id).txt") }

    private func hasCachedText(_ id: String) -> Bool { id == ShieldLists.builtinId || FileManager.default.fileExists(atPath: listPath(id).path) }

    private func change(_ transform: (inout Config) -> Void) {
        let snapshot: Config = lock.locked {
            transform(&config)
            return config
        }
        if let data = try? JSONEncoder().encode(snapshot) {
            try? data.write(to: directory.appendingPathComponent("shield.json"), options: .atomic)
        }
        onChange()
    }

    /// Descarga por HTTPS con límite de 15 MB y 30 s.
    public static func httpFetch(_ url: String) async -> FetchResult {
        guard let target = URL(string: url) else { return .failed(.invalidURL) }
        var request = URLRequest(url: target, timeoutInterval: 30)
        request.setValue("text/plain, */*;q=0.5", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return .failed(.http) }
            // Una redirección a HTTP no se acepta.
            if response.url?.scheme?.lowercased() != "https" { return .failed(.http) }
            if data.count > maxListBytes { return .failed(.tooLarge) }
            return .ok(String(decoding: data, as: UTF8.self))
        } catch {
            return .failed(.network)
        }
    }
}
