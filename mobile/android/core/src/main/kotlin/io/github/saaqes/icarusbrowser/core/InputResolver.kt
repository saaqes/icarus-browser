package io.github.saaqes.icarusbrowser.core

/** Resultado de interpretar el texto de la barra de direcciones. */
sealed interface InputResolution {
    /** Nombre del caso, igual que `kind` en la versión de escritorio. */
    val kind: String

    data object Empty : InputResolution {
        override val kind = "empty"
    }

    data class Url(val url: String) : InputResolution {
        override val kind = "url"
    }

    data class Search(val url: String, val query: String, val provider: SearchProvider) : InputResolution {
        override val kind = "search"
    }

    /** Dirección personalizada: `address` es lo escrito y `url`, el destino real. */
    data class Custom(val url: String, val address: String, val entry: CustomAddress) : InputResolution {
        override val kind = "custom"
    }

    data class Internal(val page: InternalPage) : InputResolution {
        override val kind = "internal"
    }

    data class InternalUnknown(val text: String) : InputResolution {
        override val kind = "internal-unknown"
    }

    data class Blocked(val protocol: String, val dangerous: Boolean) : InputResolution {
        override val kind = "blocked"
    }
}

/**
 * Interpreta el texto de la barra de direcciones: dirección web, dirección
 * personalizada, página interna o protocolo bloqueado. Equivale a
 * src/services/url-resolution/resolveInput.ts.
 *
 * ICARUS no tiene buscador general: lo que no es una dirección válida ni un alias se
 * intenta como dominio (se añade `https://`) y el motor muestra su error real si no
 * existe; nunca se convierte en una búsqueda.
 */
object InputResolver {
    private val SCHEME = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

    fun resolve(text: String, provider: SearchProvider, customAddresses: List<CustomAddress>): InputResolution {
        val value = text.trim()
        if (value.isEmpty()) return InputResolution.Empty

        val web = { url: WebUrl, explicitProtocol: Boolean ->
            CustomAddresses.resolve(url, customAddresses, explicitProtocol)
                ?.let { InputResolution.Custom(it.url, it.address, it.entry) } ?: InputResolution.Url(url.href)
        }

        // Sin buscador: lo que no es dirección se intenta como dominio (error real del motor).
        val asDomain = {
            val candidate = if (SCHEME.containsMatchIn(value)) value else "https://$value"
            val parsed = UrlUtils.parseWebUrl(candidate)
            InputResolution.Url(parsed?.href ?: "https://${UrlUtils.encodeUriComponent(value)}/")
        }

        val protocol = UrlUtils.getProtocol(value)
        val isHostWithPort = protocol != null && UrlUtils.startsWithHostAndPort(value)
        if (!value.any { it.isWhitespace() } && protocol != null && !isHostWithPort) {
            if (protocol == InternalPage.PROTOCOL) {
                return InternalPage.parse(value)?.let { InputResolution.Internal(it) } ?: InputResolution.InternalUnknown(value)
            }
            if (protocol in UrlUtils.WEB_PROTOCOLS) {
                val url = UrlUtils.parseWebUrl(value)
                if (url != null && !url.hasCredentials) return web(url, true)
                return asDomain()
            }
            return InputResolution.Blocked(protocol, UrlUtils.isDangerousProtocol(protocol))
        }

        return when (val normalized = UrlUtils.normalizeUserUrl(value)) {
            is UrlUtils.Normalized.Ok -> web(normalized.parsed, false)
            is UrlUtils.Normalized.Failure -> asDomain()
        }
    }
}
