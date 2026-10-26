import XCTest
@testable import IcarusCore

/// El núcleo de iPhone contra los vectores de mobile/shared, generados desde escritorio.
final class SharedVectorsTests: XCTestCase {
    private func describe(_ result: InputResolution) -> String {
        switch result {
        case .url(let url): return "url \(url)"
        case .search(let url, _, _): return "search \(url)"
        case .custom(let url, let address, let entry): return "custom \(url) \(address) \(entry.id)"
        case .internal(let page): return "internal \(page.kind)"
        case .internalUnknown: return "internal-unknown"
        case .blocked(let proto, let dangerous): return "blocked \(proto) \(dangerous)"
        case .empty: return "empty"
        }
    }

    private func describe(_ item: [String: Any]) -> String {
        let kind = item["kind"] as! String
        switch kind {
        case "url", "search": return "\(kind) \(item["url"] as! String)"
        case "custom": return "custom \(item["url"] as! String) \(item["address"] as! String) \(item["entryId"] as! String)"
        case "internal": return "internal \(item["page"] as! String)"
        case "blocked": return "blocked \(item["protocol"] as! String) \(item["dangerous"] as! Bool)"
        default: return kind
        }
    }

    func testLaBarraDeDireccionesResuelveIgualQueEnEscritorio() throws {
        let data = try Shared.json("test-vectors/resolve-input.json")
        let entries = Shared.customAddresses(data["customAddresses"])
        XCTAssertEqual(entries.count, (data["customAddresses"] as! [Any]).count, "entradas de los vectores")
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 40)
        var failures: [String] = []
        for item in cases {
            let input = item["input"] as! String
            let actual = describe(InputResolver.resolve(input, provider: .google, customAddresses: entries))
            let expected = describe(item)
            if actual != expected { failures.append("«\(input)»: se esperaba \(expected) y se obtuvo \(actual)") }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testLasBusquedasCodificanComoEncodeURIComponent() throws {
        let search = try Shared.json("test-vectors/resolve-input.json")["search"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(search.count, 20)
        for item in search {
            let provider = SearchProvider.from(id: item["providerId"] as? String)
            XCTAssertEqual(provider.searchURL(item["query"] as! String), item["url"] as? String, item["query"] as! String)
        }
    }

    func testLaBarraMuestraLaMismaDireccionQueEnEscritorio() throws {
        let data = try Shared.json("test-vectors/custom-address-display.json")
        let entries = Shared.customAddresses(data["customAddresses"])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 15)
        for item in cases {
            let url = item["url"] as! String
            let match = CustomAddresses.displayURL(for: url, entries)
            let shown = match?.url ?? url
            XCTAssertEqual(match?.entry.id, item["entryId"] as? String, url)
            XCTAssertEqual(shown, item["shown"] as? String, url)
            XCTAssertEqual(CustomAddresses.shortAddress(shown), item["short"] as? String, url)
            XCTAssertEqual(CustomAddresses.formatAddress(shown, full: true).description, item["full"] as? String, url)
        }
    }

    func testElEditorValidaYDetectaConflictosComoEnEscritorio() throws {
        let data = try Shared.json("test-vectors/custom-address-validation.json")
        let entries = Shared.customAddresses(data["customAddresses"])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 10)
        for item in cases {
            let input = item["input"] as! [String: Any]
            let label = "\(input)"
            let result = CustomAddresses.validate(target: input["target"] as! String, address: input["address"] as! String, enabled: input["enabled"] as! Bool,
                                                  entries: entries, editingId: item["editingId"] as? String, sections: input["sections"] as? String ?? "")
            if item["ok"] as! Bool {
                let value = item["value"] as! [String: Any]
                XCTAssertEqual(result, .ok(target: value["target"] as! String, address: value["address"] as! String, enabled: value["enabled"] as! Bool,
                                           sections: value["sections"] as? [String] ?? []), label)
            } else {
                guard case .errors(let errors, let conflicts) = result else { XCTFail("debería fallar: \(label)"); continue }
                XCTAssertEqual(errors, item["errors"] as? [String: String], label)
                XCTAssertEqual(conflicts.mapValues(\.id), item["conflicts"] as? [String: String], label)
            }
        }
    }

