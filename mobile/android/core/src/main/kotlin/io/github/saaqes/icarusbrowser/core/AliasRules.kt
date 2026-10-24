package io.github.saaqes.icarusbrowser.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Reglas de «Cambiar nombre de URL», equivalentes a src/services/alias-rules de la
 * versión de escritorio. Un alias es solo una etiqueta de presentación: nunca
 * sustituye el origen real del documento ni toca DNS o certificados.
 */
enum class AliasMatchType(val id: String) {
    EXACT("exact"),
    PREFIX("prefix"),
    HOST("host");

    companion object {
        fun fromId(id: String?): AliasMatchType = entries.firstOrNull { it.id == id } ?: EXACT
    }
}

data class AliasRule(
    val id: String,
    val name: String,
    val matchType: AliasMatchType,
    /** URL canónica (exact/prefix) o nombre de host, admite `*.dominio` (host). */
    val pattern: String,
    val displayName: String,
    /** Siempre termina en `.icarus`. */
    val alias: String,
    val targetUrl: String,
    val enabled: Boolean,
    val createdAt: String,
    val updatedAt: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put("matchType", matchType.id)
        .put("pattern", pattern)
        .put("displayName", displayName)
        .put("alias", alias)
        .put("targetUrl", targetUrl)
        .put("enabled", enabled)
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)

    companion object {
        fun fromJson(json: JSONObject): AliasRule = AliasRule(
            id = json.optString("id"),
            name = json.optString("name"),
            matchType = AliasMatchType.fromId(json.optString("matchType")),
            pattern = json.optString("pattern"),
            displayName = json.optString("displayName"),
            alias = json.optString("alias"),
            targetUrl = json.optString("targetUrl"),
            enabled = json.optBoolean("enabled", true),
            createdAt = json.optString("createdAt"),
            updatedAt = json.optString("updatedAt"),
        )

        fun listFromJson(array: JSONArray): List<AliasRule> =
            (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(::fromJson) }

        fun listToJson(rules: List<AliasRule>): JSONArray = JSONArray().also { array -> rules.forEach { array.put(it.toJson()) } }
    }
}

data class AliasMatch(val rule: AliasRule, val realUrl: String)

data class HostPattern(val wildcard: Boolean, val host: String) {
    override fun toString(): String = (if (wildcard) "*." else "") + host
}

sealed interface TypedAlias {
    data object NotAlias : TypedAlias
    data class Resolved(val rule: AliasRule, val url: String) : TypedAlias
    data class Disabled(val alias: String, val rule: AliasRule) : TypedAlias
    data class Unknown(val alias: String) : TypedAlias
}

object AliasRules {
    const val RULE_NAME_MAX = 60
    const val DISPLAY_NAME_MAX = 60
    const val ALIAS_MAX = 80

    private const val LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    /** `nombre.icarus`, `a.b.icarus` o `nombre.icarus/ruta`. */
    private val ALIAS_PATTERN = Regex("^(?:$LABEL\\.)+icarus(?:/[a-z0-9._~\\-/]*)?$")
    private val ALIAS_PREFIX = Regex("^(?:https?|icarus)://")
    private val TRAILING_SLASHES = Regex("/+$")

    /** Forma canónica de una URL para comparar: protocolo + host + ruta + consulta. */
    fun canonicalUrl(url: WebUrl): String = "${url.protocol}//${url.host}${url.pathname}${url.search}"

    fun normalizeAliasText(text: String): String =
        text.trim().lowercase().replace(ALIAS_PREFIX, "").replace(TRAILING_SLASHES, "")

    fun isAliasText(text: String): Boolean {
        val value = normalizeAliasText(text)
        return value.isNotEmpty() && value.length <= ALIAS_MAX && ALIAS_PATTERN.matches(value)
    }

    /** Valida y normaliza un patrón de host (`www.ejemplo.com` o `*.ejemplo.com`). */
    fun normalizeHostPattern(text: String): HostPattern? {
        var value = text.trim().lowercase().removeSuffix(".")
        val wildcard = value.startsWith("*.")
        if (wildcard) value = value.substring(2)
        if (value.isEmpty() || value.contains('/') || value.contains(':') || !UrlUtils.looksLikeHost(value)) return null
        val parsed = UrlUtils.parseWebUrl("https://$value/") ?: return null
        return HostPattern(wildcard, parsed.hostname)
    }

    fun ruleMatchesUrl(rule: AliasRule, url: WebUrl): Boolean = when (rule.matchType) {
        AliasMatchType.EXACT -> canonicalUrl(url) == rule.pattern
        AliasMatchType.PREFIX -> {
            val value = canonicalUrl(url)
            val prefix = rule.pattern
            when {
                value == prefix -> true
                !value.startsWith(prefix) -> false
                prefix.endsWith("/") -> true
                else -> value[prefix.length] == '/' || value[prefix.length] == '?'
            }
        }
        AliasMatchType.HOST -> {
            val pattern = normalizeHostPattern(rule.pattern)
            if (pattern == null) {
                false
            } else {
                val hostname = url.hostname.lowercase()
                hostname == pattern.host || (pattern.wildcard && hostname.endsWith(".${pattern.host}"))
            }
        }
    }

    /** Cuanto más específica, mayor: exacta > prefijo (más largo) > host concreto > host comodín. */
    fun rulePriority(rule: AliasRule): Int {
        val length = rule.pattern.length
        return when (rule.matchType) {
            AliasMatchType.EXACT -> 4_000_000 + length
            AliasMatchType.PREFIX -> 3_000_000 + length
            AliasMatchType.HOST -> (if (rule.pattern.startsWith("*.")) 1_000_000 else 2_000_000) + length
        }
    }

