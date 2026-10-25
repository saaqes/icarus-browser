package io.github.saaqes.icarusbrowser

import android.app.Application
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import io.github.saaqes.icarusbrowser.core.HistoryStore
import io.github.saaqes.icarusbrowser.core.Profile
import io.github.saaqes.icarusbrowser.core.PublicSuffixList
import io.github.saaqes.icarusbrowser.core.Themes
import io.github.saaqes.icarusbrowser.core.shield.ShieldState
import io.github.saaqes.icarusbrowser.core.shield.ShieldStore
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Estado compartido de la app: perfil, historial, ICARUS Shield y descargas.
 * Los datos viven en el almacenamiento interno de la app (filesDir), que Android
 * borra al desinstalarla. No se guarda nada fuera del dispositivo.
 */
class IcarusApp : Application() {
    val main = Handler(Looper.getMainLooper())
    /** Hilo para tareas de disco y red (descarga de listas de Shield). */
    val background = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "icarus-background").apply { isDaemon = true } }

    lateinit var themes: Themes
        private set
    lateinit var strings: JSONObject
        private set
    lateinit var suffixes: PublicSuffixList
        private set
    lateinit var profile: Profile
        private set
    lateinit var history: HistoryStore
        private set
    lateinit var shield: ShieldStore
        private set
    lateinit var downloads: DownloadsStore
        private set
    lateinit var favicons: FaviconCache
        private set

    private val profileListeners = CopyOnWriteArrayList<() -> Unit>()
    private val shieldListeners = CopyOnWriteArrayList<(ShieldState) -> Unit>()
    private var shieldNotifyPending = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        val data = File(filesDir, "icarus")
        themes = Themes(asset("themes.json"))
        strings = JSONObject(asset("strings.json"))
        suffixes = PublicSuffixList(asset("public-suffix-rules.txt"))
        profile = Profile(data, asset("defaults.json")) { main.post { profileListeners.forEach { it() } } }
        history = HistoryStore(File(data, "history.json"))
        shield = ShieldStore(File(data, "shield"), asset("shield-basic.txt"), suffixes, onChange = ::onShieldChanged)
        downloads = DownloadsStore(this)
        favicons = FaviconCache(File(cacheDir, "favicons"))
        // Las listas se actualizan en segundo plano solo si han caducado (4 días).
        background.execute { shield.updateLists(onlyStale = true) }
    }

    private fun asset(name: String): String = assets.open(name).bufferedReader().use { it.readText() }

    /** Los cambios de Shield llegan desde el hilo de red de WebView: se agrupan cada 500 ms. */
    private fun onShieldChanged(state: ShieldState) {
        synchronized(this) {
            if (shieldNotifyPending) return
            shieldNotifyPending = true
        }
        main.postDelayed({
            synchronized(this) { shieldNotifyPending = false }
            val current = shield.state()
            shieldListeners.forEach { it(current) }
        }, 500)
    }

    /** Avisa de un bloqueo contado por shouldBlock (el contador total cambia). */
    fun notifyBlocked() = onShieldChanged(shield.state())

    fun addProfileListener(listener: () -> Unit) = profileListeners.add(listener)
    fun removeProfileListener(listener: () -> Unit) = profileListeners.remove(listener)
    fun addShieldListener(listener: (ShieldState) -> Unit) = shieldListeners.add(listener)
    fun removeShieldListener(listener: (ShieldState) -> Unit) = shieldListeners.remove(listener)

    /** Estilo, modo y paleta actuales. */
    fun look(configuration: Configuration = resources.configuration): Look {
        val settings = profile.settings
        val systemDark = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val dark = when (settings.colorMode) {
            io.github.saaqes.icarusbrowser.core.ColorMode.LIGHT -> false
            io.github.saaqes.icarusbrowser.core.ColorMode.DARK -> true
            io.github.saaqes.icarusbrowser.core.ColorMode.SYSTEM -> systemDark
        }
        return Look(settings.theme, dark, themes.palette(settings.theme, dark, settings.accent))
    }

    /** Texto compartido con escritorio (mobile/shared/strings.json), p. ej. sharedText("aliasErrors", "required"). */
    fun sharedText(group: String, key: String): String = strings.optJSONObject(group)?.optString(key).orEmpty().ifEmpty { key }

    /** Texto compartido con sus parámetros `{nombre}` sustituidos. */
    fun sharedText(group: String, key: String, vararg params: Pair<String, String>): String =
        params.fold(sharedText(group, key)) { text, (name, value) -> text.replace("{$name}", value) }

    /** Texto de un grupo anidado (p. ej. `customAddresses.form`). */
    fun sharedText(group: String, subgroup: String, key: String, vararg params: Pair<String, String>): String {
        val text = strings.optJSONObject(group)?.optJSONObject(subgroup)?.optString(key).orEmpty().ifEmpty { key }
        return params.fold(text) { acc, (name, value) -> acc.replace("{$name}", value) }
    }

    /**
     * Las solicitudes de los service workers no pasan por el WebViewClient de las
     * pestañas: se filtran aquí, usando el Referer como página de origen. Si no lo
     * hay, la solicitud no se evalúa (Shield no puede saber de qué sitio viene).
     */
    fun installServiceWorkerFilter() {
        android.webkit.ServiceWorkerController.getInstance().setServiceWorkerClient(object : android.webkit.ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
                val headers = request.requestHeaders.orEmpty()
                val page = headers.entries.firstOrNull { it.key.equals("Referer", ignoreCase = true) }?.value ?: return null
                val url = request.url.toString()
                val type = io.github.saaqes.icarusbrowser.core.shield.ResourceTypes.infer(url, false, headers)
                if (!shield.shouldBlock(url, type, page)) return null
                notifyBlocked()
                return BrowserTab.blockedResponse()
            }
        })
    }

    fun flushAll() {
        background.execute {
            profile.flush()
            history.flush()
            shield.flush()
        }
    }

    companion object {
        lateinit var instance: IcarusApp
            private set
    }
}
