import Foundation

/// Utilidades de URL equivalentes a src/services/url-resolution/urlUtils.ts (escritorio)
/// y a UrlUtils.kt (Android). Solo se consideran navegables las URL http(s).
public enum UrlUtils {
    public static let webProtocols: Set<String> = ["http:", "https:"]
    /// Protocolos que nunca se abren porque pueden ejecutar código o leer datos locales.
    public static let dangerousProtocols: Set<String> = ["javascript:", "data:", "vbscript:", "file:", "blob:"]

    static let ipv4 = Pattern("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    static let ipv6Bracketed = Pattern("^\\[[0-9a-f:.]+]$", caseInsensitive: true)
    static let domain = Pattern(
        "^(?=.{1,253}$)(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:\\p{L}{2,63}|xn--[a-z0-9-]{1,59})\\.?$",
        caseInsensitive: true
    )
    static let port = Pattern("^\\d{1,5}$")
    static let hostWithPort = Pattern("^(.*):([^:\\]]*)$")
    static let protocolPattern = Pattern("^([a-z][a-z0-9+.-]*):", caseInsensitive: true)
    static let hostWithPortNotScheme = Pattern("^[^:/]+:\\d+(?:[/?#]|$)")

    public static func parseWebURL(_ text: String) -> WebURL? {
        guard let url = WebURL.parse(text.trimmed), !url.hostname.isEmpty else { return nil }
        return url
    }

    public static func isLoopbackHost(_ hostname: String) -> Bool {
        let host = hostname.lowercased()
        return host == "localhost" || host.hasSuffix(".localhost") || host.hasPrefix("127.") || host == "[::1]"
    }

    public static func isIPLiteral(_ hostname: String) -> Bool { ipv4.matches(hostname) || ipv6Bracketed.matches(hostname) }

    /// ¿Parece `text` un host con puerto opcional (ej. `ejemplo.com`, `localhost:3000`)?
    public static func looksLikeHost(_ text: String) -> Bool {
        if text.isEmpty || text.contains("@") { return false }
        var host = text
        if let groups = hostWithPort.groups(text), !ipv6Bracketed.matches(text) {
            if !port.matches(groups[2]) { return false }
            host = groups[1]
        }
        return host.lowercased() == "localhost" || ipv4.matches(host) || ipv6Bracketed.matches(host) || domain.matches(host)
    }

    public static func getProtocol(_ text: String) -> String? {
        protocolPattern.groups(text.trimmed).map { "\($0[1].lowercased()):" }
    }

    public static func isDangerousProtocol(_ value: String) -> Bool { dangerousProtocols.contains(value.lowercased()) }

    /// ¿Empieza el texto por «host:puerto» (que no es un protocolo)?
    public static func startsWithHostAndPort(_ text: String) -> Bool { hostWithPortNotScheme.contains(text) }

    public enum Normalized {
        case ok(url: String, parsed: WebURL)
        /// `empty`, `unsafe-protocol`, `unsupported-protocol` o `invalid`.
        case failure(reason: String)
    }

    /// Normaliza una URL escrita en formularios (accesos directos, página principal).
    /// Acepta `ejemplo.com` como `https://ejemplo.com/`. Rechaza protocolos peligrosos.
    public static func normalizeUserURL(_ text: String) -> Normalized {
        let value = text.trimmed
        if value.isEmpty { return .failure(reason: "empty") }
        if value.contains(where: { $0.isWhitespace }) { return .failure(reason: "invalid") }
        let proto = getProtocol(value)
        let hasPortInsteadOfScheme = proto != nil && startsWithHostAndPort(value)
        var candidate = value
        if let proto, !hasPortInsteadOfScheme {
            if isDangerousProtocol(proto) { return .failure(reason: "unsafe-protocol") }
            if !webProtocols.contains(proto) { return .failure(reason: "unsupported-protocol") }
        } else {
            let hostPart = String(value.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" }).first ?? "")
            if !looksLikeHost(hostPart) { return .failure(reason: "invalid") }
            let bareHost = Pattern(":\\d+$").replacing(hostPart, with: "")
            let scheme = isLoopbackHost(bareHost) || isIPLiteral(bareHost) ? "http" : "https"
            candidate = "\(scheme)://\(value)"
        }
        guard let parsed = parseWebURL(candidate) else { return .failure(reason: "invalid") }
        if parsed.hasCredentials { return .failure(reason: "invalid") }
        return .ok(url: parsed.href, parsed: parsed)
    }

    private static let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()".utf8)
    private static let hex = Array("0123456789ABCDEF")

    /// Equivalente exacto de `encodeURIComponent` de JavaScript.
    public static func encodeURIComponent(_ text: String) -> String {
        var result = ""
        for byte in text.utf8 {
            if unreserved.contains(byte) {
                result.append(Character(UnicodeScalar(byte)))
            } else {
                result.append("%")
                result.append(hex[Int(byte >> 4)])
                result.append(hex[Int(byte & 0xF)])
            }
        }
        return result
    }
}

/// Proveedores de búsqueda (los mismos que en escritorio).
public enum SearchProvider: String, CaseIterable, Codable {
    case google, bing, duckduckgo

    public var displayName: String {
        switch self {
        case .google: return "Google"
        case .bing: return "Bing"
        case .duckduckgo: return "DuckDuckGo"
        }
    }

    public var homeURL: String {
        switch self {
        case .google: return "https://www.google.com/"
        case .bing: return "https://www.bing.com/"
        case .duckduckgo: return "https://duckduckgo.com/"
        }
    }

    private var prefix: String {
        switch self {
        case .google: return "https://www.google.com/search?q="
        case .bing: return "https://www.bing.com/search?q="
        case .duckduckgo: return "https://duckduckgo.com/?q="
        }
    }

    public func searchURL(_ query: String) -> String { prefix + UrlUtils.encodeURIComponent(query.trimmed) }

    public static func from(id: String?) -> SearchProvider { id.flatMap(SearchProvider.init(rawValue:)) ?? .google }
}

/// Páginas internas `icarus://…`.
public enum InternalPage: String, CaseIterable {
    case newTab = "newtab", blank, history, downloads, settings

    public static let protocolName = "icarus:"

    public var url: String {
        switch self {
        case .newTab: return "icarus://nueva-pestana"
        case .blank: return "icarus://en-blanco"
        case .history: return "icarus://historial"
        case .downloads: return "icarus://descargas"
        case .settings: return "icarus://configuracion"
        }
    }

    public var kind: String { rawValue }

    private static let pattern = Pattern("^icarus://([^?#]*)", caseInsensitive: true)
    private static let settingsSlugs: Set<String> = ["general", "apariencia", "navegacion", "privacidad", "shield", "descargas", "avanzado", "acerca-de"]

    public static func parse(_ text: String) -> InternalPage? {
        guard let groups = pattern.groups(text.trimmed) else { return nil }
        let parts = groups[1].lowercased().split(separator: "/").map(String.init)
        let root = parts.first
        switch root {
        case nil, "inicio", "nueva-pestana": return parts.count <= 1 ? .newTab : nil
        case "en-blanco": return parts.count == 1 ? .blank : nil
        case "historial": return parts.count == 1 ? .history : nil
        case "descargas": return parts.count == 1 ? .downloads : nil
        case "configuracion":
            if parts.count == 1 { return .settings }
            return parts.count == 2 && settingsSlugs.contains(parts[1]) ? .settings : nil
        default: return nil
        }
    }
}
