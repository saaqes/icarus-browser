import Foundation

/// URL absoluta http(s) analizada como el estándar URL de WHATWG en los casos que usa
/// ICARUS (equivale a `new URL()` en escritorio y a `WebUrl` en Android): protocolo y
/// host en minúsculas, host internacional en punycode, puerto predeterminado omitido,
/// ruta «/» por defecto, segmentos «.» y «..» resueltos y no ASCII codificado en UTF-8.
public struct WebURL: Equatable, Hashable, CustomStringConvertible {
    public let scheme: String
    public let username: String
    public let password: String
    /// Nombre de host en ASCII y minúsculas (las IPv6 van entre corchetes).
    public let hostname: String
    /// Puerto explícito, o nil si no hay o es el predeterminado.
    public let port: Int?
    public let pathname: String
    /// Consulta sin «?», o nil.
    public let query: String?
    /// Fragmento sin «#», o nil.
    public let fragment: String?

    public var `protocol`: String { "\(scheme):" }
    public var host: String { port.map { "\(hostname):\($0)" } ?? hostname }
    public var search: String { (query?.isEmpty ?? true) ? "" : "?\(query!)" }
    public var hasCredentials: Bool { !username.isEmpty || !password.isEmpty }

    public var href: String {
        let credentials = hasCredentials ? username + (password.isEmpty ? "" : ":\(password)") + "@" : ""
        let queryPart = query.map { "?\($0)" } ?? ""
        let fragmentPart = fragment.map { "#\($0)" } ?? ""
        return "\(scheme)://\(credentials)\(host)\(pathname)\(queryPart)\(fragmentPart)"
    }

    public var description: String { href }

    private static let forbiddenHostChars: Set<Character> = [" ", "#", "%", "/", ":", "<", ">", "?", "@", "[", "\\", "]", "^", "|"]
    private static let fragmentSet: Set<Character> = [" ", "\"", "<", ">", "`"]
    private static let querySet: Set<Character> = [" ", "\"", "#", "<", ">", "'"]
    private static let pathSet: Set<Character> = [" ", "\"", "#", "<", ">", "?", "`", "{", "}"]

