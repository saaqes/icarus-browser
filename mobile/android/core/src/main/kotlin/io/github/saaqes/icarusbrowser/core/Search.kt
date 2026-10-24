package io.github.saaqes.icarusbrowser.core

/** Proveedores de búsqueda (los mismos que en la versión de escritorio). */
enum class SearchProvider(val id: String, val displayName: String, val homeUrl: String, private val searchPrefix: String) {
    GOOGLE("google", "Google", "https://www.google.com/", "https://www.google.com/search?q="),
    BING("bing", "Bing", "https://www.bing.com/", "https://www.bing.com/search?q="),
    DUCKDUCKGO("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/", "https://duckduckgo.com/?q=");

    fun searchUrl(query: String): String = searchPrefix + UrlUtils.encodeUriComponent(query.trim())

    companion object {
        fun fromId(id: String?): SearchProvider = entries.firstOrNull { it.id == id } ?: GOOGLE
    }
}
