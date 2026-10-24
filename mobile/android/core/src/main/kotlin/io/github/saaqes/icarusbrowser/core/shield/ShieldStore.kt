package io.github.saaqes.icarusbrowser.core.shield

import io.github.saaqes.icarusbrowser.core.PublicSuffixList
import io.github.saaqes.icarusbrowser.core.UrlUtils
import io.github.saaqes.icarusbrowser.core.store.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** Errores de una lista, con los mismos códigos que en escritorio (docs/SHIELD.md). */
enum class ListError(val id: String) {
    INVALID_URL("invalid-url"),
    NETWORK("network"),
    HTTP("http"),
    TOO_LARGE("too-large"),
    NOT_A_LIST("not-a-list"),
    EMPTY("empty"),
    DUPLICATE("duplicate");

    companion object {
        fun fromId(id: String?): ListError? = entries.firstOrNull { it.id == id }
    }
}

data class ShieldListInfo(
    val id: String,
    val name: String,
    val url: String?,
    val enabled: Boolean,
    val builtIn: Boolean,
    val ruleCount: Int,
    val ignoredCount: Int,
    val invalidCount: Int,
    val lastUpdated: Long?,
    val error: ListError?,
    val updating: Boolean,
)

data class ShieldState(
    val enabled: Boolean,
    val lists: List<ShieldListInfo>,
    val customRules: String,
    val customRuleCount: Int,
    val customInvalidCount: Int,
    /** Dominios registrables donde Shield está desactivado. */
    val exceptions: List<String>,
    val totalBlocked: Long,
    val activeRuleCount: Int,
)

sealed interface FetchResult {
    data class Ok(val text: String) : FetchResult
    data class Failed(val error: ListError) : FetchResult
}

fun interface ListFetcher {
    /** Se llama en un hilo de fondo; puede bloquear. */
    fun fetch(url: String): FetchResult
}

/**
 * ICARUS Shield en el dispositivo: configuración, listas descargadas y motor de
 * filtros. Es una adaptación directa de electron/main/shieldService.ts.
 *
 * - `shouldBlock` se llama desde el hilo de red de WebView para cada subsolicitud.
 * - `addList` y `updateLists` hacen peticiones de red y bloquean: llámalos fuera
 *   del hilo principal.
 * - `onChange` se invoca desde cualquier hilo.
 */
