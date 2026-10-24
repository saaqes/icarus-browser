package io.github.saaqes.icarusbrowser.core.shield

import io.github.saaqes.icarusbrowser.core.PublicSuffixList
import io.github.saaqes.icarusbrowser.core.WebUrl

/**
 * Motor de coincidencia de ICARUS Shield, igual que electron/shield/engine.ts:
 * - Los filtros `||dominio^` se indexan por nombre de host.
 * - El resto se indexa por un fragmento literal («token»); solo se evalúan los
 *   filtros cuyos tokens aparecen en la URL, más un pequeño grupo genérico.
 * - Las excepciones (@@) siempre prevalecen sobre los bloqueos.
 * - Las solicitudes de documento principal nunca se bloquean.
 *
 * Es inmutable después de construirlo: se puede consultar desde varios hilos.
 */
class FilterEngine(filters: List<NetworkFilter>, private val suffixes: PublicSuffixList) {
    data class Result(val blocked: Boolean, val filter: NetworkFilter?)

    private class Bucket {
        val byHost = HashMap<String, MutableList<NetworkFilter>>()
        val byToken = HashMap<String, MutableList<NetworkFilter>>()
        val generic = ArrayList<NetworkFilter>()
    }

    private val block = Bucket()
    private val allow = Bucket()
    private val documentExceptions = ArrayList<NetworkFilter>()
    val size: Int = filters.size

    init {
        for (filter in filters) {
            if (filter.documentException) {
                documentExceptions.add(filter)
                continue
            }
            val bucket = if (filter.exception) allow else block
            val hostname = filter.hostname
            val token = filter.token
            when {
                hostname != null -> bucket.byHost.getOrPut(hostname) { ArrayList() }.add(filter)
                token != null -> bucket.byToken.getOrPut(token) { ArrayList() }.add(filter)
                else -> bucket.generic.add(filter)
            }
        }
    }

    /** ¿Desactiva alguna excepción $document el bloqueo en esta página? */
    fun isPageAllowed(pageUrl: String): Boolean {
        val pageHost = hostOf(pageUrl)
        return documentExceptions.any { filterMatches(it, pageUrl, pageHost, ResourceType.DOCUMENT, pageHost, false) }
    }

    fun match(url: String, type: ResourceType, pageUrl: String): Result {
        val requestHost = hostOf(url)
        if (requestHost.isEmpty() || type == ResourceType.DOCUMENT) return NOT_BLOCKED
        val pageHost = hostOf(pageUrl)
        val thirdParty = suffixes.isThirdParty(requestHost, pageHost)
        val tokens = TOKEN.findAll(url.lowercase()).map { it.value }.toSet()
        val blocker = find(block, url, type, requestHost, pageHost, thirdParty, tokens) ?: return NOT_BLOCKED
        val exception = find(allow, url, type, requestHost, pageHost, thirdParty, tokens)
        if (exception != null || (pageUrl.isNotEmpty() && isPageAllowed(pageUrl))) return Result(false, exception)
        return Result(true, blocker)
    }

    private fun find(
        bucket: Bucket,
        url: String,
        type: ResourceType,
        requestHost: String,
        pageHost: String,
        thirdParty: Boolean,
        tokens: Set<String>,
    ): NetworkFilter? {
        val labels = requestHost.split('.')
        for (index in 0 until labels.size - 1) {
            val host = labels.subList(index, labels.size).joinToString(".")
            bucket.byHost[host]?.firstOrNull { filterMatches(it, url, requestHost, type, pageHost, thirdParty) }?.let { return it }
        }
        for (token in tokens) {
            bucket.byToken[token]?.firstOrNull { filterMatches(it, url, requestHost, type, pageHost, thirdParty) }?.let { return it }
        }
        return bucket.generic.firstOrNull { filterMatches(it, url, requestHost, type, pageHost, thirdParty) }
    }

    private fun filterMatches(
        filter: NetworkFilter,
        url: String,
        requestHost: String,
        type: ResourceType,
        pageHost: String,
        thirdParty: Boolean,
    ): Boolean {
        val types = filter.types
        if (types != null && type !in types && !filter.documentException) return false
        if (filter.excludedTypes?.contains(type) == true) return false
        if (filter.thirdParty != null && filter.thirdParty != thirdParty) return false
        filter.domains?.let { (include, exclude) ->
            if (include.isNotEmpty() && include.none { PublicSuffixList.hostMatchesDomain(pageHost, it) }) return false
            if (exclude.any { PublicSuffixList.hostMatchesDomain(pageHost, it) }) return false
        }
        filter.hostname?.let { return PublicSuffixList.hostMatchesDomain(requestHost, it) }
        return filter.regex?.containsMatchIn(url) ?: false
    }

    companion object {
        private val NOT_BLOCKED = Result(false, null)
        private val TOKEN = Regex("[a-z0-9%]{2,}")
        private val ANY_URL_HOST = Regex("^[a-z][a-z0-9+.-]*://(?:[^/?#@]*@)?(\\[[^\\]/]*]|[^:/?#]*)", RegexOption.IGNORE_CASE)

        /** Nombre de host en minúsculas de cualquier URL con autoridad (http, https, ws…), o vacío. */
        fun hostOf(url: String): String =
            WebUrl.parse(url)?.hostname ?: ANY_URL_HOST.find(url)?.groupValues?.get(1)?.lowercase().orEmpty()
    }
}
