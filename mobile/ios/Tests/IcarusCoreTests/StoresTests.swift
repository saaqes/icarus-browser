import Foundation
import XCTest
@testable import IcarusCore

final class StoresTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("icarus-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func defaults() throws -> Data { try Data(contentsOf: Shared.directory.appendingPathComponent("defaults.json")) }

    func testElHistorialAgrupaVisitasYSeConserva() {
        let file = directory.appendingPathComponent("history.json")
        let history = HistoryStore(file: file)
        history.add(url: "https://ejemplo.com/", title: "", now: 1)
        history.add(url: "https://ejemplo.com/", title: "Ejemplo", now: 20)
        history.add(url: "https://otra.com/", title: "Otra", now: 60)
        history.add(url: "icarus://historial", title: "Interna", now: 61)
        XCTAssertEqual(history.list().map(\.url), ["https://otra.com/", "https://ejemplo.com/"])
        XCTAssertEqual(history.list()[1].title, "Ejemplo")
        XCTAssertEqual(history.search("EJEMPLO").count, 1)
        history.flush()
        XCTAssertEqual(HistoryStore(file: file).list(), history.list())
        // Borrar la última hora no toca visitas más antiguas.
        history.clear(.hour, now: 60 + 3600 + 1)
        XCTAssertEqual(history.list().count, 2)
        history.add(url: "https://reciente.com/", title: "R", now: 100_000)
        history.clear(.hour, now: 100_010)
        XCTAssertFalse(history.list().contains { $0.url == "https://reciente.com/" })
        XCTAssertTrue(history.list().contains { $0.url == "https://otra.com/" })
        history.clear(.all)
        XCTAssertTrue(history.list().isEmpty)
    }

    func testElPerfilValidaYGuarda() throws {
        let profile = try Profile(directory: directory, defaultsJSON: defaults())
        XCTAssertEqual(profile.shortcuts.count, 6)
        guard case .ok(let shortcut) = profile.saveShortcut(title: "  Docs ", url: "docs.ejemplo.com") else { return XCTFail() }
        XCTAssertEqual(shortcut.url, "https://docs.ejemplo.com/")
        guard case .errors(let errors, _) = profile.saveShortcut(title: "", url: "javascript:alert(1)") else { return XCTFail() }
        XCTAssertEqual(errors["title"], "required")
        XCTAssertEqual(errors["url"], "unsafe-protocol")
        guard case .errors(let duplicate, _) = profile.saveShortcut(title: "Otra", url: "https://docs.ejemplo.com/") else { return XCTFail() }
        XCTAssertEqual(duplicate["url"], "duplicate-url")
        for index in 0..<Profile.maxShortcuts { _ = profile.saveShortcut(title: "S\(index)", url: "https://s\(index).ejemplo.com/") }
        XCTAssertEqual(profile.shortcuts.count, Profile.maxShortcuts)
        guard case .errors(_, let limit) = profile.saveShortcut(title: "Más", url: "https://mas.com/") else { return XCTFail() }
        XCTAssertTrue(limit)

        profile.updateSettings { $0.theme = .panorama; $0.colorMode = .dark; $0.searchProvider = .duckduckgo; $0.accent = "teal" }
        let input = AliasRules.Input(name: "Correo", matchType: .host, pattern: "mail.google.com", displayName: "Correo", alias: "correo.icarus",
                                     targetUrl: "https://mail.google.com/", enabled: true)
        guard case .ok = profile.saveAliasRule(input) else { return XCTFail() }
        profile.setPermission(origin: "https://reunion.com", .camera, allowed: true)
        profile.saveSession(urls: ["https://a.com/", "javascript:alert(1)", "icarus://nueva-pestana", "https://b.com/"], activeIndex: 2)

        let reopened = try Profile(directory: directory, defaultsJSON: defaults())
        XCTAssertEqual(reopened.settings.theme, .panorama)
        XCTAssertEqual(reopened.settings.colorMode, .dark)
        XCTAssertEqual(reopened.settings.searchProvider, .duckduckgo)
        XCTAssertEqual(reopened.settings.accent, "teal")
        XCTAssertEqual(AliasRules.findMatch("https://mail.google.com/x", reopened.aliasRules)?.rule.alias, "correo.icarus")
        XCTAssertEqual(reopened.permission(origin: "https://reunion.com", .camera), true)
        XCTAssertNil(reopened.permission(origin: "https://reunion.com", .microphone))
        XCTAssertEqual(reopened.session.urls, ["https://a.com/", "icarus://nueva-pestana", "https://b.com/"])
        XCTAssertEqual(reopened.session.activeIndex, 2)
    }

    func testUnArchivoDanadoNoImpideArrancar() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("[]".utf8).write(to: directory.appendingPathComponent("profile.json"))
        try Data("{no es json".utf8).write(to: directory.appendingPathComponent("history.json"))
        XCTAssertEqual(try Profile(directory: directory, defaultsJSON: defaults()).settings.theme, .icarus)
        XCTAssertTrue(HistoryStore(file: directory.appendingPathComponent("history.json")).list().isEmpty)
    }

    func testLasPaletasSalenDelCSSDeEscritorio() throws {
        let themes = try Themes(json: Data(contentsOf: Shared.directory.appendingPathComponent("themes.json")))
        XCTAssertEqual(themes.themes[.essential]?.name, "Esencial")
        XCTAssertEqual(themes.palette(.icarus, dark: false)["accent"], RGBA(hex: "#6D28D9"))
        XCTAssertEqual(themes.palette(.icarus, dark: true, accent: "teal")["accent"], RGBA(hex: "#5FCFCF"))
        for theme in ThemeId.allCases {
            XCTAssertGreaterThan(themes.palette(theme, dark: false)["toolbar-bg"].luminance, 0.4)
            XCTAssertLessThan(themes.palette(theme, dark: true)["toolbar-bg"].luminance, 0.4)
        }
    }

    func testListasDeShieldSinConexionYConDescargas() async throws {
        var responses: [String: FetchResult] = [:]
        let shield = ShieldLists(directory: directory, builtinText: try Shared.text("shield-basic.txt"), suffixes: Shared.suffixes) { url in
            responses[url] ?? .failed(.network)
        }
        await shield.updateLists(onlyStale: true)
        XCTAssertEqual(shield.lists.first { $0.id == "easylist" }?.error, .network)
        let basicOnly = shield.contentBlocker()
        XCTAssertGreaterThan(basicOnly.convertedFilters, 50)

        responses["https://easylist.to/easylist/easylist.txt"] = .ok("[Adblock Plus 2.0]\n||anuncios-de-prueba.com^\n")
        responses["https://easylist.to/easylist/easyprivacy.txt"] = .ok("<!doctype html><html>Inicia sesión</html>")
        await shield.updateLists(onlyStale: false)
        XCTAssertEqual(shield.lists.first { $0.id == "easylist" }?.ruleCount, 1)
        XCTAssertEqual(shield.lists.first { $0.id == "easyprivacy" }?.error, .notAList)
        XCTAssertEqual(shield.contentBlocker().convertedFilters, basicOnly.convertedFilters + 1)

        // Si falla la actualización se conserva la copia anterior.
        responses["https://easylist.to/easylist/easylist.txt"] = nil
        await shield.updateLists(onlyStale: false)
        XCTAssertEqual(shield.lists.first { $0.id == "easylist" }?.error, .network)
        XCTAssertEqual(shield.contentBlocker().convertedFilters, basicOnly.convertedFilters + 1)

        let invalid = await shield.addList(name: "HTTP", url: "http://listas.com/a.txt")
        XCTAssertEqual(invalid, .invalidURL)
        responses["https://listas.com/propia.txt"] = .ok("||propia.com^\n")
        let added = await shield.addList(name: "", url: "https://listas.com/propia.txt")
        XCTAssertNil(added)
        let duplicate = await shield.addList(name: "Otra", url: "https://listas.com/propia.txt")
        XCTAssertEqual(duplicate, .duplicate)
        XCTAssertEqual(shield.lists.last?.name, "listas.com")

        shield.setCustomRules("||regla-personal.net^\n/roto(/\n")
        XCTAssertEqual(shield.customStats.rules, 1)
        XCTAssertEqual(shield.customStats.invalid, 1)

        shield.setSiteAllowed(host: "www.noticias.co.uk", true)
        XCTAssertEqual(shield.exceptions, ["noticias.co.uk"])
        XCTAssertTrue(shield.isSiteAllowed("https://m.noticias.co.uk/portada"))
        shield.setSiteAllowed(host: "noticias.co.uk", false)
        XCTAssertFalse(shield.isSiteAllowed("https://m.noticias.co.uk/portada"))

        // La huella cambia con las reglas propias y las listas, y es estable al reabrir.
        let before = shield.fingerprint
        shield.setCustomRules("||otra-regla.net^\n")
        XCTAssertNotEqual(shield.fingerprint, before)
        shield.setCustomRules("||regla-personal.net^\n/roto(/\n")
        XCTAssertEqual(shield.fingerprint, before)
        shield.setListEnabled(id: "peter-lowe", true)
        XCTAssertNotEqual(shield.fingerprint, before)
        shield.setListEnabled(id: "peter-lowe", false)

        // La configuración se conserva al reabrir.
        let reopened = ShieldLists(directory: directory, builtinText: try Shared.text("shield-basic.txt"), suffixes: Shared.suffixes) { _ in .failed(.network) }
        XCTAssertEqual(reopened.lists.count, 5)
        XCTAssertEqual(reopened.customRules, "||regla-personal.net^\n/roto(/\n")
        XCTAssertEqual(reopened.fingerprint, shield.fingerprint)
    }
}
