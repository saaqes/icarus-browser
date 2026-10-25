package io.github.saaqes.icarusbrowser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import io.github.saaqes.icarusbrowser.core.InternalPage
import io.github.saaqes.icarusbrowser.core.SitePermission
import io.github.saaqes.icarusbrowser.core.UrlUtils
import io.github.saaqes.icarusbrowser.core.shield.ResourceTypes
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Lo que la ventana principal ofrece a cada pestaña. */
interface TabHost {
    val context: Context
    fun onTabChanged(tab: BrowserTab)
    fun attachNewWindow(opener: BrowserTab, message: Message): Boolean
    fun closeTab(tab: BrowserTab)
    fun onPageError(tab: BrowserTab)
    fun requestAuth(tab: BrowserTab, handler: HttpAuthHandler, host: String, realm: String)
    fun requestPermission(tab: BrowserTab, origin: String, permissions: Set<SitePermission>, callback: (Boolean) -> Unit)
    fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean
    fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback)
    fun hideCustomView()
    fun startDownload(tab: BrowserTab, url: String, userAgent: String?, contentDisposition: String?, mimeType: String?, length: Long)
    fun openExternal(tab: BrowserTab, uri: Uri, userGesture: Boolean)
    fun showMessage(message: String)
    fun onFindResult(tab: BrowserTab, active: Int, total: Int, done: Boolean)
}

/** Error que ocupa la pestaña en lugar de la página. */
data class PageError(val kind: Kind, val url: String, val detail: String) {
    enum class Kind { CERTIFICATE, NETWORK, CRASHED }
}

/**
 * Una pestaña: su WebView (creado al abrir la primera página) y su estado.
 *
 * Todas las pestañas comparten el mismo perfil de WebView: cookies,
 * almacenamiento local y caché son comunes a todas (no están aisladas entre sí).
 */
class BrowserTab(private val host: TabHost, initialUrl: String?) {
    val id: Long = NEXT_ID.incrementAndGet()
    private val app = IcarusApp.instance

    var webView: WebView? = null
        private set

    /** Dirección real de la página actual (o la página interna de nueva pestaña). */
    var url: String = initialUrl ?: InternalPage.NEW_TAB.url
        private set
    var title: String = ""
        private set
    var progress: Int = 100
        private set
    var loading = false
        private set
    var favicon: Bitmap? = null
        private set
    var error: PageError? = null
        private set
    /** La pestaña muestra la página de nueva pestaña en lugar del WebView. */
    var showingNewTab: Boolean = initialUrl == null || initialUrl == InternalPage.NEW_TAB.url
        private set
    /** URL que se cargará cuando se muestre la pestaña (pestañas restauradas). */
    private var pendingUrl: String? = initialUrl?.takeIf { it != InternalPage.NEW_TAB.url }

    /** Solicitudes bloqueadas por Shield en la página actual (contador real). */
    val blocked = AtomicInteger(0)

    /** Página para la que se evalúan las subsolicitudes; se lee desde el hilo de red. */
    @Volatile
    private var pageUrl: String = ""

    @Volatile
    private var lastMainFrameRequest: String = ""

    val canGoBack get() = !showingNewTab && webView?.canGoBack() == true || (showingNewTab && webView != null)
    val canGoForward get() = webView?.canGoForward() == true
    val isSecure get() = !showingNewTab && url.startsWith("https://", ignoreCase = true)

    /** Carga pendiente de una pestaña restaurada. */
    fun activate() {
        pendingUrl?.let {
            pendingUrl = null
            load(it)
        }
    }

    fun load(target: String) {
        val view = ensureWebView()
        showingNewTab = false
        error = null
        url = target
        lastMainFrameRequest = target
        view.loadUrl(target)
        host.onTabChanged(this)
    }

    fun showNewTab() {
        showingNewTab = true
        pendingUrl = null
        error = null
        webView?.stopLoading()
        loading = false
        progress = 100
        url = InternalPage.NEW_TAB.url
        title = ""
        host.onTabChanged(this)
    }

    fun goBack() {
        when {
            showingNewTab && webView != null -> {
                showingNewTab = false
                url = webView?.url ?: url
                title = webView?.title.orEmpty()
                host.onTabChanged(this)
            }
            error != null && webView?.canGoBack() == true -> {
                error = null
                webView?.goBack()
            }
            else -> webView?.goBack()
        }
    }

    fun goForward() = webView?.goForward()

