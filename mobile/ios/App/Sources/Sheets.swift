import SwiftUI
import WebKit

/// Página de nueva pestaña (nativa). Cada estilo tiene su propia distribución, como en escritorio.
struct NewTabPage: View {
    let look: Look
    let onSearch: () -> Void
    let onOpen: (String) -> Void
    let onShield: () -> Void
    let onAddShortcut: () -> Void
    @ObservedObject private var services = AppServices.shared
    @State private var editing: Shortcut?

    var body: some View {
        ScrollView {
            VStack(alignment: look.theme == .essential ? .center : .leading, spacing: 22) {
                header
                searchBox
                if services.settings.showShortcuts { shortcuts }
                shieldCard
            }
            .padding(.horizontal, 20)
            .padding(.top, look.theme == .essential ? 56 : 36)
            .padding(.bottom, 24)
        }
        .background(background.ignoresSafeArea())
        .sheet(item: $editing) { shortcut in NavigationStack { ShortcutForm(shortcut: shortcut) } }
    }

    @ViewBuilder
    private var background: some View {
        switch look.theme {
        case .essential: look.pageBg
        case .panorama: LinearGradient(colors: [look.accent.opacity(look.dark ? 0.33 : 0.25), look.pageBg, look.pageBg], startPoint: .top, endPoint: .bottom)
        case .icarus: LinearGradient(colors: [look.accent.opacity(look.dark ? 0.4 : 0.2), look.pageBg, look.pageBg], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    @ViewBuilder
    private var header: some View {
        switch look.theme {
        case .essential:
            HStack(spacing: 12) {
                Image("Logo").resizable().frame(width: 44, height: 44)
                Text("ICARUS").font(.system(size: 30, weight: .bold)).kerning(2.4).foregroundColor(look.fg1)
            }
        case .panorama:
            VStack(alignment: .leading, spacing: 2) {
                Text(greeting).font(.system(size: 28, weight: .bold)).foregroundColor(look.fg1)
                Text(date).foregroundColor(look.fg2)
            }
        case .icarus:
            VStack(alignment: .leading, spacing: 8) {
                Image("Logo").resizable().frame(width: 56, height: 56)
                Text("ICARUS").font(.system(size: 34, weight: .bold)).kerning(4).foregroundColor(look.fg1)
                Text("Navega más alto, sin rastreadores.").foregroundColor(look.fg2)
            }
        }
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 6...13: return "Buenos días"
        case 14...20: return "Buenas tardes"
        default: return "Buenas noches"
        }
    }

    private var date: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es_ES")
        formatter.dateFormat = "EEEE, d 'de' MMMM"
        let text = formatter.string(from: Date())
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    private var searchBox: some View {
        Button(action: onSearch) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                Text("Busca o escribe una dirección")
                Spacer()
            }
            .foregroundColor(look.fg3)
            .padding(.horizontal, 18)
            .frame(minHeight: 52)
            .background(RoundedRectangle(cornerRadius: look.theme == .panorama ? 12 : 26).fill(look.theme == .icarus ? look.surface2 : look.surface1))
            .overlay(RoundedRectangle(cornerRadius: look.theme == .panorama ? 12 : 26).stroke(look.border1))
        }
        .accessibilityLabel("Buscar o escribir una dirección")
    }

    private var shortcuts: some View {
        let items = services.profile.shortcuts
        let tiles = ForEach(items) { shortcut in
            tile(label: shortcut.title, letter: String(shortcut.title.prefix(1)).uppercased()) { onOpen(shortcut.url) }
                .contextMenu {
                    Button("Editar") { editing = shortcut }
                    Button("Eliminar", role: .destructive) { services.profile.removeShortcut(id: shortcut.id) }
                }
        }
        return Group {
            if look.theme == .icarus {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        tiles
                        tile(label: "Añadir", letter: nil, action: onAddShortcut)
                    }
                }
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 12) {
                    tiles
                    tile(label: "Añadir", letter: nil, action: onAddShortcut)
                }
            }
        }
    }

    private func tile(label: String, letter: String?, action: @escaping () -> Void) -> some View {
        let panorama = look.theme == .panorama
        let size: CGFloat = panorama ? 40 : 52
        return Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: panorama ? 12 : size / 2).fill(look.surface2)
                    RoundedRectangle(cornerRadius: panorama ? 12 : size / 2).stroke(look.border1)
                    if let letter {
                        Text(letter).font(.system(size: 18, weight: .bold)).foregroundColor(look.accent)
                    } else {
                        Image(systemName: "plus").foregroundColor(look.fg2)
                    }
                }
                .frame(width: size, height: size)
                Text(label).font(.footnote).foregroundColor(look.fg2).lineLimit(1)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 6)
            .frame(minWidth: 72)
            .background(panorama ? RoundedRectangle(cornerRadius: 14).fill(look.surface1) : nil)
        }
        .accessibilityLabel(label)
    }

    private var shieldCard: some View {
        Button(action: onShield) {
            HStack(spacing: 12) {
                Image(systemName: services.shield.enabled ? "shield.fill" : "shield.slash").foregroundColor(look.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(services.shield.enabled ? "ICARUS Shield está activo" : "ICARUS Shield está desactivado").foregroundColor(look.fg1)
                    Text(services.shieldStatus)
                        .font(.footnote).foregroundColor(look.fg3)
                }
                Spacer()
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16).fill(look.surface1))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(look.border1))
        }
    }
}

