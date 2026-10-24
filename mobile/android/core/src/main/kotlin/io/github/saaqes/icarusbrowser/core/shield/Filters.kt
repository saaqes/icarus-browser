package io.github.saaqes.icarusbrowser.core.shield

/**
 * Analizador de filtros de red con la sintaxis de Adblock Plus / EasyList y el
 * formato hosts, igual que electron/shield/filters.ts: admite el subconjunto que
 * puede aplicarse con seguridad al bloquear solicitudes; el resto se ignora.
 */
enum class ResourceType(val id: String) {
    DOCUMENT("document"),
    SUBDOCUMENT("subdocument"),
    STYLESHEET("stylesheet"),
    SCRIPT("script"),
    IMAGE("image"),
    FONT("font"),
    OBJECT("object"),
    XMLHTTPREQUEST("xmlhttprequest"),
    PING("ping"),
    MEDIA("media"),
    WEBSOCKET("websocket"),
    OTHER("other");

    companion object {
        fun fromId(id: String): ResourceType = entries.firstOrNull { it.id == id } ?: OTHER
    }
}

data class DomainConstraint(val include: List<String>, val exclude: List<String>)

class NetworkFilter(val raw: String) {
    var exception = false
    /** Excepción que desactiva el bloqueo en toda la página ($document). */
    var documentException = false
    /** Dominio de un filtro `||dominio^` sencillo (se indexa por host). */
    var hostname: String? = null
    var regex: Regex? = null
    /** Fragmento literal que debe aparecer en la URL (índice). */
    var token: String? = null
    var thirdParty: Boolean? = null
    var types: Set<ResourceType>? = null
    var excludedTypes: Set<ResourceType>? = null
    var domains: DomainConstraint? = null
}

sealed interface ParseOutcome {
    data class Filter(val filter: NetworkFilter) : ParseOutcome
    data object Ignored : ParseOutcome
    data object Invalid : ParseOutcome
    data object Empty : ParseOutcome
}

data class ParsedList(val filters: List<NetworkFilter>, val ruleCount: Int, val ignoredCount: Int, val invalidCount: Int)

object Filters {
    private val TYPE_ALIASES = mapOf(
        "script" to ResourceType.SCRIPT,
        "image" to ResourceType.IMAGE,
        "stylesheet" to ResourceType.STYLESHEET,
        "css" to ResourceType.STYLESHEET,
        "xmlhttprequest" to ResourceType.XMLHTTPREQUEST,
        "xhr" to ResourceType.XMLHTTPREQUEST,
        "subdocument" to ResourceType.SUBDOCUMENT,
        "frame" to ResourceType.SUBDOCUMENT,
        "media" to ResourceType.MEDIA,
        "font" to ResourceType.FONT,
        "object" to ResourceType.OBJECT,
        "ping" to ResourceType.PING,
        "beacon" to ResourceType.PING,
        "websocket" to ResourceType.WEBSOCKET,
        "other" to ResourceType.OTHER,
        "document" to ResourceType.DOCUMENT,
        "doc" to ResourceType.DOCUMENT,
    )

    private val HOSTS_LINE = Regex("^(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|::1?|::)\\s+([^\\s#]+)")
    private val HOSTNAME = Regex("^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$")
    private val HOSTS_SKIP = setOf("localhost", "localhost.localdomain", "local", "broadcasthost", "0.0.0.0", "ip6-localhost", "ip6-loopback")
    private const val SEPARATOR = "(?:[^\\w.%-]|$)"
    private val TOKEN = Regex("[a-z0-9%]{2,}")
    private val TOKEN_CHAR = Regex("[a-z0-9%]")
    /** Fragmentos demasiado frecuentes para servir de índice. */
    private val COMMON_TOKENS = setOf("http", "https", "www", "com", "net", "org", "js", "html", "php", "cdn", "static", "img")
    private val COSMETIC = Regex("#@?[#?$%]#?|#\\+js\\(")
    private val REGEX_WITH_OPTIONS = Regex("/\\$[^/]*$")
    private val OPTION_START = Regex("^~?[a-z0-9_-]+(=|,|$)", RegexOption.IGNORE_CASE)
    private val SIMPLE_HOST = Regex("^\\|\\|([a-z0-9_.-]+)\\^?$", RegexOption.IGNORE_CASE)
    private val REGEX_SPECIAL = setOf('.', '+', '?', '$', '{', '}', '(', ')', '|', '[', ']', '\\')

