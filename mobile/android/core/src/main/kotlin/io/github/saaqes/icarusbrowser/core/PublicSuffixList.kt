package io.github.saaqes.icarusbrowser.core

import java.util.concurrent.ConcurrentHashMap

/**
 * Dominio registrable (eTLD+1) según la Public Suffix List (secciones ICANN y
 * PRIVATE), igual que electron/shield/domains.ts. Las reglas se leen del texto de
 * mobile/shared/public-suffix-rules.txt (una por línea, en ASCII).
 *
 * Es seguro usarla desde varios hilos (WebView consulta Shield en segundo plano).
 */
class PublicSuffixList(rulesText: String) {
    private val exact = HashSet<String>()
    private val wildcard = HashSet<String>()
    private val exception = HashSet<String>()
    private val cache = ConcurrentHashMap<String, String>()

    init {
        rulesText.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("//") }
            .forEach { rule ->
                when {
                    rule.startsWith("!") -> exception.add(rule.substring(1))
                    rule.startsWith("*.") -> wildcard.add(rule.substring(2))
                    else -> exact.add(rule)
                }
            }
    }

    val ruleCount: Int get() = exact.size + wildcard.size + exception.size

    /** Sufijo público de un host en minúsculas y ASCII (p. ej. «co.uk» para «www.bbc.co.uk»). */
    fun publicSuffix(host: String): String {
        val labels = host.split('.')
        for (index in labels.indices) {
            val candidate = labels.subList(index, labels.size).joinToString(".")
            // Una excepción («!www.ck») anula el comodín: el sufijo es lo que queda a su derecha.
            if (candidate in exception) return labels.subList(index + 1, labels.size).joinToString(".")
            if (candidate in exact) return candidate
            if (index + 1 < labels.size && labels.subList(index + 1, labels.size).joinToString(".") in wildcard) return candidate
        }
        // Regla implícita «*»: el último nivel es el sufijo.
        return labels.last()
    }

    fun registrableDomain(hostname: String): String {
        val host = hostname.lowercase().removeSuffix(".")
        if (host.isEmpty() || IPV4.matches(host) || host.contains(':') || host.startsWith("[")) return host
        cache[host]?.let { return it }
        val suffix = publicSuffix(host)
        val domain = if (suffix == host) host else host.split('.').takeLast(suffix.split('.').size + 1).joinToString(".")
        if (cache.size > CACHE_LIMIT) cache.clear()
        cache[host] = domain
        return domain
    }

    fun isThirdParty(requestHost: String, pageHost: String): Boolean {
        if (pageHost.isEmpty()) return false
        return registrableDomain(requestHost) != registrableDomain(pageHost)
    }

    companion object {
        private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
        private const val CACHE_LIMIT = 4000

        /** ¿Es `host` igual a `domain` o un subdominio suyo? */
        fun hostMatchesDomain(host: String, domain: String): Boolean = host == domain || host.endsWith(".$domain")
    }
}