    /** Orden de aplicación: la primera gana. En empate gana la regla más antigua. */
    val ORDER: Comparator<AliasRule> = Comparator { a, b ->
        val byPriority = rulePriority(b) - rulePriority(a)
        when {
            byPriority != 0 -> byPriority
            a.createdAt != b.createdAt -> a.createdAt.compareTo(b.createdAt)
            else -> a.id.compareTo(b.id)
        }
    }

    /** URL real → regla que se muestra (o null). No redirige. */
    fun findMatch(href: String, rules: List<AliasRule>): AliasMatch? {
        val url = UrlUtils.parseWebUrl(href) ?: return null
        if (UrlUtils.isAliasHost(url.hostname)) return null
        val winner = rules.filter { it.enabled && ruleMatchesUrl(it, url) }.sortedWith(ORDER).firstOrNull() ?: return null
        return AliasMatch(winner, canonicalUrl(url))
    }

    /** Alias escrito → URL de destino de una regla activa (un único paso: no hay cadenas ni ciclos). */
    fun resolveTyped(text: String, rules: List<AliasRule>): TypedAlias {
        if (!isAliasText(text)) return TypedAlias.NotAlias
        val alias = normalizeAliasText(text)
        val candidates = rules.filter { it.alias == alias }
        val active = candidates.filter { it.enabled }.sortedWith(ORDER).firstOrNull()
        if (active != null) {
            val target = UrlUtils.parseWebUrl(active.targetUrl)
            // Defensa adicional ante datos manipulados: el destino debe ser una URL web real.
            return if (target != null && !UrlUtils.isAliasHost(target.hostname)) TypedAlias.Resolved(active, target.href) else TypedAlias.Unknown(alias)
        }
        return candidates.firstOrNull()?.let { TypedAlias.Disabled(alias, it) } ?: TypedAlias.Unknown(alias)
    }

    data class Input(
        val name: String,
        val matchType: AliasMatchType,
        val pattern: String,
        val displayName: String,
        val alias: String,
        val targetUrl: String,
        val enabled: Boolean,
    )

    /** Resultado de validar: los valores normalizados o un código de error por campo. */
    sealed interface Validation {
        data class Ok(val value: Input) : Validation
        data class Errors(val errors: Map<String, String>) : Validation
    }

    /**
     * Valida una regla como la versión de escritorio. Códigos: required, too-long,
     * invalid-url, unsafe-protocol, invalid-host, alias-format, alias-duplicate,
     * pattern-is-alias, target-is-alias, insecure-target.
     */
    fun validate(input: Input, otherRules: List<AliasRule>, editingId: String? = null): Validation {
        val errors = LinkedHashMap<String, String>()
        val name = input.name.trim()
        textError(name, RULE_NAME_MAX)?.let { errors["name"] = it }
        val displayName = input.displayName.trim()
        textError(displayName, DISPLAY_NAME_MAX)?.let { errors["displayName"] = it }

        var pattern = input.pattern.trim()
        var patternProtocol: String? = null
        if (input.matchType == AliasMatchType.HOST) {
            val hostPattern = normalizeHostPattern(pattern)
            when {
                pattern.isEmpty() -> errors["pattern"] = "required"
                hostPattern == null -> errors["pattern"] = "invalid-host"
                UrlUtils.isAliasHost(hostPattern.host) -> errors["pattern"] = "pattern-is-alias"
                else -> pattern = hostPattern.toString()
            }
        } else {
            when (val result = UrlUtils.normalizeUserUrl(pattern)) {
                is UrlUtils.Normalized.Failure -> errors["pattern"] = urlError(result.reason)
                is UrlUtils.Normalized.Ok -> {
                    pattern = canonicalUrl(result.parsed)
                    patternProtocol = result.parsed.protocol
                }
            }
        }

        val alias = normalizeAliasText(input.alias)
        when {
            alias.isEmpty() -> errors["alias"] = "required"
            alias.length > ALIAS_MAX -> errors["alias"] = "too-long"
            !ALIAS_PATTERN.matches(alias) -> errors["alias"] = "alias-format"
            input.enabled && otherRules.any { it.enabled && it.id != editingId && it.alias == alias } -> errors["alias"] = "alias-duplicate"
        }

        var targetUrl = input.targetUrl.trim()
        when (val target = UrlUtils.normalizeUserUrl(targetUrl)) {
            is UrlUtils.Normalized.Failure -> errors["targetUrl"] = if (target.reason == "alias") "target-is-alias" else urlError(target.reason)
            is UrlUtils.Normalized.Ok -> {
                if (UrlUtils.isAliasHost(target.parsed.hostname)) {
                    errors["targetUrl"] = "target-is-alias"
                } else {
                    targetUrl = target.url
                    // Una regla nunca puede llevar de HTTPS a HTTP salvo hacia localhost.
                    val insecure = target.parsed.protocol == "http:"
                    if (insecure && patternProtocol != "http:" && !UrlUtils.isLoopbackHost(target.parsed.hostname)) {
                        errors["targetUrl"] = "insecure-target"
                    }
                }
            }
        }

        if (errors.isNotEmpty()) return Validation.Errors(errors)
        return Validation.Ok(Input(name, input.matchType, pattern, displayName, alias, targetUrl, input.enabled))
    }

    private fun textError(value: String, max: Int): String? = when {
        value.isEmpty() -> "required"
        value.length > max -> "too-long"
        else -> null
    }

    private fun urlError(reason: String): String = when (reason) {
        "empty" -> "required"
        "unsafe-protocol", "unsupported-protocol" -> "unsafe-protocol"
        "alias" -> "pattern-is-alias"
        else -> "invalid-url"
    }
}
