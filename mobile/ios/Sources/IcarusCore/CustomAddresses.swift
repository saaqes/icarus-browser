import Foundation

/// Dirección personalizada, equivalente a src/services/custom-addresses (escritorio) y
/// CustomAddresses.kt (Android); misma forma JSON en las tres plataformas.
///
/// El usuario asigna a un destino real (`https://bot.deriv.me/`) la dirección que quiere
/// ver en la barra (`https://miweb.com/`). Mientras se navega dentro del destino, la barra
/// muestra la dirección personalizada con la misma ruta, consulta y fragmento; al
/// escribirla, ICARUS navega al destino real. Una entrada puede limitarse a unas
/// secciones (`#home`), donde gana a la general del sitio. La resolución es interna:
/// WebKit siempre carga el sitio real, con su certificado.
public struct CustomAddress: Codable, Equatable, Identifiable {
    public var id: String
    /// Destino real: `protocolo://host[:puerto]/ruta-base`, sin consulta ni fragmento.
    public var target: String
    /// Dirección que muestra la barra, siempre con el protocolo del destino.
    public var address: String
    /// Secciones a las que se limita (`home`, sin `#`); vacía: todo el destino.
    public var sections: [String]
    public var enabled: Bool
    public var createdAt: String
    public var updatedAt: String

    public init(id: String, target: String, address: String, enabled: Bool, createdAt: String, updatedAt: String, sections: [String] = []) {
        self.id = id
        self.target = target
        self.address = address
        self.sections = sections
        self.enabled = enabled
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey { case id, target, address, sections, enabled, createdAt, updatedAt }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        target = try container.decode(String.self, forKey: .target)
        address = try container.decode(String.self, forKey: .address)
        sections = try container.decodeIfPresent([String].self, forKey: .sections) ?? []
        enabled = try container.decode(Bool.self, forKey: .enabled)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
    }

    /// Como en escritorio y Android: `sections` solo se guarda si la entrada tiene alguna.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(target, forKey: .target)
        try container.encode(address, forKey: .address)
        if !sections.isEmpty { try container.encode(sections, forKey: .sections) }
        try container.encode(enabled, forKey: .enabled)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

/// `protocolo://host[:puerto]` más una ruta base sin barra final (vacía = todo el sitio).
public struct Location: Equatable {
    public let `protocol`: String
    public let host: String
    public let path: String

    /// Forma guardada: `https://miweb.com/` o `https://miweb.com/ruta`.
    public func format() -> String { "\(`protocol`)//\(host)\(path.isEmpty ? "/" : path)" }
    public var label: String { host + path }
}

/// Dirección para la barra: protocolo visible (vacío en la forma corta), host y resto.
public struct AddressParts: Equatable, CustomStringConvertible {
    public let prefix: String
    public let host: String
    public let rest: String
    public var description: String { prefix + host + rest }
}

public enum CustomAddresses {
    public static let max = 200
    private static let epoch = "2026-01-01T00:00:00.000Z"

    public enum LocationResult: Equatable {
        case ok(Location)
        /// `required`, `invalid-url`, `unsupported-protocol` o `has-query`.
        case failure(String)

        var location: Location? { if case .ok(let location) = self { return location } else { return nil } }
    }

    public struct DisplayMatch: Equatable {
        public let entry: CustomAddress
        public let url: String
    }

    /// `url` es el destino real; `address`, lo escrito con el protocolo de la entrada.
    public struct Resolution: Equatable {
        public let entry: CustomAddress
        public let url: String
        public let address: String
    }

    public enum Validation: Equatable {
        case ok(target: String, address: String, enabled: Bool, sections: [String])
        /// Errores por campo (`target`, `address`, `sections`) y la entrada con la que choca cada uno.
        case errors([String: String], conflicts: [String: CustomAddress])
    }

    public enum Sections: Equatable {
        case ok([String])
        /// `invalid-section` o `too-many-sections`.
        case failure(String)
    }

    public enum SectionSave: Equatable {
        /// `entry` es la entrada que muestra la sección después de guardar.
        case ok(entries: [CustomAddress], entry: CustomAddress)
        case failure(errors: [String: String], conflicts: [String: CustomAddress])
    }

