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
 * Interpreta el texto de la barra de direcciones o del buscador: dirección web,
 * dirección personalizada, búsqueda, página interna o protocolo bloqueado.
 * Equivale a src/services/url-resolution/resolveInput.ts. Las direcciones se
 * aceptan tal como se escriben; solo se añade el protocolo si falta.
 */
object InputResolver {
    fun resolve(text: String, provider: SearchProvider, customAddresses: List<CustomAddress>): InputResolution {
        val value = text.trim()
        if (value.isEmpty()) return InputResolution.Empty

        val search = { InputResolution.Search(provider.searchUrl(value), value, provider) }

        val web = { url: WebUrl, explicitProtocol: Boolean ->
            CustomAddresses.resolve(url, customAddresses, explicitProtocol)
                ?.let { InputResolution.Custom(it.url, it.address, it.entry) } ?: InputResolution.Url(url.href)
        }

        // Con espacios siempre es una búsqueda (p. ej. «cómo funciona javascript: …»).
        if (value.any { it.isWhitespace() }) return search()

        val protocol = UrlUtils.getProtocol(value)
        val isHostWithPort = protocol != null && UrlUtils.startsWithHostAndPort(value)
        if (protocol != null && !isHostWithPort) {
            if (protocol == InternalPage.PROTOCOL) {
                return InternalPage.parse(value)?.let { InputResolution.Internal(it) } ?: InputResolution.InternalUnknown(value)
            }
            if (protocol in UrlUtils.WEB_PROTOCOLS) {
                val url = UrlUtils.parseWebUrl(value)
                if (url != null && !url.hasCredentials) return web(url, true)
                return search()
            }
            return InputResolution.Blocked(protocol, UrlUtils.isDangerousProtocol(protocol))
        }

        return when (val normalized = UrlUtils.normalizeUserUrl(value)) {
            is UrlUtils.Normalized.Ok -> web(normalized.parsed, false)
            is UrlUtils.Normalized.Failure -> search()
        }
    }
}
