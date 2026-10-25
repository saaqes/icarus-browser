import SwiftUI
import WebKit

struct SettingsView: View {
    let initialSection: String?
    @ObservedObject private var services = AppServices.shared
    @Environment(\.dismiss) private var dismiss
    @State private var clearing = false

    private var settings: Settings { services.settings }

    private func binding<T>(_ keyPath: WritableKeyPath<Settings, T>) -> Binding<T> {
        Binding(get: { services.settings[keyPath: keyPath] }, set: { value in services.profile.updateSettings { $0[keyPath: keyPath] = value } })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Apariencia") {
                    Picker("Estilo", selection: binding(\.theme)) {
                        ForEach(ThemeId.allCases) { theme in
                            VStack(alignment: .leading) {
                                Text(services.themes.themes[theme]?.name ?? theme.rawValue)
                                Text(services.themes.themes[theme]?.description ?? "").font(.footnote).foregroundColor(.secondary)
                            }
                            .tag(theme)
                        }
                    }
                    .pickerStyle(.inline)
                    Picker("Modo", selection: binding(\.colorMode)) {
                        Text("Sistema").tag(ColorMode.system)
                        Text("Claro").tag(ColorMode.light)
                        Text("Oscuro").tag(ColorMode.dark)
                    }
                    .pickerStyle(.segmented)
                    AccentPicker()
                }
                Section("Navegación") {
                    Picker("Buscador", selection: binding(\.searchProvider)) {
                        ForEach(SearchProvider.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    Toggle("Mostrar accesos directos", isOn: binding(\.showShortcuts))
                    NavigationLink("Accesos directos (\(services.profile.shortcuts.count) de \(Profile.maxShortcuts))") { ShortcutsList() }
                    Toggle("Restaurar pestañas al abrir", isOn: binding(\.restoreSession))
                    Toggle(isOn: binding(\.showFullUrls)) {
                        VStack(alignment: .leading) {
                            Text(services.text("addressBar", "showFullUrls"))
                            Text(services.text("addressBar", "showFullUrlsHint")).font(.footnote).foregroundColor(.secondary)
                        }
                    }
                }
                Section("Protección") {
                    NavigationLink {
                        ShieldSettings()
                    } label: {
                        Label(services.shield.enabled ? "ICARUS Shield · activo" : "ICARUS Shield · desactivado", systemImage: services.shield.enabled ? "shield.fill" : "shield.slash")
                    }
                }
                Section("Privacidad") {
                    Toggle("Guardar el historial", isOn: binding(\.saveHistory))
                    Button("Borrar datos de navegación…", role: .destructive) { clearing = true }
                    NavigationLink("Permisos de sitios") { PermissionsList() }
                }
                Section {
                    NavigationLink {
                        CustomAddressList()
                    } label: {
                        let entries = services.profile.customAddresses
                        VStack(alignment: .leading) {
                            Text("Personalizar direcciones URL")
                            Text("Elige qué dirección muestra la barra para un sitio (por ejemplo, miweb.com en lugar de bot.deriv.me).")
                                .font(.footnote).foregroundColor(.secondary)
                            Text(entries.isEmpty ? "Ninguna dirección personalizada" : "\(entries.filter(\.enabled).count) de \(entries.count) direcciones activas")
                                .font(.footnote).foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Avanzado")
                }
                Section("ICARUS") {
                    NavigationLink("Acerca de ICARUS") { AboutView() }
                }
            }
            .navigationTitle("Configuración")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
            .confirmationDialog("Borrar datos de navegación", isPresented: $clearing, titleVisibility: .visible) {
                Button("Historial de la última hora", role: .destructive) { services.history.clear(.hour) }
                Button("Historial del último día", role: .destructive) { services.history.clear(.day) }
                Button("Todo el historial", role: .destructive) { services.history.clear(.all) }
                Button("Cookies, datos de sitios y caché", role: .destructive) {
                    let types = WKWebsiteDataStore.allWebsiteDataTypes()
                    WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) {}
                    URLCredentialStorage.shared.allCredentials.forEach { space, credentials in
                        credentials.values.forEach { URLCredentialStorage.shared.remove($0, for: space) }
                    }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Las cookies, los datos de sitios y la caché se borran por completo y se cierran las sesiones iniciadas.")
            }
        }
    }
}

struct AccentPicker: View {
    @ObservedObject private var services = AppServices.shared
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                circle(id: "default", color: Color(services.themes.palette(services.settings.theme, dark: scheme == .dark)["accent"]))
                ForEach(services.themes.accents) { accent in
                    circle(id: accent.id, color: Color(scheme == .dark ? accent.dark : accent.light))
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func circle(id: String, color: Color) -> some View {
        Button {
            services.profile.updateSettings { $0.accent = id }
        } label: {
            Circle().fill(color).frame(width: 34, height: 34)
                .overlay(Circle().stroke(Color.primary, lineWidth: services.settings.accent == id ? 3 : 0))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(id == "default" ? "Acento del estilo" : "Acento \(id)")
    }
}

// MARK: Accesos directos

struct ShortcutsList: View {
    @ObservedObject private var services = AppServices.shared
    @State private var resetting = false

    var body: some View {
        List {
            ForEach(services.profile.shortcuts) { shortcut in
                NavigationLink {
                    ShortcutForm(shortcut: shortcut)
                } label: {
                    VStack(alignment: .leading) {
                        Text(shortcut.title)
                        Text(shortcut.url).font(.footnote).foregroundColor(.secondary)
                    }
                }
            }
            .onDelete { offsets in
                offsets.map { services.profile.shortcuts[$0].id }.forEach { services.profile.removeShortcut(id: $0) }
            }
            Button("Restaurar predeterminados", role: .destructive) { resetting = true }
        }
        .navigationTitle("Accesos directos")
        .toolbar { NavigationLink { ShortcutForm(shortcut: nil) } label: { Image(systemName: "plus") }.accessibilityLabel("Añadir acceso directo") }
        .confirmationDialog("Se sustituirán tus accesos por los predeterminados.", isPresented: $resetting, titleVisibility: .visible) {
            Button("Restaurar", role: .destructive) { services.profile.resetShortcuts() }
        }
    }
}

struct ShortcutForm: View {
    let shortcut: Shortcut?
    @ObservedObject private var services = AppServices.shared
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var url = ""
    @State private var errors: [String: String] = [:]
    @State private var limit = false

    var body: some View {
        Form {
            Section {
                TextField("Nombre", text: $title)
                if let error = errors["title"] { Text(services.text("shortcutErrors", error)).font(.footnote).foregroundColor(.red) }
                TextField("Dirección (ejemplo.com)", text: $url)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                if let error = errors["url"] { Text(services.text("shortcutErrors", error)).font(.footnote).foregroundColor(.red) }
                if limit { Text("Puedes tener como máximo \(Profile.maxShortcuts) accesos directos.").font(.footnote).foregroundColor(.red) }
            }
            if let shortcut {
                Button("Eliminar acceso directo", role: .destructive) {
                    services.profile.removeShortcut(id: shortcut.id)
                    dismiss()
                }
            }
        }
        .navigationTitle(shortcut == nil ? "Nuevo acceso directo" : "Editar acceso directo")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Guardar") {
                    switch services.profile.saveShortcut(title: title, url: url, editingId: shortcut?.id) {
                    case .ok: dismiss()
                    case .errors(let found, let reachedLimit):
                        errors = found
                        limit = reachedLimit
                    }
                }
            }
        }
        .onAppear {
            title = shortcut?.title ?? ""
            url = shortcut?.url ?? ""
        }
    }
}

