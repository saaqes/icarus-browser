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
            await restoreCompiledShield()
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

    private static let ruleListId = "icarus-shield"
    private static let compiledKey = "icarus.shield.compiled"
    /// Huella de las listas con las que se compilaron las reglas que hay en WebKit.
    private var compiledFingerprint: String?

    /// WebKit guarda las reglas compiladas: si las listas no han cambiado, se usan al
    /// instante en lugar de convertir y compilar de nuevo (EasyList tarda varios segundos).
    private func restoreCompiledShield() async {
        guard let saved = UserDefaults.standard.dictionary(forKey: AppServices.compiledKey),
              let fingerprint = saved["fingerprint"] as? String, fingerprint == shield.fingerprint else { return }
        let list: WKContentRuleList? = await withCheckedContinuation { continuation in
            WKContentRuleListStore.default().lookUpContentRuleList(forIdentifier: AppServices.ruleListId) { list, _ in
                continuation.resume(returning: list)
            }
        }
        guard let list else { return }
        shieldRules = list
        shieldConverted = saved["converted"] as? Int ?? 0
        shieldSkipped = saved["skipped"] as? Int ?? 0
        compiledFingerprint = fingerprint
        revision += 1
    }

    /// Convierte las listas activas y las compila en WebKit (puede tardar unos segundos con
    /// EasyList). Los contadores solo cambian cuando WebKit ha aceptado las reglas.
    func compileShield() async {
        let fingerprint = shield.fingerprint
        if shieldRules != nil && compiledFingerprint == fingerprint { return }
        shieldCompiling = true
        let lists = shield
        let result = await Task.detached(priority: .userInitiated) { lists.contentBlocker() }.value
        do {
            shieldRules = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: AppServices.ruleListId, encodedContentRuleList: result.json)
            shieldConverted = result.convertedFilters
            shieldSkipped = result.skippedFilters
            shieldCompileError = nil
            compiledFingerprint = fingerprint
            UserDefaults.standard.set(["fingerprint": fingerprint, "converted": result.convertedFilters, "skipped": result.skippedFilters],
                                      forKey: AppServices.compiledKey)
        } catch {
            // Si WebKit rechaza las listas descargadas, Shield sigue funcionando con la lista básica y las reglas propias.
            shieldCompileError = error.localizedDescription
            let fallback = ContentBlocker.convert(Filters.parseList(shieldBasicText).filters + Filters.parseList(shield.customRules).filters)
            if let rules = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: AppServices.ruleListId, encodedContentRuleList: fallback.json) {
                shieldRules = rules
                shieldConverted = fallback.convertedFilters
                shieldSkipped = fallback.skippedFilters
            }
            compiledFingerprint = nil
            UserDefaults.standard.removeObject(forKey: AppServices.compiledKey)
        }
        shieldCompiling = false
        revision += 1
    }

    /// Texto de estado de Shield para la interfaz (sin cifras hasta que WebKit tiene las reglas).
    var shieldStatus: String {
        guard shield.enabled else { return "Actívalo en Configuración" }
        guard shieldRules != nil else { return "Preparando las reglas de WebKit…" }
        let skipped = shieldSkipped > 0 ? " (\(shieldSkipped) no compatibles con WebKit)" : ""
        return "\(shieldConverted.formatted()) filtros de anuncios y rastreadores aplicados por WebKit\(skipped)"
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
