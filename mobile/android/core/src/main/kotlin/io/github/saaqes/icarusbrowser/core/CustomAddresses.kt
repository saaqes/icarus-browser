package io.github.saaqes.icarusbrowser.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Direcciones personalizadas, equivalentes a src/services/custom-addresses de la
 * versión de escritorio.
 *
 * El usuario asigna a un destino real (`https://bot.deriv.me/`) la dirección que
 * quiere ver en la barra (`https://miweb.com/`). Mientras se navega dentro del
 * destino, la barra muestra la dirección personalizada con la misma ruta,
 * consulta y fragmento; al escribirla, ICARUS navega al destino real. La
 * resolución es interna: WebView siempre carga el sitio real, con su certificado.
 */
data class CustomAddress(
    val id: String,
    /** Destino real: `protocolo://host[:puerto]/ruta-base`, sin consulta ni fragmento. */
    val target: String,
    /** Dirección que muestra la barra, siempre con el protocolo del destino. */
    val address: String,
    val enabled: Boolean,
    val createdAt: String,
    val updatedAt: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("target", target)
        .put("address", address)
        .put("enabled", enabled)
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)

    companion object {
        fun listToJson(entries: List<CustomAddress>): JSONArray = JSONArray().also { array -> entries.forEach { array.put(it.toJson()) } }
    }
}

/** `protocolo://host[:puerto]` más una ruta base sin barra final (vacía = todo el sitio). */
data class Location(val protocol: String, val host: String, val path: String) {
    /** Forma guardada: `https://miweb.com/` o `https://miweb.com/ruta`. */
    fun format(): String = "$protocol//$host${path.ifEmpty { "/" }}"

    val label: String get() = "$host$path"
}

/** Dirección para la barra: protocolo visible (vacío en la forma corta), host y resto. */
data class AddressParts(val prefix: String, val host: String, val rest: String) {
    override fun toString(): String = "$prefix$host$rest"
}

object CustomAddresses {
    const val MAX = 200
    private const val EPOCH = "2026-01-01T00:00:00.000Z"

    sealed interface LocationResult {
        data class Ok(val location: Location) : LocationResult

        /** `required`, `invalid-url`, `unsupported-protocol` o `has-query`. */
        data class Failure(val error: String) : LocationResult
    }

    data class DisplayMatch(val entry: CustomAddress, val url: String)

    /** `url` es el destino real; `address`, lo escrito con el protocolo de la entrada. */
    data class Resolution(val entry: CustomAddress, val url: String, val address: String)

    sealed interface Validation {
        data class Ok(val target: String, val address: String, val enabled: Boolean) : Validation

        /** Errores por campo (`target`, `address`) y la entrada con la que choca cada uno. */
        data class Errors(val errors: Map<String, String>, val conflicts: Map<String, CustomAddress>) : Validation
    }

    sealed interface Legacy {
        data class Entry(val target: String, val address: String, val enabled: Boolean) : Legacy
        data object Skip : Legacy
        data object Invalid : Legacy
    }

    private val TRAILING_SLASHES = Regex("/+$")
    private val HOST_WITH_PORT_THEN_PATH = Regex("^[^:/]+:\\d+(?:/|$)")
    private val PORT_SUFFIX = Regex(":\\d+$")
    private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$")
    private val ALIAS_PREFIX = Regex("^(?:https?|icarus)://")

    /* --------------------------------- Ubicaciones --------------------------------- */

    private fun hashOf(url: WebUrl): String = url.fragment?.takeIf { it.isNotEmpty() }?.let { "#$it" } ?: ""

    private fun fromUrl(url: WebUrl) = Location(url.protocol, url.host, url.pathname.replace(TRAILING_SLASHES, ""))

    /** Lee una ubicación ya guardada (forma canónica). */
    fun parseLocation(text: String): Location? {
        val url = UrlUtils.parseWebUrl(text) ?: return null
        if (url.hasCredentials || url.search.isNotEmpty() || hashOf(url).isNotEmpty()) return null
        return fromUrl(url)
    }

