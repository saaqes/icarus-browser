package io.github.saaqes.icarusbrowser.core

/**
 * Edición de la base de una dirección conservando ruta, consulta y fragmento
 * (misma lógica que src/services/custom-addresses/rebase.ts, con los vectores de
 * mobile/shared/test-vectors/address-rebase.json).
 *
 * - Base: la dirección personalizada aplicada a la página o, si no hay ninguna, el origen.
 * - Sufijo: lo que identifica la sección actual (`/#inicio`, `/panel/usuarios?id=10`).
 */
object AddressRebase {
    data class Split(val base: String, val suffix: String, val entry: CustomAddress?)

    sealed interface Join {
        data class Ok(val url: String) : Join
        data class Failure(val error: String) : Join
    }

    sealed interface Edit {
        /** Solo cambió la base: el texto sigue terminando en el sufijo de la página. */
        data class Rebase(val base: String, val url: String) : Edit
        /** Cualquier otra cosa: se navega a lo escrito tal cual. */
        data object Navigate : Edit
    }

    private val SCHEME_PREFIX = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

    private fun hashOf(url: WebUrl): String = url.fragment?.takeIf { it.isNotEmpty() }?.let { "#$it" } ?: ""

    /** Divide la dirección que muestra la barra; `entry` es la dirección personalizada aplicada. */
    fun split(displayUrl: String, entry: CustomAddress?): Split? {
        val url = UrlUtils.parseWebUrl(displayUrl) ?: return null
        if (url.hasCredentials) return null
        val location = entry?.let { CustomAddresses.parseLocation(it.address) }
        val rest = location?.let { CustomAddresses.remainderWithin(it, url) }
        if (location != null && rest != null) {
            // En la raíz, la `/` forma parte del sufijo: `/#inicio`, nunca `#inicio`.
            val path = if (location.path.isEmpty() && rest.isEmpty() && (url.search.isNotEmpty() || hashOf(url).isNotEmpty())) "/" else rest
            return Split("${location.protocol}//${location.host}${location.path}", path + url.search + hashOf(url), entry)
        }
        val suffix = url.pathname + url.search + hashOf(url)
        return Split("${url.protocol}//${url.host}", if (suffix == "/") "" else suffix, null)
    }

    /** Une una base nueva (como la escribe el usuario) con el sufijo conservado, sin barras dobles. */
    fun join(baseText: String, suffix: String): Join {
        val base = when (val result = CustomAddresses.normalizeLocationInput(baseText)) {
            is CustomAddresses.LocationResult.Ok -> result.location
            is CustomAddresses.LocationResult.Failure -> return Join.Failure(result.error)
        }
        val tail = when {
            suffix.isEmpty() -> base.path.ifEmpty { "/" }
            suffix.startsWith("/") -> base.path + suffix
            else -> base.path.ifEmpty { "/" } + suffix
        }
        val url = UrlUtils.parseWebUrl("${base.protocol}//${base.host}$tail") ?: return Join.Failure("invalid-url")
        return Join.Ok(url.href)
    }

    /** Distingue editar la base de escribir otra dirección (que nunca hereda la ruta anterior). */
    fun classify(original: Split, typed: String): Edit {
        val text = typed.trim()
        if (original.suffix.isEmpty() || !text.endsWith(original.suffix)) return Edit.Navigate
        val prefix = text.substring(0, text.length - original.suffix.length)
        if (prefix.isEmpty()) return Edit.Navigate
        val base = (CustomAddresses.normalizeLocationInput(prefix) as? CustomAddresses.LocationResult.Ok)?.location ?: return Edit.Navigate
        val current = (CustomAddresses.normalizeLocationInput(original.base) as? CustomAddresses.LocationResult.Ok)?.location
        val ignoreProtocol = !SCHEME_PREFIX.containsMatchIn(prefix)
        if (current != null && current.host == base.host && current.path == base.path && (ignoreProtocol || current.protocol == base.protocol)) return Edit.Navigate
        return when (val joined = join(prefix, original.suffix)) {
            is Join.Ok -> Edit.Rebase(prefix, joined.url)
            is Join.Failure -> Edit.Navigate
        }
    }
}