    /// Analiza una URL absoluta http(s). Devuelve nil para otros protocolos o si no es válida.
    public static func parse(_ input: String) -> WebURL? {
        // Como el estándar: fuera espacios y controles de los extremos, y tabuladores y saltos internos.
        let trimmed = String(input.unicodeScalars.drop(while: { $0.value <= 0x20 }).reversed().drop(while: { $0.value <= 0x20 }).reversed().map(Character.init))
        let text = trimmed.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }
        guard let colon = text.firstIndex(of: ":") else { return nil }
        let rawScheme = String(text[..<colon])
        guard let first = rawScheme.first, first.isASCII, first.isLetter,
              rawScheme.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "+" || $0 == "." || $0 == "-") }) else { return nil }
        let scheme = rawScheme.lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }

        var rest = Substring(text[text.index(after: colon)...])
        while let c = rest.first, c == "/" || c == "\\" { rest = rest.dropFirst() }
        let authorityEnd = rest.firstIndex(where: { $0 == "/" || $0 == "\\" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
        let authority = String(rest[..<authorityEnd])
        var remainder = String(rest[authorityEnd...])

        let at = authority.lastIndex(of: "@")
        let userinfo = at.map { String(authority[..<$0]) } ?? ""
        let hostAndPort = at.map { String(authority[authority.index(after: $0)...]) } ?? authority
        let userColon = userinfo.firstIndex(of: ":")
        let username = userColon.map { String(userinfo[..<$0]) } ?? userinfo
        let password = userColon.map { String(userinfo[userinfo.index(after: $0)...]) } ?? ""

        let hostText: String
        let portText: String?
        if hostAndPort.hasPrefix("[") {
            guard let close = hostAndPort.firstIndex(of: "]") else { return nil }
            hostText = String(hostAndPort[...close])
            let after = String(hostAndPort[hostAndPort.index(after: close)...])
            if after.isEmpty {
                portText = nil
            } else if after.hasPrefix(":") {
                portText = String(after.dropFirst())
            } else {
                return nil
            }
        } else if let portColon = hostAndPort.lastIndex(of: ":") {
            hostText = String(hostAndPort[..<portColon])
            portText = String(hostAndPort[hostAndPort.index(after: portColon)...])
        } else {
            hostText = hostAndPort
            portText = nil
        }

        guard let hostname = parseHost(hostText) else { return nil }
        var port: Int? = nil
        if let portText, !portText.isEmpty {
            guard portText.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
            let digits = portText.drop(while: { $0 == "0" })
            guard digits.count <= 5, let value = Int(digits.isEmpty ? "0" : String(digits)), value <= 65535 else { return nil }
            port = value
        }

        var fragment: String? = nil
        if let hash = remainder.firstIndex(of: "#") {
            fragment = percentEncode(String(remainder[remainder.index(after: hash)...]), fragmentSet)
            remainder = String(remainder[..<hash])
        }
        var query: String? = nil
        if let mark = remainder.firstIndex(of: "?") {
            query = percentEncode(String(remainder[remainder.index(after: mark)...]), querySet)
            remainder = String(remainder[..<mark])
        }
        let pathname = normalizePath(remainder.replacingOccurrences(of: "\\", with: "/"))
        let defaultPort = scheme == "http" ? 80 : 443
        return WebURL(scheme: scheme, username: username, password: password, hostname: hostname,
                      port: port == defaultPort ? nil : port, pathname: pathname, query: query, fragment: fragment)
    }

    private static func parseHost(_ input: String) -> String? {
        if input.isEmpty { return nil }
        if input.hasPrefix("[") {
            guard input.hasSuffix("]") else { return nil }
            let inner = input.dropFirst().dropLast()
            let valid = !inner.isEmpty && inner.allSatisfy { $0.isHexDigit || $0 == ":" || $0 == "." }
            return valid ? "[\(inner.lowercased())]" : nil
        }
        guard let decoded = percentDecode(input), let ascii = Punycode.toASCII(decoded)?.lowercased() else { return nil }
        if ascii.isEmpty || ascii.contains(where: { forbiddenHostChars.contains($0) || !$0.isASCII || ($0.asciiValue ?? 0) < 0x20 || ($0.asciiValue ?? 0) >= 0x7F }) {
            return nil
        }
        // Si la última etiqueta es numérica, el host debe ser una IPv4 decimal.
        let labels = (ascii.hasSuffix(".") ? String(ascii.dropLast()) : ascii).split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if let last = labels.last, !last.isEmpty, last.allSatisfy({ $0 >= "0" && $0 <= "9" }) {
            guard labels.count == 4, labels.allSatisfy({ !$0.isEmpty && $0.count <= 3 && Int($0)! <= 255 }) else { return nil }
            return labels.map { String(Int($0)!) }.joined(separator: ".")
        }
        return ascii
    }

    private static func normalizePath(_ raw: String) -> String {
        if raw.isEmpty { return "/" }
        let segments = (raw.hasPrefix("/") ? String(raw.dropFirst()) : raw).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        var output: [String] = []
        for (index, segment) in segments.enumerated() {
            let isLast = index == segments.count - 1
            switch segment.lowercased() {
            case ".", "%2e":
                if isLast { output.append("") }
            case "..", ".%2e", "%2e.", "%2e%2e":
                if !output.isEmpty { output.removeLast() }
                if isLast { output.append("") }
            default:
                output.append(percentEncode(segment, pathSet))
            }
        }
        return "/" + output.joined(separator: "/")
    }

    private static let hex = Array("0123456789ABCDEF")

    /// Codifica en UTF-8 los caracteres de `set`, los controles y todo lo que no es ASCII. Deja los «%» existentes.
    static func percentEncode(_ text: String, _ set: Set<Character>) -> String {
        var result = ""
        for scalar in text.unicodeScalars {
            let value = scalar.value
            if value < 0x20 || value > 0x7E || (value < 0x80 && set.contains(Character(scalar))) {
                for byte in String(scalar).utf8 {
                    result.append("%")
                    result.append(hex[Int(byte >> 4)])
                    result.append(hex[Int(byte & 0xF)])
                }
            } else {
                result.unicodeScalars.append(scalar)
            }
        }
        return result
    }

    private static func percentDecode(_ text: String) -> String? {
        guard text.contains("%") else { return text }
        var bytes: [UInt8] = []
        let utf8 = Array(text.utf8)
        var index = 0
        while index < utf8.count {
            // «%» seguido de dos dígitos hexadecimales.
            if utf8[index] == UInt8(ascii: "%"), index + 2 < utf8.count,
               let value = UInt8(String(decoding: utf8[(index + 1)...(index + 2)], as: UTF8.self), radix: 16) {
                bytes.append(value)
                index += 3
                continue
            }
            bytes.append(utf8[index])
            index += 1
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

/// Conversión de nombres de dominio internacionales a ASCII (IDNA: punycode, RFC 3492).
enum Punycode {
    /// Separadores de etiqueta que IDNA trata como «.».
    private static let dots: Set<Character> = [".", "\u{3002}", "\u{FF0E}", "\u{FF61}"]

    static func toASCII(_ domain: String) -> String? {
        let mapped = domain.precomposedStringWithCompatibilityMapping.lowercased()
        var labels: [String] = []
        var current = ""
        for character in mapped {
            if dots.contains(character) {
                labels.append(current)
                current = ""
            } else {
                current.append(character)
            }
        }
        labels.append(current)
        var output: [String] = []
        for label in labels {
            if label.unicodeScalars.allSatisfy({ $0.isASCII }) {
                output.append(label)
            } else {
                guard let encoded = encode(label) else { return nil }
                output.append("xn--" + encoded)
            }
        }
        let result = output.joined(separator: ".")
        return result.count <= 253 + 1 ? result : nil
    }

    private static let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128

    private static func adapt(_ delta: Int, _ numPoints: Int, _ firstTime: Bool) -> Int {
        var delta = firstTime ? delta / damp : delta / 2
        delta += delta / numPoints
        var k = 0
        while delta > ((base - tMin) * tMax) / 2 {
            delta /= base - tMin
            k += base
        }
        return k + (base - tMin + 1) * delta / (delta + skew)
    }

    private static func digit(_ value: Int) -> Character {
        Character(UnicodeScalar(UInt8(value < 26 ? value + 97 : value + 22)))
    }

    static func encode(_ input: String) -> String? {
        let scalars = input.unicodeScalars.map { Int($0.value) }
        var output = scalars.filter { $0 < 0x80 }.map { Character(UnicodeScalar(UInt8($0))) }
        let basicCount = output.count
        var handled = basicCount
        if basicCount > 0 { output.append("-") }
        var n = initialN, delta = 0, bias = initialBias
        while handled < scalars.count {
            guard let m = scalars.filter({ $0 >= n }).min() else { return nil }
            delta += (m - n) * (handled + 1)
            n = m
            for c in scalars {
                if c < n { delta += 1 }
                if c == n {
                    var q = delta
                    var k = base
                    while true {
                        let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                        if q < t { break }
                        output.append(digit(t + (q - t) % (base - t)))
                        q = (q - t) / (base - t)
                        k += base
                    }
                    output.append(digit(q))
                    bias = adapt(delta, handled + 1, handled == basicCount)
                    delta = 0
                    handled += 1
                }
            }
            delta += 1
            n += 1
        }
        return String(output)
    }
}