// MARK: ICARUS Shield

struct ShieldSettings: View {
    @ObservedObject private var services = AppServices.shared
    @State private var customRules = ""
    @State private var addingList = false
    @State private var newListName = ""
    @State private var newListURL = ""
    @State private var listError: String?
    @State private var updating = false

    var body: some View {
        Form {
            Section {
                Toggle("Activar ICARUS Shield", isOn: Binding(get: { services.shield.enabled }, set: { services.shield.setEnabled($0) }))
            } footer: {
                Text(services.text("shield", "intro") + "\n\nEn iPhone y iPad las reglas las aplica WebKit, que no informa de cuántas solicitudes bloquea: por eso no hay contador. \(services.shieldStatus).")
            }
            if let error = services.shieldCompileError {
                Section { Text("WebKit no pudo compilar las reglas: \(error)").foregroundColor(.red) }
            }
            Section {
                ForEach(services.shield.lists) { list in
                    Toggle(isOn: Binding(get: { list.enabled }, set: { value in
                        services.shield.setListEnabled(id: list.id, value)
                        Task {
                            if value && services.shield.needsDownload(id: list.id) { await services.shield.updateLists(onlyStale: true) }
                            await services.compileShield()
                        }
                    })) {
                        VStack(alignment: .leading) {
                            Text(list.name)
                            Text(status(list)).font(.footnote).foregroundColor(list.error == nil ? .secondary : .red)
                        }
                    }
                    .swipeActions {
                        if !list.builtIn {
                            Button("Quitar", role: .destructive) {
                                services.shield.removeList(id: list.id)
                                Task { await services.compileShield() }
                            }
                        }
                    }
                }
                Button(updating || services.shieldCompiling ? "Actualizando…" : "Actualizar listas ahora") {
                    updating = true
                    Task {
                        await services.shield.updateLists(onlyStale: false)
                        await services.compileShield()
                        updating = false
                    }
                }
                .disabled(updating)
                Button("Añadir lista…") { addingList = true }
            } header: {
                Text("Listas de filtros")
            } footer: {
                Text(services.text("shield", "listsHint"))
            }
            Section {
                TextEditor(text: $customRules)
                    .font(.system(.footnote, design: .monospaced))
                    .frame(minHeight: 120)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                Button("Guardar reglas propias") {
                    services.shield.setCustomRules(customRules)
                    Task { await services.compileShield() }
                }
            } header: {
                Text("Reglas propias")
            } footer: {
                let stats = services.shield.customStats
                Text(services.text("shield", "customHint") + "\n\(stats.rules) reglas válidas" + (stats.invalid > 0 ? " · \(stats.invalid) no válidas" : ""))
            }
            Section("Sitios sin Shield") {
                if services.shield.exceptions.isEmpty {
                    Text("No hay excepciones. Puedes desactivar Shield en un sitio desde el botón del escudo.").foregroundColor(.secondary)
                }
                ForEach(services.shield.exceptions, id: \.self) { domain in
                    Text(domain).swipeActions {
                        Button("Quitar", role: .destructive) { services.shield.setSiteAllowed(host: domain, false) }
                    }
                }
            }
        }
        .navigationTitle("ICARUS Shield")
        .onAppear { customRules = services.shield.customRules }
        .sheet(isPresented: $addingList) {
            NavigationStack {
                Form {
                    TextField("Nombre", text: $newListName)
                    TextField("Dirección (https)", text: $newListURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                    if let listError { Text(listError).foregroundColor(.red).font(.footnote) }
                }
                .navigationTitle("Añadir lista")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { addingList = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Añadir") {
                            Task {
                                if let error = await services.shield.addList(name: newListName, url: newListURL) {
                                    listError = services.text("shieldListErrors", error.rawValue)
                                } else {
                                    listError = nil
                                    addingList = false
                                    newListName = ""
                                    newListURL = ""
                                    await services.compileShield()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func status(_ list: ShieldListInfo) -> String {
        if list.updating { return "Actualizando…" }
        var parts: [String] = []
        if list.builtIn && list.url == nil { parts.append("Incluida en ICARUS") }
        if list.ruleCount > 0 { parts.append("\(list.ruleCount.formatted()) reglas") }
        if list.skippedCount > 0 { parts.append("\(list.skippedCount.formatted()) no se pueden expresar en WebKit") }
        if let date = list.lastUpdated { parts.append("Actualizada \(date.formatted(date: .abbreviated, time: .omitted))") }
        if list.url != nil && list.lastUpdated == nil && list.error == nil { parts.append("Aún no descargada") }
        if let error = list.error { parts.append(services.text("shieldListErrors", error.rawValue)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: Direcciones personalizadas

struct CustomAddressList: View {
    @ObservedObject private var services = AppServices.shared
    @State private var deleting: CustomAddress?
    @State private var message: String?

    private func t(_ key: String, _ params: [String: String] = [:]) -> String { services.text("customAddresses", key, params) }

    var body: some View {
        List {
            Section {
                Text(t("subtitle")).font(.footnote).foregroundColor(.secondary)
            }
            Section {
                let entries = services.profile.customAddresses
                if entries.isEmpty { Text(t("empty")).foregroundColor(.secondary) }
                ForEach(entries) { entry in
                    let address = CustomAddresses.shortAddress(entry.address)
                    HStack {
                        NavigationLink {
                            CustomAddressForm(entry: entry, initialTarget: nil)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(address).foregroundColor(entry.enabled ? .primary : .secondary)
                                Text(t("targetOf", ["target": CustomAddresses.shortAddress(entry.target)]) + (entry.enabled ? "" : " · \(t("disabled"))"))
                                    .font(.footnote).foregroundColor(.secondary)
                            }
                        }
                        Toggle("Activar o desactivar \(address)", isOn: Binding(get: { entry.enabled }, set: { enabled in
                            if let other = services.profile.setCustomAddressEnabled(id: entry.id, enabled: enabled) {
                                message = t("toggleConflict", ["address": CustomAddresses.shortAddress(other.address), "target": CustomAddresses.shortAddress(other.target)])
                            }
                        }))
                        .labelsHidden()
                    }
                    .swipeActions { Button("Eliminar", role: .destructive) { deleting = entry } }
                }
            }
            Section(services.text("customAddresses", "howTo", "title")) {
                let steps = services.textList("customAddresses", "howTo", "steps")
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in Text("\(index + 1). \(step)").font(.subheadline) }
                Text(services.text("customAddresses", "howTo", "security")).font(.footnote).foregroundColor(.secondary)
            }
        }
        .navigationTitle(t("title"))
        .toolbar { NavigationLink { CustomAddressForm(entry: nil, initialTarget: nil) } label: { Image(systemName: "plus") }.accessibilityLabel(t("add")) }
        .confirmationDialog(t("deleteTitle"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible,
                            presenting: deleting) { entry in
            Button("Eliminar", role: .destructive) { services.profile.removeCustomAddress(id: entry.id) }
        } message: { entry in
            Text(t("deleteBody", ["address": CustomAddresses.shortAddress(entry.address), "target": CustomAddresses.shortAddress(entry.target)]))
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button("Aceptar", role: .cancel) {} }
    }
}

/// Crear o editar una dirección: los conflictos se muestran en el campo nombrando la
/// otra entrada y nunca se sobrescribe otra configuración en silencio.
struct CustomAddressForm: View {
    let entry: CustomAddress?
    let initialTarget: String?
    @ObservedObject private var services = AppServices.shared
    @Environment(\.dismiss) private var dismiss
    @State private var target = ""
    @State private var address = ""
    @State private var enabled = true
    @State private var errors: [String: String] = [:]
    @State private var conflicts: [String: CustomAddress] = [:]
    @State private var loaded = false

    private func form(_ key: String, _ params: [String: String] = [:]) -> String { services.text("customAddresses", "form", key, params) }

    private func error(_ field: String) -> some View {
        Group {
            if let code = errors[field] {
                let other = conflicts[field]
                Text(code == "limit" ? services.text("customAddresses", "limit")
                     : services.text("customAddressErrors", code, ["address": other.map { CustomAddresses.shortAddress($0.address) } ?? "",
                                                                  "target": other.map { CustomAddresses.shortAddress($0.target) } ?? ""]))
                    .font(.footnote).foregroundColor(.red)
            }
        }
    }

    /// Páginas que ya tiene el usuario, para elegir el destino sin escribirlo.
    private var choices: [String] {
        var seen: [String] = []
        for url in services.profile.shortcuts.map(\.url) + services.history.list().map(\.url) {
            guard let parsed = UrlUtils.parseWebURL(url) else { continue }
            let origin = "\(parsed.protocol)//\(parsed.host)/"
            if !seen.contains(origin) { seen.append(origin) }
            if seen.count >= 8 { break }
        }
        return seen
    }

    private var preview: String {
        guard case .ok(let cleanTarget, let cleanAddress, _) = CustomAddresses.validate(target: target, address: address, enabled: true) else {
            return form("previewIncomplete")
        }
        let shownTarget = CustomAddresses.shortAddress(cleanTarget)
        let shownAddress = CustomAddresses.shortAddress(cleanAddress)
        let example = cleanTarget.removingSuffix("/") + "/pagina?x=1"
        let sample = CustomAddress(id: "preview", target: cleanTarget, address: cleanAddress, enabled: true, createdAt: "", updatedAt: "")
        let exampleShown = CustomAddresses.displayURL(for: example, [sample])?.url ?? example
        return [
            form("previewShows", ["target": shownTarget, "address": shownAddress]),
            form("previewOpens", ["address": shownAddress, "target": shownTarget]),
            form("previewPaths", ["real": CustomAddresses.shortAddress(example), "shown": CustomAddresses.shortAddress(exampleShown)]),
        ].joined(separator: "\n")
    }

    var body: some View {
        Form {
            Section {
                TextField(form("targetPlaceholder"), text: $target).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                error("target")
                if !choices.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(choices, id: \.self) { choice in
                                Button(CustomAddresses.shortAddress(choice)) { target = choice }.buttonStyle(.bordered)
                            }
                        }
                    }
                }
            } header: {
                Text(form("target"))
            } footer: {
                Text(form("targetHint") + (choices.isEmpty ? "" : " " + form("chooseFrom")))
            }
            Section {
                TextField(form("addressPlaceholder"), text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                error("address")
            } header: {
                Text(form("address"))
            } footer: {
                Text(form("addressHint"))
            }
            Section(form("preview")) {
                Text(preview).font(.subheadline)
                Text(form("limitation")).font(.footnote).foregroundColor(.secondary)
            }
            Toggle(form("enabled"), isOn: $enabled)
        }
        .navigationTitle(entry == nil ? form("createTitle") : form("editTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Guardar") {
                    switch services.profile.saveCustomAddress(target: target, address: address, enabled: enabled, editingId: entry?.id) {
                    case .ok: dismiss()
                    case .errors(let found, let others):
                        errors = found
                        conflicts = others
                    }
                }
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let entry {
                // Completas, como en escritorio: así se conserva el protocolo (p. ej. un destino http://).
                target = entry.target
                address = entry.address
                enabled = entry.enabled
            } else if let initialTarget {
                target = initialTarget
            }
        }
    }
}

// MARK: Privacidad y acerca de

struct PermissionsList: View {
    @ObservedObject private var services = AppServices.shared

    var body: some View {
        List {
            Section {
                let sites = services.profile.sitePermissions
                let origins = sites.keys.sorted()
                if origins.isEmpty { Text("Ningún sitio ha pedido la cámara o el micrófono todavía.").foregroundColor(.secondary) }
                ForEach(origins, id: \.self) { origin in
                    let decisions = sites[origin] ?? [:]
                    VStack(alignment: .leading) {
                        Text(origin)
                        Text(decisions.map { "\($0.key == .camera ? "Cámara" : "Micrófono"): \($0.value ? "permitido" : "bloqueado")" }.sorted().joined(separator: " · "))
                            .font(.footnote).foregroundColor(.secondary)
                    }
                    .swipeActions { Button("Olvidar", role: .destructive) { services.profile.forgetPermissions(origin: origin) } }
                }
            } footer: {
                Text("La ubicación la gestiona WebKit con su propio aviso y el permiso de iOS (Ajustes → ICARUS).")
            }
            Button("Olvidar todas las decisiones", role: .destructive) { services.profile.forgetPermissions() }
        }
        .navigationTitle("Permisos de sitios")
    }
}

struct AboutView: View {
    var body: some View {
        List {
            Section {
                LabeledContent("Versión", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                LabeledContent("Motor", value: "WebKit")
                LabeledContent("Sistema", value: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")
            }
            Section("Cómo funciona") {
                Text("En iPhone y iPad, ICARUS usa WebKit, el motor que iOS exige a los navegadores. Apple solo permite otros motores en la Unión Europea con requisitos que esta versión no cumple.")
                Text("Todas las pestañas comparten cookies, almacenamiento y caché: no están aisladas entre sí.")
                Text("ICARUS Shield convierte las listas de filtros en reglas de contenido de WebKit. WebKit no informa de lo que bloquea, así que no hay contador.")
                Text("ICARUS no permite continuar en sitios con certificados no válidos.")
                Text("Los datos se guardan solo en este dispositivo.")
            }
            Section("Licencias de terceros") {
                LabeledContent("EasyList y EasyPrivacy", value: "GPLv3 / CC BY-SA 3.0")
                LabeledContent("Lista de Peter Lowe", value: "pgl.yoyo.org")
                LabeledContent("Public Suffix List", value: "MPL 2.0")
            }
            Section {
                Link("Código fuente", destination: URL(string: "https://github.com/saaqes/icarus-browser")!)
            }
        }
        .navigationTitle("Acerca de ICARUS")
    }
}
