package io.github.saaqes.icarusbrowser.core

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StoresTest {
    private val shared = File(System.getProperty("icarus.shared") ?: "../../shared")
    private val dir: File = Files.createTempDirectory("icarus-stores").toFile()
    private val defaults = File(shared, "defaults.json").readText()

    @AfterTest
    fun cleanUp() {
        dir.deleteRecursively()
    }

    @Test
    fun `el historial agrupa visitas repetidas y se conserva al reabrir`() {
        val history = HistoryStore(File(dir, "history.json"))
        history.add("https://ejemplo.com/", "", now = 1_000)
        history.add("https://ejemplo.com/", "Ejemplo", now = 20_000)
        history.add("https://otra.com/", "Otra", now = 60_000)
        history.add("icarus://historial", "Interna", now = 61_000)
        assertEquals(listOf("https://otra.com/", "https://ejemplo.com/"), history.list().map { it.url })
        assertEquals("Ejemplo", history.list()[1].title)
        assertEquals(1, history.search("EJEMPLO").size)
        history.flush()
        val reopened = HistoryStore(File(dir, "history.json"))
        assertEquals(history.list(), reopened.list())
    }

    @Test
    fun `borrar el historial por intervalo conserva lo antiguo`() {
        val history = HistoryStore(File(dir, "history.json"))
        val now = 10L * 24 * 60 * 60 * 1000
        history.add("https://antigua.com/", "Antigua", now = now - 2L * 24 * 60 * 60 * 1000)
        history.add("https://reciente.com/", "Reciente", now = now - 60_000)
        history.clear(ClearRange.HOUR, now = now)
        assertEquals(listOf("https://antigua.com/"), history.list().map { it.url })
        history.clear(ClearRange.ALL, now = now)
        assertTrue(history.list().isEmpty())
    }

    @Test
    fun `un archivo dañado no impide arrancar`() {
        File(dir, "history.json").writeText("{no es json")
        File(dir, "profile.json").writeText("[]")
        assertTrue(HistoryStore(File(dir, "history.json")).list().isEmpty())
        val profile = Profile(dir, defaults)
        assertEquals(6, profile.shortcuts.size)
        assertEquals(ThemeId.ICARUS, profile.settings.theme)
    }

    @Test
    fun `los accesos directos se validan como en escritorio`() {
        val profile = Profile(dir, defaults)
        val ok = assertIs<Profile.ShortcutResult.Ok>(profile.saveShortcut("  Docs ", "docs.ejemplo.com"))
        assertEquals("https://docs.ejemplo.com/", ok.shortcut.url)
        assertEquals("Docs", ok.shortcut.title)
        val errors = assertIs<Profile.ShortcutResult.Errors>(profile.saveShortcut("", "javascript:alert(1)")).errors
        assertEquals("required", errors["title"])
        assertEquals("unsafe-protocol", errors["url"])
        assertEquals("duplicate-url", assertIs<Profile.ShortcutResult.Errors>(profile.saveShortcut("Otra", "https://docs.ejemplo.com/")).errors["url"])
        // `.icarus` ya no está reservado: es una dirección más.
        assertEquals("https://buscar.icarus/", assertIs<Profile.ShortcutResult.Ok>(profile.saveShortcut("Antes alias", "buscar.icarus")).shortcut.url)
        repeat(Profile.MAX_SHORTCUTS) { profile.saveShortcut("S$it", "https://s$it.ejemplo.com/") }
        assertEquals(Profile.MAX_SHORTCUTS, profile.shortcuts.size)
        assertTrue(assertIs<Profile.ShortcutResult.Errors>(profile.saveShortcut("Una más", "https://mas.com/")).limit)
    }

    @Test
    fun `preferencias, direcciones personalizadas, permisos y sesión se guardan`() {
        val profile = Profile(dir, defaults)
        profile.updateSettings { it.copy(theme = ThemeId.PANORAMA, colorMode = ColorMode.DARK, searchProvider = SearchProvider.DUCKDUCKGO, accent = "teal") }
        profile.updateSettings { it.copy(showFullUrls = true) }
        assertIs<CustomAddresses.Validation.Ok>(profile.saveCustomAddress("bot.deriv.me", "miweb.com", true))
        // No sobrescribe otra entrada: devuelve el conflicto.
        val conflict = assertIs<CustomAddresses.Validation.Errors>(profile.saveCustomAddress("otro.com", "miweb.com", true))
        assertEquals("address-in-use", conflict.errors["address"])
        profile.setPermission("https://mapas.com", SitePermission.LOCATION, true)
        profile.setPermission("https://mapas.com", SitePermission.CAMERA, false)
        profile.saveSession(listOf("https://a.com/", "javascript:alert(1)", "icarus://nueva-pestana", "https://b.com/"), 2)
        profile.flush()

        val reopened = Profile(dir, defaults)
        assertEquals(ThemeId.PANORAMA, reopened.settings.theme)
        assertEquals(ColorMode.DARK, reopened.settings.colorMode)
        assertEquals(SearchProvider.DUCKDUCKGO, reopened.settings.searchProvider)
        assertEquals("teal", reopened.settings.accent)
        assertTrue(reopened.settings.showFullUrls)
        assertEquals(listOf("https://miweb.com/"), reopened.customAddresses.map { it.address })
        assertEquals("https://miweb.com/x?y=1", CustomAddresses.displayUrlFor("https://bot.deriv.me/x?y=1", reopened.customAddresses)?.url)
        assertEquals(true, reopened.permission("https://mapas.com", SitePermission.LOCATION))
        assertEquals(false, reopened.permission("https://mapas.com", SitePermission.CAMERA))
        assertNull(reopened.permission("https://mapas.com", SitePermission.MICROPHONE))
        assertEquals(listOf("https://a.com/", "icarus://nueva-pestana", "https://b.com/"), reopened.session.urls)
        assertEquals(2, reopened.session.activeIndex)

        reopened.forgetPermissions("https://mapas.com")
        assertTrue(reopened.sitePermissions().isEmpty())
    }

    @Test
    fun `las paletas salen del CSS de escritorio`() {
        val themes = Themes(File(shared, "themes.json").readText())
        assertEquals("Esencial", themes.themes.getValue(ThemeId.ESSENTIAL).name)
        assertEquals(Themes.parseColor("#6D28D9"), themes.palette(ThemeId.ICARUS, dark = false).accent)
        assertEquals(Themes.parseColor("#5FCFCF"), themes.palette(ThemeId.ICARUS, dark = true, accent = "teal").accent)
        assertEquals(0x1A0F141E, Themes.parseColor("#0F141E1A"))
        for (theme in ThemeId.entries) {
            for (dark in listOf(false, true)) {
                val palette = themes.palette(theme, dark)
                val light = Themes.luminance(palette.toolbarBg) > 0.4
                assertEquals(!dark, light, "$theme dark=$dark")
            }
        }
    }

    @Test
    fun `convierte las reglas de alias guardadas por versiones anteriores`() {
        File(dir, "profile.json").writeText(
            """{"version":1,"aliasRules":[
              {"id":"default-search","matchType":"exact","pattern":"https://www.google.com/","alias":"buscar.icarus","targetUrl":"https://www.google.com/","enabled":true},
              {"id":"mia","matchType":"host","pattern":"bot.deriv.me","alias":"bot.icarus","targetUrl":"https://bot.deriv.me/","enabled":true,"createdAt":"2026-02-01T00:00:00.000Z","updatedAt":"2026-02-02T00:00:00.000Z"}
            ]}""".trimIndent(),
        )
        val profile = Profile(dir, defaults)
        assertEquals(listOf(CustomAddress("mia", "https://bot.deriv.me/", "https://bot.icarus/", true, "2026-02-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z")), profile.customAddresses)
        assertEquals(null, profile.setCustomAddressEnabled("mia", false))
        profile.removeCustomAddress("mia")
        assertTrue(profile.customAddresses.isEmpty())
    }
}