    func testLasReglasDeAliasAntiguasSeConviertenIgualQueEnEscritorio() throws {
        let legacy = try Shared.json("test-vectors/custom-address-validation.json")["legacy"] as! [String: Any]
        let rules = legacy["rules"] as! [[String: Any]]
        for conversion in legacy["conversions"] as! [[String: Any]] {
            let raw = rules.first { $0["id"] as? String == conversion["id"] as? String }!
            let expected = conversion["result"] as! [String: Any]
            let actual = CustomAddresses.convertLegacy(raw)
            switch expected["kind"] as! String {
            case "skip": XCTAssertEqual(actual, .skip, "\(raw)")
            case "invalid": XCTAssertEqual(actual, .invalid, "\(raw)")
            default:
                let input = expected["input"] as! [String: Any]
                XCTAssertEqual(actual, .entry(target: input["target"] as! String, address: input["address"] as! String, enabled: input["enabled"] as! Bool), "\(raw)")
            }
        }
        let loaded = (legacy["loaded"] as! [[String: Any]]).map { item in
            CustomAddress(id: item["id"] as! String, target: item["target"] as! String, address: item["address"] as! String, enabled: item["enabled"] as! Bool,
                          createdAt: item["createdAt"] as! String, updatedAt: item["updatedAt"] as! String)
        }
        XCTAssertEqual(CustomAddresses.sanitize(rules), loaded)
    }

    func testDireccionesSinSufijosYNuncaHTTPComoHTTPS() {
        guard case .ok(let target, let address, _, _) = CustomAddresses.validate(target: "bot.deriv.me", address: "miweb.com", enabled: true) else {
            return XCTFail("debería ser válida")
        }
        XCTAssertEqual(target, "https://bot.deriv.me/")
        XCTAssertEqual(address, "https://miweb.com/")
        guard case .ok(_, let local, _, _) = CustomAddresses.validate(target: "localhost:3000", address: "miapp.com", enabled: true) else { return XCTFail() }
        XCTAssertEqual(local, "http://miapp.com/")
        guard case .errors(let errors, _) = CustomAddresses.validate(target: "http://intranet.ejemplo.com", address: "https://miweb.com", enabled: true) else {
            return XCTFail()
        }
        XCTAssertEqual(errors["address"], "protocol-mismatch")
        let entries = [CustomAddress(id: "deriv", target: "https://bot.deriv.me/", address: "https://miweb.com/", enabled: true,
                                     createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z")]
        XCTAssertNil(CustomAddresses.displayURL(for: "http://bot.deriv.me/", entries))
        for real in ["https://bot.deriv.me/a/b?c=1#d", "https://bot.deriv.me/"] {
            let shown = CustomAddresses.displayURL(for: real, entries)!.url
            XCTAssertEqual(CustomAddresses.resolve(UrlUtils.parseWebURL(shown)!, entries, explicitProtocol: true)?.url, real)
        }
    }

    func testLasSeccionesYGuardarSoloParaUnaSeccionComoEnEscritorio() throws {
        let data = try Shared.json("test-vectors/custom-address-sections.json")
        for item in data["fragments"] as! [[String: Any]] {
            XCTAssertEqual(CustomAddresses.sectionOf(item["hash"] as! String), item["section"] as? String, "\(item)")
        }
        for item in data["texts"] as! [[String: Any]] {
            let expected: CustomAddresses.Sections = item["ok"] as! Bool ? .ok(item["sections"] as! [String]) : .failure(item["error"] as! String)
            XCTAssertEqual(CustomAddresses.parseSections(item["text"] as! String), expected, "\(item)")
        }
        var entries = Shared.customAddresses(data["customAddresses"])
        let now = data["now"] as! String
        for item in data["saves"] as! [[String: Any]] {
            let result = CustomAddresses.saveSection(entries, target: "https://bot.deriv.me/", section: item["section"] as! String,
                                                     base: item["base"] as! String, id: item["id"] as! String, now: now)
            switch result {
            case .ok(let saved, let entry):
                XCTAssertTrue(item["ok"] as! Bool, "\(item)")
                XCTAssertEqual(entry.id, item["entryId"] as? String, "\(item)")
                XCTAssertEqual(saved.filter { $0.target == "https://bot.deriv.me/" }, Shared.customAddresses(item["entries"]), "\(item)")
                entries = saved
            case .failure(let errors, _):
                XCTAssertFalse(item["ok"] as! Bool, "\(item)")
                XCTAssertEqual(errors, item["errors"] as? [String: String], "\(item)")
            }
        }
    }

    func testElDominioRegistrableCoincideConEscritorio() throws {
        let cases = try Shared.json("test-vectors/registrable-domain.json")["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 10)
        XCTAssertGreaterThan(Shared.suffixes.ruleCount, 5000)
        for item in cases {
            XCTAssertEqual(Shared.suffixes.registrableDomain(item["host"] as! String), item["domain"] as? String, item["host"] as! String)
        }
    }

    func testPunycode() {
        XCTAssertEqual(WebURL.parse("https://café.com/")?.hostname, "xn--caf-dma.com")
        XCTAssertEqual(WebURL.parse("https://bücher.de/")?.hostname, "xn--bcher-kva.de")
        XCTAssertEqual(WebURL.parse("https://例え.テスト/")?.hostname, "xn--r8jz45g.xn--zckzah")
        XCTAssertEqual(WebURL.parse("https://ПРИМЕР.рф/")?.hostname, "xn--e1afmkfd.xn--p1ai")
    }
}
