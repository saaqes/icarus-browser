import SwiftUI
import WebKit

/// Cómo se presenta una dirección: el alias si hay regla activa, o el host y la ruta.
enum AddressFormat {
    struct Display {
        let text: String
        let alias: String?
        let secure: Bool
        let insecure: Bool
    }

    @MainActor
    static func display(_ url: String) -> Display {
        let services = AppServices.shared
        if url == InternalPage.newTab.url { return Display(text: "", alias: nil, secure: false, insecure: false) }
        guard let parsed = UrlUtils.parseWebURL(url) else { return Display(text: url, alias: nil, secure: false, insecure: false) }
        if services.settings.showAliases, let match = AliasRules.findMatch(url, services.profile.aliasRules) {
            return Display(text: match.rule.alias, alias: match.rule.alias, secure: parsed.protocol == "https:", insecure: parsed.protocol == "http:")
        }
        let path = parsed.pathname + parsed.search == "/" ? "" : parsed.pathname + parsed.search
        if parsed.protocol == "https:" {
            return Display(text: parsed.host.removingPrefix("www.") + path, alias: nil, secure: true, insecure: false)
        }
        return Display(text: "http://\(parsed.host)\(path)", alias: nil, secure: false, insecure: !UrlUtils.isLoopbackHost(parsed.hostname))
    }

    /// Título visible: el nombre de la regla de alias, el título o el host.
    @MainActor
    static func title(_ url: String, _ pageTitle: String) -> String {
        if url == InternalPage.newTab.url { return "Nueva pestaña" }
        let services = AppServices.shared
        if services.settings.showAliases, let match = AliasRules.findMatch(url, services.profile.aliasRules) { return match.rule.displayName }
        if !pageTitle.trimmed.isEmpty { return pageTitle }
        return UrlUtils.parseWebURL(url)?.hostname ?? url
    }
}

/// Pestañas y navegación de la ventana.
@MainActor
final class BrowserModel: ObservableObject {
    @Published private(set) var tabs: [BrowserTab] = []
    @Published private(set) var current: BrowserTab?
    /// Mensaje breve en la parte inferior (bloqueos, errores de la barra de direcciones…).
    @Published var notice: String?
    /// Página interna que la interfaz debe mostrar (historial, descargas, configuración).
    @Published var internalSheet: InternalPage?

    private let services = AppServices.shared

    init() {
        let session = services.profile.session
        if services.settings.restoreSession && !session.urls.isEmpty {
            for url in session.urls { tabs.append(makeTab(url)) }
            select(tabs[min(session.activeIndex, tabs.count - 1)])
        } else {
            openNewTab()
        }
        if let url = UserDefaults.standard.string(forKey: "icarus.open") { submit(url) }
    }

    private func makeTab(_ url: String?) -> BrowserTab {
        let tab = BrowserTab(url: url)
        tab.browser = self
        return tab
    }

    @discardableResult
    func openNewTab(_ url: String? = nil) -> BrowserTab {
        let tab = makeTab(url)
        let index = current.flatMap { tabs.firstIndex(of: $0) }.map { $0 + 1 } ?? tabs.count
        tabs.insert(tab, at: index)
        select(tab)
        return tab
    }

    func select(_ tab: BrowserTab) {
        current = tab
        tab.activate()
    }

    func close(_ tab: BrowserTab) {
        guard let index = tabs.firstIndex(of: tab) else { return }
        tabs.remove(at: index)
        tab.close()
        if tabs.isEmpty {
            current = nil
            openNewTab()
        } else if current === tab {
            select(tabs[min(index, tabs.count - 1)])
        }
    }

    func closeAll() {
        tabs.forEach { $0.close() }
        tabs.removeAll()
        current = nil
        openNewTab()
    }

    /// Ventana nueva pedida por una página (target=_blank, window.open tras un gesto).
    func openWindow(from opener: BrowserTab, configuration: WKWebViewConfiguration) -> WKWebView {
        let tab = makeTab(nil)
        let index = tabs.firstIndex(of: opener).map { $0 + 1 } ?? tabs.count
        tabs.insert(tab, at: index)
        let view = tab.adopt(configuration: configuration)
        current = tab
        return view
    }

