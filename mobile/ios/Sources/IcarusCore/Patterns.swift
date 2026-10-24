import Foundation

/// Expresión regular (ICU, como en Android/Java) con las operaciones que usa el núcleo.
struct Pattern {
    let regex: NSRegularExpression

    init(_ pattern: String, caseInsensitive: Bool = false) {
        // Los patrones del núcleo son constantes: si uno no compila es un error de programación.
        regex = try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    private static func range(_ text: String) -> NSRange { NSRange(text.startIndex..., in: text) }

    /// ¿Coincide con todo el texto?
    func matches(_ text: String) -> Bool {
        let whole = Pattern.range(text)
        guard let match = regex.firstMatch(in: text, options: [.anchored], range: whole) else { return false }
        return match.range == whole
    }

    func contains(_ text: String) -> Bool { regex.firstMatch(in: text, range: Pattern.range(text)) != nil }

    /// Grupos de la primera coincidencia (0 = todo); nil si no coincide.
    func groups(_ text: String) -> [String]? {
        guard let match = regex.firstMatch(in: text, range: Pattern.range(text)) else { return nil }
        return (0..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
        }
    }

    func allMatches(_ text: String) -> [(range: Range<String.Index>, value: String)] {
        regex.matches(in: text, range: Pattern.range(text)).compactMap { match in
            Range(match.range, in: text).map { ($0, String(text[$0])) }
        }
    }

    func replacing(_ text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: Pattern.range(text), withTemplate: template)
    }
}

extension String {
    public func removingSuffix(_ suffix: String) -> String { hasSuffix(suffix) ? String(dropLast(suffix.count)) : self }
    public func removingPrefix(_ prefix: String) -> String { hasPrefix(prefix) ? String(dropFirst(prefix.count)) : self }
    public var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
