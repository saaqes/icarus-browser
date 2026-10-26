import SwiftUI
import WebKit

@main
struct IcarusBrowserApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

enum Sheet: String, Identifiable {
    case tabs, menu, shield, settings, history, downloads, newShortcut, siteInfo, editAddress
    var id: String { rawValue }
}

/// Qué abrir en el editor de direcciones personalizadas (desde la información del sitio).
struct CustomAddressRequest: Equatable {
    var editId: String?
    var target: String?
}

struct ContentView: View {
    @StateObject private var browser = BrowserModel()
    @ObservedObject private var services = AppServices.shared
    @ObservedObject private var updates = UpdateModel.shared
    /// Avisos de actualización ya mostrados en esta sesión (no se repiten).
    @State private var notifiedUpdates = Set<String>()
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.scenePhase) private var phase

    private var look: Look {
        let settings = services.settings
        let dark = settings.colorMode == .dark || (settings.colorMode == .system && systemScheme == .dark)
        return Look(theme: settings.theme, dark: dark, palette: services.palette(dark: dark))
    }

    private var scheme: ColorScheme? {
        switch services.settings.colorMode {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var body: some View {
        Group {
            if let tab = browser.current {
                BrowserScreen(browser: browser, tab: tab, look: look)
            }
        }
        .preferredColorScheme(scheme)
        .tint(look.accent)
        .onChange(of: phase) { value in
            if value != .active { browser.saveSession() }
            if value == .active { Task { await updates.checkIfDue() } }
        }
        .onChange(of: updates.status) { _ in notifyUpdate() }
        .task {
            notifyUpdate()
            await updates.checkIfDue()
        }
    }

    /// Aviso discreto (abajo, sin interrumpir): una vez por versión nueva no pospuesta,
    /// y la confirmación de la versión tras actualizar.
    private func notifyUpdate() {
        if let updated = updates.justUpdated, notifiedUpdates.insert("updated:\(updated.to)").inserted {
            browser.notice = "ICARUS se ha actualizado a la versión \(updated.to)."
        }
        if updates.shouldNotify, let version = updates.available?.version, notifiedUpdates.insert(version).inserted {
            browser.notice = "ICARUS \(version) está disponible: Configuración → Actualizaciones."
        }
    }
}

/// Pantalla del navegador para la pestaña actual (se observa para reflejar su estado).
struct BrowserScreen: View {
    @ObservedObject var browser: BrowserModel
    @ObservedObject var tab: BrowserTab
    @ObservedObject private var services = AppServices.shared
    let look: Look

    @State private var sheet: Sheet?
    @State private var addressText = ""
    @FocusState private var addressFocused: Bool
    @State private var fieldOne = ""
    @State private var fieldTwo = ""
    @State private var addressRequest = CustomAddressRequest()

    var body: some View {
        ZStack {
            look.toolbarBg.ignoresSafeArea()
            VStack(spacing: 0) {
                if !look.addressBarAtBottom {
                    toolbar
                    progressLine
                }
                content
                if look.addressBarAtBottom {
                    progressLine
                    toolbar
                }
                if look.hasBottomToolbar && !addressFocused { bottomBar }
            }
        }
        .overlay(alignment: .bottom) { noticeView }
        .sheet(item: $sheet) { sheetView($0) }
        .onChange(of: browser.internalSheet) { _ in presentInternalPage() }
        .onChange(of: addressFocused) { focused in
            // Como Chrome: al editar se ve la dirección completa (la personalizada si la hay) y se selecciona entera.
            addressText = focused ? (tab.showingNewTab ? "" : currentDisplay.full) : displayText
            if focused && !addressText.isEmpty {
                DispatchQueue.main.async { UIApplication.shared.sendAction(#selector(UIResponder.selectAll(_:)), to: nil, from: nil, for: nil) }
            }
        }
        .onChange(of: tab.url) { _ in if !addressFocused { addressText = displayText } }
        .onChange(of: services.revision) { _ in if !addressFocused { addressText = displayText } }
        .onAppear {
            addressText = displayText
            // Una página interna pedida al arrancar (icarus://configuracion) no dispara onChange.
            presentInternalPage()
        }
        .onChange(of: tab.id) { _ in addressText = displayText }
        .onChange(of: tab.request?.id) { _ in
            fieldOne = ""
            fieldTwo = ""
            if case .prompt(_, _, let text, _) = tab.request { fieldOne = text }
        }
        .alert(requestTitle, isPresented: Binding(get: { tab.request != nil }, set: { _ in }), presenting: tab.request) { request in
            requestActions(request)
        } message: { request in
            Text(requestMessage(request))
        }
    }

    private func presentInternalPage() {
        guard let page = browser.internalSheet else { return }
        sheet = page == .history ? .history : page == .downloads ? .downloads : .settings
        browser.internalSheet = nil
    }

    private var certificateError: Bool { tab.error?.kind == .certificate }

    /// Con un error de certificado se muestra la dirección real que falló, completa y sin
    /// dirección personalizada; si no, la de la página (o la de la página que no cargó).
    private var currentDisplay: AddressFormat.Display {
        if certificateError, let error = tab.error { return AddressFormat.display(error.url, applyCustom: false) }
        return AddressFormat.display(tab.showingNewTab ? InternalPage.newTab.url : (tab.error?.url ?? tab.url))
    }

    private var displayText: String {
        let display = currentDisplay
        return certificateError ? display.full : display.text
    }

    // MARK: Barra de direcciones

    /// Icono de la información del sitio, con el estado real de la conexión (como Chrome).
    private var securityIcon: (name: String, color: Color, label: String, notSecure: Bool) {
        let display = currentDisplay
        if addressFocused || tab.showingNewTab { return ("magnifyingglass", look.fg3, "Buscar", false) }
        if certificateError { return ("exclamationmark.triangle.fill", look.danger, "No seguro: el certificado no es válido", true) }
        if display.secure { return ("slider.horizontal.3", look.fg2, "Información del sitio", false) }
        if display.insecure { return ("exclamationmark.triangle", look.color("warning"), "No seguro: ver información del sitio", true) }
        return ("info.circle", look.fg2, "Información del sitio", false)
    }

    private var addressBar: some View {
        HStack(spacing: 6) {
            Button {
                if tab.showingNewTab { addressFocused = true } else { sheet = .siteInfo }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: securityIcon.name).foregroundColor(securityIcon.color)
                    if securityIcon.notSecure && !addressFocused {
                        Text(services.text("addressBar", "notSecure")).font(.subheadline).foregroundColor(securityIcon.color).lineLimit(1).fixedSize()
                    }
                }
                .frame(minWidth: 32, minHeight: 36)
            }
            .accessibilityLabel(securityIcon.label)
            TextField("Busca o escribe una dirección", text: $addressText)
                .focused($addressFocused)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.go)
                .foregroundColor(look.color("omnibox-fg"))
                .onSubmit {
                    let value = addressText
                    addressFocused = false
                    browser.submit(value)
                }
                .accessibilityLabel("Barra de direcciones")
            if addressFocused && !addressText.isEmpty {
                Button { addressText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(look.fg3)
                }
                .accessibilityLabel("Borrar")
            }
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 44)
        .background(RoundedRectangle(cornerRadius: look.theme == .panorama ? 12 : 22).fill(look.omniboxBg))
        .overlay(RoundedRectangle(cornerRadius: look.theme == .panorama ? 12 : 22).stroke(look.border1))
    }

    private var shieldButton: some View {
        Button { sheet = .shield } label: {
            Image(systemName: tab.isShieldActive ? "shield.fill" : "shield.slash")
                .foregroundColor(tab.isShieldActive ? look.accent : look.fg3)
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(tab.isShieldActive ? "ICARUS Shield: activo en esta página" : "ICARUS Shield: inactivo en esta página")
    }

    private var tabsButton: some View {
        Button { sheet = .tabs } label: {
            Text(browser.tabs.count > 99 ? "99+" : "\(browser.tabs.count)")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(look.fg1)
                .frame(width: 24, height: 24)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(look.fg2, lineWidth: 1.6))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel("Pestañas abiertas: \(browser.tabs.count)")
    }

    private var menuButton: some View {
        Button { sheet = .menu } label: {
            Image(systemName: "ellipsis").foregroundColor(look.fg2).frame(width: 44, height: 44)
        }
        .accessibilityLabel("Menú")
    }

    private var toolbar: some View {
        HStack(spacing: 4) {
            if look.addressBarAtBottom {
                shieldButton
                addressBar
                if !addressFocused {
                    tabsButton
                    menuButton
                }
            } else if look.hasBottomToolbar {
                addressBar
                shieldButton
            } else {
                addressBar
                if !addressFocused {
                    shieldButton
                    tabsButton
                    menuButton
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(look.toolbarBg)
    }

    @ViewBuilder
    private var progressLine: some View {
        GeometryReader { proxy in
            Rectangle().fill(look.accent).frame(width: proxy.size.width * tab.progress)
        }
        .frame(height: 2)
        .opacity(tab.loading && !tab.showingNewTab ? 1 : 0)
    }

    /// Barra inferior de Panorama: atrás, adelante, nueva pestaña, pestañas y menú.
    private var bottomBar: some View {
        HStack {
            Button { tab.goBack() } label: { Image(systemName: "chevron.backward").frame(maxWidth: .infinity, minHeight: 44) }
                .disabled(!tab.canGoBack).accessibilityLabel("Atrás")
            Button { tab.goForward() } label: { Image(systemName: "chevron.forward").frame(maxWidth: .infinity, minHeight: 44) }
                .disabled(!tab.canGoForward).accessibilityLabel("Adelante")
            Button { browser.openNewTab() } label: { Image(systemName: "plus").frame(maxWidth: .infinity, minHeight: 44) }
                .accessibilityLabel("Nueva pestaña")
            tabsButton.frame(maxWidth: .infinity)
            menuButton.frame(maxWidth: .infinity)
        }
        .foregroundColor(look.fg1)
        .padding(.horizontal, 8)
        .background(look.toolbarBg)
    }

    // MARK: Contenido

    @ViewBuilder
    private var content: some View {
        ZStack {
            look.pageBg
            if let webView = tab.webView, !tab.showingNewTab {
                WebViewHost(webView: webView)
            }
            if tab.showingNewTab {
                NewTabPage(look: look, onSearch: { addressFocused = true }, onOpen: { browser.submit($0) },
                           onShield: { sheet = .shield }, onAddShortcut: { sheet = .newShortcut })
            }
            if let error = tab.error {
                ErrorPage(error: error, look: look, tab: tab)
            }
            if addressFocused {
                SuggestionsList(items: browser.suggestions(for: addressText), look: look) { target in
                    addressFocused = false
                    browser.submit(target)
                }
            }
        }
    }

    @ViewBuilder
    private var noticeView: some View {
        if let notice = browser.notice {
            Text(notice)
                .font(.subheadline)
                .foregroundColor(look.fg1)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 16).fill(look.surface1).shadow(radius: 6))
                .padding(.horizontal, 16)
                .padding(.bottom, 90)
                .onTapGesture { browser.notice = nil }
                .task(id: notice) {
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    if browser.notice == notice { browser.notice = nil }
                }
        }
    }

    // MARK: Hojas

    @ViewBuilder
    private func sheetView(_ sheet: Sheet) -> some View {
        switch sheet {
        case .tabs: TabsSheet(browser: browser, look: look) { self.sheet = nil }
        case .menu: MenuSheet(browser: browser, tab: tab, look: look) { next in self.sheet = next }
        case .siteInfo:
            SiteInfoSheet(tab: tab, look: look) { request in
                addressRequest = request
                self.sheet = .editAddress
            }
        case .editAddress:
            NavigationStack {
                CustomAddressForm(entry: addressRequest.editId.flatMap { id in services.profile.customAddresses.first { $0.id == id } },
                                  initialTarget: addressRequest.target)
            }
            .preferredColorScheme(look.dark ? .dark : .light)
        case .shield: ShieldSheet(tab: tab, look: look) { self.sheet = .settings }
        case .settings: SettingsView(initialSection: nil).preferredColorScheme(look.dark ? .dark : .light)
        case .history: HistoryView(browser: browser) { self.sheet = nil }
        case .downloads: DownloadsView()
        case .newShortcut: NavigationStack { ShortcutForm(shortcut: nil) }
        }
    }

    // MARK: Peticiones de la página

    private var requestTitle: String {
        switch tab.request {
        case .alert(_, let host, _), .confirm(_, let host, _), .prompt(_, let host, _, _): return host.isEmpty ? "Mensaje de la página" : "\(host) dice"
        case .auth: return "Iniciar sesión"
        case .permission: return "Permiso del sitio"
        case .download: return "¿Descargar el archivo?"
        case .external: return "¿Abrir en otra aplicación?"
        case nil: return ""
        }
    }

    private func requestMessage(_ request: TabRequest) -> String {
        switch request {
        case .alert(let message, _, _), .confirm(let message, _, _), .prompt(let message, _, _, _): return message
        case .auth(let host, let realm, let insecure, _):
            var text = "\(host) solicita un usuario y una contraseña."
            if !realm.isEmpty { text += "\nEl sitio dice: «\(realm)»" }
            if insecure { text += "\n\nLa conexión con este sitio no es privada: las credenciales se envían sin cifrar." }
            return text
        case .permission(let origin, let names, _):
            return "\(origin) quiere usar \(names). Puedes cambiar la decisión en Configuración → Privacidad → Permisos de sitios."
        case .download(let name, let host, _): return "\(name)\n\(host)\n\nSe guardará en Archivos → En mi iPhone → ICARUS → Descargas."
        case .external(let url, _): return "Este enlace (\(url.scheme ?? ""):) se abrirá fuera de ICARUS."
        }
    }

    private func finish(_ action: () -> Void) {
        action()
        tab.request = nil
    }

    @ViewBuilder
    private func requestActions(_ request: TabRequest) -> some View {
        switch request {
        case .alert(_, _, let done):
            Button("Aceptar") { finish { done() } }
        case .confirm(_, _, let done):
            Button("Cancelar", role: .cancel) { finish { done(false) } }
            Button("Aceptar") { finish { done(true) } }
        case .prompt(_, _, _, let done):
            TextField("Respuesta", text: $fieldOne)
            Button("Cancelar", role: .cancel) { finish { done(nil) } }
            Button("Aceptar") { let value = fieldOne; finish { done(value) } }
        case .auth(_, _, _, let done):
            TextField("Usuario", text: $fieldOne).textInputAutocapitalization(.never).autocorrectionDisabled(true)
            SecureField("Contraseña", text: $fieldTwo)
            Button("Cancelar", role: .cancel) { finish { done(nil) } }
            Button("Iniciar sesión") {
                let credential = URLCredential(user: fieldOne, password: fieldTwo, persistence: .forSession)
                finish { done(credential) }
            }
        case .permission(_, _, let done):
            Button("Bloquear", role: .cancel) { finish { done(false) } }
            Button("Permitir") { finish { done(true) } }
        case .download(_, _, let done):
            Button("Cancelar", role: .cancel) { finish { done(false) } }
            Button("Descargar") { finish { done(true) } }
        case .external(_, let done):
            Button("Cancelar", role: .cancel) { finish { done(false) } }
            Button("Abrir") { finish { done(true) } }
        }
    }
}

/// Coloca el WKWebView de la pestaña actual en la jerarquía de SwiftUI.
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        attach(to: container)
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        if webView.superview !== container { attach(to: container) }
    }

    private func attach(to container: UIView) {
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.removeFromSuperview()
        webView.frame = container.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(webView)
    }
}

