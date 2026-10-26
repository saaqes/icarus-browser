import Foundation

/// Edición de la base de una dirección conservando ruta, consulta y fragmento
/// (misma lógica que src/services/custom-addresses/rebase.ts, con los vectores de
/// mobile/shared/test-vectors/address-rebase.json).
///
/// - Base: la dirección personalizada aplicada a la página o, si no hay ninguna, el origen.
/// - Sufijo: lo que identifica la sección actual (`/#inicio`, `/panel/usuarios?id=10`).
public enum AddressRebase {
    public struct Split: Equatable {
        public let base: String
        public let suffix: String
        public let entry: CustomAddress?
    }

    public enum Join: Equatable {
        case ok(String)
        /// `required`, `invalid-url`, `unsupported-protocol` o `has-query`.
        case failure(String)
    }

    public enum Edit: Equatable {
        /// Solo cambió la base: el texto sigue terminando en el sufijo de la página.
        case rebase(base: String, url: String)
        /// Cualquier otra cosa: se navega a lo escrito tal cual.
        case navigate
    }

    private static let schemePrefix = Pattern("^[a-z][a-z0-9+.-]*://", caseInsensitive: true)

    private static func hashOf(_ url: WebURL) -> String { (url.fragment?.isEmpty ?? true) ? "" : "#\(url.fragment!)" }

    /// Divide la dirección que muestra la barra; `entry` es la dirección personalizada aplicada.
    public static func split(_ displayURL: String, entry: CustomAddress?) -> Split? {
        guard let url = UrlUtils.parseWebURL(displayURL), !url.hasCredentials else { return nil }
        if let entry, let location = CustomAddresses.parseLocation(entry.address), let rest = CustomAddresses.remainderWithin(location, url) {
            // En la raíz, la `/` forma parte del sufijo: `/#inicio`, nunca `#inicio`.
            let path = location.path.isEmpty && rest.isEmpty && (!url.search.isEmpty || !hashOf(url).isEmpty) ? "/" : rest
            return Split(base: "\(location.protocol)//\(location.host)\(location.path)", suffix: path + url.search + hashOf(url), entry: entry)
        }
        let suffix = url.pathname + url.search + hashOf(url)
        return Split(base: "\(url.protocol)//\(url.host)", suffix: suffix == "/" ? "" : suffix, entry: nil)
    }

    /// Une una base nueva (como la escribe el usuario) con el sufijo conservado, sin barras dobles.
    public static func join(_ baseText: String, suffix: String) -> Join {
        let base: Location
        switch CustomAddresses.normalizeLocationInput(baseText) {
        case .ok(let location): base = location
        case .failure(let error): return .failure(error)
        }
        let tail: String
        if suffix.isEmpty { tail = base.path.isEmpty ? "/" : base.path }
        else if suffix.hasPrefix("/") { tail = base.path + suffix }
        else { tail = (base.path.isEmpty ? "/" : base.path) + suffix }
        guard let url = UrlUtils.parseWebURL("\(base.protocol)//\(base.host)\(tail)") else { return .failure("invalid-url") }
        return .ok(url.href)
    }

    /// Distingue editar la base de escribir otra dirección (que nunca hereda la ruta anterior).
    public static func classify(_ original: Split, typed: String) -> Edit {
        let text = typed.trimmed
        guard !original.suffix.isEmpty, text.hasSuffix(original.suffix) else { return .navigate }
        let prefix = String(text.dropLast(original.suffix.count))
        guard !prefix.isEmpty, case .ok(let base) = CustomAddresses.normalizeLocationInput(prefix) else { return .navigate }
        if case .ok(let current) = CustomAddresses.normalizeLocationInput(original.base),
           current.host == base.host, current.path == base.path,
           !schemePrefix.contains(prefix) || current.protocol == base.protocol {
            return .navigate
        }
        guard case .ok(let url) = join(prefix, suffix: original.suffix) else { return .navigate }
        return .rebase(base: prefix, url: url)
    }
}
