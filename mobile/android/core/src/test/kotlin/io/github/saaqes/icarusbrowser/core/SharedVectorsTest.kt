package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.shield.FilterEngine
import io.github.saaqes.icarusbrowser.core.shield.Filters
import io.github.saaqes.icarusbrowser.core.shield.ResourceType
import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Comprueba el núcleo de Android contra los vectores de mobile/shared, generados
 * desde la versión de escritorio (electron/shared/mobileShared.test.ts).
 */
class SharedVectorsTest {
    private val shared = File(System.getProperty("icarus.shared") ?: "../../shared")

    private fun vectors(name: String) = JSONObject(File(shared, "test-vectors/$name").readText())

    private val suffixes by lazy { PublicSuffixList(File(shared, "public-suffix-rules.txt").readText()) }

    @Test
    fun `la barra de direcciones resuelve igual que en escritorio`() {
        val data = vectors("resolve-input.json")
        val rules = AliasRule.listFromJson(data.getJSONArray("rules"))
        val cases = data.getJSONArray("cases")
        assertTrue(cases.length() >= 40, "faltan vectores de entrada")
        val failures = ArrayList<String>()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val input = case.getString("input")
            val result = InputResolver.resolve(input, SearchProvider.GOOGLE, rules)
            val actual = describe(result)
            val expected = describe(case)
            if (actual != expected) failures.add("«$input»: se esperaba $expected y se obtuvo $actual")
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun `las búsquedas codifican la consulta como encodeURIComponent`() {
        val search = vectors("resolve-input.json").getJSONArray("search")
        assertTrue(search.length() >= 20, "faltan vectores de búsqueda")
        for (index in 0 until search.length()) {
            val case = search.getJSONObject(index)
            val provider = SearchProvider.fromId(case.getString("providerId"))
            assertEquals(case.getString("url"), provider.searchUrl(case.getString("query")), case.getString("query"))
        }
    }

    @Test
    fun `los alias se aplican a las mismas direcciones`() {
        val data = vectors("alias-match.json")
        val rules = AliasRule.listFromJson(data.getJSONArray("rules"))
        val cases = data.getJSONArray("cases")
        assertTrue(cases.length() >= 15, "faltan vectores de alias")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val match = AliasRules.findMatch(case.getString("url"), rules)
            assertEquals(case.optString("ruleId").takeIf { !case.isNull("ruleId") }, match?.rule?.id, case.getString("url"))
            assertEquals(case.optString("realUrl").takeIf { !case.isNull("realUrl") }, match?.realUrl, case.getString("url"))
        }
    }

    @Test
    fun `el dominio registrable coincide con la Public Suffix List de escritorio`() {
        val cases = vectors("registrable-domain.json").getJSONArray("cases")
        assertTrue(cases.length() >= 10, "faltan vectores de dominios")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            assertEquals(case.getString("domain"), suffixes.registrableDomain(case.getString("host")), case.getString("host"))
        }
    }

    @Test
    fun `ICARUS Shield bloquea las mismas solicitudes`() {
        val data = vectors("shield-match.json")
        val parsed = Filters.parseList(data.getString("list"))
        val counts = data.getJSONObject("counts")
        assertEquals(counts.getInt("rules"), parsed.ruleCount, "reglas")
        assertEquals(counts.getInt("ignored"), parsed.ignoredCount, "ignoradas")
        assertEquals(counts.getInt("invalid"), parsed.invalidCount, "no válidas")
        val engine = FilterEngine(parsed.filters, suffixes)
        val requests = data.getJSONArray("requests")
        assertTrue(requests.length() >= 20, "faltan vectores de Shield")
        val failures = ArrayList<String>()
        for (index in 0 until requests.length()) {
            val request = requests.getJSONObject(index)
            val blocked = engine.match(request.getString("url"), ResourceType.fromId(request.getString("type")), request.getString("pageUrl")).blocked
            if (blocked != request.getBoolean("blocked")) failures.add("${request.getString("type")} ${request.getString("url")} en ${request.getString("pageUrl")}: se esperaba ${request.getBoolean("blocked")}")
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun `la lista básica y los valores predeterminados están disponibles`() {
        val basic = Filters.parseList(File(shared, "shield-basic.txt").readText())
        assertTrue(basic.ruleCount > 50)
        assertEquals(0, basic.invalidCount)
        val defaults = JSONObject(File(shared, "defaults.json").readText())
        assertEquals("buscar.icarus", AliasRule.listFromJson(defaults.getJSONArray("aliasRules")).first().alias)
        assertTrue(defaults.getJSONArray("shortcuts").length() >= 4)
        assertTrue(suffixes.ruleCount > 5000)
    }

    private fun describe(result: InputResolution): String = when (result) {
        is InputResolution.Url -> "url ${result.url}"
        is InputResolution.Search -> "search ${result.url}"
        is InputResolution.Alias -> "alias ${result.url} ${result.rule.id}"
        is InputResolution.AliasUnresolved -> "alias-unresolved ${result.alias} ${result.reason}"
        is InputResolution.Internal -> "internal ${result.page.kind}"
        is InputResolution.InternalUnknown -> "internal-unknown"
        is InputResolution.Blocked -> "blocked ${result.protocol} ${result.dangerous}"
        InputResolution.Empty -> "empty"
    }

    private fun describe(case: JSONObject): String = when (val kind = case.getString("kind")) {
        "url", "search" -> "$kind ${case.getString("url")}"
        "alias" -> "alias ${case.getString("url")} ${case.getString("ruleId")}"
        "alias-unresolved" -> "alias-unresolved ${case.getString("alias")} ${case.getString("reason")}"
        "internal" -> "internal ${case.getString("page")}"
        "blocked" -> "blocked ${case.getString("protocol")} ${case.getBoolean("dangerous")}"
        else -> kind
    }
}
