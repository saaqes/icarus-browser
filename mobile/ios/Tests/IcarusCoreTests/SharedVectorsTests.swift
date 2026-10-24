import XCTest
@testable import IcarusCore

/// El núcleo de iPhone contra los vectores de mobile/shared, generados desde escritorio.
final class SharedVectorsTests: XCTestCase {
    private func describe(_ result: InputResolution) -> String {
        switch result {
        case .url(let url): return "url \(url)"
        case .search(let url, _, _): return "search \(url)"
        case .alias(let url, let rule): return "alias \(url) \(rule.id)"
        case .aliasUnresolved(let alias, let reason): return "alias-unresolved \(alias) \(reason)"
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
        case "alias": return "alias \(item["url"] as! String) \(item["ruleId"] as! String)"
        case "alias-unresolved": return "alias-unresolved \(item["alias"] as! String) \(item["reason"] as! String)"
        case "internal": return "internal \(item["page"] as! String)"
        case "blocked": return "blocked \(item["protocol"] as! String) \(item["dangerous"] as! Bool)"
        default: return kind
        }
    }

    func testLaBarraDeDireccionesResuelveIgualQueEnEscritorio() throws {
        let data = try Shared.json("test-vectors/resolve-input.json")
        let rules = try Shared.rules(data["rules"])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 40)
        var failures: [String] = []
        for item in cases {
            let input = item["input"] as! String
            let actual = describe(InputResolver.resolve(input, provider: .google, rules: rules))
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

    func testLosAliasSeAplicanALasMismasDirecciones() throws {
        let data = try Shared.json("test-vectors/alias-match.json")
        let rules = try Shared.rules(data["rules"])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 15)
        for item in cases {
            let url = item["url"] as! String
            let match = AliasRules.findMatch(url, rules)
            XCTAssertEqual(match?.rule.id, item["ruleId"] as? String, url)
            XCTAssertEqual(match?.realUrl, item["realUrl"] as? String, url)
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

    func testValidacionDeAlias() {
        func input(pattern: String = "https://www.google.com/", alias: String = "buscar.icarus", target: String = "https://www.google.com/",
                   type: AliasMatchType = .exact) -> AliasRules.Input {
            AliasRules.Input(name: "Búsqueda", matchType: type, pattern: pattern, displayName: "Buscar", alias: alias, targetUrl: target, enabled: true)
        }
        guard case .ok(let value) = AliasRules.validate(input(pattern: "WWW.GOOGLE.COM", alias: " https://Buscar.Icarus/ "), others: []) else {
            return XCTFail("debería ser válida")
        }
        XCTAssertEqual(value.pattern, "https://www.google.com/")
        XCTAssertEqual(value.alias, "buscar.icarus")
        guard case .errors(let errors) = AliasRules.validate(input(alias: "buscar.com", target: "otro.icarus"), others: []) else { return XCTFail() }
        XCTAssertEqual(errors["alias"], "alias-format")
        XCTAssertEqual(errors["targetUrl"], "target-is-alias")
        guard case .errors(let insecure) = AliasRules.validate(input(target: "http://ejemplo.com/"), others: []) else { return XCTFail() }
        XCTAssertEqual(insecure["targetUrl"], "insecure-target")
        guard case .ok = AliasRules.validate(input(target: "http://localhost:3000/"), others: []) else { return XCTFail() }
        guard case .ok(let host) = AliasRules.validate(input(pattern: "*.Ejemplo.org", alias: "org.icarus", target: "https://ejemplo.org/", type: .host), others: []) else {
            return XCTFail()
        }
        XCTAssertEqual(host.pattern, "*.ejemplo.org")
    }

    func testPunycode() {
        XCTAssertEqual(WebURL.parse("https://café.com/")?.hostname, "xn--caf-dma.com")
        XCTAssertEqual(WebURL.parse("https://bücher.de/")?.hostname, "xn--bcher-kva.de")
        XCTAssertEqual(WebURL.parse("https://例え.テスト/")?.hostname, "xn--r8jz45g.xn--zckzah")
        XCTAssertEqual(WebURL.parse("https://ПРИМЕР.рф/")?.hostname, "xn--e1afmkfd.xn--p1ai")
    }
}
