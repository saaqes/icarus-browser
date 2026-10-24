package io.github.saaqes.icarusbrowser.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class AliasValidationTest {
    private fun input(
        pattern: String = "https://www.google.com/",
        alias: String = "buscar.icarus",
        target: String = "https://www.google.com/",
        matchType: AliasMatchType = AliasMatchType.EXACT,
        enabled: Boolean = true,
    ) = AliasRules.Input("Búsqueda", matchType, pattern, "Buscar", alias, target, enabled)

    @Test
    fun `normaliza una regla válida`() {
        val result = AliasRules.validate(input(pattern = "WWW.GOOGLE.COM", alias = " https://Buscar.Icarus/ "), emptyList())
        val value = assertIs<AliasRules.Validation.Ok>(result).value
        assertEquals("https://www.google.com/", value.pattern)
        assertEquals("buscar.icarus", value.alias)
    }

    @Test
    fun `rechaza alias que no terminan en icarus y destinos que son alias`() {
        val errors = assertIs<AliasRules.Validation.Errors>(AliasRules.validate(input(alias = "buscar.com", target = "otro.icarus"), emptyList())).errors
        assertEquals("alias-format", errors["alias"])
        assertEquals("target-is-alias", errors["targetUrl"])
    }

    @Test
    fun `no permite pasar de HTTPS a HTTP salvo hacia localhost`() {
        val insecure = AliasRules.validate(input(target = "http://ejemplo.com/"), emptyList())
        assertEquals("insecure-target", assertIs<AliasRules.Validation.Errors>(insecure).errors["targetUrl"])
        assertIs<AliasRules.Validation.Ok>(AliasRules.validate(input(target = "http://localhost:3000/"), emptyList()))
    }

    @Test
    fun `detecta alias duplicados entre reglas activas`() {
        val existing = AliasRule("otra", "Otra", AliasMatchType.EXACT, "https://bing.com/", "Bing", "buscar.icarus", "https://bing.com/", true, "2026-01-01", "2026-01-01")
        val errors = assertIs<AliasRules.Validation.Errors>(AliasRules.validate(input(), listOf(existing))).errors
        assertEquals("alias-duplicate", errors["alias"])
        assertIs<AliasRules.Validation.Ok>(AliasRules.validate(input(), listOf(existing), editingId = "otra"))
    }

    @Test
    fun `valida patrones de host con comodín`() {
        val ok = AliasRules.validate(input(pattern = "*.Ejemplo.org", matchType = AliasMatchType.HOST, target = "https://ejemplo.org/", alias = "org.icarus"), emptyList())
        assertEquals("*.ejemplo.org", assertIs<AliasRules.Validation.Ok>(ok).value.pattern)
        val bad = AliasRules.validate(input(pattern = "ejemplo.org/ruta", matchType = AliasMatchType.HOST), emptyList())
        assertEquals("invalid-host", assertIs<AliasRules.Validation.Errors>(bad).errors["pattern"])
    }
}
