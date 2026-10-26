import SwiftUI

/// Actualizaciones en iPhone y iPad: ICARUS comprueba el mismo manifiesto firmado que
/// escritorio y Android y AVISA de las versiones nuevas. iOS no permite que una app
/// descargue e instale otra versión de sí misma, así que la instalación se hace por
/// el canal de distribución oficial:
///
/// - App Store o TestFlight (claves ICARUSDistribution e ICARUSStoreURL de Info.plist):
///   se abre la ficha de la app, que actualiza conservando los datos.
/// - Sin canal oficial (copia instalada a mano, `none`): se abre la página de la
///   versión y se explica cómo volver a firmar el .ipa nuevo.
@MainActor
final class UpdateModel: ObservableObject {
    static let shared = UpdateModel()

    enum Status: Equatable { case idle, checking, upToDate, available, error(String) }
    enum Distribution: String { case appStore = "app-store", testFlight = "testflight", none }

    @Published private(set) var status: Status = .idle
    @Published private(set) var available: UpdateManifest?
    @Published private(set) var lastChecked: Date?
    @Published private(set) var justUpdated: (from: String, to: String)?
    @Published var channel: UpdateChannel {
        didSet { defaults.set(channel.rawValue, forKey: Keys.channel); if oldValue != channel { available = nil; status = .idle; Task { await check() } } }
    }
    @Published private(set) var postponedVersion: String?

    let current: UpdateVersion
    let distribution: Distribution
    let storeURL: URL?
    private let publicKey: String?
    private let checker = UpdateChecker()
    private let defaults = UserDefaults.standard
    private enum Keys {
        static let channel = "icarus.updates.channel"
        static let lastChecked = "icarus.updates.lastChecked"
        static let postponed = "icarus.updates.postponed"
        static let lastVersionCode = "icarus.updates.lastVersionCode"
        static let lastVersion = "icarus.updates.lastVersion"
    }

    private init() {
        let info = Bundle.main.infoDictionary ?? [:]
        // CFBundleVersion es el mismo código que en Android: de él sale la versión completa (con «-preview.N»).
        let code = Int(info["CFBundleVersion"] as? String ?? "") ?? 0
        current = UpdateModel.version(fromCode: code) ?? UpdateVersion(major: 0, minor: 0, patch: 0, preview: nil)
        distribution = Distribution(rawValue: info["ICARUSDistribution"] as? String ?? "none") ?? .none
        storeURL = (info["ICARUSStoreURL"] as? String).flatMap { URL(string: $0) }.flatMap { ["https", "itms-apps", "itms-beta"].contains($0.scheme ?? "") ? $0 : nil }
        publicKey = Bundle.main.url(forResource: "update-public-key", withExtension: "pem")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            .flatMap { UpdateManifests.isValidPublicKey($0) ? $0 : nil }
        channel = UpdateChannel(rawValue: defaults.string(forKey: Keys.channel) ?? "") ?? .stable
        lastChecked = defaults.object(forKey: Keys.lastChecked) as? Date
        postponedVersion = defaults.string(forKey: Keys.postponed)
        let previous = defaults.integer(forKey: Keys.lastVersionCode)
        if previous > 0 && previous < code {
            justUpdated = (defaults.string(forKey: Keys.lastVersion) ?? "?", current.description)
            postponedVersion = nil
            defaults.removeObject(forKey: Keys.postponed)
        }
        defaults.set(code, forKey: Keys.lastVersionCode)
        defaults.set(current.description, forKey: Keys.lastVersion)
    }

    static func version(fromCode code: Int) -> UpdateVersion? {
        guard code > 0 else { return nil }
        let last = code % 100
        return UpdateVersion(major: code / 1_000_000, minor: code / 10_000 % 100, patch: code / 100 % 100, preview: last == 99 ? nil : last)
    }

    /// Esta compilación puede comprobar actualizaciones (lleva la clave pública).
    var supported: Bool { publicKey != nil }

    /// Aviso discreto: hay versión nueva y el usuario no la ha pospuesto.
    var shouldNotify: Bool { status == .available && available != nil && available?.version != postponedVersion }

    func releasePage(_ manifest: UpdateManifest) -> URL { checker.releasePage(tag: manifest.tag) }

    /// Al abrir ICARUS: como mucho cada 6 horas.
    func checkIfDue() async {
        if let lastChecked, Date().timeIntervalSince(lastChecked) < 6 * 60 * 60 { return }
        await check(manual: false)
    }

    func check(manual: Bool = true) async {
        guard supported, status != .checking else { return }
        status = .checking
        let now = Date()
        lastChecked = now
        defaults.set(now, forKey: Keys.lastChecked)
        do {
            let (manifest, version) = try await checker.fetch(channel: channel, publicKeyPEM: publicKey)
            switch UpdateManifests.evaluate(manifest, version: version, current: current, channel: channel, platform: "ios", arch: "universal", kinds: []) {
            case .available:
                available = manifest
                status = .available
            case .upToDate, .rejected:
                available = nil
                status = .upToDate
            }
        } catch let error as UpdateChecker.CheckError {
            switch error {
            case .notFound, .noKey:
                available = nil
                status = .upToDate
            // Las comprobaciones automáticas no muestran los fallos de red.
            case .network where !manual, .rateLimited where !manual:
                status = available == nil ? .idle : .available
            default:
                status = .error(UpdateModel.message(for: error))
            }
        } catch {
            status = manual ? .error(UpdateModel.message(for: .network)) : .idle
        }
    }

