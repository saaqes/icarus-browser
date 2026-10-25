package io.github.saaqes.icarusbrowser.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class CustomAddressesTest {
    private fun entry(id: String, target: String, address: String, enabled: Boolean = true) =
        CustomAddress(id, target, address, enabled, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")

    private val entries = listOf(
        entry("deriv", "https://bot.deriv.me/", "https://miweb.com/"),
        entry("docs", "https://ejemplo.com/docs", "https://docs.miweb.org/"),
    )

    @Test
    fun `acepta direcciones sin sufijos y usa el protocolo del destino`() {
        val ok = assertIs<CustomAddresses.Validation.Ok>(CustomAddresses.validate("bot.deriv.me", "miweb.com", true))
        assertEquals("https://bot.deriv.me/", ok.target)
        assertEquals("https://miweb.com/", ok.address)
        val local = assertIs<CustomAddresses.Validation.Ok>(CustomAddresses.validate("localhost:3000", "miapp.com", true))
        assertEquals("http://miapp.com/", local.address)
    }

    @Test
    fun `nunca presenta una página HTTP como HTTPS`() {
        val errors = assertIs<CustomAddresses.Validation.Errors>(CustomAddresses.validate("http://intranet.ejemplo.com", "https://miweb.com", true)).errors
        assertEquals("protocol-mismatch", errors["address"])
        assertNull(CustomAddresses.displayUrlFor("http://bot.deriv.me/", entries))
    }

    @Test
    fun `ida y vuelta, mostrar y escribir llevan a la misma página`() {
        for (real in listOf("https://bot.deriv.me/a/b?c=1#d", "https://ejemplo.com/docs/x", "https://bot.deriv.me/")) {
            val shown = CustomAddresses.displayUrlFor(real, entries)!!.url
            val typed = UrlUtils.parseWebUrl(shown)!!
            assertEquals(real, CustomAddresses.resolve(typed, entries, explicitProtocol = true)?.url)
        }
    }

    @Test
    fun `una entrada que choca se conserva desactivada`() {
        val (list, disabled) = CustomAddresses.appendResolvingConflicts(entries, entry("copia", "https://otra.com/", "https://miweb.com/"))
        assertEquals(true, disabled)
        assertEquals(false, list.last().enabled)
    }
}
