package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.store.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.Locale
import java.util.UUID

data class BookmarkFolder(val id: String, val name: String, val createdAt: String)

/** Favorito: se guarda la URL real; la app lo muestra con la dirección personalizada que corresponda. */
data class Bookmark(val id: String, val title: String, val url: String, val folderId: String, val createdAt: String, val updatedAt: String)

data class BookmarksData(val folders: List<BookmarkFolder>, val items: List<Bookmark>)

/**
 * Favoritos con las mismas reglas que escritorio (src/services/bookmarks/bookmarks.ts):
 * sin duplicados (la misma URL real es el mismo favorito; el fragmento cuenta), la
 * carpeta «Favoritos» siempre existe y borrar una carpeta no borra sus favoritos.
 */
class BookmarksStore(file: File, private val onChange: () -> Unit = {}) {
    private val store = JsonFile(file, ::encode, ::decode, ::defaults, delayMs = 500)

    val data: BookmarksData get() = store.get()

    fun find(url: String): Bookmark? = key(url)?.let { key -> data.items.firstOrNull { it.url == key } }

    sealed interface AddResult {
        data class Ok(val bookmark: Bookmark, val created: Boolean) : AddResult
        data class Failure(val error: String) : AddResult
    }

    /** Añade la página; si ya estaba guardada devuelve la existente. */
    fun add(title: String, url: String, folderId: String? = null): AddResult {
        val clean = key(url) ?: return AddResult.Failure("invalid-url")
        find(clean)?.let { return AddResult.Ok(it, created = false) }
        if (data.items.size >= MAX_BOOKMARKS) return AddResult.Failure("limit")
        val now = Instant.now().toString()
        val folder = folderId?.takeIf { id -> data.folders.any { it.id == id } } ?: DEFAULT_FOLDER_ID
        val bookmark = Bookmark(UUID.randomUUID().toString(), cleanTitle(title, clean), clean, folder, now, now)
        store.update { it.copy(items = it.items + bookmark) }
        onChange()
        return AddResult.Ok(bookmark, created = true)
    }

    fun update(id: String, title: String? = null, folderId: String? = null) {
        store.update { current ->
            current.copy(items = current.items.map { item ->
                if (item.id != id) return@map item
                item.copy(
                    title = title?.let { cleanTitle(it, item.url) } ?: item.title,
                    folderId = folderId?.takeIf { id -> current.folders.any { it.id == id } } ?: item.folderId,
                    updatedAt = Instant.now().toString(),
                )
            })
        }
        onChange()
    }

    fun remove(id: String) {
        store.update { it.copy(items = it.items.filter { item -> item.id != id }) }
        onChange()
    }

    /** Crea una carpeta (o reutiliza la del mismo nombre). Null si el nombre no es válido. */
    fun addFolder(name: String): BookmarkFolder? {
        val clean = name.trim()
        if (clean.isEmpty() || clean.length > FOLDER_NAME_MAX) return null
        data.folders.firstOrNull { it.name.lowercase(SPANISH) == clean.lowercase(SPANISH) }?.let { return it }
        if (data.folders.size >= MAX_FOLDERS) return null
        val folder = BookmarkFolder(UUID.randomUUID().toString(), clean, Instant.now().toString())
        store.update { it.copy(folders = it.folders + folder) }
        onChange()
        return folder
    }

    fun renameFolder(id: String, name: String) {
        val clean = name.trim().take(FOLDER_NAME_MAX).ifEmpty { return }
        store.update { it.copy(folders = it.folders.map { folder -> if (folder.id == id) folder.copy(name = clean) else folder }) }
        onChange()
    }

    /** Borra una carpeta propia; sus favoritos pasan a «Favoritos». */
    fun removeFolder(id: String) {
        if (id == DEFAULT_FOLDER_ID) return
        store.update { current ->
            BookmarksData(current.folders.filter { it.id != id }, current.items.map { if (it.folderId == id) it.copy(folderId = DEFAULT_FOLDER_ID) else it })
        }
        onChange()
    }

    fun flush() = store.flush()

    companion object {
        const val DEFAULT_FOLDER_ID = "favoritos"
        const val DEFAULT_FOLDER_NAME = "Favoritos"
        const val MAX_BOOKMARKS = 5000
        const val MAX_FOLDERS = 100
        const val TITLE_MAX = 300
        const val FOLDER_NAME_MAX = 60
        private const val EPOCH = "2026-01-01T00:00:00.000Z"
        private val SPANISH = Locale.forLanguageTag("es-ES")

        fun defaults() = BookmarksData(listOf(BookmarkFolder(DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, EPOCH)), emptyList())

        /** Forma con la que se comparan las URL: http(s) normalizada, sin credenciales. */
        fun key(url: String): String? = UrlUtils.parseWebUrl(url)?.takeIf { !it.hasCredentials }?.href

        private fun cleanTitle(title: String, url: String) = title.trim().ifEmpty { url }.take(TITLE_MAX)

        fun encode(data: BookmarksData): String = JSONObject()
            .put("version", 1)
            .put("folders", JSONArray().also { array -> data.folders.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("createdAt", it.createdAt)) } })
            .put("items", JSONArray().also { array ->
                data.items.forEach {
                    array.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url).put("folderId", it.folderId).put("createdAt", it.createdAt).put("updatedAt", it.updatedAt))
                }
            })
            .toString()

        /** Lee el archivo saneando cada campo, como sanitizeBookmarks en escritorio. */
        fun decode(text: String): BookmarksData {
            val json = JSONObject(text)
            val folders = ArrayList(defaults().folders)
            val folderIds = hashSetOf(DEFAULT_FOLDER_ID)
            json.optJSONArray("folders")?.let { array ->
                for (index in 0 until array.length()) {
                    val raw = array.optJSONObject(index) ?: continue
                    val id = raw.optString("id")
                    val name = raw.optString("name").trim().take(FOLDER_NAME_MAX)
                    if (id.isEmpty() || name.isEmpty()) continue
                    if (id == DEFAULT_FOLDER_ID) {
                        folders[0] = folders[0].copy(name = name)
                        continue
                    }
                    if (!folderIds.add(id) || folders.size >= MAX_FOLDERS) continue
                    folders.add(BookmarkFolder(id, name, raw.optString("createdAt", EPOCH)))
                }
            }
            val items = ArrayList<Bookmark>()
            val ids = HashSet<String>()
            val urls = HashSet<String>()
            json.optJSONArray("items")?.let { array ->
                for (index in 0 until minOf(array.length(), MAX_BOOKMARKS)) {
                    val raw = array.optJSONObject(index) ?: continue
                    val id = raw.optString("id")
                    val url = key(raw.optString("url")) ?: continue
                    if (id.isEmpty() || !ids.add(id) || !urls.add(url)) continue
                    val folder = raw.optString("folderId").takeIf { it in folderIds } ?: DEFAULT_FOLDER_ID
                    items.add(Bookmark(id, cleanTitle(raw.optString("title"), url), url, folder, raw.optString("createdAt", EPOCH), raw.optString("updatedAt", EPOCH)))
                }
            }
            return BookmarksData(folders, items)
        }
    }
}