struct SuggestionsList: View {
    let items: [BrowserModel.Suggestion]
    let look: Look
    let open: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if items.isEmpty {
                    Text("Escribe una dirección o una búsqueda.").font(.subheadline).foregroundColor(look.fg3).padding()
                }
                ForEach(items) { item in
                    Button {
                        if let target = item.target { open(target) }
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: item.icon).foregroundColor(look.fg2).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).foregroundColor(look.fg1).lineLimit(2)
                                if let subtitle = item.subtitle { Text(subtitle).font(.footnote).foregroundColor(look.fg3).lineLimit(2) }
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .disabled(item.target == nil)
                }
            }
        }
        .background(look.surface1)
    }
}

struct ErrorPage: View {
    let error: PageError
    let look: Look
    @ObservedObject var tab: BrowserTab

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: error.kind == .certificate ? "lock.trianglebadge.exclamationmark" : "exclamationmark.triangle")
                    .font(.system(size: 36))
                    .foregroundColor(error.kind == .certificate ? look.danger : look.fg2)
                Text(title).font(.title2.bold()).foregroundColor(look.fg1)
                Text(error.detail).foregroundColor(look.fg2)
                if error.kind == .certificate {
                    Text("ICARUS no permite continuar a un sitio con un certificado no válido: alguien podría estar suplantándolo o leyendo la conexión.")
                        .foregroundColor(look.fg2)
                }
                Text(error.url).font(.footnote).foregroundColor(look.fg3).textSelection(.enabled)
                HStack {
                    if error.kind == .certificate {
                        Button("Volver") { tab.leaveError() }.buttonStyle(.borderedProminent)
                    } else {
                        Button("Reintentar") { tab.reload() }.buttonStyle(.borderedProminent)
                        Button("Volver") { tab.leaveError() }.buttonStyle(.bordered)
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(look.pageBg)
    }

    private var title: String {
        switch error.kind {
        case .certificate: return "La conexión no es segura"
        case .network: return "No se pudo abrir la página"
        case .crashed: return "La página dejó de funcionar"
        }
    }
}