struct TabsSheet: View {
    @ObservedObject var browser: BrowserModel
    let look: Look
    let dismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(browser.tabs) { tab in
                    TabRow(tab: tab, selected: tab === browser.current, look: look)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            browser.select(tab)
                            dismiss()
                        }
                        .swipeActions {
                            Button("Cerrar", role: .destructive) { browser.close(tab) }
                        }
                }
            }
            .navigationTitle(browser.tabs.count == 1 ? "1 pestaña" : "\(browser.tabs.count) pestañas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if browser.tabs.count > 1 { Button("Cerrar todas", role: .destructive) { browser.closeAll(); dismiss() } }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { browser.openNewTab(); dismiss() } label: { Image(systemName: "plus") }.accessibilityLabel("Nueva pestaña")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct TabRow: View {
    @ObservedObject var tab: BrowserTab
    let selected: Bool
    let look: Look

    var body: some View {
        HStack {
            Image(systemName: "globe").foregroundColor(selected ? look.accent : look.fg3)
            VStack(alignment: .leading) {
                Text(AddressFormat.title(tab.showingNewTab ? InternalPage.newTab.url : tab.url, tab.title)).lineLimit(1)
                Text(tab.showingNewTab ? InternalPage.newTab.url : AddressFormat.display(tab.url).text).font(.footnote).foregroundColor(.secondary).lineLimit(1)
            }
            Spacer()
            if selected { Image(systemName: "checkmark").foregroundColor(look.accent) }
        }
    }
}

struct MenuSheet: View {
    @ObservedObject var browser: BrowserModel
    @ObservedObject var tab: BrowserTab
    let look: Look
    let show: (Sheet?) -> Void
    @ObservedObject private var services = AppServices.shared

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        menuIcon("chevron.backward", "Atrás", enabled: tab.canGoBack) { tab.goBack() }
                        menuIcon("chevron.forward", "Adelante", enabled: tab.canGoForward) { tab.goForward() }
                        menuIcon(tab.loading ? "xmark" : "arrow.clockwise", tab.loading ? "Detener" : "Recargar", enabled: !tab.showingNewTab) {
                            if tab.loading { tab.stop() } else { tab.reload() }
                        }
                        if !tab.showingNewTab, let url = URL(string: tab.url) {
                            ShareLink(item: url) { Image(systemName: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44) }
                                .accessibilityLabel("Compartir")
                        }
                    }
                    .buttonStyle(.borderless)
                }
                Section {
                    row("plus.square.on.square", "Nueva pestaña") { browser.openNewTab(); show(nil) }
                    if !tab.showingNewTab {
                        row("doc.text.magnifyingglass", "Buscar en la página") {
                            show(nil)
                            let view = tab.webView
                            Task { @MainActor in
                                // Se espera a que se cierre la hoja para mostrar la barra de búsqueda de WebKit.
                                try? await Task.sleep(nanoseconds: 400_000_000)
                                view?.findInteraction?.presentFindNavigator(showingReplace: false)
                            }
                        }
                        row("doc.on.doc", "Copiar dirección") { UIPasteboard.general.string = AddressFormat.display(tab.url).full; show(nil) }
                        row("star", "Añadir a accesos directos") {
                            switch services.profile.saveShortcut(title: String(AddressFormat.title(tab.url, tab.title).prefix(Profile.shortcutTitleMax)), url: tab.url) {
                            case .ok: browser.notice = "Acceso directo añadido."
                            case .errors(let errors, let limit):
                                browser.notice = limit ? "Puedes tener como máximo \(Profile.maxShortcuts) accesos directos."
                                    : errors.values.first.map { services.text("shortcutErrors", $0) } ?? "No se pudo añadir."
                            }
                            show(nil)
                        }
                    }
                }
                Section {
                    row("clock", "Historial") { show(.history) }
                    row("arrow.down.circle", "Descargas") { show(.downloads) }
                    row("gearshape", "Configuración") { show(.settings) }
                }
            }
            .navigationTitle(AddressFormat.title(tab.showingNewTab ? InternalPage.newTab.url : tab.url, tab.title))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func menuIcon(_ icon: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
            show(nil)
        } label: {
            Image(systemName: icon).frame(maxWidth: .infinity, minHeight: 44)
        }
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func row(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: icon) }
    }
}

