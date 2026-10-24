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

    data class Alias(val url: String, val rule: AliasRule) : InputResolution {
        override val kind = "alias"
    }

    /** `reason`: `unknown` (no hay regla) o `disabled` (la regla está desactivada). */
    data class AliasUnresolved(val alias: String, val reason: String) : InputResolution {
        override val kind = "alias-unresolved"
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
 * búsqueda, alias de ICARUS, página interna o protocolo bloqueado. Equivale a
 * src/services/url-resolution/resolveInput.ts.
 */
object InputResolver {
    fun resolve(text: String, provider: SearchProvider, rules: List<AliasRule>): InputResolution {
        val value = text.trim()
        if (value.isEmpty()) return InputResolution.Empty

        val search = { InputResolution.Search(provider.searchUrl(value), value, provider) }

        // Con espacios siempre es una búsqueda (p. ej. «cómo funciona javascript: …»).
        if (value.any { it.isWhitespace() }) return search()

        // Alias de ICARUS: solo se convierte en destino si hay una regla activa explícita.
        when (val alias = AliasRules.resolveTyped(value, rules)) {
            is TypedAlias.Resolved -> return InputResolution.Alias(alias.url, alias.rule)
            is TypedAlias.Disabled -> return InputResolution.AliasUnresolved(alias.alias, "disabled")
            is TypedAlias.Unknown -> return InputResolution.AliasUnresolved(alias.alias, "unknown")
            TypedAlias.NotAlias -> Unit
        }

        val protocol = UrlUtils.getProtocol(value)
        val isHostWithPort = protocol != null && UrlUtils.startsWithHostAndPort(value)
        if (protocol != null && !isHostWithPort) {
            if (protocol == InternalPage.PROTOCOL) {
                return InternalPage.parse(value)?.let { InputResolution.Internal(it) } ?: InputResolution.InternalUnknown(value)
            }
            if (protocol in UrlUtils.WEB_PROTOCOLS) {
                val url = UrlUtils.parseWebUrl(value)
                if (url != null && !UrlUtils.isAliasHost(url.hostname) && !url.hasCredentials) return InputResolution.Url(url.href)
                return search()
            }
            return InputResolution.Blocked(protocol, UrlUtils.isDangerousProtocol(protocol))
        }

        return when (val normalized = UrlUtils.normalizeUserUrl(value)) {
            is UrlUtils.Normalized.Ok -> InputResolution.Url(normalized.url)
            is UrlUtils.Normalized.Failure -> search()
        }
    }
}
