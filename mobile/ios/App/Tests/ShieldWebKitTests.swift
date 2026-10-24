import WebKit
import XCTest
@testable import ICARUS

/// Pruebas en el simulador con WebKit real: las reglas de ICARUS Shield compilan y
/// cancelan solicitudes de verdad.
@MainActor
final class ShieldWebKitTests: XCTestCase {
    /// Filtros que usan todas las opciones que convierte ICARUS.
    private let extraFilters = """
    ||ads.ejemplo.com^
    /banner/*/ad.$image
    ||tracker.net^$script,third-party
    @@||tracker.net/permitido.js^
    ||cdn.ejemplo.com^$domain=noticias.com|~deportes.noticias.com
    @@||sinbloqueo.com^$document
    /\\/pixel\\?id=\\d+/
    0.0.0.0 hosts-bloqueado.com
    -publicidad-$~image
    ||ejemplo.com/anuncio.js|
    ||sensible.com/Ruta$match-case
    ||marcos.com^$subdocument
    """

    private func compile(_ json: String, id: String) async throws -> WKContentRuleList {
        let list = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: id, encodedContentRuleList: json)
        return try XCTUnwrap(list)
    }

    func testLasReglasDeShieldCompilanEnWebKit() async throws {
        let basic = try String(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "shield-basic.txt", withExtension: nil)), encoding: .utf8)
        let filters = Filters.parseList(basic).filters + Filters.parseList(extraFilters).filters
        let result = ContentBlocker.convert(filters)
        XCTAssertEqual(result.skippedFilters, 0)
        _ = try await compile(result.json, id: "icarus-prueba-compilacion")
    }

    /// Carga una página con un rastreador y una imagen de control; devuelve qué cargó.
    private func loadProbe(rules: WKContentRuleList?) async throws -> [String: String] {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if let rules { configuration.userContentController.add(rules) }
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 600), configuration: configuration)
        let html = """
        <html><body><script>
        var pending = 2, result = {};
        function done(key, value) { result[key] = value; if (--pending === 0) { document.title = JSON.stringify(result); } }
        </script>
        <img src="https://www.google-analytics.com/__utm.gif?icarus=\(UUID().uuidString)" onload="done('tracker','load')" onerror="done('tracker','error')">
        <img src="https://www.google.com/favicon.ico?icarus=\(UUID().uuidString)" onload="done('control','load')" onerror="done('control','error')">
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://icarus-prueba.example/"))
        for _ in 0..<120 {
            try await Task.sleep(nanoseconds: 250_000_000)
            if let title = webView.title, title.hasPrefix("{"),
               let decoded = try? JSONSerialization.jsonObject(with: Data(title.utf8)) as? [String: String] {
                return decoded
            }
        }
        throw XCTSkip("La página de prueba no terminó de cargar (¿sin Internet en el simulador?).")
    }

    func testWebKitCancelaUnRastreadorReal() async throws {
        let rules = try await compile(AppServices.shared.shield.contentBlocker().json, id: "icarus-prueba-bloqueo")
        let withShield = try await loadProbe(rules: rules)
        guard withShield["control"] == "load" else { throw XCTSkip("Sin Internet en el simulador: no se puede comprobar el bloqueo real.") }
        XCTAssertEqual(withShield["tracker"], "error", "Shield debe cancelar la solicitud a google-analytics.com")

        // Sin las reglas, la misma solicitud sí llega al servidor.
        let withoutShield = try await loadProbe(rules: nil)
        if withoutShield["tracker"] != "load" { throw XCTSkip("google-analytics.com no responde desde el simulador.") }
    }

    /// EasyList real (si hay Internet): la conversión debe ser aceptada por WebKit.
    func testEasyListRealCompilaEnWebKit() async throws {
        guard case .ok(let text) = await ShieldLists.httpFetch("https://easylist.to/easylist/easylist.txt") else {
            throw XCTSkip("No se pudo descargar EasyList desde el simulador.")
        }
        let parsed = Filters.parseList(text)
        let result = ContentBlocker.convert(parsed.filters)
        print("EasyList: \(parsed.ruleCount) filtros de red, \(result.convertedFilters) convertidos, \(result.skippedFilters) omitidos, \(result.rules.count) reglas de WebKit")
        XCTAssertGreaterThan(result.convertedFilters, parsed.ruleCount * 8 / 10, "la mayoría de EasyList debe poder expresarse en WebKit")
        _ = try await compile(result.json, id: "icarus-prueba-easylist")
    }

    func testLaBarraMuestraAliasYResuelveComoEnEscritorio() {
        let rules = AppServices.shared.profile.aliasRules
        guard case .alias(let url, _) = InputResolver.resolve("buscar.icarus", provider: .google, rules: rules) else {
            return XCTFail("buscar.icarus debe abrir la regla predeterminada")
        }
        XCTAssertEqual(url, "https://www.google.com/")
        XCTAssertEqual(AddressFormat.display("https://www.google.com/").text, "buscar.icarus")
        XCTAssertEqual(AddressFormat.display("https://es.wikipedia.org/wiki/Ícaro").text, "es.wikipedia.org/wiki/%C3%8Dcaro")
    }
}
