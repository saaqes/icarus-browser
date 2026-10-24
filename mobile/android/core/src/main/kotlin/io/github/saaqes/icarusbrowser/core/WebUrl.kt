package io.github.saaqes.icarusbrowser.core

import java.net.IDN

/**
 * URL absoluta http(s) analizada como lo hace el estándar URL de WHATWG (el de los
 * navegadores) en los casos que usa ICARUS: protocolo y host en minúsculas, host
 * internacional en punycode, puerto predeterminado omitido, ruta «/» por defecto,
 * segmentos «.» y «..» resueltos y caracteres no ASCII codificados en UTF-8.
 *
 * Es el equivalente de `new URL()` en la versión de escritorio; los vectores de
 * mobile/shared comprueban que ambos producen la misma `href`.
 */
class WebUrl private constructor(
    val scheme: String,
    val username: String,
    val password: String,
    /** Nombre de host en ASCII y minúsculas (las IPv6 van entre corchetes). */
    val hostname: String,
    /** Puerto explícito, o null si no hay o es el predeterminado del protocolo. */
    val port: Int?,
    val pathname: String,
    /** Consulta sin «?», o null si no hay. */
    val query: String?,
    /** Fragmento sin «#», o null si no hay. */
    val fragment: String?,
) {
    val protocol: String get() = "$scheme:"

    /** Host con puerto, como `URL.host`. */
    val host: String get() = if (port == null) hostname else "$hostname:$port"

    /** «?consulta» o vacío, como `URL.search`. */
    val search: String get() = if (query.isNullOrEmpty()) "" else "?$query"

    val hasCredentials: Boolean get() = username.isNotEmpty() || password.isNotEmpty()

    val href: String
        get() {
            val credentials = if (!hasCredentials) "" else username + (if (password.isEmpty()) "" else ":$password") + "@"
            val queryPart = query?.let { "?$it" } ?: ""
            val fragmentPart = fragment?.let { "#$it" } ?: ""
            return "$scheme://$credentials$host$pathname$queryPart$fragmentPart"
        }

    override fun toString(): String = href

    override fun equals(other: Any?): Boolean = other is WebUrl && other.href == href

    override fun hashCode(): Int = href.hashCode()

    companion object {
        private val SCHEME = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):")
        private val FORBIDDEN_HOST_CHARS = setOf(' ', '#', '%', '/', ':', '<', '>', '?', '@', '[', '\\', ']', '^', '|')
        private val FRAGMENT_SET = setOf(' ', '"', '<', '>', '`')
        private val QUERY_SET = setOf(' ', '"', '#', '<', '>', '\'')
        private val PATH_SET = setOf(' ', '"', '#', '<', '>', '?', '`', '{', '}')

        /** Analiza una URL absoluta http(s). Devuelve null para cualquier otro protocolo o si no es válida. */
        fun parse(input: String): WebUrl? {
            // Como el estándar: fuera espacios y controles de los extremos, y tabuladores y saltos de línea internos.
            val text = input.trim { it <= ' ' }.filter { it != '\t' && it != '\n' && it != '\r' }
            val schemeMatch = SCHEME.find(text) ?: return null
            val scheme = schemeMatch.groupValues[1].lowercase()
            if (scheme != "http" && scheme != "https") return null

            val rest = text.substring(schemeMatch.range.last + 1).trimStart('/', '\\')
            val authorityEnd = rest.indexOfFirst { it == '/' || it == '\\' || it == '?' || it == '#' }.let { if (it < 0) rest.length else it }
            val authority = rest.substring(0, authorityEnd)
            var remainder = rest.substring(authorityEnd)

            val at = authority.lastIndexOf('@')
            val userinfo = if (at >= 0) authority.substring(0, at) else ""
            val hostAndPort = if (at >= 0) authority.substring(at + 1) else authority
            val colonInUserinfo = userinfo.indexOf(':')
            val username = if (colonInUserinfo < 0) userinfo else userinfo.substring(0, colonInUserinfo)
            val password = if (colonInUserinfo < 0) "" else userinfo.substring(colonInUserinfo + 1)

            val hostText: String
            val portText: String?
            if (hostAndPort.startsWith("[")) {
                val close = hostAndPort.indexOf(']')
                if (close < 0) return null
                hostText = hostAndPort.substring(0, close + 1)
                val after = hostAndPort.substring(close + 1)
                portText = when {
                    after.isEmpty() -> null
                    after.startsWith(":") -> after.substring(1)
                    else -> return null
                }
            } else {
                val colon = hostAndPort.lastIndexOf(':')
                hostText = if (colon >= 0) hostAndPort.substring(0, colon) else hostAndPort
                portText = if (colon >= 0) hostAndPort.substring(colon + 1) else null
            }

            val hostname = parseHost(hostText) ?: return null
            val port: Int? = when {
                portText.isNullOrEmpty() -> null
                !portText.all { it in '0'..'9' } -> return null
                else -> portText.trimStart('0').ifEmpty { "0" }.toIntOrNull()?.takeIf { it <= 65535 } ?: return null
            }

            var fragment: String? = null
            val hashIndex = remainder.indexOf('#')
            if (hashIndex >= 0) {
                fragment = percentEncode(remainder.substring(hashIndex + 1), FRAGMENT_SET)
                remainder = remainder.substring(0, hashIndex)
            }
            var query: String? = null
            val queryIndex = remainder.indexOf('?')
            if (queryIndex >= 0) {
                query = percentEncode(remainder.substring(queryIndex + 1), QUERY_SET)
                remainder = remainder.substring(0, queryIndex)
            }
            val pathname = normalizePath(remainder.replace('\\', '/'))
            val defaultPort = if (scheme == "http") 80 else 443
            return WebUrl(scheme, username, password, hostname, port?.takeIf { it != defaultPort }, pathname, query, fragment)
        }

        private fun parseHost(input: String): String? {
            if (input.isEmpty()) return null
            if (input.startsWith("[")) {
                if (!input.endsWith("]")) return null
                val inner = input.substring(1, input.length - 1)
                val valid = inner.isNotEmpty() && inner.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' || it == ':' || it == '.' }
                return if (valid) "[${inner.lowercase()}]" else null
            }
            val decoded = percentDecode(input) ?: return null
            val ascii = try {
                IDN.toASCII(decoded, IDN.ALLOW_UNASSIGNED).lowercase()
            } catch (_: IllegalArgumentException) {
                return null
            }
            if (ascii.isEmpty() || ascii.any { it in FORBIDDEN_HOST_CHARS || it.code < 0x20 || it.code >= 0x7F }) return null
            // Si la última etiqueta es numérica, el host debe ser una IPv4 decimal.
            val labels = ascii.removeSuffix(".").split('.')
            val last = labels.last()
            if (last.isNotEmpty() && last.all { it in '0'..'9' }) {
                if (labels.size != 4 || labels.any { it.isEmpty() || it.length > 3 || it.toInt() > 255 }) return null
                return labels.joinToString(".") { it.toInt().toString() }
            }
            return ascii
        }

        private fun normalizePath(raw: String): String {
            if (raw.isEmpty()) return "/"
            val segments = raw.removePrefix("/").split('/')
            val output = ArrayList<String>()
            segments.forEachIndexed { index, segment ->
                val isLast = index == segments.lastIndex
                when (segment.lowercase()) {
                    ".", "%2e" -> if (isLast) output.add("")
                    "..", ".%2e", "%2e.", "%2e%2e" -> {
                        if (output.isNotEmpty()) output.removeAt(output.lastIndex)
                        if (isLast) output.add("")
                    }
                    else -> output.add(percentEncode(segment, PATH_SET))
                }
            }
            return "/" + output.joinToString("/")
        }

        /** Codifica en UTF-8 los caracteres de `set`, los controles y todo lo que no es ASCII. Deja los «%» existentes. */
        internal fun percentEncode(text: String, set: Set<Char>): String {
            val builder = StringBuilder(text.length)
            var index = 0
            while (index < text.length) {
                val codePoint = text.codePointAt(index)
                val length = Character.charCount(codePoint)
                if (codePoint < 0x20 || codePoint > 0x7E || (codePoint < 0x80 && codePoint.toChar() in set)) {
                    String(Character.toChars(codePoint)).toByteArray(Charsets.UTF_8).forEach { byte ->
                        builder.append('%').append(HEX[(byte.toInt() shr 4) and 0xF]).append(HEX[byte.toInt() and 0xF])
                    }
                } else {
                    builder.appendCodePoint(codePoint)
                }
                index += length
            }
            return builder.toString()
        }

        private fun percentDecode(text: String): String? {
            if (!text.contains('%')) return text
            val bytes = java.io.ByteArrayOutputStream()
            var index = 0
            while (index < text.length) {
                val char = text[index]
                // «%» seguido de dos dígitos hexadecimales.
                if (char == '%' && index + 2 < text.length) {
                    val value = text.substring(index + 1, index + 3).toIntOrNull(16)
                    if (value != null) {
                        bytes.write(value)
                        index += 3
                        continue
                    }
                }
                bytes.write(char.toString().toByteArray(Charsets.UTF_8))
                index += 1
            }
            return bytes.toString(Charsets.UTF_8.name())
        }

        private const val HEX = "0123456789ABCDEF"
    }
}