    func postpone() {
        guard let version = available?.version else { return }
        postponedVersion = version
        defaults.set(version, forKey: Keys.postponed)
    }

    func acknowledge() { justUpdated = nil }

    static func message(for error: UpdateChecker.CheckError) -> String {
        switch error {
        case .network: return "No se pudo conectar con el servidor de actualizaciones. Comprueba tu conexión e inténtalo de nuevo."
        case .rateLimited: return "GitHub ha limitado temporalmente las consultas. Vuelve a intentarlo dentro de un rato."
        case .notFound: return "No se encontró la información de la actualización."
        case .signature: return "La información de la actualización no tiene una firma válida de ICARUS y se ha descartado."
        case .invalidManifest: return "La información de la actualización no es válida y se ha descartado."
        case .noKey: return "Esta compilación no puede verificar actualizaciones."
        }
    }
}

/// Configuración → Actualizaciones.
struct UpdatesView: View {
    @ObservedObject private var updates = UpdateModel.shared
    @Environment(\.openURL) private var openURL

    private var statusText: String? {
        switch updates.status {
        case .idle: return nil
        case .checking: return "Buscando actualizaciones…"
        case .upToDate: return "ICARUS está actualizado."
        case .available: return updates.available.map { "Hay una versión nueva: \($0.version)." }
        case .error(let message): return message
        }
    }

    var body: some View {
        List {
            if let updated = updates.justUpdated {
                Section {
                    Label("ICARUS se ha actualizado de la versión \(updated.from) a la \(updated.to).", systemImage: "checkmark.circle")
                    Button("Entendido") { updates.acknowledge() }
                }
            }
            Section {
                LabeledContent("Versión instalada", value: updates.current.description)
                if updates.supported {
                    LabeledContent("Última comprobación", value: updates.lastChecked.map { $0.formatted(date: .long, time: .shortened) } ?? "Nunca")
                    Picker("Canal", selection: $updates.channel) {
                        Text("Estable").tag(UpdateChannel.stable)
                        Text("Vista previa").tag(UpdateChannel.preview)
                    }
                    Button("Buscar actualizaciones") { Task { await updates.check() } }
                        .disabled(updates.status == .checking)
                }
            } footer: {
                if updates.supported {
                    Text("Vista previa incluye versiones preliminares, que pueden tener errores. Al volver a estable no se instala una versión anterior.")
                }
            }

            if !updates.supported {
                Section {
                    Text("Esta compilación no incluye la clave pública para verificar actualizaciones, así que ICARUS no las busca.")
                }
            } else if let statusText {
                Section {
                    if case .error = updates.status {
                        Label(statusText, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    } else {
                        Text(statusText).font(.headline)
                    }
                }
            }

            if let manifest = updates.available {
                Section("Novedades de la versión \(manifest.version)") {
                    Text("Publicada el \(manifest.releasedAt.formatted(date: .long, time: .omitted))").foregroundStyle(.secondary)
                    // Las notas son texto plano.
                    Text(verbatim: manifest.notes.isEmpty ? "Esta versión no incluye notas." : manifest.notes)
                }
                Section {
                    switch updates.distribution {
                    case .appStore, .testFlight:
                        Button(updates.distribution == .appStore ? "Actualizar en el App Store" : "Actualizar en TestFlight") {
                            if let url = updates.storeURL { openURL(url) }
                        }
                        .disabled(updates.storeURL == nil)
                    case .none:
                        Button("Ver la versión") { openURL(updates.releasePage(manifest)) }
                    }
                    if manifest.version != updates.postponedVersion {
                        Button("Recordármelo más tarde") { updates.postpone() }
                    }
                } footer: {
                    if manifest.version == updates.postponedVersion {
                        Text("No se volverá a avisar de esta versión.")
                    }
                }
            }

            Section("Cómo se instalan") {
                switch updates.distribution {
                case .appStore:
                    Text("Las actualizaciones se instalan desde el App Store, que conserva tus pestañas, accesos directos, historial y ajustes.")
                case .testFlight:
                    Text("Las actualizaciones se instalan desde TestFlight, que conserva tus datos.")
                case .none:
                    Text("iOS no permite que una app se instale a sí misma. Esta copia se instaló a mano (sin App Store): descarga el .ipa de la versión nueva y fírmalo con la misma herramienta y el mismo Apple ID (Sideloadly, AltStore o Xcode). Si conservas el identificador de la app, iOS la actualiza sin borrar tus datos.")
                }
            }
        }
        .navigationTitle("Actualizaciones")
    }
}
