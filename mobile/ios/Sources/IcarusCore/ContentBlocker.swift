import Foundation

/// Conversión de los filtros de ICARUS Shield al formato de reglas de contenido de
/// WebKit (`WKContentRuleList`). En iPhone es WebKit quien bloquea las solicitudes,
/// con la misma semántica que escritorio:
/// - La página principal nunca se bloquea (solo subrecursos y marcos internos): cada
///   filtro es una sola regla y una última regla anula los bloqueos de la página principal.
/// - Las excepciones (@@) se colocan después de todos los bloqueos, así que siempre ganan.
/// - Las excepciones $document desactivan el bloqueo en todo el sitio.
///
/// WebKit solo admite un subconjunto de expresiones regulares (sin «|», «{n}» ni
/// clases como «\s»); los filtros que no se pueden expresar se cuentan como «omitidos».
/// WebKit no informa de cuántas solicitudes bloquea, así que en iPhone no hay contador.
public enum ContentBlocker {
    /// Máximo de reglas por lista que admite WebKit.
    public static let maxRules = 150_000

    public struct Result {
        /// JSON listo para `WKContentRuleListStore.compileContentRuleList`.
        public let json: String
        public let rules: [[String: Any]]
        /// Filtros que aplica WebKit.
        public let convertedFilters: Int
        /// Filtros que WebKit no puede expresar.
        public let skippedFilters: Int
        /// Filtros que se pueden expresar pero no caben en el máximo de reglas de WebKit.
        public let overLimitFilters: Int
    }

    /// Anula los bloqueos anteriores para la página principal (marco superior), que
    /// escritorio nunca bloquea. Los marcos internos siguen bloqueándose.
    static let mainFrameRule: [String: Any] = [
        "trigger": ["url-filter": ".*", "resource-type": ["document"], "load-context": ["top-frame"]],
        "action": ["type": "ignore-previous-rules"],
    ]

    /// Tipos de recurso de WebKit para cada tipo de ICARUS (sin la página principal).
    static func webKitTypes(_ type: ResourceType) -> [String] {
        switch type {
        case .image: return ["image"]
        case .stylesheet: return ["style-sheet"]
        case .script: return ["script"]
        case .font: return ["font"]
        case .media: return ["media"]
        case .xmlhttprequest, .websocket, .ping, .other, .object: return ["raw"]
        case .subdocument, .document: return ["document"]
        }
    }

    static let subresourceTypes: Set<ResourceType> = Set(ResourceType.allCases).subtracting([.document])

