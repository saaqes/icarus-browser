import XCTest
@testable import IcarusCore

/// Edición de la base con los vectores generados desde escritorio (mobile/shared/test-vectors/address-rebase.json).
final class AddressRebaseTests: XCTestCase {
    func testEditaLaBaseConservandoRutaConsultaYFragmentoComoEnEscritorio() throws {
        let data = try Shared.json("test-vectors/address-rebase.json")
        let entries = CustomAddresses.sanitize(data["customAddresses"])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 12)
        var failures: [String] = []
        for item in cases {
            let shown = item["shown"] as! String
            let entryId = item["entryId"] as? String
            let entry = entryId.flatMap { id in entries.first { $0.id == id } }
            let split = AddressRebase.split(shown, entry: entry)
            guard let expected = item["split"] as? [String: Any] else {
                if split != nil { failures.append("\(shown): se esperaba sin base") }
                continue
            }
            guard let split else { failures.append("\(shown): sin base"); continue }
            if split.base != expected["base"] as! String || split.suffix != expected["suffix"] as! String {
                failures.append("\(shown): \(split.base) + \(split.suffix)")
            }
            for join in item["joins"] as! [[String: Any]] {
                let base = join["base"] as! String
                let actual: String
                switch AddressRebase.join(base, suffix: split.suffix) {
                case .ok(let url): actual = "url:\(url)"
                case .failure(let error): actual = "error:\(error)"
                }
                let wanted = (join["url"] as? String).map { "url:\($0)" } ?? "error:\(join["error"] as! String)"
                if actual != wanted { failures.append("\(shown) + «\(base)»: \(actual) ≠ \(wanted)") }
            }
            for edit in item["edits"] as! [[String: Any]] {
                let typed = edit["typed"] as! String
                let actual: String
                switch AddressRebase.classify(split, typed: typed) {
                case .rebase(let base, let url): actual = "rebase \(base) \(url)"
                case .navigate: actual = "navigate"
                }
                let wanted = edit["kind"] as! String == "rebase" ? "rebase \(edit["base"] as! String) \(edit["url"] as! String)" : "navigate"
                if actual != wanted { failures.append("\(shown) / «\(typed)»: \(actual) ≠ \(wanted)") }
            }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }
}
