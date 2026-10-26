import Foundation

public enum ThemeId: String, Codable, CaseIterable, Identifiable {
    case essential = "google-inspired"
    case panorama = "edge-inspired"
    case icarus

    public var id: String { rawValue }
}

public enum ColorMode: String, Codable, CaseIterable, Identifiable {
    case system, light, dark
    public var id: String { rawValue }
}

public struct Settings: Codable, Equatable {
    public var theme: ThemeId = .icarus
    public var colorMode: ColorMode = .system
    /// `default` (el del estilo) o un id de mobile/shared/themes.json → accents.
    public var accent: String = "default"
    public var searchProvider: SearchProvider = .google
    public var saveHistory = true
    public var restoreSession = true
    public var showShortcuts = true
    /// «Mostrar siempre las URL completas»: sin foco, la barra muestra `https://` y `www.`.
    public var showFullUrls = false

    public init() {}

    /// Lectura tolerante: un campo ausente o no válido toma su valor predeterminado.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = Settings()
        theme = (try? container.decodeIfPresent(ThemeId.self, forKey: .theme)) ?? defaults.theme
        colorMode = (try? container.decodeIfPresent(ColorMode.self, forKey: .colorMode)) ?? defaults.colorMode
        let accentValue = (try? container.decodeIfPresent(String.self, forKey: .accent)) ?? defaults.accent
        accent = accentValue.range(of: "^[a-z]{1,20}$", options: .regularExpression) != nil ? accentValue : "default"
        searchProvider = (try? container.decodeIfPresent(SearchProvider.self, forKey: .searchProvider)) ?? defaults.searchProvider
        saveHistory = (try? container.decodeIfPresent(Bool.self, forKey: .saveHistory)) ?? defaults.saveHistory
        restoreSession = (try? container.decodeIfPresent(Bool.self, forKey: .restoreSession)) ?? defaults.restoreSession
        showShortcuts = (try? container.decodeIfPresent(Bool.self, forKey: .showShortcuts)) ?? defaults.showShortcuts
        showFullUrls = (try? container.decodeIfPresent(Bool.self, forKey: .showFullUrls)) ?? defaults.showFullUrls
    }
}

public struct Shortcut: Codable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var url: String
}

/// Pestañas abiertas al cerrar la app, para restaurarlas.
public struct SavedSession: Codable, Equatable {
    public var urls: [String] = []
    public var activeIndex = 0
}

/// Permisos que un sitio puede pedir en iPhone a través de WebKit.
public enum SitePermission: String, Codable, CaseIterable {
    case camera, microphone
}

/// Datos del usuario en el dispositivo: preferencias, accesos directos, direcciones
/// personalizadas, decisiones de permisos y sesión. Se guardan en `profile.json` (escritura atómica).
public final class Profile {
    private struct Data: Codable {
        /// 2: direcciones personalizadas (antes, reglas de alias en `aliasRules`).
        var version = 2
        var settings = Settings()
        var shortcuts: [Shortcut]
        var customAddresses: [CustomAddress]
        /// origen → permiso → permitido.
        var permissions: [String: [String: Bool]] = [:]
        var session = SavedSession()
    }

    public static let maxShortcuts = 24
    public static let shortcutTitleMax = 40
    private static let maxSessionTabs = 50

    private let file: URL
    private let defaultShortcuts: [Shortcut]
    private var data: Data
    private let lock = NSLock()
    public var onChange: () -> Void = {}

    public init(directory: URL, defaultsJSON: Foundation.Data) throws {
        struct Defaults: Decodable {
            let shortcuts: [Shortcut]
        }
        let defaults = try JSONDecoder().decode(Defaults.self, from: defaultsJSON)
        defaultShortcuts = defaults.shortcuts
        file = directory.appendingPathComponent("profile.json")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let rawDefaults = try? JSONSerialization.jsonObject(with: defaultsJSON) as? [String: Any]
        data = Data(shortcuts: defaults.shortcuts, customAddresses: CustomAddresses.sanitize(rawDefaults?["customAddresses"]))
        if let stored = try? Foundation.Data(contentsOf: file), let decoded = Profile.decode(stored, defaults: self) {
            data = decoded
        }
    }