    /**
     * Normaliza lo que escribe el usuario: `miweb.com`, `localhost:3000`,
     * `https://ejemplo.com/ruta`… Sin protocolo se usa `defaultProtocol` (el del
     * destino) o https (http para localhost y direcciones IP).
     */
    fun normalizeLocationInput(text: String, defaultProtocol: String? = null): LocationResult {
        val value = text.trim()
        if (value.isEmpty()) return LocationResult.Failure("required")
        if (value.any { it.isWhitespace() }) return LocationResult.Failure("invalid-url")
        if (value.contains('?') || value.contains('#')) return LocationResult.Failure("has-query")

        val protocol = UrlUtils.getProtocol(value)
        val hostWithPort = protocol != null && HOST_WITH_PORT_THEN_PATH.containsMatchIn(value)
        var candidate = value
        if (protocol != null && !hostWithPort) {
            if (UrlUtils.isDangerousProtocol(protocol) || protocol !in UrlUtils.WEB_PROTOCOLS) return LocationResult.Failure("unsupported-protocol")
        } else {
            val hostPart = value.split('/')[0]
            if (!UrlUtils.looksLikeHost(hostPart)) return LocationResult.Failure("invalid-url")
            val bareHost = hostPart.replace(PORT_SUFFIX, "")
            val fallback = if (UrlUtils.isLoopbackHost(bareHost) || UrlUtils.isIpLiteral(bareHost)) "http:" else "https:"
            candidate = "${defaultProtocol ?: fallback}//$value"
        }
        val url = UrlUtils.parseWebUrl(candidate) ?: return LocationResult.Failure("invalid-url")
        if (url.hasCredentials || !UrlUtils.looksLikeHost(url.host)) return LocationResult.Failure("invalid-url")
        return LocationResult.Ok(fromUrl(url))
    }

    /** Si `url` está dentro de `location`, el resto de la ruta (vacío o con `/` inicial). */
    fun remainderWithin(location: Location, url: WebUrl, anyProtocol: Boolean = false): String? {
        if (!anyProtocol && url.protocol != location.protocol) return null
        if (url.host != location.host || url.hasCredentials) return null
        val pathname = url.pathname
        if (location.path.isEmpty()) return if (pathname == "/") "" else pathname
        if (pathname == location.path) return ""
        return if (pathname.startsWith("${location.path}/")) pathname.substring(location.path.length) else null
    }

    /** La URL equivalente bajo otra ubicación. */
    fun urlWithin(location: Location, rest: String, url: WebUrl): String =
        "${location.protocol}//${location.host}${(location.path + rest).ifEmpty { "/" }}${url.search}${hashOf(url)}"

    /** ¿Comparten alguna dirección? Se ignora el protocolo. */
    fun overlap(a: Location, b: Location): Boolean {
        if (a.host != b.host) return false
        val (shorter, longer) = if (a.path.length <= b.path.length) a.path to b.path else b.path to a.path
        return shorter.isEmpty() || longer == shorter || longer.startsWith("$shorter/")
    }

    /* ----------------------------------- Aplicar ----------------------------------- */

    private class Parsed(val entry: CustomAddress, val target: Location, val address: Location)

    /** Entradas activas y válidas, de la más específica a la menos (en empate, la más antigua). */
    private fun active(entries: List<CustomAddress>): List<Parsed> = entries
        .filter { it.enabled }
        .mapNotNull { entry ->
            val target = parseLocation(entry.target)
            val address = parseLocation(entry.address)
            if (target != null && address != null && target.protocol == address.protocol) Parsed(entry, target, address) else null
        }
        .sortedWith(compareByDescending<Parsed> { it.target.path.length }.thenBy { it.entry.createdAt })

    /** URL real → dirección que muestra la barra (o null si no hay entrada para ella). */
    fun displayUrlFor(href: String, entries: List<CustomAddress>): DisplayMatch? {
        val url = UrlUtils.parseWebUrl(href) ?: return null
        for (item in active(entries)) {
            val rest = remainderWithin(item.target, url) ?: continue
            return DisplayMatch(item.entry, urlWithin(item.address, rest, url))
        }
        return null
    }

    /** URL escrita dentro de una dirección personalizada → URL real del destino. */
    fun resolve(url: WebUrl, entries: List<CustomAddress>, explicitProtocol: Boolean): Resolution? {
        val best = active(entries)
            .mapNotNull { item -> remainderWithin(item.address, url, !explicitProtocol)?.let { item to it } }
            .maxByOrNull { it.first.address.path.length } ?: return null
        val (item, rest) = best
        return Resolution(item.entry, urlWithin(item.target, rest, url), urlWithin(item.address, rest, url))
    }

