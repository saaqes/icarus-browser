package io.github.saaqes.icarusbrowser.core

/**
 * Utilidades de URL equivalentes a src/services/url-resolution/urlUtils.ts de la
 * versión de escritorio. Solo se consideran navegables las URL http(s).
 */
object UrlUtils {
    val WEB_PROTOCOLS = setOf("http:", "https:")

    /** Protocolos que nunca se abren porque pueden ejecutar código o leer datos locales. */
    val DANGEROUS_PROTOCOLS = setOf("javascript:", "data:", "vbscript:", "file:", "blob:")

    private val IPV4 = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    private val IPV6_BRACKETED = Regex("^\\[[0-9a-f:.]+]$", RegexOption.IGNORE_CASE)
    private val DOMAIN = Regex(
        "^(?=.{1,253}$)(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:\\p{L}{2,63}|xn--[a-z0-9-]{1,59})\\.?$",
        setOf(RegexOption.IGNORE_CASE),
    )
    private val PORT = Regex("^\\d{1,5}$")
    private val HOST_WITH_PORT = Regex("^(.*):([^:\\]]*)$")
    private val PROTOCOL = Regex("^([a-z][a-z0-9+.-]*):", RegexOption.IGNORE_CASE)
    private val HOST_WITH_PORT_NOT_SCHEME = Regex("^[^:/]+:\\d+(?:[/?#]|$)")

    fun parseWebUrl(text: String): WebUrl? = WebUrl.parse(text.trim())?.takeIf { it.hostname.isNotEmpty() }

    fun isLoopbackHost(hostname: String): Boolean {
        val host = hostname.lowercase()
        return host == "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host == "[::1]"
    }

    fun isIpLiteral(hostname: String): Boolean = IPV4.matches(hostname) || IPV6_BRACKETED.matches(hostname)

    /** ¿Parece `text` un host con puerto opcional (ej. `ejemplo.com`, `localhost:3000`)? */
    fun looksLikeHost(text: String): Boolean {
        if (text.isEmpty() || text.contains('@')) return false
        var host = text
        val portMatch = HOST_WITH_PORT.find(text)
        if (portMatch != null && !IPV6_BRACKETED.matches(text)) {
            if (!PORT.matches(portMatch.groupValues[2])) return false
            host = portMatch.groupValues[1]
        }
        return host.lowercase() == "localhost" || IPV4.matches(host) || IPV6_BRACKETED.matches(host) || DOMAIN.matches(host)
    }

    fun getProtocol(text: String): String? = PROTOCOL.find(text.trim())?.let { "${it.groupValues[1].lowercase()}:" }

    fun isDangerousProtocol(protocol: String): Boolean = protocol.lowercase() in DANGEROUS_PROTOCOLS

    /** ¿Empieza el texto por «host:puerto» (que no es un protocolo)? */
    fun startsWithHostAndPort(text: String): Boolean = HOST_WITH_PORT_NOT_SCHEME.containsMatchIn(text)

    sealed interface Normalized {
        data class Ok(val url: String, val parsed: WebUrl) : Normalized
        /** `empty`, `unsafe-protocol`, `unsupported-protocol` o `invalid`. */
        data class Failure(val reason: String) : Normalized
    }

    /**
     * Normaliza una URL escrita por el usuario en formularios (accesos directos,
     * página principal). Acepta `ejemplo.com` y lo convierte en
     * `https://ejemplo.com/`. Rechaza protocolos peligrosos.
     */
    fun normalizeUserUrl(text: String): Normalized {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return Normalized.Failure("empty")
        if (trimmed.any { it.isWhitespace() }) return Normalized.Failure("invalid")

        val protocol = getProtocol(trimmed)
        val hasPortInsteadOfScheme = protocol != null && startsWithHostAndPort(trimmed)
        var candidate = trimmed
        if (protocol != null && !hasPortInsteadOfScheme) {
            if (isDangerousProtocol(protocol)) return Normalized.Failure("unsafe-protocol")
            if (protocol !in WEB_PROTOCOLS) return Normalized.Failure("unsupported-protocol")
        } else {
            val hostPart = trimmed.split('/', '?', '#')[0]
            if (!looksLikeHost(hostPart)) return Normalized.Failure("invalid")
            val bareHost = hostPart.replace(Regex(":\\d+$"), "")
            val scheme = if (isLoopbackHost(bareHost) || isIpLiteral(bareHost)) "http" else "https"
            candidate = "$scheme://$trimmed"
        }

        val parsed = parseWebUrl(candidate) ?: return Normalized.Failure("invalid")
        if (parsed.hasCredentials) return Normalized.Failure("invalid")
        return Normalized.Ok(parsed.href, parsed)
    }

    private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    private const val HEX = "0123456789ABCDEF"

    /** Equivalente exacto de `encodeURIComponent` de JavaScript. */
    fun encodeUriComponent(text: String): String {
        val builder = StringBuilder(text.length * 3)
        text.toByteArray(Charsets.UTF_8).forEach { byte ->
            val value = byte.toInt() and 0xFF
            if (value < 0x80 && UNRESERVED.indexOf(value.toChar()) >= 0) {
                builder.append(value.toChar())
            } else {
                builder.append('%').append(HEX[value shr 4]).append(HEX[value and 0xF])
            }
        }
        return builder.toString()
    }
}
