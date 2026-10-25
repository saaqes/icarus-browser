package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.store.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

enum class ThemeId(val id: String) {
    ESSENTIAL("google-inspired"),
    PANORAMA("edge-inspired"),
    ICARUS("icarus");

    companion object {
        fun fromId(id: String?): ThemeId = entries.firstOrNull { it.id == id } ?: ICARUS
    }
}

enum class ColorMode(val id: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    companion object {
        fun fromId(id: String?): ColorMode = entries.firstOrNull { it.id == id } ?: SYSTEM
    }
}

data class Settings(
    val theme: ThemeId = ThemeId.ICARUS,
    val colorMode: ColorMode = ColorMode.SYSTEM,
    /** `default` (el del estilo) o un id de mobile/shared/themes.json → accents. */
    val accent: String = "default",
    val searchProvider: SearchProvider = SearchProvider.GOOGLE,
    val saveHistory: Boolean = true,
    val restoreSession: Boolean = true,
    val showShortcuts: Boolean = true,
    /** «Mostrar siempre las URL completas»: sin ella, la barra oculta https:// y www. como Chrome. */
    val showFullUrls: Boolean = false,
)

data class Shortcut(val id: String, val title: String, val url: String)

/** Pestañas abiertas al cerrar la app, para restaurarlas. */
data class SavedSession(val urls: List<String>, val activeIndex: Int)

enum class SitePermission(val id: String) {
    LOCATION("geolocation"),
    CAMERA("camera"),
    MICROPHONE("microphone");

    companion object {
        fun fromId(id: String?): SitePermission? = entries.firstOrNull { it.id == id }
    }
}

/**
 * Datos del usuario en el dispositivo (preferencias, accesos directos, direcciones
 * personalizadas, decisiones de permisos y sesión). Se guardan en `profile.json` dentro de
 * `dir`; el historial y ICARUS Shield usan sus propios archivos.
 */
class Profile(dir: File, defaultsJson: String, private val onChange: () -> Unit = {}) {
    private data class Data(
        val settings: Settings,
        val shortcuts: List<Shortcut>,
        val customAddresses: List<CustomAddress>,
        /** origen (https://ejemplo.com) → permiso → permitido. */
        val permissions: Map<String, Map<SitePermission, Boolean>>,
        val session: SavedSession,
    )

    private val defaults = JSONObject(defaultsJson)
    private val store = JsonFile(File(dir, "profile.json"), ::encode, ::decode, ::initial, delayMs = 500)

    val settings: Settings get() = store.get().settings
    val shortcuts: List<Shortcut> get() = store.get().shortcuts
    val customAddresses: List<CustomAddress> get() = store.get().customAddresses
    val session: SavedSession get() = store.get().session

    fun updateSettings(transform: (Settings) -> Settings) = change { it.copy(settings = transform(it.settings)) }

    /* ------------------------------ Accesos directos ------------------------------ */

    sealed interface ShortcutResult {
        data class Ok(val shortcut: Shortcut) : ShortcutResult
        /** Códigos por campo como en escritorio: required, too-long, invalid-url, unsafe-protocol, duplicate-url. */
        data class Errors(val errors: Map<String, String>, val limit: Boolean = false) : ShortcutResult
    }