    public enum Legacy: Equatable {
        case entry(target: String, address: String, enabled: Bool)
        case skip
        case invalid
    }

    private static let trailingSlashes = Pattern("/+$")
    private static let hostWithPortThenPath = Pattern("^[^:/]+:\\d+(?:/|$)")
    private static let portSuffix = Pattern(":\\d+$")
    private static let isoDate = Pattern("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$")
    private static let aliasPrefix = Pattern("^(?:https?|icarus)://")
    public static let maxSections = 20
    private static let sectionNamePattern = Pattern("^[\\p{L}\\p{N}_.~-]{1,60}$")
    private static let sectionLead = Pattern("^[!/]+")
    /// Separadores como `\s` de JavaScript (espacios Unicode incluidos), comas y punto y coma.
    private static let sectionSeparators: Set<Unicode.Scalar> = {
        var set: Set<Unicode.Scalar> = ["\t", "\n", "\u{0B}", "\u{0C}", "\r", " ", "\u{A0}", "\u{1680}", "\u{2028}", "\u{2029}", "\u{202F}", "\u{205F}", "\u{3000}", "\u{FEFF}", ",", ";"]
        for value in UInt32(0x2000)...UInt32(0x200A) {
            if let scalar = Unicode.Scalar(value) { set.insert(scalar) }
        }
        return set
    }()

    /* ---------------------------------- Secciones ---------------------------------- */

    /// Como `decodeURIComponent`: si la codificación no es válida, el texto queda igual.
    private static func sectionName(_ token: String) -> String {
        let raw = sectionLead.replacing(token.removingPrefix("#"), with: "")
        return (raw.removingPercentEncoding ?? raw).lowercased()
    }

    /// Sección de un fragmento (con o sin `#`): el primer tramo, sin `#`, `!` ni `/` iniciales, en minúsculas.
    public static func sectionOf(_ hash: String) -> String? {
        let stripped = sectionLead.replacing(hash.removingPrefix("#"), with: "")
        let head = stripped.firstIndex(where: { "/?&=".contains($0) }).map { String(stripped[..<$0]) } ?? stripped
        let name = sectionName(head)
        return sectionNamePattern.matches(name) ? name : nil
    }

    /// Secciones como las escribe el usuario: `#home, #usuario`, `home usuario`…
    public static func parseSections(_ text: String) -> Sections {
        var tokens: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if sectionSeparators.contains(scalar) {
                tokens.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(scalar)
            }
        }
        tokens.append(String(current))
        var sections: [String] = []
        for token in tokens {
            if sectionLead.replacing(token.removingPrefix("#"), with: "").isEmpty { continue }
            let name = sectionName(token)
            if !sectionNamePattern.matches(name) { return .failure("invalid-section") }
            if !sections.contains(name) { sections.append(name) }
        }
        return sections.count > maxSections ? .failure("too-many-sections") : .ok(sections)
    }

    /// Texto para el editor y los mensajes: `#home, #usuario`.
    public static func formatSections(_ sections: [String]) -> String { sections.map { "#\($0)" }.joined(separator: ", ") }

    /* --------------------------------- Ubicaciones --------------------------------- */

    private static func hashOf(_ url: WebURL) -> String { (url.fragment?.isEmpty ?? true) ? "" : "#\(url.fragment!)" }

    private static func fromURL(_ url: WebURL) -> Location {
        Location(protocol: url.protocol, host: url.host, path: trailingSlashes.replacing(url.pathname, with: ""))
    }

    /// Lee una ubicación ya guardada (forma canónica).
    public static func parseLocation(_ text: String) -> Location? {
        guard let url = UrlUtils.parseWebURL(text), !url.hasCredentials, url.search.isEmpty, hashOf(url).isEmpty else { return nil }
        return fromURL(url)
    }

