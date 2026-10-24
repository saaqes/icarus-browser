// El núcleo se reexporta para que las pruebas de la app (que importan ICARUS) lo vean.
@_exported import IcarusCore
import SwiftUI
import WebKit

/// Servicios compartidos de la app: perfil, historial, ICARUS Shield, descargas y estilos.
/// Los datos se guardan en Application Support del dispositivo; nada sale de él.
@MainActor
final class AppServices: ObservableObject {
    static let shared = AppServices()

    let themes: Themes
    let suffixes: PublicSuffixList
    let profile: Profile
    let history: HistoryStore
    let shield: ShieldLists
    let downloads: DownloadsStore
    private let strings: [String: Any]
    private let shieldBasicText: String

    /// Cambia cada vez que cambian el perfil o Shield (la interfaz se vuelve a dibujar).
    @Published private(set) var revision = 0
    /// Reglas de WebKit compiladas a partir de las listas activas.
    @Published private(set) var shieldRules: WKContentRuleList?
    @Published private(set) var shieldCompileError: String?
    @Published private(set) var shieldConverted = 0
    @Published private(set) var shieldSkipped = 0
    @Published private(set) var shieldCompiling = false

    private init() {
        func resource(_ name: String) -> Data {
            let url = Bundle.main.url(forResource: name, withExtension: nil)!
            return try! Data(contentsOf: url)
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ICARUS", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        themes = try! Themes(json: resource("themes.json"))
        strings = (try? JSONSerialization.jsonObject(with: resource("strings.json")) as? [String: Any]) ?? [:]
        suffixes = PublicSuffixList(rules: String(decoding: resource("public-suffix-rules.txt"), as: UTF8.self))
        profile = try! Profile(directory: support, defaultsJSON: resource("defaults.json"))
        history = HistoryStore(file: support.appendingPathComponent("history.json"))
        shieldBasicText = String(decoding: resource("shield-basic.txt"), as: UTF8.self)
        shield = ShieldLists(directory: support.appendingPathComponent("shield", isDirectory: true), builtinText: shieldBasicText, suffixes: suffixes)
        downloads = DownloadsStore(directory: support)

        profile.onChange = { [weak self] in Task { @MainActor in self?.revision += 1 } }
        shield.onChange = { [weak self] in Task { @MainActor in self?.revision += 1 } }
        applyLaunchArguments()
        Task {
            await compileShield()
            // Las listas se actualizan en segundo plano solo si han caducado (4 días).
            await shield.updateLists(onlyStale: true)
            await compileShield()
        }
    }

    /// Argumentos para las capturas de CI (`-icarus.theme icarus -icarus.mode dark`).
    private func applyLaunchArguments() {
        let defaults = UserDefaults.standard
        if let theme = defaults.string(forKey: "icarus.theme").flatMap(ThemeId.init(rawValue:)) {
            profile.updateSettings { $0.theme = theme }
        }
        if let mode = defaults.string(forKey: "icarus.mode").flatMap(ColorMode.init(rawValue:)) {
            profile.updateSettings { $0.colorMode = mode }
        }
    }

    /// Texto compartido con escritorio (mobile/shared/strings.json).
    func text(_ group: String, _ key: String) -> String {
        ((strings[group] as? [String: Any])?[key] as? String) ?? key
    }

    func text(_ group: String, _ subgroup: String, _ key: String) -> String {
        (((strings[group] as? [String: Any])?[subgroup] as? [String: Any])?[key] as? String) ?? key
    }

    /// Convierte las listas activas y las compila en WebKit (puede tardar unos segundos con EasyList).
    func compileShield() async {
        shieldCompiling = true
        let lists = shield
        let result = await Task.detached(priority: .utility) { lists.contentBlocker() }.value
        shieldConverted = result.convertedFilters
        shieldSkipped = result.skippedFilters
        do {
            shieldRules = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "icarus-shield", encodedContentRuleList: result.json)
            shieldCompileError = nil
        } catch {
            // Si WebKit rechaza las listas descargadas, Shield sigue funcionando con la lista básica y las reglas propias.
            shieldCompileError = error.localizedDescription
            let fallback = ContentBlocker.convert(Filters.parseList(shieldBasicText).filters + Filters.parseList(shield.customRules).filters)
            shieldRules = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "icarus-shield", encodedContentRuleList: fallback.json)
            shieldConverted = fallback.convertedFilters
            shieldSkipped = fallback.skippedFilters
        }
        shieldCompiling = false
        revision += 1
    }

    var settings: Settings { profile.settings }

    func palette(dark: Bool) -> Palette {
        let settings = profile.settings
        return themes.palette(settings.theme, dark: dark, accent: settings.accent)
    }

    func saveAll() {
        history.flush()
    }
}

extension Color {
    init(_ rgba: RGBA) {
        self.init(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
    }
}

/// Estilo resuelto: colores del CSS de escritorio y distribución de cada estilo.
struct Look: Equatable {
    let theme: ThemeId
    let dark: Bool
    let palette: Palette

    func color(_ token: String) -> Color { Color(palette[token]) }

    var accent: Color { color("accent") }
    var onAccent: Color { palette["accent"].luminance > 0.4 ? Color(red: 0.086, green: 0.078, blue: 0.11) : .white }
    var appBg: Color { color("app-bg") }
    var toolbarBg: Color { color("toolbar-bg") }
    var omniboxBg: Color { color("omnibox-bg") }
    var pageBg: Color { color("page-bg") }
    var surface1: Color { color("surface-1") }
    var surface2: Color { color("surface-2") }
    var border1: Color { color("border-1") }
    var fg1: Color { color("fg-1") }
    var fg2: Color { color("fg-2") }
    var fg3: Color { color("fg-3") }
    var danger: Color { color("danger") }

    /// Cada estilo coloca la barra de direcciones en un sitio distinto, como en escritorio.
    var addressBarAtBottom: Bool { theme == .icarus }
    var hasBottomToolbar: Bool { theme == .panorama }
}