class ShieldStore(
    dir: File,
    private val builtinListText: String,
    private val suffixes: PublicSuffixList,
    private val fetcher: ListFetcher = HttpListFetcher(),
    private val onChange: (ShieldState) -> Unit = {},
) {
    private data class ListConfig(val id: String, val name: String, val url: String?, val enabled: Boolean, val builtIn: Boolean)

    private data class ListMeta(val ruleCount: Int, val ignoredCount: Int, val invalidCount: Int, val lastUpdated: Long?, val error: ListError?)

    private data class Config(
        val enabled: Boolean,
        val lists: List<ListConfig>,
        val customRules: String,
        val exceptions: List<String>,
        val totalBlocked: Long,
        val meta: Map<String, ListMeta>,
    )

    private val listsDir = File(dir, "lists").apply { mkdirs() }
    private val file = JsonFile(File(dir, "shield.json"), ::encode, ::decode, ::defaultConfig, delayMs = 2000)
    private val updating = java.util.Collections.synchronizedSet(HashSet<String>())

    @Volatile
    private var engine = FilterEngine(emptyList(), suffixes)

    @Volatile
    private var customStats = Pair(0, 0)

    init {
        rebuild()
    }

    /** ¿Debe cancelarse esta subsolicitud? Si devuelve true, ya se ha contado. */
    fun shouldBlock(url: String, type: ResourceType, pageUrl: String): Boolean {
        val config = file.get()
        if (!config.enabled || type == ResourceType.DOCUMENT || pageUrl.isEmpty()) return false
        if (isSiteAllowed(pageUrl)) return false
        if (!engine.match(url, type, pageUrl).blocked) return false
        file.update { it.copy(totalBlocked = it.totalBlocked + 1) }
        return true
    }

    fun isSiteAllowed(pageUrl: String): Boolean {
        val host = UrlUtils.parseWebUrl(pageUrl)?.hostname ?: return false
        return file.get().exceptions.any { PublicSuffixList.hostMatchesDomain(host, it) }
    }

    fun state(): ShieldState {
        val config = file.get()
        val lists = config.lists.map { list ->
            val meta = config.meta[list.id]
            ShieldListInfo(
                id = list.id,
                name = list.name,
                url = list.url,
                enabled = list.enabled,
                builtIn = list.builtIn,
                ruleCount = meta?.ruleCount ?: 0,
                ignoredCount = meta?.ignoredCount ?: 0,
                invalidCount = meta?.invalidCount ?: 0,
                lastUpdated = meta?.lastUpdated,
                error = meta?.error,
                updating = list.id in updating,
            )
        }
        val (customRules, customInvalid) = customStats
        return ShieldState(config.enabled, lists, config.customRules, customRules, customInvalid, config.exceptions, config.totalBlocked, engine.size)
    }

    fun setEnabled(enabled: Boolean) {
        file.update { it.copy(enabled = enabled) }
        changed()
    }

    /** Activa o desactiva una lista. Si se activa una lista sin copia local, hay que llamar a `updateLists`. */
    fun setListEnabled(id: String, enabled: Boolean) {
        file.update { config -> config.copy(lists = config.lists.map { if (it.id == id) it.copy(enabled = enabled) else it }) }
        rebuild()
        changed()
    }

    fun needsDownload(id: String): Boolean {
        val list = file.get().lists.firstOrNull { it.id == id } ?: return false
        return list.enabled && list.url != null && !hasCachedText(id)
    }

    sealed interface AddResult {
        data object Ok : AddResult
        data class Failed(val error: ListError) : AddResult
    }

    fun addList(name: String, url: String): AddResult {
        val parsed = UrlUtils.parseWebUrl(url.trim())
        if (parsed == null || parsed.protocol != "https:" || parsed.hasCredentials) return AddResult.Failed(ListError.INVALID_URL)
        if (file.get().lists.any { it.url == parsed.href }) return AddResult.Failed(ListError.DUPLICATE)
        val id = "custom-${UUID.randomUUID().toString().take(8)}"
        val result = download(parsed.href)
        if (result !is Download.Ok) return AddResult.Failed((result as Download.Failed).error)
        file.update { config ->
            config.copy(lists = config.lists + ListConfig(id, name.trim().take(80).ifEmpty { parsed.hostname }, parsed.href, true, false))
        }
        storeList(id, result)
        rebuild()
        changed()
        return AddResult.Ok
    }

    fun removeList(id: String) {
        val list = file.get().lists.firstOrNull { it.id == id }
        if (list == null || list.builtIn) return
        file.update { config -> config.copy(lists = config.lists.filter { it.id != id }, meta = config.meta - id) }
        listPath(id).delete()
        rebuild()
        changed()
    }

    fun setCustomRules(text: String) {
        file.update { it.copy(customRules = text.take(MAX_CUSTOM_RULES_LENGTH)) }
        rebuild()
        changed()
    }

    /** Activa o desactiva Shield para un sitio (se guarda su dominio registrable). */
    fun setSiteAllowed(hostname: String, allowed: Boolean) {
        val host = hostname.lowercase()
        val domain = suffixes.registrableDomain(host)
        if (!DOMAIN.matches(domain)) return
        file.update { config ->
            val rest = config.exceptions.filter { it != domain && !PublicSuffixList.hostMatchesDomain(host, it) }
            config.copy(exceptions = if (allowed) (rest + domain).sorted() else rest)
        }
        changed()
    }

    /** Descarga las listas activas (todas o solo las caducadas). Bloquea. */
    fun updateLists(onlyStale: Boolean, now: Long = System.currentTimeMillis()) {
        val config = file.get()
        for (list in config.lists) {
            if (!list.enabled || list.url == null) continue
            val lastUpdated = config.meta[list.id]?.lastUpdated
            val fresh = lastUpdated != null && now - lastUpdated < UPDATE_INTERVAL_MS && hasCachedText(list.id)
            if (onlyStale && fresh) continue
            updateList(list.id)
        }
    }

    fun flush() = file.flush()

    private fun updateList(id: String) {
        val list = file.get().lists.firstOrNull { it.id == id }
        if (list?.url == null || !updating.add(id)) return
        changed()
        try {
            when (val result = download(list.url)) {
                is Download.Ok -> {
                    storeList(id, result)
                    rebuild()
                }
                // Se conserva la copia anterior de la lista si existía.
                is Download.Failed -> setMeta(id) { it.copy(error = result.error) }
            }
        } finally {
            updating.remove(id)
            changed()
        }
    }

    private sealed interface Download {
        data class Ok(val text: String, val parsed: ParsedList) : Download
        data class Failed(val error: ListError) : Download
    }

    private fun download(url: String): Download {
        val text = when (val response = fetcher.fetch(url)) {
            is FetchResult.Failed -> return Download.Failed(response.error)
            is FetchResult.Ok -> response.text
        }
        if (Filters.looksLikeHtml(text)) return Download.Failed(ListError.NOT_A_LIST)
        val parsed = Filters.parseList(text)
        if (parsed.ruleCount == 0) return Download.Failed(ListError.EMPTY)
        return Download.Ok(text, parsed)
    }

    private fun storeList(id: String, download: Download.Ok) {
        JsonFile.writeAtomically(listPath(id), download.text)
        setMeta(id) {
            ListMeta(download.parsed.ruleCount, download.parsed.ignoredCount, download.parsed.invalidCount, System.currentTimeMillis(), null)
        }
    }

    private fun setMeta(id: String, transform: (ListMeta) -> ListMeta) {
        file.update { config ->
            val current = config.meta[id] ?: ListMeta(0, 0, 0, null, null)
            config.copy(meta = config.meta + (id to transform(current)))
        }
    }

    private fun listPath(id: String) = File(listsDir, "$id.txt")

    private fun hasCachedText(id: String) = id == BUILTIN_ID || listPath(id).isFile

    @Synchronized
    private fun rebuild() {
        val config = file.get()
        val filters = ArrayList<NetworkFilter>()
        for (list in config.lists) {
            if (!list.enabled) continue
            val text = if (list.id == BUILTIN_ID) builtinListText else runCatching { listPath(list.id).takeIf { it.isFile }?.readText() }.getOrNull()
            text ?: continue
            val parsed = Filters.parseList(text)
            filters.addAll(parsed.filters)
            if (list.id == BUILTIN_ID && config.meta[BUILTIN_ID]?.ruleCount != parsed.ruleCount) {
                setMeta(BUILTIN_ID) { ListMeta(parsed.ruleCount, parsed.ignoredCount, parsed.invalidCount, null, null) }
            }
        }
        val custom = Filters.parseList(config.customRules)
        customStats = Pair(custom.ruleCount, custom.invalidCount)
        filters.addAll(custom.filters)
        engine = FilterEngine(filters, suffixes)
    }

    private fun changed() = onChange(state())

    private fun defaultConfig() = Config(true, DEFAULT_LISTS, "", emptyList(), 0, emptyMap())

    private fun encode(config: Config): String {
        val lists = JSONArray()
        for (list in config.lists) {
            lists.put(JSONObject().put("id", list.id).put("name", list.name).put("url", list.url ?: JSONObject.NULL).put("enabled", list.enabled))
        }
        val meta = JSONObject()
        for ((id, value) in config.meta) {
            meta.put(
                id,
                JSONObject()
                    .put("ruleCount", value.ruleCount)
                    .put("ignoredCount", value.ignoredCount)
                    .put("invalidCount", value.invalidCount)
                    .put("lastUpdated", value.lastUpdated ?: JSONObject.NULL)
                    .put("error", value.error?.id ?: JSONObject.NULL),
            )
        }
        return JSONObject()
            .put("version", 1)
            .put("enabled", config.enabled)
            .put("lists", lists)
            .put("customRules", config.customRules)
            .put("exceptions", JSONArray(config.exceptions))
            .put("totalBlocked", config.totalBlocked)
            .put("meta", meta)
            .toString()
    }

    /** Igual que sanitizeConfig en escritorio: las listas predefinidas siempre existen. */
    private fun decode(text: String): Config {
        val raw = JSONObject(text)
        val stored = raw.optJSONArray("lists")?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } } ?: emptyList()
        val lists = ArrayList<ListConfig>()
        for (builtIn in DEFAULT_LISTS) {
            val match = stored.firstOrNull { it.optString("id") == builtIn.id }
            lists.add(builtIn.copy(enabled = match?.optBoolean("enabled", builtIn.enabled) ?: builtIn.enabled))
        }
        for (item in stored) {
            val id = item.optString("id")
            if (lists.any { it.id == id } || !LIST_ID.matches(id)) continue
            val url = UrlUtils.parseWebUrl(item.optString("url"))?.takeIf { it.protocol == "https:" && !it.hasCredentials } ?: continue
            lists.add(ListConfig(id, item.optString("name").trim().take(80).ifEmpty { url.hostname }, url.href, item.optBoolean("enabled", true), false))
        }
        val meta = HashMap<String, ListMeta>()
        raw.optJSONObject("meta")?.let { json ->
            for (id in json.keys()) {
                val value = json.optJSONObject(id) ?: continue
                meta[id] = ListMeta(
                    value.optInt("ruleCount"),
                    value.optInt("ignoredCount"),
                    value.optInt("invalidCount"),
                    if (value.isNull("lastUpdated")) null else value.optLong("lastUpdated"),
                    if (value.isNull("error")) null else ListError.fromId(value.optString("error")),
                )
            }
        }
        val exceptions = raw.optJSONArray("exceptions")?.let { array ->
            (0 until array.length()).map { array.optString(it) }.filter { DOMAIN.matches(it) }.take(2000)
        } ?: emptyList()
        return Config(
            enabled = raw.optBoolean("enabled", true),
            lists = lists,
            customRules = raw.optString("customRules").take(MAX_CUSTOM_RULES_LENGTH),
            exceptions = exceptions,
            totalBlocked = raw.optLong("totalBlocked").coerceAtLeast(0),
            meta = meta,
        )
    }

    companion object {
        const val BUILTIN_ID = "icarus-basic"
        const val MAX_LIST_BYTES = 15 * 1024 * 1024
        private const val MAX_CUSTOM_RULES_LENGTH = 200_000
        const val UPDATE_INTERVAL_MS = 4L * 24 * 60 * 60 * 1000
        private val DOMAIN = Regex("^[a-z0-9.-]{1,253}$")
        private val LIST_ID = Regex("^[a-z0-9-]{1,64}$", RegexOption.IGNORE_CASE)

        private val DEFAULT_LISTS = listOf(
            ListConfig(BUILTIN_ID, "ICARUS básica", null, true, true),
            ListConfig("easylist", "EasyList (anuncios)", "https://easylist.to/easylist/easylist.txt", true, true),
            ListConfig("easyprivacy", "EasyPrivacy (rastreadores)", "https://easylist.to/easylist/easyprivacy.txt", true, true),
            ListConfig(
                "peter-lowe",
                "Peter Lowe (servidores de anuncios)",
                "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
                false,
                true,
            ),
        )
    }
}

/** Descarga por HTTPS con límite de 15 MB y 30 s, sin aceptar redirecciones a HTTP. */
class HttpListFetcher(private val timeoutMs: Int = 30_000) : ListFetcher {
    override fun fetch(url: String): FetchResult {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (_: Exception) {
            return FetchResult.Failed(ListError.INVALID_URL)
        }
        return try {
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            // HttpURLConnection no sigue redirecciones que cambian de protocolo.
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept", "text/plain, */*;q=0.5")
            val code = connection.responseCode
            if (code !in 200..299) return FetchResult.Failed(ListError.HTTP)
            if (connection.contentLengthLong > ShieldStore.MAX_LIST_BYTES) return FetchResult.Failed(ListError.TOO_LARGE)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    if (output.size() > ShieldStore.MAX_LIST_BYTES) return FetchResult.Failed(ListError.TOO_LARGE)
                }
            }
            FetchResult.Ok(output.toString(Charsets.UTF_8.name()))
        } catch (_: Exception) {
            FetchResult.Failed(ListError.NETWORK)
        } finally {
            connection.disconnect()
        }
    }
}
