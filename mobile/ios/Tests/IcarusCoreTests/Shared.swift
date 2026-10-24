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

    static func rules(_ value: Any?) throws -> [AliasRule] {
        let data = try JSONSerialization.data(withJSONObject: value ?? [])
        return try JSONDecoder().decode([AliasRule].self, from: data)
    }

    static let suffixes: PublicSuffixList = PublicSuffixList(rules: try! text("public-suffix-rules.txt"))
}