    /** Entradas activas cuya dirección empieza por lo escrito (para sugerencias). */
    fun startingWith(text: String, entries: List<CustomAddress>): List<CustomAddress> {
        val needle = text.trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.")
        if (needle.isEmpty()) return emptyList()
        return active(entries).filter { it.address.label.startsWith(needle) || it.address.label.removePrefix("www.").startsWith(needle) }.map { it.entry }
    }

    /** Dirección para la barra: forma corta (sin foco, como Chrome) o completa. */
    fun formatAddress(href: String, full: Boolean): AddressParts {
        val url = UrlUtils.parseWebUrl(href) ?: return AddressParts("", href, "")
        val path = url.pathname + url.search + hashOf(url)
        if (full) return AddressParts("${url.protocol}//", url.host, path)
        return AddressParts("", url.host.removePrefix("www."), if (path == "/") "" else path)
    }

    fun shortAddress(href: String): String = formatAddress(href, false).let { it.host + it.rest }

    /* ---------------------------------- Validación ---------------------------------- */

    /** Primera entrada activa (distinta de `exceptId`) que choca con estas ubicaciones. */
    fun findConflicts(target: Location, address: Location, entries: List<CustomAddress>, exceptId: String?): Validation.Errors {
        val errors = LinkedHashMap<String, String>()
        val conflicts = LinkedHashMap<String, CustomAddress>()
        for (other in entries) {
            if (!other.enabled || other.id == exceptId) continue
            val otherTarget = parseLocation(other.target) ?: continue
            val otherAddress = parseLocation(other.address) ?: continue
            if ("target" !in errors) {
                when {
                    overlap(target, otherTarget) -> errors["target"] = "target-in-use"
                    overlap(target, otherAddress) -> errors["target"] = "target-is-address"
                }
                if ("target" in errors) conflicts["target"] = other
            }
            if ("address" !in errors) {
                when {
                    overlap(address, otherAddress) -> errors["address"] = "address-in-use"
                    overlap(address, otherTarget) -> errors["address"] = "address-is-target"
                }
                if ("address" in errors) conflicts["address"] = other
            }
        }
        return Validation.Errors(errors, conflicts)
    }

    /**
     * Valida como la versión de escritorio: la dirección usa el protocolo del destino,
     * no puede estar dentro de su propio destino y, si está activa, ningún destino ni
     * dirección se solapa con los de otra entrada activa.
     */
    fun validate(targetText: String, addressText: String, enabled: Boolean, entries: List<CustomAddress> = emptyList(), editingId: String? = null): Validation {
        val errors = LinkedHashMap<String, String>()
        val target = normalizeLocationInput(targetText)
        if (target is LocationResult.Failure) errors["target"] = target.error
        val address = normalizeLocationInput(addressText, (target as? LocationResult.Ok)?.location?.protocol)
        if (address is LocationResult.Failure) {
            errors["address"] = address.error
        } else if (target is LocationResult.Ok && address is LocationResult.Ok) {
            if (address.location.protocol != target.location.protocol) errors["address"] = "protocol-mismatch"
            else if (overlap(address.location, target.location)) errors["address"] = "same-as-target"
        }
        var conflicts: Map<String, CustomAddress> = emptyMap()
        if (target is LocationResult.Ok && address is LocationResult.Ok && errors.isEmpty() && enabled) {
            val found = findConflicts(target.location, address.location, entries, editingId)
            errors.putAll(found.errors)
            conflicts = found.conflicts
        }
        if (target !is LocationResult.Ok || address !is LocationResult.Ok || errors.isNotEmpty()) return Validation.Errors(errors, conflicts)
        return Validation.Ok(target.location.format(), address.location.format(), enabled)
    }

    /* ---------------------------- Carga y reglas antiguas ---------------------------- */

    /** Reglas de ejemplo de versiones anteriores: si nadie las tocó, no se migran. */
    private val LEGACY_DEFAULTS = mapOf(
        "default-search" to ("buscar.icarus" to "https://www.google.com/"),
        "default-wiki" to ("wiki.icarus" to "es.wikipedia.org"),
    )

