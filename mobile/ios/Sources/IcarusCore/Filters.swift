import Foundation

public enum ResourceType: String, CaseIterable {
    case document, subdocument, stylesheet, script, image, font, object, xmlhttprequest, ping, media, websocket, other
}

public struct DomainConstraint: Equatable {
    public var include: [String]
    public var exclude: [String]
}

/// Filtro de red de Adblock Plus ya analizado (sin compilar: en iPhone lo aplica WebKit).
public struct NetworkFilter: Equatable {
    public let raw: String
    public var exception = false
    /// Excepción que desactiva el bloqueo en toda la página ($document).
    public var documentException = false
    /// Dominio de un filtro `||dominio^` sencillo o de una línea de formato hosts.
    public var hostname: String?
    /// Patrón ABP sin opciones (p. ej. `||ads.com/x^` o `/banner/*/ad.`).
    public var pattern: String?
    /// Expresión regular de un filtro `/…/`.
    public var regexSource: String?
    /// Filtro sin patrón acotado por $domain (coincide con cualquier URL).
    public var matchesAnyURL = false
    public var matchCase = false
    public var thirdParty: Bool?
    public var types: Set<ResourceType>?
    public var excludedTypes: Set<ResourceType>?
    public var domains: DomainConstraint?

    init(raw: String) { self.raw = raw }
}

public enum ParseOutcome: Equatable {
    case filter(NetworkFilter)
    case ignored, invalid, empty
}

public struct ParsedList {
    public let filters: [NetworkFilter]
    public var ruleCount: Int { filters.count }
    public let ignoredCount: Int
    public let invalidCount: Int
}

/// Analizador de filtros con la misma sintaxis y los mismos resultados que
/// electron/shield/filters.ts y Filters.kt (los vectores lo comprueban).
public enum Filters {
    private static let typeAliases: [String: ResourceType] = [
        "script": .script, "image": .image, "stylesheet": .stylesheet, "css": .stylesheet,
        "xmlhttprequest": .xmlhttprequest, "xhr": .xmlhttprequest, "subdocument": .subdocument, "frame": .subdocument,
        "media": .media, "font": .font, "object": .object, "ping": .ping, "beacon": .ping, "websocket": .websocket,
        "other": .other, "document": .document, "doc": .document,
    ]
    private static let hostsLine = Pattern("^(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|::1?|::)\\s+([^\\s#]+)")
    static let hostnamePattern = Pattern("^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$")
    private static let hostsSkip: Set<String> = ["localhost", "localhost.localdomain", "local", "broadcasthost", "0.0.0.0", "ip6-localhost", "ip6-loopback"]
    private static let cosmetic = Pattern("#@?[#?$%]#?|#\\+js\\(")
    private static let regexWithOptions = Pattern("/\\$[^/]*$")
    private static let optionStart = Pattern("^~?[a-z0-9_-]+(=|,|$)", caseInsensitive: true)
    private static let simpleHost = Pattern("^\\|\\|([a-z0-9_.-]+)\\^?$", caseInsensitive: true)
    private static let html = Pattern("^\\s*(<!doctype html|<html|<head|<body)", caseInsensitive: true)

    private static func parseDomains(_ value: String) -> DomainConstraint? {
        var include: [String] = []
        var exclude: [String] = []
        for part in value.split(separator: "|") {
            let domain = String(part).trimmed.lowercased()
            if domain.isEmpty { continue }
            if domain.hasPrefix("~") { exclude.append(String(domain.dropFirst())) } else { include.append(domain) }
        }
        let unsupported = { (domain: String) in domain.contains("*") || domain.hasPrefix("/") }
        if include.contains(where: unsupported) || exclude.contains(where: unsupported) { return nil }
        return DomainConstraint(include: include, exclude: exclude)
    }

