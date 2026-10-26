package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.shield.FilterEngine
import io.github.saaqes.icarusbrowser.core.shield.Filters
import io.github.saaqes.icarusbrowser.core.shield.ResourceType
import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
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
        val entries = CustomAddresses.sanitize(data.getJSONArray("customAddresses"))
        assertEquals(data.getJSONArray("customAddresses").length(), entries.size, "entradas de los vectores")
        val cases = data.getJSONArray("cases")
        assertTrue(cases.length() >= 40, "faltan vectores de entrada")
        val failures = ArrayList<String>()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val input = case.getString("input")
            val result = InputResolver.resolve(input, SearchProvider.GOOGLE, entries)
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
    fun `la barra muestra la misma dirección que en escritorio`() {
        val data = vectors("custom-address-display.json")
        val entries = CustomAddresses.sanitize(data.getJSONArray("customAddresses"))
        val cases = data.getJSONArray("cases")
        assertTrue(cases.length() >= 15, "faltan vectores de la dirección visible")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val url = case.getString("url")
            val match = CustomAddresses.displayUrlFor(url, entries)
            val shown = match?.url ?: url
            assertEquals(case.optString("entryId").takeIf { !case.isNull("entryId") }, match?.entry?.id, url)
            assertEquals(case.getString("shown"), shown, url)
            assertEquals(case.getString("short"), CustomAddresses.shortAddress(shown), url)
            assertEquals(case.getString("full"), CustomAddresses.formatAddress(shown, true).toString(), url)
        }
    }

    @Test
    fun `el editor valida y detecta conflictos como en escritorio`() {
        val data = vectors("custom-address-validation.json")
        val entries = CustomAddresses.sanitize(data.getJSONArray("customAddresses"))
        val cases = data.getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val input = case.getJSONObject("input")
            val result = CustomAddresses.validate(
                input.getString("target"),
                input.getString("address"),
                input.getBoolean("enabled"),
                entries,
                case.optString("editingId").takeIf { !case.isNull("editingId") },
                input.optString("sections", ""),
            )
            val label = input.toString()
            if (case.getBoolean("ok")) {
                val value = case.getJSONObject("value")
                val sections = strings(value.optJSONArray("sections"))
                assertEquals(CustomAddresses.Validation.Ok(value.getString("target"), value.getString("address"), value.getBoolean("enabled"), sections), result, label)
            } else {
                val errors = assertIs<CustomAddresses.Validation.Errors>(result, label)
                val expected = case.getJSONObject("errors")
                assertEquals(expected.keys().asSequence().associateWith { expected.getString(it) }, errors.errors, label)
                val conflicts = case.getJSONObject("conflicts")
                assertEquals(conflicts.keys().asSequence().associateWith { conflicts.getString(it) }, errors.conflicts.mapValues { it.value.id }, label)
            }
        }
    }

    @Test
    fun `las reglas de alias antiguas se convierten igual que en escritorio`() {
        val legacy = vectors("custom-address-validation.json").getJSONObject("legacy")
        val rules = legacy.getJSONArray("rules")
        val conversions = legacy.getJSONArray("conversions")
        for (index in 0 until conversions.length()) {
            val conversion = conversions.getJSONObject(index)
            val raw = (0 until rules.length()).map { rules.getJSONObject(it) }.first { it.getString("id") == conversion.getString("id") }
            val expected = conversion.getJSONObject("result")
            val actual = CustomAddresses.convertLegacy(raw)
            when (expected.getString("kind")) {
                "skip" -> assertEquals(CustomAddresses.Legacy.Skip, actual, raw.toString())
                "invalid" -> assertEquals(CustomAddresses.Legacy.Invalid, actual, raw.toString())
                else -> {
                    val input = expected.getJSONObject("input")
                    assertEquals(CustomAddresses.Legacy.Entry(input.getString("target"), input.getString("address"), input.getBoolean("enabled")), actual, raw.toString())
                }
            }
        }
        val loaded = legacy.getJSONArray("loaded")
        val expected = (0 until loaded.length()).map { index ->
            val item = loaded.getJSONObject(index)
            CustomAddress(item.getString("id"), item.getString("target"), item.getString("address"), item.getBoolean("enabled"), item.getString("createdAt"), item.getString("updatedAt"))
        }
        assertEquals(expected, CustomAddresses.sanitize(rules))
    }

    @Test
    fun `las secciones y «Guardar solo para #sección» funcionan como en escritorio`() {
        val data = vectors("custom-address-sections.json")
        val fragments = data.getJSONArray("fragments")
        for (index in 0 until fragments.length()) {
            val case = fragments.getJSONObject(index)
            assertEquals(case.optString("section").takeIf { !case.isNull("section") }, CustomAddresses.sectionOf(case.getString("hash")), case.toString())
        }
        val texts = data.getJSONArray("texts")
        for (index in 0 until texts.length()) {
            val case = texts.getJSONObject(index)
            val expected = if (case.getBoolean("ok")) CustomAddresses.Sections.Ok(strings(case.getJSONArray("sections"))) else CustomAddresses.Sections.Failure(case.getString("error"))
            assertEquals(expected, CustomAddresses.parseSections(case.getString("text")), case.toString())
        }
        var entries = CustomAddresses.sanitize(data.getJSONArray("customAddresses"))
        val saves = data.getJSONArray("saves")
        for (index in 0 until saves.length()) {
            val case = saves.getJSONObject(index)
            val result = CustomAddresses.saveSection(entries, "https://bot.deriv.me/", case.getString("section"), case.getString("base"), case.getString("id"), data.getString("now"))
            if (case.getBoolean("ok")) {
                val saved = assertIs<CustomAddresses.SectionSave.Ok>(result, case.toString())
                assertEquals(case.getString("entryId"), saved.entry.id, case.toString())
                assertEquals(CustomAddresses.sanitize(case.getJSONArray("entries")), saved.entries.filter { it.target == "https://bot.deriv.me/" }, case.toString())
                entries = saved.entries
            } else {
                val failure = assertIs<CustomAddresses.SectionSave.Failure>(result, case.toString())
                val expected = case.getJSONObject("errors")
                assertEquals(expected.keys().asSequence().associateWith { expected.getString(it) }, failure.errors.errors, case.toString())
            }
        }
    }

    private fun strings(array: org.json.JSONArray?): List<String> = if (array == null) emptyList() else (0 until array.length()).map { array.getString(it) }

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
        assertEquals(0, defaults.getJSONArray("customAddresses").length())
        assertTrue(defaults.getJSONArray("shortcuts").length() >= 4)
        assertTrue(suffixes.ruleCount > 5000)
    }

    private fun describe(result: InputResolution): String = when (result) {
        is InputResolution.Url -> "url ${result.url}"
        is InputResolution.Search -> "search ${result.url}"
        is InputResolution.Custom -> "custom ${result.url} ${result.address} ${result.entry.id}"
        is InputResolution.Internal -> "internal ${result.page.kind}"
        is InputResolution.InternalUnknown -> "internal-unknown"
        is InputResolution.Blocked -> "blocked ${result.protocol} ${result.dangerous}"
        InputResolution.Empty -> "empty"
    }

    private fun describe(case: JSONObject): String = when (val kind = case.getString("kind")) {
        "url", "search" -> "$kind ${case.getString("url")}"
        "custom" -> "custom ${case.getString("url")} ${case.getString("address")} ${case.getString("entryId")}"
        "internal" -> "internal ${case.getString("page")}"
        "blocked" -> "blocked ${case.getString("protocol")} ${case.getBoolean("dangerous")}"
        else -> kind
    }
}
