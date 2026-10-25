import Foundation
@testable import IcarusCore

/// mobile/shared (generado desde escritorio): Tests/IcarusCoreTests → ../../../shared
enum Shared {
    static let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("shared")

    static func text(_ name: String) throws -> String {
        try String(contentsOf: directory.appendingPathComponent(name), encoding: .utf8)
    }

    static func json(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: directory.appendingPathComponent(name))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    /// Entradas de los vectores, leídas como las guardadas por la app.
    static func customAddresses(_ value: Any?) -> [CustomAddress] { CustomAddresses.sanitize(value) }

    static let suffixes: PublicSuffixList = PublicSuffixList(rules: try! text("public-suffix-rules.txt"))
}