    public static func parseFilter(_ line: String) -> ParseOutcome {
        let raw = line.trimmed
        if raw.isEmpty { return .empty }
        // Comentarios (ABP «!», hosts «#»), cabeceras «[Adblock Plus 2.0]» y filtros cosméticos.
        if raw.hasPrefix("!") || raw.hasPrefix("[") || (raw.hasPrefix("#") && !raw.hasPrefix("##")) { return .ignored }
        if cosmetic.contains(raw) && !raw.hasPrefix("/") { return .ignored }

        if let hosts = hostsLine.groups(raw) {
            let host = hosts[1].lowercased().removingSuffix(".")
            if hostsSkip.contains(host) || !hostnamePattern.matches(host) { return .ignored }
            var filter = NetworkFilter(raw: raw)
            filter.hostname = host
            return .filter(filter)
        }

        var filter = NetworkFilter(raw: raw)
        var text = raw
        if text.hasPrefix("@@") {
            filter.exception = true
            text = String(text.dropFirst(2))
        }

        var options = ""
        if text.hasPrefix("/") && regexWithOptions.contains(text), let index = text.range(of: "/$", options: .backwards) {
            options = String(text[index.upperBound...])
            text = String(text[..<index.lowerBound]) + "/"
        } else if !(text.hasPrefix("/") && text.hasSuffix("/") && text.count > 2), let index = text.lastIndex(of: "$") {
            // Las opciones empiezan por un nombre (p. ej. «third-party», «csp=…»); su valor puede contener espacios.
            let candidate = String(text[text.index(after: index)...])
            if optionStart.contains(candidate) {
                options = candidate
                text = String(text[..<index])
            }
        }

        if !options.isEmpty {
            var included: [ResourceType] = []
            var excluded: [ResourceType] = []
            for rawOption in options.split(separator: ",", omittingEmptySubsequences: false) {
                let option = String(rawOption).trimmed.lowercased()
                if option.isEmpty { continue }
                let separator = option.firstIndex(of: "=")
                let name = separator.map { String(option[..<$0]) } ?? option
                let value = separator.map { String(option[option.index(after: $0)...]) } ?? ""
                let negated = name.hasPrefix("~")
                let key = negated ? String(name.dropFirst()) : name
                switch key {
                case "third-party", "3p": filter.thirdParty = !negated
                case "first-party", "1p": filter.thirdParty = negated
                case "domain", "from":
                    guard let domains = parseDomains(value) else { return .ignored }
                    filter.domains = domains
                case "match-case": filter.matchCase = true
                // «important» no cambia el resultado en ICARUS: las excepciones siguen ganando.
                case "important", "all": break
                default:
                    // Opción no admitida (redirect, csp, popup…) o desconocida: se ignora el filtro completo.
                    guard let type = typeAliases[key] else { return .ignored }
                    if negated { excluded.append(type) } else { included.append(type) }
                }
            }
            if included.contains(.document) {
                if !filter.exception { return .ignored }
                filter.documentException = true
                included.removeAll { $0 == .document }
            }
            if !included.isEmpty { filter.types = Set(included) }
            if !excluded.isEmpty { filter.excludedTypes = Set(excluded) }
        }

        let pattern = text.trimmed
        if pattern.isEmpty || pattern == "*" || pattern == "||" || pattern == "|" {
            // Un filtro sin patrón solo tiene sentido si las opciones lo acotan a dominios.
            guard let domains = filter.domains, !domains.include.isEmpty else { return .invalid }
            filter.matchesAnyURL = true
            return .filter(filter)
        }

        if pattern.hasPrefix("/") && pattern.hasSuffix("/") && pattern.count > 2 {
            let source = String(pattern.dropFirst().dropLast())
            guard (try? NSRegularExpression(pattern: source)) != nil else { return .invalid }
            filter.regexSource = source
            return .filter(filter)
        }

        if let host = simpleHost.groups(pattern), hostnamePattern.matches(host[1].lowercased()) {
            filter.hostname = host[1].lowercased()
            return .filter(filter)
        }

        if pattern.contains(where: { $0.isWhitespace }) { return .invalid }
        filter.pattern = pattern
        return .filter(filter)
    }

    public static func parseList(_ text: String) -> ParsedList {
        var filters: [NetworkFilter] = []
        var ignored = 0
        var invalid = 0
        for line in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
            switch parseFilter(String(line).removingSuffix("\r")) {
            case .filter(let filter): filters.append(filter)
            case .ignored: ignored += 1
            case .invalid: invalid += 1
            case .empty: break
            }
        }
        return ParsedList(filters: filters, ignoredCount: ignored, invalidCount: invalid)
    }

    /// ¿Parece el texto descargado una página HTML en lugar de una lista de filtros?
    public static func looksLikeHTML(_ text: String) -> Bool { html.contains(String(text.prefix(512))) }
}