    /// Normaliza lo que escribe el usuario: `miweb.com`, `localhost:3000`,
    /// `https://ejemplo.com/ruta`… Sin protocolo se usa `defaultProtocol` (el del
    /// destino) o https (http para localhost y direcciones IP).
    public static func normalizeLocationInput(_ text: String, defaultProtocol: String? = nil) -> LocationResult {
        let value = text.trimmed
        if value.isEmpty { return .failure("required") }
        if value.contains(where: { $0.isWhitespace }) { return .failure("invalid-url") }
        if value.contains("?") || value.contains("#") { return .failure("has-query") }

        let proto = UrlUtils.getProtocol(value)
        let hostWithPort = proto != nil && hostWithPortThenPath.contains(value)
        var candidate = value
        if let proto, !hostWithPort {
            if UrlUtils.isDangerousProtocol(proto) || !UrlUtils.webProtocols.contains(proto) { return .failure("unsupported-protocol") }
        } else {
            let hostPart = String(value.split(separator: "/", omittingEmptySubsequences: false).first ?? "")
            if !UrlUtils.looksLikeHost(hostPart) { return .failure("invalid-url") }
            let bareHost = portSuffix.replacing(hostPart, with: "")
            let fallback = UrlUtils.isLoopbackHost(bareHost) || UrlUtils.isIPLiteral(bareHost) ? "http:" : "https:"
            candidate = "\(defaultProtocol ?? fallback)//\(value)"
        }
        guard let url = UrlUtils.parseWebURL(candidate), !url.hasCredentials, UrlUtils.looksLikeHost(url.host) else { return .failure("invalid-url") }
        return .ok(fromURL(url))
    }

    /// Si `url` está dentro de `location`, el resto de la ruta (vacío o con `/` inicial).
    public static func remainderWithin(_ location: Location, _ url: WebURL, anyProtocol: Bool = false) -> String? {
        if !anyProtocol && url.protocol != location.protocol { return nil }
        if url.host != location.host || url.hasCredentials { return nil }
        let pathname = url.pathname
        if location.path.isEmpty { return pathname == "/" ? "" : pathname }
        if pathname == location.path { return "" }
        return pathname.hasPrefix(location.path + "/") ? String(pathname.dropFirst(location.path.count)) : nil
    }

    /// La URL equivalente bajo otra ubicación (`hash`: otro fragmento en lugar del de `url`).
    public static func urlWithin(_ location: Location, _ rest: String, _ url: WebURL, hash: String? = nil) -> String {
        let path = location.path + rest
        return "\(location.protocol)//\(location.host)\(path.isEmpty ? "/" : path)\(url.search)\(hash ?? hashOf(url))"
    }

    /// ¿Comparten alguna dirección? Se ignora el protocolo.
    public static func overlap(_ a: Location, _ b: Location) -> Bool {
        if a.host != b.host { return false }
        let (shorter, longer) = a.path.count <= b.path.count ? (a.path, b.path) : (b.path, a.path)
        return shorter.isEmpty || longer == shorter || longer.hasPrefix(shorter + "/")
    }

    /* ----------------------------------- Aplicar ----------------------------------- */

    private struct Parsed {
        let entry: CustomAddress
        let target: Location
        let address: Location
        var sections: [String] { entry.sections }
    }