    /// Convierte los filtros en orden. Si no caben todos en `maxRules`, se quedan fuera
    /// filtros de bloqueo completos empezando por el final (las excepciones siempre entran).
    public static func convert(_ filters: [NetworkFilter], maxRules: Int = ContentBlocker.maxRules) -> Result {
        // Reglas de cada filtro de bloqueo (una, o dos si anula sus dominios excluidos).
        var blocks: [[[String: Any]]] = []
        var exceptions: [[String: Any]] = []
        var documentExceptions: [[String: Any]] = []
        var skipped = 0

        for filter in filters {
            if filter.documentException {
                guard let host = filter.hostname, let domain = Punycode.toASCII(host) else {
                    skipped += 1
                    continue
                }
                documentExceptions.append(["trigger": ["url-filter": ".*", "if-domain": ["*\(domain)"]], "action": ["type": "ignore-previous-rules"]])
                continue
            }
            guard let urlFilter = urlFilter(for: filter), var base = trigger(filter, urlFilter: urlFilter) else {
                skipped += 1
                continue
            }
            let domains = filter.domains
            let bothDomainKinds = !(domains?.include.isEmpty ?? true) && !(domains?.exclude.isEmpty ?? true)
            if filter.exception && bothDomainKinds {
                skipped += 1
                continue
            }
            if bothDomainKinds { base["unless-domain"] = nil }

            if filter.exception {
                // Sin tipos, la excepción vale para cualquier recurso (también marcos internos).
                var trigger = base
                if let types = effectiveTypes(filter, defaultTypes: nil) {
                    let (subresources, frames) = split(types)
                    if !subresources.isEmpty || frames {
                        trigger["resource-type"] = subresources + (frames ? ["document"] : [])
                    }
                }
                exceptions.append(["trigger": trigger, "action": ["type": "ignore-previous-rules"]])
                continue
            }

            let types = effectiveTypes(filter, defaultTypes: subresourceTypes) ?? subresourceTypes
            let (subresources, frames) = split(types)
            if subresources.isEmpty && !frames {
                skipped += 1
                continue
            }
            // «document» incluye la página principal: la anula mainFrameRule al final.
            var trigger = base
            trigger["resource-type"] = subresources + (frames ? ["document"] : [])
            var produced: [[String: Any]] = [["trigger": trigger, "action": ["type": "block"]]]
            if bothDomainKinds, let exclude = domains?.exclude {
                // WebKit no admite if-domain y unless-domain juntos: se anula en los dominios excluidos.
                var trigger = base
                trigger["if-domain"] = exclude.compactMap { Punycode.toASCII($0) }.map { "*\($0)" }
                produced.append(["trigger": trigger, "action": ["type": "ignore-previous-rules"]])
            }
            blocks.append(produced)
        }

        var room = maxRules - exceptions.count - documentExceptions.count - (blocks.isEmpty ? 0 : 1)
        var kept: [[String: Any]] = []
        var keptFilters = 0
        for group in blocks {
            guard group.count <= room else { break }
            kept.append(contentsOf: group)
            room -= group.count
            keptFilters += 1
        }
        var rules = kept + exceptions + documentExceptions
        if !kept.isEmpty { rules.append(mainFrameRule) }
        // WebKit rechaza una lista vacía: una regla inocua que nunca coincide.
        let output = rules.isEmpty ? [["trigger": ["url-filter": "^icarus-sin-reglas:"], "action": ["type": "block"]]] : rules
        let data = (try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])) ?? Data("[]".utf8)
        return Result(json: String(decoding: data, as: UTF8.self), rules: output,
                      convertedFilters: keptFilters + exceptions.count + documentExceptions.count,
                      skippedFilters: skipped, overLimitFilters: blocks.count - keptFilters)
    }

    /// Lista que desactiva todo lo anterior en los sitios que el usuario excluyó de Shield.
    public static func siteExceptionRule(domain: String) -> [String: Any] {
        ["trigger": ["url-filter": ".*", "if-domain": ["*\(domain)"]], "action": ["type": "ignore-previous-rules"]]
    }

    private static func effectiveTypes(_ filter: NetworkFilter, defaultTypes: Set<ResourceType>?) -> Set<ResourceType>? {
        guard filter.types != nil || filter.excludedTypes != nil else { return defaultTypes }
        var types = filter.types ?? subresourceTypes
        types.subtract(filter.excludedTypes ?? [])
        types.remove(.document)
        return types
    }

    /// Tipos de WebKit para subrecursos y si hay que añadir los marcos internos.
    private static func split(_ types: Set<ResourceType>) -> (subresources: [String], frames: Bool) {
        let frames = types.contains(.subdocument)
        var subresources: [String] = []
        for type in ResourceType.allCases where types.contains(type) && type != .subdocument && type != .document {
            for name in webKitTypes(type) where !subresources.contains(name) { subresources.append(name) }
        }
        return (subresources, frames)
    }

    private static func trigger(_ filter: NetworkFilter, urlFilter: String) -> [String: Any]? {
        var trigger: [String: Any] = ["url-filter": urlFilter]
        if filter.matchCase { trigger["url-filter-is-case-sensitive"] = true }
        if let thirdParty = filter.thirdParty { trigger["load-type"] = [thirdParty ? "third-party" : "first-party"] }
        if let domains = filter.domains {
            let include = domains.include.compactMap { Punycode.toASCII($0) }
            let exclude = domains.exclude.compactMap { Punycode.toASCII($0) }
            guard include.count == domains.include.count, exclude.count == domains.exclude.count else { return nil }
            if !include.isEmpty { trigger["if-domain"] = include.map { "*\($0)" } }
            if !exclude.isEmpty { trigger["unless-domain"] = exclude.map { "*\($0)" } }
        }
        return trigger
    }

    /// Prefijo de `||`: cualquier esquema, y el dominio o un subdominio suyo.
    static let domainAnchor = "^[a-z][a-z0-9.+-]*://([^/?#]*\\.)?"
    /// Separador «^» de ABP: cualquier carácter salvo letra, dígito, «_», «-», «.» o «%».
    static let separator = "[^a-zA-Z0-9_.%-]"

    static func urlFilter(for filter: NetworkFilter) -> String? {
        let result: String?
        if filter.matchesAnyURL {
            result = ".*"
        } else if let host = filter.hostname {
            result = domainAnchor + escape(host) + "[/:]"
        } else if let source = filter.regexSource {
            result = translateRegex(source)
        } else if let pattern = filter.pattern {
            result = translatePattern(pattern)
        } else {
            result = nil
        }
        guard let value = result, isWebKitCompatible(value) else { return nil }
        return value
    }

    private static let special: Set<Character> = [".", "+", "?", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "^", "*"]

    static func escape(_ text: String) -> String {
        var output = ""
        for character in text {
            if special.contains(character) { output.append("\\") }
            output.append(character)
        }
        return output
    }

    /// Patrón ABP → url-filter de WebKit.
    static func translatePattern(_ pattern: String) -> String? {
        guard pattern.unicodeScalars.allSatisfy({ $0.isASCII }) else { return nil }
        var source = pattern
        var prefix = ""
        var suffix = ""
        if source.hasPrefix("||") {
            source = String(source.dropFirst(2))
            prefix = domainAnchor
        } else if source.hasPrefix("|") {
            source = String(source.dropFirst())
            prefix = "^"
        }
        if source.hasSuffix("|") {
            source = String(source.dropLast())
            suffix = "$"
        }
        while source.hasPrefix("*") { source.removeFirst() }
        while source.hasSuffix("*") { source.removeLast() }
        var trailingSeparator = false
        if source.hasSuffix("^") && suffix.isEmpty {
            source.removeLast()
            trailingSeparator = true
        }
        var body = ""
        for character in source {
            switch character {
            case "*": body += ".*"
            case "^": body += separator
            default: body += escape(String(character))
            }
        }
        // «^» al final también coincide con el final de la URL.
        if trailingSeparator { body += "(\(separator).*)?$" }
        let result = prefix + body + suffix
        return result.isEmpty ? ".*" : result
    }

    /// Expresión regular de un filtro `/…/` → subconjunto de WebKit, o nil si no se puede.
    static func translateRegex(_ source: String) -> String? {
        guard source.unicodeScalars.allSatisfy({ $0.isASCII }) else { return nil }
        var output = ""
        var inClass = false
        var index = source.startIndex
        while index < source.endIndex {
            let character = source[index]
            let next = source.index(after: index)
            if character == "\\" {
                guard next < source.endIndex else { return nil }
                let escaped = source[next]
                switch escaped {
                case "d": output += inClass ? "0-9" : "[0-9]"
                case "D": if inClass { return nil } else { output += "[^0-9]" }
                case "w": output += inClass ? "A-Za-z0-9_" : "[A-Za-z0-9_]"
                case "W": if inClass { return nil } else { output += "[^A-Za-z0-9_]" }
                case "/": output += "/"
                case ".", "+", "?", "*", "(", ")", "[", "]", "{", "}", "|", "\\", "^", "$", "-", ":", "=", "&", "#", "%", "_", "~", ",", "!", "@", ";", "'", "\"", "<", ">":
                    output += "\\" + String(escaped)
                default:
                    // \s, \b, \1… no existen en WebKit.
                    return nil
                }
                index = source.index(after: next)
                continue
            }
            if inClass {
                if character == "]" { inClass = false }
                output.append(character)
            } else {
                switch character {
                case "[": inClass = true
                case "|", "{", "}": return nil
                case "(":
                    if next < source.endIndex && source[next] == "?" { return nil }
                case "^": if index != source.startIndex { return nil }
                case "$": if next != source.endIndex { return nil }
                default: break
                }
                output.append(character)
            }
            index = next
        }
        return inClass ? nil : output
    }

    /// Comprueba que un url-filter solo usa lo que admite WebKit.
    static func isWebKitCompatible(_ filter: String) -> Bool {
        guard !filter.isEmpty, filter.unicodeScalars.allSatisfy({ $0.isASCII && $0.value >= 0x20 }) else { return false }
        var inClass = false
        var depth = 0
        var index = filter.startIndex
        while index < filter.endIndex {
            let character = filter[index]
            let next = filter.index(after: index)
            if character == "\\" {
                guard next < filter.endIndex, !"dDwWsSbB0123456789".contains(filter[next]) else { return false }
                index = filter.index(after: next)
                continue
            }
            if inClass {
                if character == "]" { inClass = false }
            } else {
                switch character {
                case "[": inClass = true
                case "|", "{", "}": return false
                case "(":
                    if next < filter.endIndex && filter[next] == "?" { return false }
                    depth += 1
                case ")":
                    depth -= 1
                    if depth < 0 { return false }
                case "^": if index != filter.startIndex { return false }
                case "$": if next != filter.endIndex { return false }
                default: break
                }
            }
            index = next
        }
        guard !inClass, depth == 0 else { return false }
        return (try? NSRegularExpression(pattern: filter)) != nil
    }
}
