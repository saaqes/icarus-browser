import UIKit
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

    /// Las listas reales predeterminadas (si hay Internet): todas caben en una sola lista
    /// de WebKit y WebKit la acepta.
    func testEasyListYEasyPrivacyRealesCompilanEnWebKit() async throws {
        let basic = try String(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "shield-basic.txt", withExtension: nil)), encoding: .utf8)
        var filters = Filters.parseList(basic).filters
        for (name, url) in [("EasyList", "https://easylist.to/easylist/easylist.txt"), ("EasyPrivacy", "https://easylist.to/easylist/easyprivacy.txt")] {
            guard case .ok(let text) = await ShieldLists.httpFetch(url) else {
                throw XCTSkip("No se pudo descargar \(name) desde el simulador.")
            }
            let parsed = Filters.parseList(text)
            let alone = ContentBlocker.convert(parsed.filters)
            print("\(name): \(parsed.ruleCount) filtros de red, \(alone.convertedFilters) convertidos, \(alone.skippedFilters) omitidos, \(alone.rules.count) reglas de WebKit")
            XCTAssertGreaterThan(alone.convertedFilters, parsed.ruleCount * 9 / 10, "casi toda la lista debe poder expresarse en WebKit")
            filters += parsed.filters
        }
        let result = ContentBlocker.convert(filters)
        print("Juntas: \(result.convertedFilters) filtros aplicados, \(result.skippedFilters) omitidos, \(result.overLimitFilters) fuera del límite, \(result.rules.count) reglas de WebKit")
        XCTAssertEqual(result.overLimitFilters, 0, "las listas predeterminadas deben caber en el máximo de reglas de WebKit")
        _ = try await compile(result.json, id: "icarus-prueba-listas-reales")
    }

    /// Una dirección que coincide con un filtro se abre igualmente como página principal
    /// (como en escritorio, Shield solo cancela subrecursos y marcos internos).
    func testLaPaginaPrincipalNoSeBloquea() async throws {
        let withoutRules = try await loadExample(rules: nil)
        guard withoutRules.title == "Example Domain" else {
            throw XCTSkip("example.com no cargó sin reglas en el simulador: \(withoutRules.error ?? "título «\(withoutRules.title ?? "")»")")
        }
        let rules = try await compile(ContentBlocker.convert(Filters.parseList("||example.com^").filters).json, id: "icarus-prueba-principal")
        let withRules = try await loadExample(rules: rules)
        XCTAssertNil(withRules.error)
        XCTAssertEqual(withRules.title, "Example Domain")
    }

    /// Abre example.com como página principal, dentro de una ventana, y espera a que
    /// WebKit termine o informe de un error.
    private func loadExample(rules: WKContentRuleList?) async throws -> (title: String?, error: String?) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if let rules { configuration.userContentController.add(rules) }
        let frame = CGRect(x: 0, y: 0, width: 390, height: 600)
        let webView = WKWebView(frame: frame, configuration: configuration)
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: frame)
        window.frame = frame
        window.addSubview(webView)
        window.isHidden = false
        defer { window.isHidden = true }
        let probe = NavigationProbe()
        webView.navigationDelegate = probe
        webView.load(URLRequest(url: URL(string: "https://example.com/?icarus=\(UUID().uuidString)")!))
        for _ in 0..<180 {
            try await Task.sleep(nanoseconds: 250_000_000)
            if probe.finished { return (webView.title, nil) }
            if let error = probe.error as NSError? { return (webView.title, "\(error.domain) \(error.code): \(error.localizedDescription)") }
        }
        return (webView.title, "WebKit no terminó la carga en 45 s")
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

/// Recoge cómo terminó una navegación de prueba.
@MainActor
private final class NavigationProbe: NSObject, WKNavigationDelegate {
    var finished = false
    var error: Error?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finished = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.error = error
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        self.error = error
    }
}