    /// Entradas activas y válidas, de la más específica a la menos (en empate, la más antigua).
    private static func active(_ entries: [CustomAddress]) -> [Parsed] {
        let parsed = entries.filter(\.enabled).compactMap { entry -> Parsed? in
            guard let target = parseLocation(entry.target), let address = parseLocation(entry.address), target.protocol == address.protocol else { return nil }
            return Parsed(entry: entry, target: target, address: address)
        }
        // Orden estable, como `sortedWith` en Kotlin y `sort` en JavaScript.
        return parsed.enumerated().sorted { a, b in
            if a.element.target.path.count != b.element.target.path.count { return a.element.target.path.count > b.element.target.path.count }
            if a.element.entry.createdAt != b.element.entry.createdAt { return a.element.entry.createdAt < b.element.entry.createdAt }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// URL real → dirección que muestra la barra (o nil si no hay entrada para ella). Gana la entrada de la sección.
    public static func displayURL(for href: String, _ entries: [CustomAddress]) -> DisplayMatch? {
        guard let url = UrlUtils.parseWebURL(href) else { return nil }
        let section = sectionOf(hashOf(url))
        let items = active(entries)
        let ordered = items.filter { section != nil && $0.sections.contains(section!) } + items.filter { $0.sections.isEmpty }
        for item in ordered {
            guard let rest = remainderWithin(item.target, url) else { continue }
            // Una general no muestra una sección que otra entrada reclama con la misma dirección.
            if item.sections.isEmpty, let section,
               items.contains(where: { $0.entry.id != item.entry.id && $0.sections.contains(section) && overlap($0.address, item.address) }) {
                continue
            }
            return DisplayMatch(entry: item.entry, url: urlWithin(item.address, rest, url))
        }
        return nil
    }

    /// Para una dirección escrita: la entrada de su sección, después la general y después las demás.
    private static func rank(_ item: Parsed, _ section: String?) -> Int {
        if let section, item.sections.contains(section) { return 0 }
        return item.sections.isEmpty ? 1 : 2
    }

    /// URL escrita dentro de una dirección personalizada → URL real del destino. Sin
    /// fragmento, la dirección de una entrada de secciones abre su primera sección.
    public static func resolve(_ url: WebURL, _ entries: [CustomAddress], explicitProtocol: Bool) -> Resolution? {
        let section = sectionOf(hashOf(url))
        var best: (item: Parsed, rest: String)? = nil
        // Como el orden estable de escritorio: mejor rango y, en empate, la ruta más larga; si no, la primera.
        for item in active(entries) {
            guard let rest = remainderWithin(item.address, url, anyProtocol: !explicitProtocol) else { continue }
            guard let current = best else { best = (item, rest); continue }
            let (itemRank, currentRank) = (rank(item, section), rank(current.item, section))
            if itemRank < currentRank || (itemRank == currentRank && item.address.path.count > current.item.address.path.count) { best = (item, rest) }
        }
        guard let best else { return nil }
        var hash = hashOf(url)
        if hash.isEmpty, let first = best.item.sections.first {
            hash = "#" + (first.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? first)
        }
        return Resolution(entry: best.item.entry, url: urlWithin(best.item.target, best.rest, url, hash: hash),
                          address: urlWithin(best.item.address, best.rest, url, hash: hash))
    }

    /// Entradas activas cuya dirección empieza por lo escrito (para sugerencias); una dirección compartida, una vez (la general si la hay).
    public static func startingWith(_ text: String, _ entries: [CustomAddress]) -> [CustomAddress] {
        let needle = text.trimmed.lowercased().removingPrefix("https://").removingPrefix("http://").removingPrefix("www.")
        if needle.isEmpty { return [] }
        var labels: [String] = []
        var byLabel: [String: Parsed] = [:]
        for item in active(entries) {
            let label = item.address.label
            guard label.hasPrefix(needle) || label.removingPrefix("www.").hasPrefix(needle) else { continue }
            if let current = byLabel[label] {
                if rank(item, nil) < rank(current, nil) { byLabel[label] = item }
            } else {
                labels.append(label)
                byLabel[label] = item
            }
        }
        return labels.compactMap { byLabel[$0]?.entry }
    }

    /// Dirección para la barra: forma corta (sin foco, como Chrome) o completa.
    public static func formatAddress(_ href: String, full: Bool) -> AddressParts {
        guard let url = UrlUtils.parseWebURL(href) else { return AddressParts(prefix: "", host: href, rest: "") }
        let path = url.pathname + url.search + hashOf(url)
        if full { return AddressParts(prefix: "\(url.protocol)//", host: url.host, rest: path) }
        return AddressParts(prefix: "", host: url.host.removingPrefix("www."), rest: path == "/" ? "" : path)
    }

    public static func shortAddress(_ href: String) -> String {
        let parts = formatAddress(href, full: false)
        return parts.host + parts.rest
    }

    /* ---------------------------------- Validación ---------------------------------- */

    /// Primera entrada activa (distinta de `exceptId`) que choca con estas ubicaciones. Dos
    /// entradas pueden compartir destino, dirección o los dos si se reparten las secciones:
    /// solo chocan si las dos son generales o si repiten una sección.
    public static func findConflicts(target: Location, address: Location, _ entries: [CustomAddress], exceptId: String?, sections: [String] = [])
        -> (errors: [String: String], conflicts: [String: CustomAddress]) {
        var errors: [String: String] = [:]
        var conflicts: [String: CustomAddress] = [:]
        for other in entries where other.enabled && other.id != exceptId {
            guard let otherTarget = parseLocation(other.target), let otherAddress = parseLocation(other.address) else { continue }
            let general = sections.isEmpty && other.sections.isEmpty
            let sameTarget = overlap(target, otherTarget)
            let sameAddress = overlap(address, otherAddress)
            if errors["target"] == nil {
                if sameTarget && general { errors["target"] = "target-in-use" }
                else if overlap(target, otherAddress) { errors["target"] = "target-is-address" }
                if errors["target"] != nil { conflicts["target"] = other }
            }
            if errors["sections"] == nil && (sameTarget || sameAddress) && sections.contains(where: { other.sections.contains($0) }) {
                errors["sections"] = "section-in-use"
                conflicts["sections"] = other
            }
            if errors["address"] == nil {
                if sameAddress && general { errors["address"] = "address-in-use" } else if overlap(address, otherTarget) { errors["address"] = "address-is-target" }
                if errors["address"] != nil { conflicts["address"] = other }
            }
        }
        return (errors, conflicts)
    }

    /// Valida como la versión de escritorio: la dirección usa el protocolo del destino,
    /// no puede estar dentro de su propio destino y, si está activa, no choca con otra
    /// entrada activa (ver `findConflicts`). `sectionsText`: `#home, #usuario` o vacío.
    public static func validate(target targetText: String, address addressText: String, enabled: Bool,
                                entries: [CustomAddress] = [], editingId: String? = nil, sections sectionsText: String = "") -> Validation {
        var errors: [String: String] = [:]
        let target = normalizeLocationInput(targetText)
        if case .failure(let error) = target { errors["target"] = error }
        let address = normalizeLocationInput(addressText, defaultProtocol: target.location?.protocol)
        if case .failure(let error) = address {
            errors["address"] = error
        } else if let targetLocation = target.location, let addressLocation = address.location {
            if addressLocation.protocol != targetLocation.protocol { errors["address"] = "protocol-mismatch" }
            else if overlap(addressLocation, targetLocation) { errors["address"] = "same-as-target" }
        }
        var sections: [String]? = nil
        switch parseSections(sectionsText) {
        case .ok(let names): sections = names
        case .failure(let error): errors["sections"] = error
        }
        var conflicts: [String: CustomAddress] = [:]
        if let targetLocation = target.location, let addressLocation = address.location, let sections, errors.isEmpty, enabled {
            let found = findConflicts(target: targetLocation, address: addressLocation, entries, exceptId: editingId, sections: sections)
            errors.merge(found.errors) { current, _ in current }
            conflicts = found.conflicts
        }
        guard let targetLocation = target.location, let addressLocation = address.location, let sections, errors.isEmpty else {
            return .errors(errors, conflicts: conflicts)
        }
        return .ok(target: targetLocation.format(), address: addressLocation.format(), enabled: enabled, sections: sections)
    }

    /// «Guardar solo para #sección», como en escritorio: la sección deja la entrada de
    /// secciones que la tuviera (si se queda vacía, se elimina); con la base general del
    /// destino, vuelve a usarla; si otra entrada de secciones del destino ya usa esa base,
    /// se le añade; si no, se crea una entrada nueva. Si algo no es válido, no cambia nada.
    public static func saveSection(_ entries: [CustomAddress], target: String, section: String, base: String, id: String, now: String) -> SectionSave {
        guard let location = parseLocation(target) else { return .failure(errors: ["target": "invalid-url"], conflicts: [:]) }
        let address: String
        switch normalizeLocationInput(base, defaultProtocol: location.protocol) {
        case .ok(let normalized): address = normalized.format()
        case .failure(let error): return .failure(errors: ["address": error], conflicts: [:])
        }
        func ofTarget(_ entry: CustomAddress) -> Bool { entry.enabled && entry.target == target }

        let remaining: [CustomAddress] = entries.compactMap { (entry: CustomAddress) -> CustomAddress? in
            guard ofTarget(entry), entry.sections.contains(section) else { return entry }
            var changed = entry
            changed.sections.removeAll { $0 == section }
            changed.updatedAt = now
            return changed.sections.isEmpty ? nil : changed
        }
        if let general = remaining.first(where: { ofTarget($0) && $0.sections.isEmpty && $0.address == address }) {
            // Si otra entrada ya reclama esa sección con la misma dirección, la general no la mostraría.
            let generalAddress = parseLocation(general.address)
            let claimed = remaining.first { other in
                guard other.enabled, other.id != general.id, other.sections.contains(section), let generalAddress,
                      let otherAddress = parseLocation(other.address) else { return false }
                return overlap(otherAddress, generalAddress)
            }
            if let claimed { return .failure(errors: ["sections": "section-in-use"], conflicts: ["sections": claimed]) }
            return .ok(entries: remaining, entry: general)
        }
        if let sibling = remaining.first(where: { ofTarget($0) && !$0.sections.isEmpty && $0.address == address }) {
            switch validate(target: sibling.target, address: address, enabled: true, entries: remaining, editingId: sibling.id,
                            sections: formatSections(sibling.sections + [section])) {
            case .errors(let errors, let conflicts): return .failure(errors: errors, conflicts: conflicts)
            case .ok(let cleanTarget, let cleanAddress, _, let sections):
                var entry = sibling
                entry.target = cleanTarget
                entry.address = cleanAddress
                entry.enabled = true
                entry.sections = sections
                entry.updatedAt = now
                return .ok(entries: remaining.map { $0.id == sibling.id ? entry : $0 }, entry: entry)
            }
        }
        if remaining.count >= max { return .failure(errors: ["target": "limit"], conflicts: [:]) }
        switch validate(target: target, address: address, enabled: true, entries: remaining, sections: "#\(section)") {
        case .errors(let errors, let conflicts): return .failure(errors: errors, conflicts: conflicts)
        case .ok(let cleanTarget, let cleanAddress, _, let sections):
            let entry = CustomAddress(id: id, target: cleanTarget, address: cleanAddress, enabled: true, createdAt: now, updatedAt: now, sections: sections)
            return .ok(entries: remaining + [entry], entry: entry)
        }
    }

    /* ---------------------------- Carga y reglas antiguas ---------------------------- */

    /// Reglas de ejemplo de versiones anteriores: si nadie las tocó, no se migran.
    private static let legacyDefaults: [String: (alias: String, pattern: String)] = [
        "default-search": ("buscar.icarus", "https://www.google.com/"),
        "default-wiki": ("wiki.icarus", "es.wikipedia.org"),
    ]

    /// Convierte una regla de alias antigua: el patrón pasa a ser el destino y el alias, la dirección.
    public static func convertLegacy(_ raw: [String: Any]) -> Legacy {
        guard let pattern = raw["pattern"] as? String, let alias = raw["alias"] as? String else { return .invalid }
        if let id = raw["id"] as? String, let legacy = legacyDefaults[id], legacy.alias == alias, legacy.pattern == pattern { return .skip }

        var target: String? = nil
        switch raw["matchType"] as? String {
        case "host":
            let host = pattern.trimmed.lowercased().removingPrefix("*.")
            let destination = (raw["targetUrl"] as? String).flatMap { UrlUtils.parseWebURL($0) }
            let proto = destination != nil && destination!.hostname == host ? destination!.protocol : "https:"
            target = "\(proto)//\(host)/"
        case "exact", "prefix":
            target = UrlUtils.parseWebURL(pattern).map { "\($0.protocol)//\($0.host)\($0.pathname)" }
        default:
            break
        }
        let name = trailingSlashes.replacing(aliasPrefix.replacing(alias.trimmed.lowercased(), with: ""), with: "")
        guard let location = target.flatMap(parseLocation), !name.isEmpty else { return .invalid }
        return .entry(target: location.format(), address: "\(location.protocol)//\(name)", enabled: raw["enabled"] as? Bool == true)
    }

    private static func date(_ value: Any?, fallback: String) -> String {
        if let text = value as? String, isoDate.matches(text) { return text }
        return fallback
    }

    private enum Read {
        case entry(CustomAddress)
        case skip
        case invalid
    }

    /// Lee una entrada (nueva o antigua).
    private static func readEntry(_ raw: [String: Any], fallbackDate: String) -> Read {
        guard let id = raw["id"] as? String, !id.trimmed.isEmpty else { return .invalid }
        let input: (target: String, address: String, enabled: Bool)
        if raw["alias"] != nil || raw["matchType"] != nil {
            switch convertLegacy(raw) {
            case .entry(let target, let address, let enabled): input = (target, address, enabled)
            case .skip: return .skip
            case .invalid: return .invalid
            }
        } else {
            guard let target = raw["target"] as? String, let address = raw["address"] as? String else { return .invalid }
            input = (target, address, raw["enabled"] as? Bool == true)
        }
        // Secciones: lista de textos (si falta, la entrada es para todo el destino).
        var sectionsText = ""
        if let value = raw["sections"] {
            guard let names = value as? [String] else { return .invalid }
            sectionsText = names.joined(separator: " ")
        }
        guard case .ok(let target, let address, _, let sections) = validate(target: input.target, address: input.address, enabled: false, sections: sectionsText) else {
            return .invalid
        }
        return .entry(CustomAddress(id: String(id.trimmed.prefix(100)), target: target, address: address, enabled: input.enabled,
                                    createdAt: date(raw["createdAt"], fallback: fallbackDate), updatedAt: date(raw["updatedAt"], fallback: fallbackDate),
                                    sections: sections))
    }

    /// Añade una entrada; si choca con otra activa, se guarda desactivada (nunca se pierde).
    public static func appendResolvingConflicts(_ entries: [CustomAddress], _ entry: CustomAddress) -> (entries: [CustomAddress], disabled: Bool) {
        if entry.enabled, let target = parseLocation(entry.target), let address = parseLocation(entry.address),
           !findConflicts(target: target, address: address, entries, exceptId: entry.id, sections: entry.sections).errors.isEmpty {
            var disabled = entry
            disabled.enabled = false
            return (entries + [disabled], true)
        }
        return (entries + [entry], false)
    }

    /// Lista guardada (o reglas de alias de versiones anteriores) → entradas válidas.
    public static func sanitize(_ array: Any?) -> [CustomAddress] {
        guard let items = array as? [Any] else { return [] }
        var seen = Set<String>()
        var pairs = Set<String>()
        var entries: [CustomAddress] = []
        for item in items.prefix(max) {
            guard let raw = item as? [String: Any], case .entry(let entry) = readEntry(raw, fallbackDate: epoch), !seen.contains(entry.id) else { continue }
            // Reglas antiguas idénticas (p. ej. una por fragmento) quedan en una sola entrada.
            guard pairs.insert("\(entry.target) \(entry.address) \(formatSections(entry.sections))").inserted else { continue }
            seen.insert(entry.id)
            entries = appendResolvingConflicts(entries, entry).entries
        }
        return entries
    }
}

/// Resultado de interpretar la barra de direcciones (equivale a resolveInput.ts).
public enum InputResolution: Equatable {
    case empty
    case url(String)
    case search(url: String, query: String, provider: SearchProvider)
    /// Dirección personalizada: `address` es lo escrito y `url`, el destino real.
    case custom(url: String, address: String, entry: CustomAddress)
    case `internal`(InternalPage)
    case internalUnknown(String)
    case blocked(protocol: String, dangerous: Bool)

    public var kind: String {
        switch self {
        case .empty: return "empty"
        case .url: return "url"
        case .search: return "search"
        case .custom: return "custom"
        case .internal: return "internal"
        case .internalUnknown: return "internal-unknown"
        case .blocked: return "blocked"
        }
    }
}

/// Interpreta el texto de la barra: dirección web, dirección personalizada, página
/// interna o protocolo bloqueado. Equivale a src/services/url-resolution/resolveInput.ts.
///
/// ICARUS no tiene buscador general: lo que no es una dirección válida ni un alias se
/// intenta como dominio (se añade `https://`) y el motor muestra su error real si no
/// existe; nunca se convierte en una búsqueda.
public enum InputResolver {
    private static let scheme = Pattern("^[a-z][a-z0-9+.-]*://")

    public static func resolve(_ text: String, provider: SearchProvider, customAddresses: [CustomAddress]) -> InputResolution {
        let value = text.trimmed
        if value.isEmpty { return .empty }

        func web(_ url: WebURL, explicitProtocol: Bool) -> InputResolution {
            if let custom = CustomAddresses.resolve(url, customAddresses, explicitProtocol: explicitProtocol) {
                return .custom(url: custom.url, address: custom.address, entry: custom.entry)
            }
            return .url(url.href)
        }

        // Sin buscador: lo que no es dirección se intenta como dominio (error real del motor).
        func asDomain() -> InputResolution {
            let candidate = scheme.contains(value) ? value : "https://\(value)"
            if let parsed = UrlUtils.parseWebURL(candidate) { return .url(parsed.href) }
            return .url("https://\(UrlUtils.encodeURIComponent(value))/")
        }

        let proto = UrlUtils.getProtocol(value)
        let isHostWithPort = proto != nil && UrlUtils.startsWithHostAndPort(value)
        if !value.contains(where: { $0.isWhitespace }), let proto, !isHostWithPort {
            if proto == InternalPage.protocolName {
                return InternalPage.parse(value).map { .internal($0) } ?? .internalUnknown(value)
            }
            if UrlUtils.webProtocols.contains(proto) {
                if let url = UrlUtils.parseWebURL(value), !url.hasCredentials { return web(url, explicitProtocol: true) }
                return asDomain()
            }
            return .blocked(protocol: proto, dangerous: UrlUtils.isDangerousProtocol(proto))
        }

        switch UrlUtils.normalizeUserURL(value) {
        case .ok(_, let parsed): return web(parsed, explicitProtocol: false)
        case .failure: return asDomain()
        }
    }
}

/// Dominio registrable (eTLD+1) según la Public Suffix List (ICANN y PRIVATE), como
/// electron/shield/domains.ts. Las reglas vienen de mobile/shared/public-suffix-rules.txt.
public final class PublicSuffixList {
    private var exact = Set<String>()
    private var wildcard = Set<String>()
    private var exception = Set<String>()
    private var cache: [String: String] = [:]
    private let lock = NSLock()
    private static let ipv4 = Pattern("^\\d{1,3}(\\.\\d{1,3}){3}$")

    public init(rules: String) {
        for line in rules.split(whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
            let rule = String(line).trimmed
            if rule.isEmpty || rule.hasPrefix("//") { continue }
            if rule.hasPrefix("!") {
                exception.insert(String(rule.dropFirst()))
            } else if rule.hasPrefix("*.") {
                wildcard.insert(String(rule.dropFirst(2)))
            } else {
                exact.insert(rule)
            }
        }
    }

    public var ruleCount: Int { exact.count + wildcard.count + exception.count }

    public func publicSuffix(_ host: String) -> String {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        for index in labels.indices {
            let candidate = labels[index...].joined(separator: ".")
            // Una excepción («!www.ck») anula el comodín: el sufijo es lo que queda a su derecha.
            if exception.contains(candidate) { return labels[(index + 1)...].joined(separator: ".") }
            if exact.contains(candidate) { return candidate }
            if index + 1 < labels.count && wildcard.contains(labels[(index + 1)...].joined(separator: ".")) { return candidate }
        }
        // Regla implícita «*»: el último nivel es el sufijo.
        return labels.last ?? host
    }

    public func registrableDomain(_ hostname: String) -> String {
        let host = hostname.lowercased().removingSuffix(".")
        if host.isEmpty || PublicSuffixList.ipv4.matches(host) || host.contains(":") || host.hasPrefix("[") { return host }
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[host] { return cached }
        let suffix = publicSuffix(host)
        let domain: String
        if suffix == host {
            domain = host
        } else {
            let labels = host.split(separator: ".", omittingEmptySubsequences: false)
            domain = labels.suffix(suffix.split(separator: ".", omittingEmptySubsequences: false).count + 1).joined(separator: ".")
        }
        if cache.count > 4000 { cache.removeAll() }
        cache[host] = domain
        return domain
    }

    public func isThirdParty(requestHost: String, pageHost: String) -> Bool {
        if pageHost.isEmpty { return false }
        return registrableDomain(requestHost) != registrableDomain(pageHost)
    }

    /// ¿Es `host` igual a `domain` o un subdominio suyo?
    public static func hostMatchesDomain(_ host: String, _ domain: String) -> Bool { host == domain || host.hasSuffix(".\(domain)") }
}