    /** Convierte el patrón ABP en una expresión regular. */
    private fun patternToRegex(pattern: String, matchCase: Boolean): Regex {
        var source = pattern
        var prefix = ""
        var suffix = ""
        if (source.startsWith("||")) {
            source = source.substring(2)
            prefix = "^[a-z][a-z0-9+.-]*:\\/+(?:[^\\/?#]*\\.)?"
        } else if (source.startsWith("|")) {
            source = source.substring(1)
            prefix = "^"
        }
        if (source.endsWith("|")) {
            source = source.dropLast(1)
            suffix = "$"
        }
        source = source.trimStart('*').trimEnd('*')
        val body = StringBuilder()
        source.forEach { char ->
            when {
                char == '*' -> body.append(".*")
                char == '^' -> body.append(SEPARATOR)
                char in REGEX_SPECIAL -> body.append('\\').append(char)
                else -> body.append(char)
            }
        }
        val options = if (matchCase) emptySet() else setOf(RegexOption.IGNORE_CASE)
        return Regex(prefix + body + suffix, options)
    }

    private fun isTokenChar(char: Char?): Boolean = char != null && TOKEN_CHAR.matches(char.toString())

    /**
     * Elige un fragmento literal completo (delimitado por separadores en el patrón)
     * para indexar el filtro. Si no hay ninguno seguro, el filtro es genérico.
     */
    private fun pickToken(pattern: String): String? {
        val lower = pattern.lowercase()
        var best: String? = null
        for (match in TOKEN.findAll(lower)) {
            val start = match.range.first
            val end = match.range.last + 1
            val before = lower.substring(maxOf(0, start - 2), start)
            val prevChar = lower.getOrNull(start - 1)
            val nextChar = lower.getOrNull(end)
            val startsClean = if (start == 0) false else before.endsWith("||") || (prevChar != '*' && !isTokenChar(prevChar))
            val startAnchored = start == 1 && lower[0] == '|'
            val endsClean = if (end == lower.length) {
                false
            } else {
                nextChar != '*' && (nextChar == '^' || !isTokenChar(nextChar)) && nextChar != '|'
            }
            val endAnchored = end == lower.length - 1 && lower[end] == '|'
            if ((startsClean || startAnchored) && (endsClean || endAnchored) && match.value !in COMMON_TOKENS) {
                if (best == null || match.value.length > best.length) best = match.value
            }
        }
        return best
    }

    private fun parseDomains(value: String): DomainConstraint? {
        val include = ArrayList<String>()
        val exclude = ArrayList<String>()
        for (part in value.split('|')) {
            val domain = part.trim().lowercase()
            if (domain.isEmpty()) continue
            if (domain.startsWith("~")) exclude.add(domain.substring(1)) else include.add(domain)
        }
        val unsupported = { domain: String -> domain.contains('*') || domain.startsWith("/") }
        if (include.any(unsupported) || exclude.any(unsupported)) return null
        return DomainConstraint(include, exclude)
    }

