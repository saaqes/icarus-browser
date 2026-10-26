import XCTest
@testable import IcarusCore

/// El núcleo de iPhone decide igual que escritorio y Android con los vectores de
/// mobile/shared/test-vectors/updates.json (generados por electron/update/vectors.test.ts).
final class UpdateVectorsTests: XCTestCase {
    func testVersionesYCodigosComoEnEscritorio() throws {
        let data = try Shared.json("test-vectors/updates.json")
        for item in data["versions"] as! [[String: Any]] {
            let text = item["text"] as! String
            let parsed = UpdateVersion.parse(text)
            XCTAssertEqual(parsed != nil, item["valid"] as! Bool, text)
            XCTAssertEqual(parsed?.versionCode, item["versionCode"] as? Int, text)
        }
        let order = (data["order"] as! [String]).map { UpdateVersion.parse($0)! }
        for index in 1..<order.count {
            XCTAssertLessThan(order[index - 1], order[index])
            XCTAssertLessThan(order[index - 1].versionCode, order[index].versionCode)
        }
    }

    func testFirmasValidacionYDecisionDeCadaManifiesto() throws {
        let data = try Shared.json("test-vectors/updates.json")
        let publicKey = data["publicKey"] as! String
        XCTAssertTrue(UpdateManifests.isValidPublicKey(publicKey))
        let manifests = data["manifests"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(manifests.count, 25)
        var failures: [String] = []
        for item in manifests {
            let name = item["name"] as! String
            let text = item["text"] as! String
            let signatureValid = UpdateManifests.verifySignature(Data(text.utf8), signature: item["signature"] as! String, publicKeyPEM: publicKey)
            if signatureValid != (item["signatureValid"] as! Bool) { failures.append("\(name): firma \(signatureValid)") }
            let result = UpdateManifests.parse(text)
            let parse: String
            switch result {
            case .ok: parse = "ok"
            case .invalid(let error): parse = error
            }
            if parse != item["parse"] as! String { failures.append("\(name): se esperaba \(item["parse"]!) y se obtuvo \(parse)") }
            for decision in item["decisions"] as! [[String: Any]] {
                guard case .ok(let manifest, let version) = result else { failures.append("\(name): sin manifiesto"); continue }
                let outcome = UpdateManifests.evaluate(
                    manifest, version: version,
                    current: UpdateVersion.parse(decision["current"] as? String)!,
                    channel: UpdateChannel(rawValue: decision["channel"] as! String)!,
                    platform: decision["platform"] as! String, arch: decision["arch"] as! String, kinds: decision["kinds"] as! [String])
                let (status, file): (String, String?) = {
                    switch outcome {
                    case .upToDate: return ("up-to-date", nil)
                    case .available(let asset): return ("available", asset?.file)
                    case .rejected(let reason): return ("rejected:\(reason)", nil)
                    }
                }()
                let expectedFile = decision["file"] as? String
                if status != decision["result"] as! String || file != expectedFile {
                    failures.append("\(name) / \(decision["platform"]!) \(decision["current"]!): \(status) \(file ?? "-") ≠ \(decision["result"]!) \(expectedFile ?? "-")")
                }
            }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testEtiquetaMasRecienteSinBorradoresNiVersionesSinManifiesto() {
        let withManifest: [[String: Any]] = [["name": "icarus-update.json"], ["name": "icarus-update.json.sig"]]
        let list: [[String: Any]] = [
            ["tag_name": "v0.4.0", "draft": true, "assets": withManifest],
            ["tag_name": "v0.3.0-preview.3", "draft": false, "assets": []],
            ["tag_name": "v0.3.0-preview.2", "draft": false, "assets": withManifest],
            ["tag_name": "v0.2.0", "draft": false, "assets": withManifest],
        ]
        XCTAssertEqual(UpdateChecker.newestTag(list), "v0.3.0-preview.2")
    }
}