    /// Abre lo escrito en la barra de direcciones (mismo resolvedor que escritorio y Android).
    func submit(_ text: String) {
        let settings = services.settings
        switch InputResolver.resolve(text, provider: settings.searchProvider, rules: services.profile.aliasRules) {
        case .empty: break
        case .url(let url), .search(let url, _, _), .alias(let url, _): navigate(url)
        case .aliasUnresolved(let alias, let reason):
            notice = reason == "disabled"
                ? "La regla del alias «\(alias)» está desactivada."
                : "«\(alias)» no corresponde a ninguna regla de alias. Los alias .icarus no son dominios de Internet."
        case .internal(let page): openInternal(page)
        case .internalUnknown(let value): notice = "La página interna «\(value)» no existe."
        case .blocked(let proto, let dangerous):
            if dangerous {
                notice = "ICARUS bloquea las direcciones \(proto) por seguridad."
            } else if let url = URL(string: text.trimmed) {
                (current ?? openNewTab()).present(.external(url: url) { open in
                    if open { UIApplication.shared.open(url) }
                })
            }
        }
    }

    func navigate(_ url: String) {
        (current ?? openNewTab()).load(url)
    }

    func openInternal(_ page: InternalPage) {
        switch page {
        case .newTab: current?.showNewTab()
        case .blank: navigate("about:blank")
        case .history, .downloads, .settings: internalSheet = page
        }
    }

    func saveSession() {
        let urls = tabs.map { $0.showingNewTab ? InternalPage.newTab.url : $0.url }
        let index = current.flatMap { tabs.firstIndex(of: $0) } ?? 0
        services.profile.saveSession(urls: services.settings.restoreSession ? urls : [], activeIndex: index)
        services.saveAll()
    }

    /// Sugerencias para el texto escrito: acción principal, accesos directos e historial.
    struct Suggestion: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let subtitle: String?
        let target: String?
    }

    func suggestions(for query: String) -> [Suggestion] {
        let value = query.trimmed
        var result: [Suggestion] = []
        let settings = services.settings
        if !value.isEmpty {
            switch InputResolver.resolve(value, provider: settings.searchProvider, rules: services.profile.aliasRules) {
            case .url(let url): result.append(Suggestion(icon: "globe", title: "Ir a \(url)", subtitle: nil, target: value))
            case .search(_, let q, let provider): result.append(Suggestion(icon: "magnifyingglass", title: "Buscar «\(q)»", subtitle: "con \(provider.displayName)", target: value))
            case .alias(let url, let rule): result.append(Suggestion(icon: "tag", title: "Abrir \(rule.alias)", subtitle: "Alias de ICARUS → \(url)", target: value))
            case .aliasUnresolved(let alias, let reason):
                result.append(Suggestion(icon: "exclamationmark.triangle", title: alias,
                                         subtitle: reason == "disabled" ? "La regla de este alias está desactivada." : "No hay ninguna regla para este alias.", target: nil))
            case .internal(let page): result.append(Suggestion(icon: "doc", title: "Abrir \(page.url)", subtitle: nil, target: value))
            case .internalUnknown: result.append(Suggestion(icon: "exclamationmark.triangle", title: "Página interna desconocida", subtitle: value, target: nil))
            case .blocked(let proto, let dangerous):
                result.append(Suggestion(icon: "shield", title: dangerous ? "ICARUS bloquea las direcciones \(proto) por seguridad." : "Abrir con otra app",
                                         subtitle: nil, target: dangerous ? nil : value))
            case .empty: break
            }
        }
        let needle = value.lowercased()
        if !needle.isEmpty {
            for shortcut in services.profile.shortcuts.filter({ $0.title.lowercased().contains(needle) || $0.url.lowercased().contains(needle) }).prefix(3) {
                result.append(Suggestion(icon: "star", title: shortcut.title, subtitle: AddressFormat.display(shortcut.url).text, target: shortcut.url))
            }
        }
        var seen = Set<String>()
        for item in services.history.search(value) where seen.insert(item.url).inserted {
            result.append(Suggestion(icon: "clock", title: AddressFormat.title(item.url, item.title), subtitle: AddressFormat.display(item.url).text, target: item.url))
            if seen.count >= (needle.isEmpty ? 6 : 5) { break }
        }
        return result
    }
}