/// Información del sitio, como el panel del icono de la barra en Chrome: estado real de
/// la conexión y, si se muestra una dirección personalizada, a qué sitio van de verdad
/// las solicitudes (nunca se oculta al pedir la información de seguridad).
struct SiteInfoSheet: View {
    @ObservedObject var tab: BrowserTab
    let look: Look
    let customize: (CustomAddressRequest) -> Void
    @ObservedObject private var services = AppServices.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let certificate = tab.error?.kind == .certificate
        let url = certificate ? tab.error!.url : (tab.error?.url ?? tab.url)
        let display = AddressFormat.display(url, applyCustom: !certificate)
        let realHost = UrlUtils.parseWebURL(url)?.host ?? url
        let shownHost = CustomAddresses.formatAddress(display.full, full: false).host
        let origin = UrlUtils.parseWebURL(url).map { "\($0.protocol)//\($0.host)/" }
        NavigationStack {
            List {
                Section {
                    if certificate {
                        info("exclamationmark.triangle.fill", look.danger, services.text("addressBar", "insecureTitle"),
                             services.text("addressBar", "dangerousBody", ["host": realHost]))
                    } else if display.secure {
                        info("lock", look.fg2, services.text("addressBar", "secureTitle"), "WebKit verificó el certificado de \(realHost). La información que envíes viaja cifrada.")
                    } else if display.insecure {
                        info("exclamationmark.triangle", look.color("warning"), services.text("addressBar", "insecureTitle"), services.text("addressBar", "insecureBody"))
                    }
                    if display.custom != nil {
                        info("globe", look.fg2, services.text("addressBar", "customTitle"),
                             services.text("addressBar", "customBody", ["shown": shownHost, "real": realHost]))
                    }
                }
                Section {
                    Button { UIPasteboard.general.string = display.full; dismiss() } label: { Label("Copiar dirección", systemImage: "doc.on.doc") }
                    if !certificate, let origin {
                        Button {
                            customize(display.custom.map { CustomAddressRequest(editId: $0.id) } ?? CustomAddressRequest(target: origin))
                        } label: {
                            Label(display.custom == nil ? "Personalizar dirección" : "Editar dirección personalizada", systemImage: "pencil")
                        }
                    }
                }
            }
            .navigationTitle(shownHost)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Cerrar") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func info(_ icon: String, _ color: Color, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundColor(color).frame(width: 22)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(body).font(.subheadline).foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

struct ShieldSheet: View {
    @ObservedObject var tab: BrowserTab
    let look: Look
    let openSettings: () -> Void
    @ObservedObject private var services = AppServices.shared

    private var host: String? { tab.showingNewTab ? nil : UrlUtils.parseWebURL(tab.url)?.hostname }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if !services.shield.enabled {
                        Text("Shield está desactivado. Puedes activarlo en Configuración.")
                    } else if let host {
                        Toggle(isOn: Binding(get: { !services.shield.isSiteAllowed(tab.url) }, set: { active in
                            services.shield.setSiteAllowed(host: host, !active)
                            tab.reload()
                        })) {
                            VStack(alignment: .leading) {
                                Text("Activo en \(host)")
                                Text(services.shield.isSiteAllowed(tab.url) ? "Este sitio está en tus excepciones: no se bloquea nada."
                                     : "Bloquea anuncios y rastreadores en este sitio. Al cambiarlo se vuelve a cargar la página.")
                                    .font(.footnote).foregroundColor(.secondary)
                            }
                        }
                    } else {
                        Text("Abre una página web para gestionar Shield en ella.")
                    }
                } footer: {
                    Text("En iPhone y iPad, WebKit aplica las reglas de Shield y no informa de cuántas solicitudes bloquea, así que ICARUS no muestra un contador. \(services.shieldStatus).")
                }
                Section {
                    Button("Configuración de Shield", action: openSettings)
                }
            }
            .navigationTitle("ICARUS Shield")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