    fun parseFilter(line: String): ParseOutcome {
        val raw = line.trim()
        if (raw.isEmpty()) return ParseOutcome.Empty
        // Comentarios (ABP «!», hosts «#»), cabeceras «[Adblock Plus 2.0]» y filtros cosméticos.
        if (raw.startsWith("!") || raw.startsWith("[") || (raw.startsWith("#") && !raw.startsWith("##"))) return ParseOutcome.Ignored
        if (COSMETIC.containsMatchIn(raw) && !raw.startsWith("/")) return ParseOutcome.Ignored

        HOSTS_LINE.find(raw)?.let { hosts ->
            val host = hosts.groupValues[1].lowercase().removeSuffix(".")
            if (host in HOSTS_SKIP || !HOSTNAME.matches(host)) return ParseOutcome.Ignored
            return ParseOutcome.Filter(NetworkFilter(raw).also { it.hostname = host })
        }

        val filter = NetworkFilter(raw)
        var text = raw
        if (text.startsWith("@@")) {
            filter.exception = true
            text = text.substring(2)
        }

        var options = ""
        if (text.startsWith("/") && REGEX_WITH_OPTIONS.containsMatchIn(text)) {
            val index = text.lastIndexOf("/$")
            options = text.substring(index + 2)
            text = text.substring(0, index + 1)
        } else if (!(text.startsWith("/") && text.endsWith("/") && text.length > 2)) {
            val index = text.lastIndexOf('$')
            // Las opciones empiezan por un nombre (p. ej. «third-party», «csp=…»); su valor puede contener espacios.
            if (index >= 0 && OPTION_START.containsMatchIn(text.substring(index + 1))) {
                options = text.substring(index + 1)
                text = text.substring(0, index)
            }
        }

        var matchCase = false
        if (options.isNotEmpty()) {
            val included = LinkedHashSet<ResourceType>()
            val excluded = LinkedHashSet<ResourceType>()
            for (rawOption in options.split(',')) {
                val option = rawOption.trim().lowercase()
                if (option.isEmpty()) continue
                val separator = option.indexOf('=')
                val name = if (separator >= 0) option.substring(0, separator) else option
                val value = if (separator >= 0) option.substring(separator + 1) else ""
                val negated = name.startsWith("~")
                val key = if (negated) name.substring(1) else name
                when {
                    key == "third-party" || key == "3p" -> filter.thirdParty = !negated
                    key == "first-party" || key == "1p" -> filter.thirdParty = negated
                    key == "domain" || key == "from" -> filter.domains = parseDomains(value) ?: return ParseOutcome.Ignored
                    key == "match-case" -> matchCase = true
                    // «important» no cambia el resultado en ICARUS: las excepciones siguen ganando.
                    key == "important" || key == "all" -> Unit
                    key in TYPE_ALIASES -> (if (negated) excluded else included).add(TYPE_ALIASES.getValue(key))
                    // Opción no admitida (redirect, csp, popup…) o desconocida: se ignora el filtro completo.
                    else -> return ParseOutcome.Ignored
                }
            }
            if (ResourceType.DOCUMENT in included) {
                if (!filter.exception) return ParseOutcome.Ignored
                filter.documentException = true
                included.remove(ResourceType.DOCUMENT)
            }
            if (included.isNotEmpty()) filter.types = included
            if (excluded.isNotEmpty()) filter.excludedTypes = excluded
        }

        val pattern = text.trim()
        if (pattern.isEmpty() || pattern == "*" || pattern == "||" || pattern == "|") {
            // Un filtro sin patrón solo tiene sentido si las opciones lo acotan a dominios.
            if (filter.domains == null || filter.domains!!.include.isEmpty()) return ParseOutcome.Invalid
            filter.regex = Regex(".*")
            return ParseOutcome.Filter(filter)
        }

        if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
            filter.regex = try {
                Regex(pattern.substring(1, pattern.length - 1), if (matchCase) emptySet() else setOf(RegexOption.IGNORE_CASE))
            } catch (_: IllegalArgumentException) {
                return ParseOutcome.Invalid
            }
            return ParseOutcome.Filter(filter)
        }

        val simpleHost = SIMPLE_HOST.find(pattern)
        if (simpleHost != null && HOSTNAME.matches(simpleHost.groupValues[1].lowercase())) {
            filter.hostname = simpleHost.groupValues[1].lowercase()
            return ParseOutcome.Filter(filter)
        }

        if (pattern.any { it.isWhitespace() }) return ParseOutcome.Invalid
        filter.regex = try {
            patternToRegex(pattern, matchCase)
        } catch (_: IllegalArgumentException) {
            return ParseOutcome.Invalid
        }
        filter.token = pickToken(pattern)
        return ParseOutcome.Filter(filter)
    }

    fun parseList(text: String): ParsedList {
        val filters = ArrayList<NetworkFilter>()
        var ignored = 0
        var invalid = 0
        for (line in text.split('\n')) {
            when (val outcome = parseFilter(line.removeSuffix("\r"))) {
                is ParseOutcome.Filter -> filters.add(outcome.filter)
                ParseOutcome.Ignored -> ignored += 1
                ParseOutcome.Invalid -> invalid += 1
                ParseOutcome.Empty -> Unit
            }
        }
        return ParsedList(filters, filters.size, ignored, invalid)
    }

    /** ¿Parece el texto descargado una página HTML en lugar de una lista de filtros? */
    fun looksLikeHtml(text: String): Boolean =
        Regex("^\\s*(<!doctype html|<html|<head|<body)", RegexOption.IGNORE_CASE).containsMatchIn(text.take(512))
}