    /** Convierte una regla de alias antigua: el patrón pasa a ser el destino y el alias, la dirección. */
    fun convertLegacy(raw: JSONObject): Legacy {
        val pattern = raw.opt("pattern") as? String ?: return Legacy.Invalid
        val alias = raw.opt("alias") as? String ?: return Legacy.Invalid
        val legacyDefault = (raw.opt("id") as? String)?.let { LEGACY_DEFAULTS[it] }
        if (legacyDefault != null && legacyDefault.first == alias && legacyDefault.second == pattern) return Legacy.Skip

        val target: String? = when (raw.opt("matchType")) {
            "host" -> {
                val host = pattern.trim().lowercase().removePrefix("*.")
                val destination = (raw.opt("targetUrl") as? String)?.let { UrlUtils.parseWebUrl(it) }
                val protocol = if (destination != null && destination.hostname == host) destination.protocol else "https:"
                "$protocol//$host/"
            }
            "exact", "prefix" -> UrlUtils.parseWebUrl(pattern)?.let { "${it.protocol}//${it.host}${it.pathname}" }
            else -> null
        }
        val location = target?.let { parseLocation(it) }
        val name = alias.trim().lowercase().replace(ALIAS_PREFIX, "").replace(TRAILING_SLASHES, "")
        if (location == null || name.isEmpty()) return Legacy.Invalid
        return Legacy.Entry(location.format(), "${location.protocol}//$name", raw.opt("enabled") == true)
    }

    private fun isoDate(value: Any?, fallback: String): String = if (value is String && ISO_DATE.matches(value)) value else fallback

    /** Lee una entrada (nueva o antigua). Null si no es válida; `Skip` para las de ejemplo antiguas. */
    private fun readEntry(raw: JSONObject?, fallbackDate: String): Any? {
        val id = raw?.opt("id") as? String
        if (raw == null || id.isNullOrBlank()) return null
        val input: Legacy.Entry = if (raw.has("alias") || raw.has("matchType")) {
            when (val legacy = convertLegacy(raw)) {
                is Legacy.Entry -> legacy
                Legacy.Skip -> return Legacy.Skip
                Legacy.Invalid -> return null
            }
        } else {
            val target = raw.opt("target") as? String ?: return null
            val address = raw.opt("address") as? String ?: return null
            Legacy.Entry(target, address, raw.opt("enabled") == true)
        }
        val result = validate(input.target, input.address, false) as? Validation.Ok ?: return null
        return CustomAddress(
            id = id.trim().take(100),
            target = result.target,
            address = result.address,
            enabled = input.enabled,
            createdAt = isoDate(raw.opt("createdAt"), fallbackDate),
            updatedAt = isoDate(raw.opt("updatedAt"), fallbackDate),
        )
    }

    /** Añade una entrada; si choca con otra activa, se guarda desactivada (nunca se pierde). */
    fun appendResolvingConflicts(entries: List<CustomAddress>, entry: CustomAddress): Pair<List<CustomAddress>, Boolean> {
        if (entry.enabled) {
            val target = parseLocation(entry.target)
            val address = parseLocation(entry.address)
            if (target != null && address != null && findConflicts(target, address, entries, entry.id).errors.isNotEmpty()) {
                return (entries + entry.copy(enabled = false)) to true
            }
        }
        return (entries + entry) to false
    }

    /** Lista guardada (o reglas de alias de versiones anteriores) → entradas válidas. */
    fun sanitize(array: JSONArray?): List<CustomAddress> {
        if (array == null) return emptyList()
        val seen = HashSet<String>()
        val pairs = HashSet<String>()
        var entries = emptyList<CustomAddress>()
        for (index in 0 until minOf(array.length(), MAX)) {
            val read = readEntry(array.optJSONObject(index), EPOCH) as? CustomAddress ?: continue
            if (read.id in seen) continue
            // Reglas antiguas idénticas (p. ej. una por fragmento) quedan en una sola entrada.
            if (!pairs.add("${read.target} ${read.address}")) continue
            seen.add(read.id)
            entries = appendResolvingConflicts(entries, read).first
        }
        return entries
    }
}