    fun reload() {
        val view = webView ?: return
        if (error != null) {
            val retry = error!!.url
            error = null
            load(retry)
        } else {
            view.reload()
        }
    }

    fun stop() {
        webView?.stopLoading()
        loading = false
        progress = 100
        host.onTabChanged(this)
    }

    fun clearError() {
        error = null
        host.onTabChanged(this)
    }

    fun destroy() {
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.stopLoading()
            view.destroy()
        }
        webView = null
    }

    /** WebView creado para una ventana nueva (window.open / target=_blank) de otra pestaña. */
    fun adoptWindow(): WebView {
        showingNewTab = false
        pendingUrl = null
        url = "about:blank"
        return ensureWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun ensureWebView(): WebView {
        webView?.let { return it }
        val view = WebView(host.context)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = true
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setGeolocationEnabled(true)
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = true
        }
        view.webViewClient = Client()
        view.webChromeClient = Chrome()
        view.setDownloadListener { downloadUrl, userAgent, contentDisposition, mimeType, length ->
            host.startDownload(this, downloadUrl, userAgent, contentDisposition, mimeType, length)
        }
        view.setFindListener { active, total, done -> host.onFindResult(this, active, total, done) }
        webView = view
        return view
    }

    private fun changed() = host.onTabChanged(this)

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme?.lowercase()) {
                // Los enlaces de las páginas van a su URL real: las direcciones personalizadas
                // solo se resuelven cuando el usuario las escribe en la barra.
                "http", "https" -> {
                    if (request.isForMainFrame) lastMainFrameRequest = uri.toString()
                    false
                }
                "about" -> uri.toString() != "about:blank"
                // Las páginas no pueden navegar a archivos locales, código ni a las páginas internas de ICARUS.
                "javascript", "file", "content", "data", "blob", "vbscript", "icarus" -> true
                null -> true
                else -> {
                    if (request.isForMainFrame) host.openExternal(this@BrowserTab, uri, request.hasGesture())
                    true
                }
            }
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val requestUrl = request.url.toString()
            if (request.isForMainFrame) {
                lastMainFrameRequest = requestUrl
                pageUrl = requestUrl
                blocked.set(0)
                return null
            }
            val scheme = request.url.scheme
            if (scheme != "http" && scheme != "https") return null
            val type = ResourceTypes.infer(requestUrl, false, request.requestHeaders.orEmpty())
            if (!app.shield.shouldBlock(requestUrl, type, pageUrl)) return null
            blocked.incrementAndGet()
            app.main.post { changed() }
            app.notifyBlocked()
            return blockedResponse()
        }

        override fun onPageStarted(view: WebView, startedUrl: String, icon: Bitmap?) {
            if (!showingNewTab) url = startedUrl
            pageUrl = startedUrl
            loading = true
            favicon = icon
            if (error != null && startedUrl != error?.url) error = null
            changed()
        }

        override fun onPageFinished(view: WebView, finishedUrl: String) {
            loading = false
            progress = 100
            // Tras un error, WebView informa de la página anterior: se conserva la dirección que falló.
            if (!showingNewTab && error == null) {
                url = view.url ?: finishedUrl
                title = view.title.orEmpty()
                app.history.updateTitle(url, title)
            }
            changed()
        }

        override fun doUpdateVisitedHistory(view: WebView, visitedUrl: String, isReload: Boolean) {
            if (showingNewTab) return
            url = visitedUrl
            pageUrl = visitedUrl
            if (!isReload && app.profile.settings.saveHistory) app.history.add(visitedUrl, view.title.orEmpty())
            changed()
        }

        /** Los errores de certificado nunca se pasan por alto: se cancela la carga. */
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, sslError: SslError) {
            handler.cancel()
            if (sslError.url == lastMainFrameRequest || sslError.url == url) {
                error = PageError(PageError.Kind.CERTIFICATE, sslError.url, describe(sslError))
                loading = false
                host.onPageError(this@BrowserTab)
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, resourceError: WebResourceError) {
            if (!request.isForMainFrame) return
            // Navegación cancelada por otra (p. ej. el usuario pulsó otro enlace): no es un error.
            if (resourceError.errorCode == ERROR_UNKNOWN && resourceError.description.contains("ERR_ABORTED")) return
            error = PageError(PageError.Kind.NETWORK, request.url.toString(), describe(resourceError))
            loading = false
            host.onPageError(this@BrowserTab)
        }

        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, authHost: String, realm: String) {
            host.requestAuth(this@BrowserTab, handler, authHost, realm.take(150))
        }

        /** Si el proceso de la página falla, solo se pierde esta pestaña, no la app. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            val lost = url
            destroy()
            error = PageError(
                PageError.Kind.CRASHED,
                lost,
                if (detail.didCrash()) "El proceso de la página se cerró inesperadamente." else "Android cerró la página para liberar memoria.",
            )
            loading = false
            host.onPageError(this@BrowserTab)
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress = newProgress
            loading = newProgress < 100
            changed()
        }

        override fun onReceivedTitle(view: WebView, newTitle: String?) {
            title = newTitle.orEmpty()
            if (!showingNewTab) app.history.updateTitle(url, title)
            changed()
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap) {
            favicon = icon
            UrlUtils.parseWebUrl(url)?.hostname?.let { app.favicons.put(it, icon) }
            changed()
        }

        /** Las ventanas emergentes solo se abren si responden a un gesto del usuario. */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) {
                host.showMessage("ICARUS bloqueó una ventana emergente.")
                return false
            }
            return host.attachNewWindow(this@BrowserTab, resultMsg)
        }

        override fun onCloseWindow(window: WebView) {
            if (window == webView) host.closeTab(this@BrowserTab)
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            host.requestPermission(this@BrowserTab, originOf(origin), setOf(SitePermission.LOCATION)) { allowed ->
                callback.invoke(origin, allowed, false)
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val wanted = LinkedHashSet<SitePermission>()
            val granted = ArrayList<String>()
            for (resource in request.resources) {
                when (resource) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> wanted.add(SitePermission.CAMERA).also { granted.add(resource) }
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> wanted.add(SitePermission.MICROPHONE).also { granted.add(resource) }
                    // MIDI y contenido protegido (DRM) no se conceden.
                }
            }
            if (wanted.isEmpty()) {
                request.deny()
                return
            }
            host.requestPermission(this@BrowserTab, originOf(request.origin.toString()), wanted) { allowed ->
                if (allowed) request.grant(granted.toTypedArray()) else request.deny()
            }
        }

        override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<Uri>>, fileChooserParams: FileChooserParams) =
            host.showFileChooser(filePathCallback, fileChooserParams)

        override fun onShowCustomView(view: View, callback: CustomViewCallback) = host.showCustomView(view, callback)

        override fun onHideCustomView() = host.hideCustomView()
    }

    companion object {
        private val NEXT_ID = AtomicLong(0)

        /** Respuesta vacía para una solicitud bloqueada: nunca sale del dispositivo. */
        fun blockedResponse() =
            WebResourceResponse("text/plain", "utf-8", 403, "Blocked by ICARUS Shield", emptyMap(), ByteArrayInputStream(ByteArray(0)))

        /** https://ejemplo.com:8443/ruta → https://ejemplo.com:8443 */
        fun originOf(url: String): String {
            val parsed = UrlUtils.parseWebUrl(url) ?: return url.trimEnd('/')
            return "${parsed.protocol}//${parsed.host}"
        }

        private fun describe(error: SslError): String = when (error.primaryError) {
            SslError.SSL_UNTRUSTED -> "El certificado no lo emite una autoridad de confianza."
            SslError.SSL_EXPIRED -> "El certificado ha caducado."
            SslError.SSL_NOTYETVALID -> "El certificado aún no es válido. Comprueba la fecha del dispositivo."
            SslError.SSL_IDMISMATCH -> "El certificado no corresponde a este sitio."
            SslError.SSL_DATE_INVALID -> "La fecha del certificado no es válida."
            else -> "El certificado no es válido."
        }

        private fun describe(error: WebResourceError): String = when (error.errorCode) {
            WebViewClient.ERROR_HOST_LOOKUP -> "No se encontró el servidor. Comprueba la dirección y la conexión a Internet."
            WebViewClient.ERROR_CONNECT -> "No se pudo conectar con el servidor."
            WebViewClient.ERROR_TIMEOUT -> "El servidor tardó demasiado en responder."
            WebViewClient.ERROR_UNSAFE_RESOURCE -> "Navegación segura de Google marcó este sitio como peligroso."
            WebViewClient.ERROR_UNSUPPORTED_SCHEME -> "ICARUS no puede abrir este tipo de dirección."
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "No se pudo establecer una conexión segura."
            WebViewClient.ERROR_TOO_MANY_REQUESTS -> "Demasiadas solicitudes a la vez."
            else -> error.description?.toString().orEmpty().ifEmpty { "No se pudo cargar la página." }
        }
    }
}