    /// Descarta lo que no sea válido, como sanitize.ts en escritorio.
    private static func decode(_ stored: Foundation.Data, defaults: Profile) -> Data? {
        guard let raw = try? JSONSerialization.jsonObject(with: stored) as? [String: Any] else { return nil }
        var result = Data(shortcuts: defaults.defaultShortcuts, customAddresses: [])
        if let settings = raw["settings"], let encoded = try? JSONSerialization.data(withJSONObject: settings),
           let decoded = try? JSONDecoder().decode(Settings.self, from: encoded) {
            result.settings = decoded
        }
        if let shortcuts = raw["shortcuts"] as? [[String: Any]] {
            var seen = Set<String>()
            result.shortcuts = shortcuts.compactMap { item -> Shortcut? in
                guard case .ok(let url, _) = UrlUtils.normalizeUserURL(item["url"] as? String ?? ""), seen.insert(url).inserted else { return nil }
                let title = String((item["title"] as? String ?? "").trimmed.prefix(shortcutTitleMax))
                if title.isEmpty { return nil }
                return Shortcut(id: (item["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString, title: title, url: url)
            }.prefix(maxShortcuts).map { $0 }
        }
        // Las versiones anteriores guardaban reglas de alias: se convierten al leerlas.
        result.customAddresses = CustomAddresses.sanitize(raw["customAddresses"] ?? raw["aliasRules"])
        if let permissions = raw["permissions"] as? [String: [String: Bool]] {
            result.permissions = permissions.filter { origin, _ in origin.range(of: "^https?://[^/\\s]+$", options: .regularExpression) != nil }
        }
        if let session = raw["session"] as? [String: Any] {
            let urls = (session["urls"] as? [String] ?? []).filter(Profile.isSessionURL).prefix(maxSessionTabs).map { $0 }
            let index = session["activeIndex"] as? Int ?? 0
            result.session = SavedSession(urls: urls, activeIndex: min(max(0, index), max(0, urls.count - 1)))
        }
        return result
    }

    private static func isSessionURL(_ url: String) -> Bool {
        url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") || url == InternalPage.newTab.url
    }

    public var settings: Settings { lock.locked { data.settings } }
    public var shortcuts: [Shortcut] { lock.locked { data.shortcuts } }
    public var customAddresses: [CustomAddress] { lock.locked { data.customAddresses } }
    public var session: SavedSession { lock.locked { data.session } }

    public func updateSettings(_ transform: (inout Settings) -> Void) {
        change { transform(&$0.settings) }
    }

    /* ------------------------------ Accesos directos ------------------------------ */

    public enum ShortcutResult: Equatable {
        case ok(Shortcut)
        /// Códigos por campo como en escritorio; `limit` si ya hay 24 accesos.
        case errors([String: String], limit: Bool)
    }

    public func saveShortcut(title: String, url: String, editingId: String? = nil) -> ShortcutResult {
        let current = shortcuts
        if editingId == nil && current.count >= Profile.maxShortcuts { return .errors([:], limit: true) }
        var errors: [String: String] = [:]
        let cleanTitle = title.trimmed
        if cleanTitle.isEmpty { errors["title"] = "required" } else if cleanTitle.count > Profile.shortcutTitleMax { errors["title"] = "too-long" }
        var cleanURL = ""
        switch UrlUtils.normalizeUserURL(url) {
        case .ok(let normalized, _):
            cleanURL = normalized
            if current.contains(where: { $0.id != editingId && $0.url == normalized }) { errors["url"] = "duplicate-url" }
        case .failure(let reason):
            switch reason {
            case "empty": errors["url"] = "required"
            case "invalid": errors["url"] = "invalid-url"
            default: errors["url"] = "unsafe-protocol"
            }
        }
        if !errors.isEmpty { return .errors(errors, limit: false) }
        let shortcut = Shortcut(id: editingId ?? UUID().uuidString, title: cleanTitle, url: cleanURL)
        change { data in
            if let index = data.shortcuts.firstIndex(where: { $0.id == editingId }) {
                data.shortcuts[index] = shortcut
            } else {
                data.shortcuts.append(shortcut)
            }
        }
        return .ok(shortcut)
    }

    public func removeShortcut(id: String) { change { $0.shortcuts.removeAll { $0.id == id } } }
    public func resetShortcuts() { change { $0.shortcuts = defaultShortcuts } }

    /* ------------------------- Direcciones personalizadas ------------------------- */

    /// Crea o edita una entrada. Devuelve los errores (con la entrada que choca) sin tocar las demás.
    @discardableResult
    public func saveCustomAddress(target: String, address: String, enabled: Bool, editingId: String? = nil, sections: String = "") -> CustomAddresses.Validation {
        let current = customAddresses
        if editingId == nil && current.count >= CustomAddresses.max { return .errors(["target": "limit"], conflicts: [:]) }
        let result = CustomAddresses.validate(target: target, address: address, enabled: enabled, entries: current, editingId: editingId, sections: sections)
        guard case .ok(let cleanTarget, let cleanAddress, let isEnabled, let cleanSections) = result else { return result }
        let now = Profile.timestamp()
        change { data in
            let existing = data.customAddresses.firstIndex { $0.id == editingId }
            let entry = CustomAddress(id: existing.map { data.customAddresses[$0].id } ?? UUID().uuidString, target: cleanTarget, address: cleanAddress,
                                      enabled: isEnabled, createdAt: existing.map { data.customAddresses[$0].createdAt } ?? now, updatedAt: now,
                                      sections: cleanSections)
            if let existing { data.customAddresses[existing] = entry } else { data.customAddresses.append(entry) }
        }
        return result
    }

    /// Activa o desactiva. No activa una entrada que choca con otra activa: devuelve esa otra.
    @discardableResult
    public func setCustomAddressEnabled(id: String, enabled: Bool) -> CustomAddress? {
        let current = customAddresses
        guard let entry = current.first(where: { $0.id == id }) else { return nil }
        if enabled, let target = CustomAddresses.parseLocation(entry.target), let address = CustomAddresses.parseLocation(entry.address) {
            let conflicts = CustomAddresses.findConflicts(target: target, address: address, current, exceptId: id, sections: entry.sections).conflicts
            if let other = conflicts["target"] ?? conflicts["address"] ?? conflicts["sections"] { return other }
        }
        change { data in
            guard let index = data.customAddresses.firstIndex(where: { $0.id == id }) else { return }
            data.customAddresses[index].enabled = enabled
            data.customAddresses[index].updatedAt = Profile.timestamp()
        }
        return nil
    }

    public func removeCustomAddress(id: String) { change { $0.customAddresses.removeAll { $0.id == id } } }

    /// Fecha ISO 8601 con milisegundos, como `new Date().toISOString()` en escritorio.
    private static func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    /* ---------------------------------- Permisos ---------------------------------- */

    /// nil = preguntar.
    public func permission(origin: String, _ permission: SitePermission) -> Bool? {
        lock.locked { data.permissions[origin]?[permission.rawValue] }
    }

    public func setPermission(origin: String, _ permission: SitePermission, allowed: Bool) {
        change { $0.permissions[origin, default: [:]][permission.rawValue] = allowed }
    }

    public var sitePermissions: [String: [SitePermission: Bool]] {
        lock.locked {
            data.permissions.mapValues { site in
                Dictionary(uniqueKeysWithValues: site.compactMap { key, value in SitePermission(rawValue: key).map { ($0, value) } })
            }
        }
    }

    public func forgetPermissions(origin: String? = nil) {
        change { data in
            if let origin { data.permissions[origin] = nil } else { data.permissions = [:] }
        }
    }

    /* ----------------------------------- Sesión ----------------------------------- */

    public func saveSession(urls: [String], activeIndex: Int) {
        let kept = urls.filter(Profile.isSessionURL).prefix(Profile.maxSessionTabs).map { $0 }
        change { $0.session = SavedSession(urls: kept, activeIndex: min(max(0, activeIndex), max(0, kept.count - 1))) }
    }

    private func change(_ transform: (inout Data) -> Void) {
        let snapshot: Data = lock.locked {
            transform(&data)
            return data
        }
        if let encoded = try? JSONEncoder().encode(snapshot) {
            try? encoded.write(to: file, options: .atomic)
        }
        onChange()
    }
}

public struct HistoryItem: Codable, Equatable, Identifiable {
    public let id: String
    public let url: String
    public var title: String
    public var visitedAt: Double
}

public enum ClearRange: String, CaseIterable {
    case hour, day, week, all

    var seconds: Double {
        switch self {
        case .hour: return 3600
        case .day: return 86_400
        case .week: return 604_800
        case .all: return .infinity
        }
    }
}

/// Historial (solo http/https de nivel superior) con las reglas de escritorio:
/// 10 000 entradas como máximo y visitas repetidas a la misma URL en 30 s agrupadas.
public final class HistoryStore {
    public static let maxItems = 10_000
    private static let mergeWindow: Double = 30

    private let file: URL
    private var items: [HistoryItem] = []
    private let lock = NSLock()
    private var pendingSave: DispatchWorkItem?
    private let queue = DispatchQueue(label: "icarus.history")
    public var onChange: () -> Void = {}

    public init(file: URL) {
        self.file = file
        struct Stored: Decodable { let items: [HistoryItem] }
        if let data = try? Data(contentsOf: file), let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            items = stored.items.filter { HistoryStore.isWeb($0.url) }.prefix(HistoryStore.maxItems).map { $0 }
        }
    }

    private static func isWeb(_ url: String) -> Bool { url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") }

    /// De la más reciente a la más antigua.
    public func list() -> [HistoryItem] { lock.locked { items } }

    public func search(_ query: String) -> [HistoryItem] {
        let needle = query.trimmed.lowercased()
        if needle.isEmpty { return list() }
        return list().filter { $0.title.lowercased().contains(needle) || $0.url.lowercased().contains(needle) }
    }

    public func add(url: String, title: String, now: Double = Date().timeIntervalSince1970) {
        guard HistoryStore.isWeb(url) else { return }
        mutate { items in
            if let latest = items.first, latest.url == url, now - latest.visitedAt < HistoryStore.mergeWindow {
                items[0].title = title.isEmpty ? latest.title : title
                items[0].visitedAt = now
            } else {
                items.insert(HistoryItem(id: UUID().uuidString, url: url, title: title, visitedAt: now), at: 0)
                if items.count > HistoryStore.maxItems { items.removeLast(items.count - HistoryStore.maxItems) }
            }
        }
    }

    /// El título suele llegar después de la navegación: se actualiza en las entradas recientes.
    public func updateTitle(url: String, title: String) {
        guard !title.isEmpty else { return }
        mutate { items in
            guard let index = items.prefix(6).firstIndex(where: { $0.url == url }), items[index].title != title else { return }
            items[index].title = title
        }
    }

    public func remove(id: String) { mutate { $0.removeAll { $0.id == id } } }

    public func clear(_ range: ClearRange, now: Double = Date().timeIntervalSince1970) {
        mutate { items in
            if range == .all { items.removeAll() } else { items.removeAll { now - $0.visitedAt <= range.seconds } }
        }
    }

    /// Escribe ya los cambios pendientes (al pasar la app a segundo plano).
    public func flush() {
        let task: DispatchWorkItem? = lock.locked {
            let pending = pendingSave
            pendingSave = nil
            return pending
        }
        guard let task else { return }
        task.cancel()
        write()
    }

    private func mutate(_ transform: (inout [HistoryItem]) -> Void) {
        lock.locked {
            transform(&items)
            if pendingSave == nil {
                let task = DispatchWorkItem { [weak self] in
                    self?.lock.locked { self?.pendingSave = nil }
                    self?.write()
                }
                pendingSave = task
                queue.asyncAfter(deadline: .now() + 1.5, execute: task)
            }
        }
        onChange()
    }

    private func write() {
        struct Stored: Encodable {
            let version = 1
            let items: [HistoryItem]
        }
        let snapshot = list()
        if let data = try? JSONEncoder().encode(Stored(items: snapshot)) {
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: file, options: .atomic)
        }
    }
}

extension NSLock {
    func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
