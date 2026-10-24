import Foundation
import XCTest
@testable import IcarusCore

/// Aplica reglas de contenido con la semántica de WebKit (orden, tipos, contexto de carga,
/// primera/tercera parte y dominios) para comprobar la conversión sin un navegador.
enum WebKitRuleEvaluator {
    static func blocks(_ rules: [[String: Any]], url: String, type: ResourceType, pageURL: String, suffixes: PublicSuffixList) -> Bool {
        let requestHost = WebURL.parse(url)?.hostname ?? ""
        let pageHost = WebURL.parse(pageURL)?.hostname ?? ""
        let thirdParty = suffixes.isThirdParty(requestHost: requestHost, pageHost: pageHost)
        let webKitType = ContentBlocker.webKitTypes(type).first!
        let context = type == .document ? "top-frame" : "child-frame"
        var blocked = false
        for rule in rules {
            let trigger = rule["trigger"] as! [String: Any]
            let caseSensitive = trigger["url-filter-is-case-sensitive"] as? Bool ?? false
            let regex = try! NSRegularExpression(pattern: trigger["url-filter"] as! String, options: caseSensitive ? [] : [.caseInsensitive])
            guard regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)) != nil else { continue }
            if let types = trigger["resource-type"] as? [String], !types.contains(webKitType) { continue }
            // Sin load-context, una regla de tipo «document» también afectaría a la página principal.
            if let contexts = trigger["load-context"] as? [String], webKitType == "document", !contexts.contains(context) { continue }
            if let loadType = trigger["load-type"] as? [String], !loadType.contains(thirdParty ? "third-party" : "first-party") { continue }
            let domainMatches = { (entry: String) -> Bool in
                entry.hasPrefix("*") ? PublicSuffixList.hostMatchesDomain(pageHost, String(entry.dropFirst())) : pageHost == entry
            }
            if let include = trigger["if-domain"] as? [String], !include.contains(where: domainMatches) { continue }
            if let exclude = trigger["unless-domain"] as? [String], exclude.contains(where: domainMatches) { continue }
            switch (rule["action"] as! [String: Any])["type"] as! String {
            case "block": blocked = true
            case "ignore-previous-rules": blocked = false
            default: break
            }
        }
        return blocked
    }
}

final class ShieldTests: XCTestCase {
    func testElAnalizadorCuentaIgualQueEscritorio() throws {
        let data = try Shared.json("test-vectors/shield-match.json")
        let parsed = Filters.parseList(data["list"] as! String)
        let counts = data["counts"] as! [String: Int]
        XCTAssertEqual(parsed.ruleCount, counts["rules"])
        XCTAssertEqual(parsed.ignoredCount, counts["ignored"])
        XCTAssertEqual(parsed.invalidCount, counts["invalid"])
    }

