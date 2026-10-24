package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.store.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class HistoryItem(val id: String, val url: String, val title: String, val visitedAt: Long)

enum class ClearRange(val id: String, val millis: Long) {
    HOUR("hour", 60L * 60 * 1000),
    DAY("day", 24L * 60 * 60 * 1000),
    WEEK("week", 7L * 24 * 60 * 60 * 1000),
    ALL("all", Long.MAX_VALUE),
}

/**
 * Historial de navegación (solo páginas http/https de nivel superior), con las
 * mismas reglas que electron/main/history.ts: máximo 10 000 entradas y las
 * visitas repetidas a la misma URL en 30 s se agrupan.
 */
class HistoryStore(file: File, private val onChange: () -> Unit = {}) {
    private val store = JsonFile(file, ::encode, ::decode, { emptyList() }, delayMs = 1500)

    /** De la más reciente a la más antigua. */
    fun list(): List<HistoryItem> = store.get()

    fun search(query: String): List<HistoryItem> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return list()
        return list().filter { it.title.lowercase().contains(needle) || it.url.lowercase().contains(needle) }
    }

    fun add(url: String, title: String, now: Long = System.currentTimeMillis()) {
        if (!WEB.containsMatchIn(url)) return
        store.update { items ->
            val latest = items.firstOrNull()
            if (latest != null && latest.url == url && now - latest.visitedAt < MERGE_WINDOW_MS) {
                listOf(latest.copy(title = title.ifEmpty { latest.title }, visitedAt = now)) + items.drop(1)
            } else {
                (listOf(HistoryItem(UUID.randomUUID().toString(), url, title, now)) + items).take(MAX_ITEMS)
            }
        }
        onChange()
    }

    /** El título suele llegar después de la navegación: se actualiza en las entradas recientes. */
    fun updateTitle(url: String, title: String) {
        if (title.isEmpty()) return
        val items = list()
        val index = items.indexOfFirst { it.url == url }
        if (index < 0 || index > 5 || items[index].title == title) return
        store.set(items.mapIndexed { i, item -> if (i == index) item.copy(title = title) else item })
        onChange()
    }

    fun remove(id: String) {
        store.update { items -> items.filter { it.id != id } }
        onChange()
    }

    fun clear(range: ClearRange, now: Long = System.currentTimeMillis()) {
        store.update { items -> if (range == ClearRange.ALL) emptyList() else items.filter { now - it.visitedAt > range.millis } }
        onChange()
    }

    fun flush() = store.flush()

    companion object {
        const val MAX_ITEMS = 10_000
        private const val MERGE_WINDOW_MS = 30_000L
        private val WEB = Regex("^https?://", RegexOption.IGNORE_CASE)

        private fun encode(items: List<HistoryItem>): String {
            val array = JSONArray()
            for (item in items) {
                array.put(JSONObject().put("id", item.id).put("url", item.url).put("title", item.title).put("visitedAt", item.visitedAt))
            }
            return JSONObject().put("version", 1).put("items", array).toString()
        }

        private fun decode(text: String): List<HistoryItem> {
            val array = JSONObject(text).optJSONArray("items") ?: return emptyList()
            val items = ArrayList<HistoryItem>()
            for (index in 0 until minOf(array.length(), MAX_ITEMS)) {
                val item = array.optJSONObject(index) ?: continue
                val url = item.optString("url")
                val id = item.optString("id")
                if (id.isEmpty() || !WEB.containsMatchIn(url) || !item.has("visitedAt")) continue
                items.add(HistoryItem(id, url, item.optString("title"), item.optLong("visitedAt")))
            }
            return items
        }
    }
}