    fun saveShortcut(title: String, url: String, editingId: String? = null): ShortcutResult {
        val current = shortcuts
        if (editingId == null && current.size >= MAX_SHORTCUTS) return ShortcutResult.Errors(emptyMap(), limit = true)
        val errors = LinkedHashMap<String, String>()
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty()) errors["title"] = "required" else if (cleanTitle.length > SHORTCUT_TITLE_MAX) errors["title"] = "too-long"
        var cleanUrl = ""
        when (val normalized = UrlUtils.normalizeUserUrl(url)) {
            is UrlUtils.Normalized.Ok -> {
                cleanUrl = normalized.url
                if (current.any { it.id != editingId && it.url == cleanUrl }) errors["url"] = "duplicate-url"
            }
            is UrlUtils.Normalized.Failure -> errors["url"] = when (normalized.reason) {
                "empty" -> "required"
                "invalid" -> "invalid-url"
                else -> "unsafe-protocol"
            }
        }
        if (errors.isNotEmpty()) return ShortcutResult.Errors(errors)
        val shortcut = Shortcut(editingId ?: UUID.randomUUID().toString(), cleanTitle, cleanUrl)
        change { data ->
            val list = if (editingId == null) data.shortcuts + shortcut else data.shortcuts.map { if (it.id == editingId) shortcut else it }
            data.copy(shortcuts = list)
        }
        return ShortcutResult.Ok(shortcut)
    }

    fun removeShortcut(id: String) = change { it.copy(shortcuts = it.shortcuts.filter { shortcut -> shortcut.id != id }) }

    fun resetShortcuts() = change { it.copy(shortcuts = defaultShortcuts()) }

    /* ------------------------- Direcciones personalizadas ------------------------- */

    /** Crea o edita una entrada. Devuelve los errores (con la entrada que choca) sin tocar las demás. */
    fun saveCustomAddress(target: String, address: String, enabled: Boolean, editingId: String? = null): CustomAddresses.Validation {
        if (editingId == null && customAddresses.size >= CustomAddresses.MAX) return CustomAddresses.Validation.Errors(mapOf("target" to "limit"), emptyMap())
        val result = CustomAddresses.validate(target, address, enabled, customAddresses, editingId)
        if (result !is CustomAddresses.Validation.Ok) return result
        val now = Instant.now().toString()
        change { data ->
            val existing = data.customAddresses.firstOrNull { it.id == editingId }
            val entry = CustomAddress(
                id = existing?.id ?: UUID.randomUUID().toString(),
                target = result.target,
                address = result.address,
                enabled = result.enabled,
                createdAt = existing?.createdAt ?: now,
                updatedAt = now,
            )
            val list = if (existing == null) data.customAddresses + entry else data.customAddresses.map { if (it.id == entry.id) entry else it }
            data.copy(customAddresses = list)
        }
        return result
    }

    /** Activa o desactiva. No activa una entrada que choca con otra activa: devuelve esa otra. */
    fun setCustomAddressEnabled(id: String, enabled: Boolean): CustomAddress? {
        val entry = customAddresses.firstOrNull { it.id == id } ?: return null
        if (enabled) {
            val target = CustomAddresses.parseLocation(entry.target)
            val address = CustomAddresses.parseLocation(entry.address)
            if (target != null && address != null) {
                val conflicts = CustomAddresses.findConflicts(target, address, customAddresses, id).conflicts
                (conflicts["target"] ?: conflicts["address"])?.let { return it }
            }
        }
        change { data ->
            data.copy(customAddresses = data.customAddresses.map { if (it.id == id) it.copy(enabled = enabled, updatedAt = Instant.now().toString()) else it })
        }
        return null
    }

    fun removeCustomAddress(id: String) = change { it.copy(customAddresses = it.customAddresses.filter { entry -> entry.id != id }) }

    /* ---------------------------------- Permisos ---------------------------------- */

    /** null = preguntar. */
    fun permission(origin: String, permission: SitePermission): Boolean? = store.get().permissions[origin]?.get(permission)

    fun setPermission(origin: String, permission: SitePermission, allowed: Boolean) = change { data ->
        val site = (data.permissions[origin] ?: emptyMap()) + (permission to allowed)
        data.copy(permissions = data.permissions + (origin to site))
    }

    fun sitePermissions(): Map<String, Map<SitePermission, Boolean>> = store.get().permissions

    fun forgetPermissions(origin: String? = null) = change { data ->
        data.copy(permissions = if (origin == null) emptyMap() else data.permissions - origin)
    }

    /* ----------------------------------- Sesión ----------------------------------- */

    fun saveSession(urls: List<String>, activeIndex: Int) = change { data ->
        val kept = urls.filter { WEB.containsMatchIn(it) || it == InternalPage.NEW_TAB.url }.take(MAX_SESSION_TABS)
        data.copy(session = SavedSession(kept, activeIndex.coerceIn(0, maxOf(0, kept.size - 1))))
    }

    fun flush() = store.flush()

    private fun change(transform: (Data) -> Data) {
        store.update(transform)
        onChange()
    }

    private fun defaultShortcuts(): List<Shortcut> {
        val array = defaults.getJSONArray("shortcuts")
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            Shortcut(item.getString("id"), item.getString("title"), item.getString("url"))
        }
    }

    private fun initial() = Data(Settings(), defaultShortcuts(), CustomAddresses.sanitize(defaults.optJSONArray("customAddresses")), emptyMap(), SavedSession(emptyList(), 0))

    private fun encode(data: Data): String {
        val settings = data.settings
        val permissions = JSONObject()
        for ((origin, site) in data.permissions) {
            permissions.put(origin, JSONObject().also { json -> site.forEach { (permission, allowed) -> json.put(permission.id, allowed) } })
        }
        return JSONObject()
            // 2: direcciones personalizadas (antes, reglas de alias en `aliasRules`).
            .put("version", 2)
            .put(
                "settings",
                JSONObject()
                    .put("theme", settings.theme.id)
                    .put("colorMode", settings.colorMode.id)
                    .put("accent", settings.accent)
                    .put("searchProvider", settings.searchProvider.id)
                    .put("saveHistory", settings.saveHistory)
                    .put("restoreSession", settings.restoreSession)
                    .put("showShortcuts", settings.showShortcuts)
                    .put("showFullUrls", settings.showFullUrls),
            )
            .put("shortcuts", JSONArray().also { array -> data.shortcuts.forEach { array.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url)) } })
            .put("customAddresses", CustomAddress.listToJson(data.customAddresses))
            .put("permissions", permissions)
            .put("session", JSONObject().put("urls", JSONArray(data.session.urls)).put("activeIndex", data.session.activeIndex))
            .toString()
    }

    /** Lee el archivo y descarta lo que no sea válido, como sanitize.ts en escritorio. */
    private fun decode(text: String): Data {
        val json = JSONObject(text)
        val raw = json.optJSONObject("settings") ?: JSONObject()
        val settings = Settings(
            theme = ThemeId.fromId(raw.optString("theme")),
            colorMode = ColorMode.fromId(raw.optString("colorMode")),
            accent = raw.optString("accent", "default").takeIf { ACCENT.matches(it) } ?: "default",
            searchProvider = SearchProvider.fromId(raw.optString("searchProvider")),
            saveHistory = raw.optBoolean("saveHistory", true),
            restoreSession = raw.optBoolean("restoreSession", true),
            showShortcuts = raw.optBoolean("showShortcuts", true),
            showFullUrls = raw.optBoolean("showFullUrls", false),
        )
        val shortcuts = json.optJSONArray("shortcuts")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val url = (UrlUtils.normalizeUserUrl(item.optString("url")) as? UrlUtils.Normalized.Ok)?.url ?: return@mapNotNull null
                val title = item.optString("title").trim().take(SHORTCUT_TITLE_MAX).ifEmpty { return@mapNotNull null }
                Shortcut(item.optString("id").ifEmpty { UUID.randomUUID().toString() }, title, url)
            }.distinctBy { it.url }.take(MAX_SHORTCUTS)
        } ?: defaultShortcuts()
        // Las versiones anteriores guardaban reglas de alias: se convierten al leerlas.
        val customAddresses = CustomAddresses.sanitize(json.optJSONArray("customAddresses") ?: json.optJSONArray("aliasRules"))
        val permissions = LinkedHashMap<String, Map<SitePermission, Boolean>>()
        json.optJSONObject("permissions")?.let { raw ->
            for (origin in raw.keys()) {
                val site = raw.optJSONObject(origin) ?: continue
                if (!ORIGIN.matches(origin)) continue
                val decisions = site.keys().asSequence().mapNotNull { key -> SitePermission.fromId(key)?.let { it to site.optBoolean(key) } }.toMap()
                if (decisions.isNotEmpty()) permissions[origin] = decisions
            }
        }
        val session = json.optJSONObject("session")?.let { raw ->
            val urls = raw.optJSONArray("urls")?.let { array -> (0 until array.length()).map { array.optString(it) } } ?: emptyList()
            val kept = urls.filter { WEB.containsMatchIn(it) || it == InternalPage.NEW_TAB.url }.take(MAX_SESSION_TABS)
            SavedSession(kept, raw.optInt("activeIndex").coerceIn(0, maxOf(0, kept.size - 1)))
        } ?: SavedSession(emptyList(), 0)
        return Data(settings, shortcuts, customAddresses, permissions, session)
    }

    companion object {
        const val MAX_SHORTCUTS = 24
        const val SHORTCUT_TITLE_MAX = 40
        private const val MAX_SESSION_TABS = 50
        private val WEB = Regex("^https?://", RegexOption.IGNORE_CASE)
        private val ACCENT = Regex("^[a-z]{1,20}$")
        private val ORIGIN = Regex("^https?://[^/\\s]+$")
    }
}
