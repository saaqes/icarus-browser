package io.github.saaqes.icarusbrowser.core

import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Edición de la base con los vectores generados desde escritorio (mobile/shared/test-vectors/address-rebase.json). */
class AddressRebaseTest {
    private val shared = File(System.getProperty("icarus.shared") ?: "../../shared")

    @Test
    fun `edita la base conservando ruta, consulta y fragmento como en escritorio`() {
        val data = JSONObject(File(shared, "test-vectors/address-rebase.json").readText())
        val entries = CustomAddresses.sanitize(data.getJSONArray("customAddresses"))
        val cases = data.getJSONArray("cases")
        assertTrue(cases.length() >= 12, "faltan vectores de la edición de la base")
        val failures = ArrayList<String>()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val shown = case.getString("shown")
            val entry = if (case.isNull("entryId")) null else entries.first { it.id == case.getString("entryId") }
            val split = AddressRebase.split(shown, entry)
            if (case.isNull("split")) {
                if (split != null) failures.add("$shown: se esperaba sin base")
                continue
            }
            val expected = case.getJSONObject("split")
            if (split == null) {
                failures.add("$shown: sin base")
                continue
            }
            if (split.base != expected.getString("base") || split.suffix != expected.getString("suffix")) {
                failures.add("$shown: ${split.base} + ${split.suffix} ≠ ${expected.getString("base")} + ${expected.getString("suffix")}")
            }
            val joins = case.getJSONArray("joins")
            for (j in 0 until joins.length()) {
                val join = joins.getJSONObject(j)
                val actual = when (val result = AddressRebase.join(join.getString("base"), split.suffix)) {
                    is AddressRebase.Join.Ok -> "url:${result.url}"
                    is AddressRebase.Join.Failure -> "error:${result.error}"
                }
                val wanted = if (join.isNull("url")) "error:${join.getString("error")}" else "url:${join.getString("url")}"
                if (actual != wanted) failures.add("$shown + «${join.getString("base")}»: $actual ≠ $wanted")
            }
            val edits = case.getJSONArray("edits")
            for (e in 0 until edits.length()) {
                val edit = edits.getJSONObject(e)
                val actual = when (val result = AddressRebase.classify(split, edit.getString("typed"))) {
                    is AddressRebase.Edit.Rebase -> "rebase ${result.base} ${result.url}"
                    AddressRebase.Edit.Navigate -> "navigate"
                }
                val wanted = if (edit.getString("kind") == "rebase") "rebase ${edit.getString("base")} ${edit.getString("url")}" else "navigate"
                if (actual != wanted) failures.add("$shown / «${edit.getString("typed")}»: $actual ≠ $wanted")
            }
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }
}
