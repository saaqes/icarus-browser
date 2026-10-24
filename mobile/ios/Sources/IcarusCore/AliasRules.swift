import Foundation

public enum AliasMatchType: String, Codable, CaseIterable {
    case exact, prefix, host
}

/// Regla de «Cambiar nombre de URL»: misma forma JSON que en escritorio y Android.
public struct AliasRule: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var matchType: AliasMatchType
    /// URL canónica (exact/prefix) o nombre de host; admite `*.dominio` (host).
    public var pattern: String
    public var displayName: String
    /// Siempre termina en `.icarus`.
    public var alias: String
    public var targetUrl: String
    public var enabled: Bool
    public var createdAt: String
    public var updatedAt: String

    public init(id: String, name: String, matchType: AliasMatchType, pattern: String, displayName: String, alias: String,
                targetUrl: String, enabled: Bool, createdAt: String, updatedAt: String) {
        self.id = id
        self.name = name
        self.matchType = matchType
        self.pattern = pattern
        self.displayName = displayName
        self.alias = alias
        self.targetUrl = targetUrl
        self.enabled = enabled
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct AliasMatch: Equatable {
    public let rule: AliasRule
    public let realUrl: String
}

public struct HostPattern: Equatable, CustomStringConvertible {
    public let wildcard: Bool
    public let host: String
    public var description: String { (wildcard ? "*." : "") + host }
}

public enum TypedAlias: Equatable {
    case notAlias
    case resolved(rule: AliasRule, url: String)
    case disabled(alias: String, rule: AliasRule)
    case unknown(alias: String)
}

public enum AliasRules {
    public static let ruleNameMax = 60
    public static let displayNameMax = 60
    public static let aliasMax = 80

    private static let label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    /// `nombre.icarus`, `a.b.icarus` o `nombre.icarus/ruta`.
    private static let aliasPattern = Pattern("^(?:\(label)\\.)+icarus(?:/[a-z0-9._~\\-/]*)?$")
    private static let aliasPrefix = Pattern("^(?:https?|icarus)://")
    private static let trailingSlashes = Pattern("/+$")

    /// Forma canónica de una URL para comparar: protocolo + host + ruta + consulta.
    public static func canonicalURL(_ url: WebURL) -> String { "\(url.protocol)//\(url.host)\(url.pathname)\(url.search)" }

    public static func normalizeAliasText(_ text: String) -> String {
        trailingSlashes.replacing(aliasPrefix.replacing(text.trimmed.lowercased(), with: ""), with: "")
    }

    public static func isAliasText(_ text: String) -> Bool {
        let value = normalizeAliasText(text)
        return !value.isEmpty && value.count <= aliasMax && aliasPattern.matches(value)
    }

    /// Valida y normaliza un patrón de host (`www.ejemplo.com` o `*.ejemplo.com`).
    public static func normalizeHostPattern(_ text: String) -> HostPattern? {
        var value = text.trimmed.lowercased().removingSuffix(".")
        let wildcard = value.hasPrefix("*.")
        if wildcard { value = String(value.dropFirst(2)) }
        if value.isEmpty || value.contains("/") || value.contains(":") || !UrlUtils.looksLikeHost(value) { return nil }
        guard let parsed = UrlUtils.parseWebURL("https://\(value)/") else { return nil }
        return HostPattern(wildcard: wildcard, host: parsed.hostname)
    }

    public static func ruleMatches(_ rule: AliasRule, _ url: WebURL) -> Bool {
        switch rule.matchType {
        case .exact:
            return canonicalURL(url) == rule.pattern
        case .prefix:
            let value = canonicalURL(url)
            let prefix = rule.pattern
            if value == prefix { return true }
            if !value.hasPrefix(prefix) { return false }
            if prefix.hasSuffix("/") { return true }
            let next = value[value.index(value.startIndex, offsetBy: prefix.count)]
            return next == "/" || next == "?"
        case .host:
            guard let pattern = normalizeHostPattern(rule.pattern) else { return false }
            let hostname = url.hostname.lowercased()
            return hostname == pattern.host || (pattern.wildcard && hostname.hasSuffix(".\(pattern.host)"))
        }
    }

    /// Cuanto más específica, mayor: exacta > prefijo (más largo) > host concreto > host comodín.
    public static func priority(_ rule: AliasRule) -> Int {
        let length = rule.pattern.count
        switch rule.matchType {
        case .exact: return 4_000_000 + length
        case .prefix: return 3_000_000 + length
        case .host: return (rule.pattern.hasPrefix("*.") ? 1_000_000 : 2_000_000) + length
        }
    }

    /// Orden de aplicación: la primera gana; en empate, la más antigua.
    public static func ordered(_ rules: [AliasRule]) -> [AliasRule] {
        rules.sorted { a, b in
            let pa = priority(a), pb = priority(b)
            if pa != pb { return pa > pb }
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            return a.id < b.id
        }
    }

    /// URL real → regla que se muestra (o nil). No redirige.
    public static func findMatch(_ href: String, _ rules: [AliasRule]) -> AliasMatch? {
        guard let url = UrlUtils.parseWebURL(href), !UrlUtils.isAliasHost(url.hostname) else { return nil }
        guard let winner = ordered(rules.filter { $0.enabled && ruleMatches($0, url) }).first else { return nil }
        return AliasMatch(rule: winner, realUrl: canonicalURL(url))
    }

    /// Alias escrito → destino de una regla activa (un solo paso: sin cadenas ni ciclos).
    public static func resolveTyped(_ text: String, _ rules: [AliasRule]) -> TypedAlias {
        guard isAliasText(text) else { return .notAlias }
        let alias = normalizeAliasText(text)
        let candidates = rules.filter { $0.alias == alias }
        if let active = ordered(candidates.filter { $0.enabled }).first {
            // Defensa ante datos manipulados: el destino debe ser una URL web real.
            if let target = UrlUtils.parseWebURL(active.targetUrl), !UrlUtils.isAliasHost(target.hostname) {
                return .resolved(rule: active, url: target.href)
            }
            return .unknown(alias: alias)
        }
        if let first = candidates.first { return .disabled(alias: alias, rule: first) }
        return .unknown(alias: alias)
    }

    public struct Input: Equatable {
        public var name: String
        public var matchType: AliasMatchType
        public var pattern: String
        public var displayName: String
        public var alias: String
        public var targetUrl: String
        public var enabled: Bool

        public init(name: String, matchType: AliasMatchType, pattern: String, displayName: String, alias: String, targetUrl: String, enabled: Bool) {
            self.name = name
            self.matchType = matchType
            self.pattern = pattern
            self.displayName = displayName
            self.alias = alias
            self.targetUrl = targetUrl
            self.enabled = enabled
        }
    }

    public enum Validation: Equatable {
        case ok(Input)
        /// Campo → código de error (los mismos que escritorio: required, too-long, invalid-url…).
        case errors([String: String])
    }

    public static func validate(_ input: Input, others: [AliasRule], editingId: String? = nil) -> Validation {
        var errors: [String: String] = [:]
        let name = input.name.trimmed
        if let error = textError(name, ruleNameMax) { errors["name"] = error }
        let displayName = input.displayName.trimmed
        if let error = textError(displayName, displayNameMax) { errors["displayName"] = error }

        var pattern = input.pattern.trimmed
        var patternProtocol: String? = nil
        if input.matchType == .host {
            let hostPattern = normalizeHostPattern(pattern)
            if pattern.isEmpty {
                errors["pattern"] = "required"
            } else if let hostPattern {
                if UrlUtils.isAliasHost(hostPattern.host) { errors["pattern"] = "pattern-is-alias" } else { pattern = hostPattern.description }
            } else {
                errors["pattern"] = "invalid-host"
            }
        } else {
            switch UrlUtils.normalizeUserURL(pattern) {
            case .failure(let reason): errors["pattern"] = urlError(reason)
            case .ok(_, let parsed):
                pattern = canonicalURL(parsed)
                patternProtocol = parsed.protocol
            }
        }

        let alias = normalizeAliasText(input.alias)
        if alias.isEmpty {
            errors["alias"] = "required"
        } else if alias.count > aliasMax {
            errors["alias"] = "too-long"
        } else if !aliasPattern.matches(alias) {
            errors["alias"] = "alias-format"
        } else if input.enabled && others.contains(where: { $0.enabled && $0.id != editingId && $0.alias == alias }) {
            errors["alias"] = "alias-duplicate"
        }

        var targetUrl = input.targetUrl.trimmed
        switch UrlUtils.normalizeUserURL(targetUrl) {
        case .failure(let reason):
            errors["targetUrl"] = reason == "alias" ? "target-is-alias" : urlError(reason)
        case .ok(let url, let parsed):
            if UrlUtils.isAliasHost(parsed.hostname) {
                errors["targetUrl"] = "target-is-alias"
            } else {
                targetUrl = url
                // Una regla nunca puede llevar de HTTPS a HTTP salvo hacia localhost.
                if parsed.protocol == "http:" && patternProtocol != "http:" && !UrlUtils.isLoopbackHost(parsed.hostname) {
                    errors["targetUrl"] = "insecure-target"
                }
            }
        }

        if !errors.isEmpty { return .errors(errors) }
        return .ok(Input(name: name, matchType: input.matchType, pattern: pattern, displayName: displayName, alias: alias, targetUrl: targetUrl, enabled: input.enabled))
    }

    private static func textError(_ value: String, _ max: Int) -> String? {
        if value.isEmpty { return "required" }
        return value.count > max ? "too-long" : nil
    }

    private static func urlError(_ reason: String) -> String {
        switch reason {
        case "empty": return "required"
        case "unsafe-protocol", "unsupported-protocol": return "unsafe-protocol"
        case "alias": return "pattern-is-alias"
        default: return "invalid-url"
        }
    }
}

/// Resultado de interpretar la barra de direcciones (equivale a resolveInput.ts).
public enum InputResolution: Equatable {
    case empty
    case url(String)
    case search(url: String, query: String, provider: SearchProvider)
    case alias(url: String, rule: AliasRule)
    case aliasUnresolved(alias: String, reason: String)
    case `internal`(InternalPage)
    case internalUnknown(String)
    case blocked(protocol: String, dangerous: Bool)

    public var kind: String {
        switch self {
        case .empty: return "empty"
        case .url: return "url"
        case .search: return "search"
        case .alias: return "alias"
        case .aliasUnresolved: return "alias-unresolved"
        case .internal: return "internal"
        case .internalUnknown: return "internal-unknown"
        case .blocked: return "blocked"
        }
    }
}

public enum InputResolver {
    public static func resolve(_ text: String, provider: SearchProvider, rules: [AliasRule]) -> InputResolution {
        let value = text.trimmed
        if value.isEmpty { return .empty }
        let search = InputResolution.search(url: provider.searchURL(value), query: value, provider: provider)

        // Con espacios siempre es una búsqueda (p. ej. «cómo funciona javascript: …»).
        if value.contains(where: { $0.isWhitespace }) { return search }

        // Alias de ICARUS: solo se convierte en destino si hay una regla activa explícita.
        switch AliasRules.resolveTyped(value, rules) {
        case .resolved(let rule, let url): return .alias(url: url, rule: rule)
        case .disabled(let alias, _): return .aliasUnresolved(alias: alias, reason: "disabled")
        case .unknown(let alias): return .aliasUnresolved(alias: alias, reason: "unknown")
        case .notAlias: break
        }

        let proto = UrlUtils.getProtocol(value)
        let isHostWithPort = proto != nil && UrlUtils.startsWithHostAndPort(value)
        if let proto, !isHostWithPort {
            if proto == InternalPage.protocolName {
                return InternalPage.parse(value).map { .internal($0) } ?? .internalUnknown(value)
            }
            if UrlUtils.webProtocols.contains(proto) {
                if let url = UrlUtils.parseWebURL(value), !UrlUtils.isAliasHost(url.hostname), !url.hasCredentials {
                    return .url(url.href)
                }
                return search
            }
            return .blocked(protocol: proto, dangerous: UrlUtils.isDangerousProtocol(proto))
        }

        switch UrlUtils.normalizeUserURL(value) {
        case .ok(let url, _): return .url(url)
        case .failure: return search
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