    func testLasReglasDeWebKitBloqueanLasMismasSolicitudes() throws {
        let data = try Shared.json("test-vectors/shield-match.json")
        let result = ContentBlocker.convert(Filters.parseList(data["list"] as! String).filters)
        XCTAssertEqual(result.skippedFilters, 0, "todos los filtros de los vectores se pueden expresar en WebKit")
        let requests = data["requests"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(requests.count, 20)
        var failures: [String] = []
        for request in requests {
            let url = request["url"] as! String
            let type = ResourceType(rawValue: request["type"] as! String)!
            let page = request["pageUrl"] as! String
            let blocked = WebKitRuleEvaluator.blocks(result.rules, url: url, type: type, pageURL: page, suffixes: Shared.suffixes)
            if blocked != request["blocked"] as! Bool { failures.append("\(type.rawValue) \(url) en \(page): se esperaba \(request["blocked"]!)") }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testLaListaBasicaSeConvierteEntera() throws {
        let parsed = Filters.parseList(try Shared.text("shield-basic.txt"))
        XCTAssertGreaterThan(parsed.ruleCount, 50)
        XCTAssertEqual(parsed.invalidCount, 0)
        let result = ContentBlocker.convert(parsed.filters)
        XCTAssertEqual(result.skippedFilters, 0)
        XCTAssertEqual(result.convertedFilters, parsed.ruleCount)
        XCTAssertEqual(result.overLimitFilters, 0)
        // JSON válido: una regla por filtro y, al final, la que deja pasar la página principal.
        let decoded = try JSONSerialization.jsonObject(with: Data(result.json.utf8)) as! [[String: Any]]
        XCTAssertEqual(decoded.count, result.rules.count)
        XCTAssertEqual(decoded.count, parsed.ruleCount + 1)
        let last = decoded.last!["trigger"] as! [String: Any]
        XCTAssertEqual(last["load-context"] as? [String], ["top-frame"])
        XCTAssertEqual(last["resource-type"] as? [String], ["document"])
        XCTAssertEqual((decoded.last!["action"] as! [String: Any])["type"] as? String, "ignore-previous-rules")
        for rule in decoded {
            let trigger = rule["trigger"] as! [String: Any]
            XCTAssertTrue(ContentBlocker.isWebKitCompatible(trigger["url-filter"] as! String))
        }
    }

    func testLaPaginaPrincipalNuncaSeBloqueaPeroLosMarcosSi() {
        let rules = ContentBlocker.convert(Filters.parseList("||anuncios.com^\n||marcos.com^$subdocument").filters).rules
        let blocks = { (url: String, type: ResourceType) in
            WebKitRuleEvaluator.blocks(rules, url: url, type: type, pageURL: "https://noticias.com/", suffixes: Shared.suffixes)
        }
        XCTAssertFalse(blocks("https://anuncios.com/", .document))
        XCTAssertTrue(blocks("https://anuncios.com/marco.html", .subdocument))
        XCTAssertTrue(blocks("https://anuncios.com/a.js", .script))
        XCTAssertFalse(blocks("https://marcos.com/", .document))
        XCTAssertTrue(blocks("https://marcos.com/", .subdocument))
        XCTAssertFalse(blocks("https://marcos.com/a.js", .script))
    }

    func testSiNoCabeTodoSeQuedanFueraFiltrosCompletosDelFinal() {
        let list = """
        ||propia.com^
        ||uno.com^
        ||dos.com^$domain=a.com|~b.a.com
        ||tres.com^
        @@||uno.com/permitido^
        @@||sitio.com^$document
        /\\s/
        """
        let filters = Filters.parseList(list).filters
        // Sin límite: 4 bloqueos (5 reglas), 2 excepciones y la regla de la página principal.
        let full = ContentBlocker.convert(filters)
        XCTAssertEqual(full.rules.count, 8)
        XCTAssertEqual(full.convertedFilters, 6)
        XCTAssertEqual(full.skippedFilters, 1)
        XCTAssertEqual(full.overLimitFilters, 0)
        // Con 6 reglas: entran las excepciones, la regla final y los dos primeros bloqueos;
        // el tercero ocupa dos reglas y no cabe, así que tampoco entra el cuarto.
        let limited = ContentBlocker.convert(filters, maxRules: 6)
        XCTAssertEqual(limited.rules.count, 5)
        XCTAssertEqual(limited.convertedFilters, 4)
        XCTAssertEqual(limited.skippedFilters, 1)
        XCTAssertEqual(limited.overLimitFilters, 2)
        let blocks = { (url: String) in
            WebKitRuleEvaluator.blocks(limited.rules, url: url, type: .script, pageURL: "https://a.com/", suffixes: Shared.suffixes)
        }
        XCTAssertTrue(blocks("https://propia.com/x.js"))
        XCTAssertTrue(blocks("https://uno.com/x.js"))
        XCTAssertFalse(blocks("https://uno.com/permitido"))
        XCTAssertFalse(blocks("https://tres.com/x.js"))
    }

    func testConversionDePatrones() {
        XCTAssertEqual(ContentBlocker.translatePattern("||ads.com/x^"), "^[a-z][a-z0-9.+-]*://([^/?#]*\\.)?ads\\.com/x([^a-zA-Z0-9_.%-].*)?$")
        XCTAssertEqual(ContentBlocker.translatePattern("|https://a.com/b|"), "^https://a\\.com/b$")
        XCTAssertEqual(ContentBlocker.translatePattern("/banner/*/ad."), "/banner/.*/ad\\.")
        XCTAssertEqual(ContentBlocker.translateRegex("\\/pixel\\?id=\\d+"), "/pixel\\?id=[0-9]+")
        XCTAssertNil(ContentBlocker.translateRegex("a|b"))
        XCTAssertNil(ContentBlocker.translateRegex("x{2}"))
        XCTAssertNil(ContentBlocker.translateRegex("\\sx"))
        XCTAssertNil(ContentBlocker.translatePattern("ñandú"))
        XCTAssertFalse(ContentBlocker.isWebKitCompatible("a|b"))
        XCTAssertTrue(ContentBlocker.isWebKitCompatible("^https?://[^/]+/ads?"))
    }

    func testListasVaciasYHTML() {
        XCTAssertTrue(Filters.looksLikeHTML("  <!DOCTYPE html><html>"))
        XCTAssertFalse(Filters.looksLikeHTML("[Adblock Plus 2.0]\n||a.com^"))
        let empty = ContentBlocker.convert([])
        XCTAssertEqual(empty.rules.count, 1, "WebKit no acepta listas vacías: se usa una regla que nunca coincide")
    }
}
