package io.github.saaqes.icarusbrowser

import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.text.InputType
import android.text.format.Formatter
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.webkit.HttpAuthHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import io.github.saaqes.icarusbrowser.core.AddressRebase
import io.github.saaqes.icarusbrowser.core.BookmarksStore
import io.github.saaqes.icarusbrowser.core.CustomAddress
import io.github.saaqes.icarusbrowser.core.CustomAddresses
import io.github.saaqes.icarusbrowser.core.InputResolution
import io.github.saaqes.icarusbrowser.core.InputResolver
import io.github.saaqes.icarusbrowser.core.InternalPage
import io.github.saaqes.icarusbrowser.core.Profile
import io.github.saaqes.icarusbrowser.core.Shortcut
import io.github.saaqes.icarusbrowser.core.SitePermission
import io.github.saaqes.icarusbrowser.core.UrlUtils
import io.github.saaqes.icarusbrowser.core.shield.ShieldState
import java.text.NumberFormat
import java.util.Locale

class MainActivity : Activity(), TabHost {
    private val app get() = IcarusApp.instance
    override val context: Context get() = this

    private lateinit var look: Look
    private lateinit var w: Widgets

    private val tabs = ArrayList<BrowserTab>()
    /** Pestaña visible. Público para las pruebas instrumentadas. */
    var currentTab: BrowserTab? = null
        private set

    private lateinit var root: FrameLayout
    private lateinit var webHolder: FrameLayout
    private lateinit var errorHolder: FrameLayout
    private lateinit var fullscreenHolder: FrameLayout
    private lateinit var omnibox: Omnibox
    private lateinit var suggestions: SuggestionsView
    private lateinit var newTab: NewTabView
    private lateinit var progress: ProgressLine
    private lateinit var findBar: LinearLayout
    private lateinit var findField: EditText
    private lateinit var findCount: TextView
    private lateinit var shieldBadge: TextView
    private lateinit var shieldIcon: ImageView
    private lateinit var tabsCount: TextView
    private lateinit var toolbar: View
    private lateinit var backButton: ImageButton
    private lateinit var reloadButton: ImageButton
    /** Solo en pantallas anchas; en teléfonos «Adelante» está en el menú, como en Chrome. */
    private var forwardButton: ImageButton? = null
    /** Shield en la barra solo si hay espacio; si no, en el menú. */
    private var shieldInToolbar = false

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: ((Boolean) -> Unit)? = null
    private var lastLook: Look? = null

    private val spanish = Locale.forLanguageTag("es-ES")
    private val profileListener: () -> Unit = { onProfileChanged() }
    private val shieldListener: (ShieldState) -> Unit = { updateChrome(); if (currentTab?.showingNewTab == true) newTab.render() }
    /** Versiones de las que ya se avisó en esta sesión (el aviso no se repite). */
    private val notifiedUpdates = HashSet<String>()
    private val updatesListener: (UpdateManager.State) -> Unit = { notifyUpdate(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        applyNightMode(app.profile.settings.colorMode)
        app.installServiceWorkerFilter()
        buildUi()
        restoreSession()
        handleIntent(intent)
        app.addProfileListener(profileListener)
        app.addShieldListener(shieldListener)
        app.updates.addListener(updatesListener)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        currentTab?.webView?.onResume()
        updateChrome()
        notifyUpdate(app.updates.state)
        app.updates.checkIfDue()
    }

    override fun onPause() {
        super.onPause()
        currentTab?.webView?.onPause()
        saveSession()
        app.flushAll()
    }

    override fun onDestroy() {
        app.updates.removeListener(updatesListener)
        app.removeProfileListener(profileListener)
        app.removeShieldListener(shieldListener)
        tabs.forEach { it.destroy() }
        tabs.clear()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (app.look(newConfig) != lastLook) rebuildUi()
    }

    @Deprecated("Android 12 y anteriores")
    override fun onBackPressed() {
        handleBack()
    }

    /* --------------------------------- Interfaz --------------------------------- */

    private fun buildUi() {
        look = app.look()
        lastLook = look
        w = Widgets(this, look)
        val p = look.palette
        applySystemBars(look)

        omnibox = Omnibox(
            this, w,
            onSubmit = ::submitAddress,
            onSecurityInfo = ::showSiteInfo,
            onFocusChanged = { focused -> if (focused) showSuggestions(omnibox.text) else suggestions.hide() },
            onQueryChanged = ::showSuggestions,
            onRebaseSubmit = ::submitRebase,
            onStar = ::toggleBookmark,
        )
        suggestions = SuggestionsView(this, w).apply { hide() }
        newTab = NewTabView(this, w, onSearch = { omnibox.focus() }, onOpen = ::submitAddress, onEditShortcut = ::editShortcut, onShield = { openSettings("shield") })
        progress = ProgressLine(this, look.accent)

        webHolder = FrameLayout(this).apply { setBackgroundColor(p.pageBg) }
        errorHolder = FrameLayout(this).apply { visibility = View.GONE; setBackgroundColor(p.pageBg) }
        val content = FrameLayout(this).apply {
            addView(webHolder, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(newTab.view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(errorHolder, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(suggestions.view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
        buildFindBar()

        // La barra está siempre arriba y fija, en todos los estilos (como Chrome para Android):
        // la página se desplaza debajo y el teclado solo encoge el contenido.
        toolbar = buildToolbar()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(toolbar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(progress, LinearLayout.LayoutParams(MATCH_PARENT, dp(2)))
            addView(findBar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(content, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        }
        fullscreenHolder = FrameLayout(this).apply { visibility = View.GONE; setBackgroundColor(android.graphics.Color.BLACK) }
        root = FrameLayout(this).apply {
            setBackgroundColor(p.toolbarBg)
            addView(column, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(fullscreenHolder, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            setOnApplyWindowInsetsListener { _, insets ->
                val safe = insets.safeArea()
                column.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                insets
            }
        }
        setContentView(root)
    }

    /** Vuelve a construir la interfaz (cambio de estilo o de modo) sin cerrar las pestañas. */
    private fun rebuildUi() {
        currentTab?.webView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        customView?.let { hideCustomView() }
        buildUi()
        render()
    }

    /**
     * Barra superior: atrás, recargar, dirección (con la estrella), pestañas y menú.
     * En pantallas anchas (tabletas, horizontal) añade «Adelante» y Shield; en
     * teléfonos están en el menú para que la dirección tenga el máximo ancho.
     */
    private fun buildToolbar(): View {
        val p = look.palette
        val wide = resources.configuration.screenWidthDp >= 600
        shieldInToolbar = wide
        fun compact(button: ImageButton) = button.apply {
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(44))
            minimumWidth = dp(40)
        }
        backButton = compact(w.iconButton(R.drawable.icarus_back, "Atrás") { currentTab?.goBack() })
        reloadButton = compact(w.iconButton(R.drawable.icarus_reload, "Recargar") {
            val tab = currentTab ?: return@iconButton
            if (tab.loading) tab.stop() else tab.reload()
        })
        forwardButton = if (wide) compact(w.iconButton(R.drawable.icarus_forward, "Adelante") { currentTab?.goForward() }) else null
        val shield = FrameLayout(this).apply {
            background = pressable(look, null, 22)
            contentDescription = "ICARUS Shield"
            shieldIcon = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER }
            addView(shieldIcon, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            shieldBadge = w.text("", 10f, look.onAccent, bold = true).apply {
                background = rounded(look.accent, 8)
                setPadding(dp(4), 0, dp(4), 0)
                gravity = Gravity.CENTER
                minWidth = dp(16)
            }
            addView(shieldBadge, FrameLayout.LayoutParams(WRAP_CONTENT, dp(16), Gravity.TOP or Gravity.END).apply { setMargins(0, dp(4), dp(2), 0) })
            setOnClickListener { showShieldSheet() }
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(44))
        }
        tabsCount = w.text("1", 13f, p.fg1, bold = true).apply {
            gravity = Gravity.CENTER
            background = rounded(android.graphics.Color.TRANSPARENT, 6, p.fg2, 1.6f)
        }
        val tabsButton = FrameLayout(this).apply {
            background = pressable(look, null, 22)
            addView(tabsCount, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
            setOnClickListener { showTabsSheet() }
            contentDescription = "Ver pestañas"
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(44))
        }
        val menu = compact(w.iconButton(R.drawable.icarus_more, "Menú") { showMenu() })
        return w.horizontal(spacingDp = 2) {
            setBackgroundColor(p.toolbarBg)
            setPadding(dp(4), dp(6), dp(4), dp(6))
            contentDescription = "Barra de navegación"
            addView(backButton)
            forwardButton?.let { addView(it) }
            addView(reloadButton)
            addView(omnibox.view, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
            if (wide) addView(shield)
            addView(tabsButton)
            addView(menu)
        }
    }

    private fun buildFindBar() {
        val p = look.palette
        findField = EditText(this).apply {
            hint = "Buscar en la página"
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            inputType = InputType.TYPE_CLASS_TEXT
            textStyle(15f, p.fg1)
            setHintTextColor(p.fg3)
            background = rounded(p.omniboxBg, 18)
            setPadding(dp(14), dp(8), dp(14), dp(8))
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: android.text.Editable?) {
                    val query = s.toString()
                    if (query.isEmpty()) {
                        currentTab?.webView?.clearMatches()
                        findCount.text = ""
                    } else {
                        currentTab?.webView?.findAllAsync(query)
                    }
                }
            })
            setOnEditorActionListener { _, _, _ -> currentTab?.webView?.findNext(true); true }
        }
        findCount = w.text("", 13f, p.fg3)
        findBar = w.horizontal(spacingDp = 2) {
            visibility = View.GONE
            setBackgroundColor(p.toolbarBg)
            setPadding(dp(10), dp(4), dp(4), dp(6))
            addView(findField, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(findCount)
            addView(w.iconButton(R.drawable.icarus_chevron_up, "Coincidencia anterior") { currentTab?.webView?.findNext(false) })
            addView(w.iconButton(R.drawable.icarus_chevron_down, "Coincidencia siguiente") { currentTab?.webView?.findNext(true) })
            addView(w.iconButton(R.drawable.icarus_close, "Cerrar la búsqueda") { closeFind() })
        }
    }

    private fun openFind() {
        val tab = currentTab ?: return
        if (tab.showingNewTab || tab.webView == null) {
            showMessage("Abre una página para buscar en ella.")
            return
        }
        findBar.visibility = View.VISIBLE
        findField.requestFocus()
        getSystemService(android.view.inputmethod.InputMethodManager::class.java)?.showSoftInput(findField, 0)
    }

    private fun closeFind() {
        findBar.visibility = View.GONE
        findField.setText("")
        currentTab?.webView?.clearMatches()
        getSystemService(android.view.inputmethod.InputMethodManager::class.java)?.hideSoftInputFromWindow(findField.windowToken, 0)
    }

    override fun onFindResult(tab: BrowserTab, active: Int, total: Int, done: Boolean) {
        if (tab != currentTab || findBar.visibility != View.VISIBLE) return
        findCount.text = when {
            findField.text.isEmpty() -> ""
            total == 0 -> if (done) "Sin resultados" else ""
            else -> "${active + 1} de $total"
        }
    }

    /* --------------------------------- Pestañas --------------------------------- */

    private fun restoreSession() {
        val session = app.profile.session
        if (app.profile.settings.restoreSession && session.urls.isNotEmpty()) {
            session.urls.forEach { url -> tabs.add(BrowserTab(this, url)) }
            select(tabs[session.activeIndex.coerceIn(0, tabs.size - 1)])
        } else {
            openNewTab(focus = false)
        }
    }

    private fun saveSession() {
        val urls = tabs.map { if (it.showingNewTab) InternalPage.NEW_TAB.url else it.url }
        app.profile.saveSession(if (app.profile.settings.restoreSession) urls else emptyList(), tabs.indexOf(currentTab).coerceAtLeast(0))
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString?.let { url ->
                if (UrlUtils.parseWebUrl(url) != null) openNewTab(url)
            }
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra(SearchManager.QUERY)?.takeIf { it.isNotBlank() }?.let { query ->
                openNewTab(app.profile.settings.searchProvider.searchUrl(query))
            }
        }
    }

    fun openNewTab(url: String? = null, focus: Boolean = url == null): BrowserTab {
        val tab = BrowserTab(this, url)
        val index = tabs.indexOf(currentTab)
        tabs.add(if (index >= 0) index + 1 else tabs.size, tab)
        select(tab)
        if (focus) omnibox.focus()
        return tab
    }

    private fun select(tab: BrowserTab) {
        val previous = currentTab
        if (previous != null && previous != tab) {
            previous.webView?.let { view ->
                view.onPause()
                (view.parent as? ViewGroup)?.removeView(view)
            }
        }
        currentTab = tab
        closeFind()
        tab.activate()
        tab.webView?.onResume()
        render()
    }

    override fun closeTab(tab: BrowserTab) {
        val index = tabs.indexOf(tab)
        if (index < 0) return
        tabs.removeAt(index)
        tab.destroy()
        if (tabs.isEmpty()) {
            currentTab = null
            openNewTab(focus = false)
            return
        }
        if (tab == currentTab) {
            currentTab = null
            select(tabs[minOf(index, tabs.size - 1)])
        } else {
            updateChrome()
        }
    }

    private fun closeAllTabs() {
        tabs.forEach { it.destroy() }
        tabs.clear()
        currentTab = null
        openNewTab(focus = false)
    }

    override fun attachNewWindow(opener: BrowserTab, message: Message): Boolean {
        val transport = message.obj as? WebView.WebViewTransport ?: return false
        val tab = BrowserTab(this, null)
        tabs.add(tabs.indexOf(opener) + 1, tab)
        transport.webView = tab.adoptWindow()
        message.sendToTarget()
        select(tab)
        return true
    }

    override fun onTabChanged(tab: BrowserTab) {
        if (tab != currentTab) return
        render()
    }

    override fun onPageError(tab: BrowserTab) {
        if (tab == currentTab) render()
    }

    /** Muestra la pestaña actual: página de nueva pestaña, WebView o error. */
    private fun render() {
        val tab = currentTab ?: return
        val error = tab.error
        when {
            error != null -> {
                tab.webView?.let { if (it.parent != webHolder) attachWebView(it) }
                showError(tab, error)
                newTab.view.visibility = View.GONE
            }
            tab.showingNewTab -> {
                errorHolder.visibility = View.GONE
                newTab.render()
                newTab.view.visibility = View.VISIBLE
            }
            else -> {
                errorHolder.visibility = View.GONE
                newTab.view.visibility = View.GONE
                tab.webView?.let { if (it.parent != webHolder) attachWebView(it) }
            }
        }
        omnibox.setUrl(error?.url ?: if (tab.showingNewTab) InternalPage.NEW_TAB.url else tab.url, certificateError = error?.kind == PageError.Kind.CERTIFICATE)
        updateChrome()
    }

    private fun attachWebView(view: WebView) {
        (view.parent as? ViewGroup)?.removeView(view)
        webHolder.removeAllViews()
        webHolder.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    }

    private fun updateChrome() {
        val tab = currentTab ?: return
        val p = look.palette
        progress.setProgress(if (tab.loading && !tab.showingNewTab) tab.progress else 100)
        tabsCount.text = if (tabs.size > 99) "99+" else tabs.size.toString()
        val shield = app.shield.state()
        val siteAllowed = !tab.showingNewTab && app.shield.isSiteAllowed(tab.url)
        val active = shield.enabled && !siteAllowed
        shieldIcon.setIcon(if (active) R.drawable.icarus_shield else R.drawable.icarus_shield_off, if (active) look.accent else p.fg3)
        val count = if (tab.showingNewTab) 0 else tab.blocked.get()
        shieldBadge.text = if (count > 99) "99+" else count.toString()
        shieldBadge.visibility = if (count > 0 && active) View.VISIBLE else View.GONE
        (shieldBadge.parent as? View)?.contentDescription = if (active) {
            "ICARUS Shield: $count ${if (count == 1) "solicitud bloqueada" else "solicitudes bloqueadas"} en esta página"
        } else {
            "ICARUS Shield: inactivo en esta página"
        }
        backButton.isEnabled = tab.canGoBack
        backButton.alpha = if (tab.canGoBack) 1f else 0.4f
        forwardButton?.isEnabled = tab.canGoForward
        forwardButton?.alpha = if (tab.canGoForward) 1f else 0.4f
        val canReload = !tab.showingNewTab && tab.webView != null
        reloadButton.isEnabled = canReload
        reloadButton.alpha = if (canReload) 1f else 0.4f
        reloadButton.setIcon(if (tab.loading && canReload) R.drawable.icarus_close else R.drawable.icarus_reload, p.fg2)
        reloadButton.contentDescription = if (tab.loading && canReload) "Detener" else "Recargar"
        omnibox.setBookmarked(!tab.showingNewTab && app.bookmarks.find(tab.url) != null)
    }

    /* --------------------------- Barra de direcciones --------------------------- */

    private fun showSuggestions(query: String) {
        val rebase = omnibox.rebase
        if (rebase != null) {
            // Editando la base: no hay sugerencias, solo qué se conserva.
            suggestions.show(listOf(Omnibox.Suggestion(R.drawable.icarus_edit, "Escribe la nueva dirección base",
                if (rebase.suffix.isEmpty()) "Pulsa Ir para continuar" else "Se conserva ${rebase.suffix}", null)))
            return
        }
        val items = Omnibox.suggestions(query) { submitAddress(it) }
        val split = omnibox.currentSplit()
        // Como en escritorio: con la dirección sin tocar, «Editar base» conserva la ruta.
        val rebaseRow = if (split != null && omnibox.unchanged) {
            listOf(Omnibox.Suggestion(R.drawable.icarus_edit, "Editar base",
                if (split.suffix.isEmpty()) "Cambiar solo ${CustomAddresses.shortAddress(split.base)}" else "Cambiar solo la dirección base y conservar ${split.suffix}") {
                omnibox.startRebase(split)
            })
        } else {
            emptyList()
        }
        suggestions.show(rebaseRow + items)
    }

    /** Base escrita en el modo «Editar base»: se une al sufijo; si es personalizada, se elige guardar o ir. */
    fun submitRebase(base: String, split: AddressRebase.Split) {
        when (val joined = AddressRebase.join(base, split.suffix)) {
            is AddressRebase.Join.Failure -> showMessage(rebaseError(joined.error))
            is AddressRebase.Join.Ok -> {
                omnibox.clearFocus()
                suggestions.hide()
                val entry = split.entry
                if (entry != null) showRebaseChoices(base.trim(), joined.url, entry) else navigate(joined.url)
            }
        }
    }

    /** Sección de la página (`home` en `…/#home`) para «Guardar solo para #sección», salvo si la entrada ya es solo de ella. */
    private fun sectionFor(entry: CustomAddress): String? {
        val fragment = currentTab?.url?.let { UrlUtils.parseWebUrl(it) }?.fragment ?: return null
        return CustomAddresses.sectionOf("#$fragment")?.takeUnless { entry.sections == listOf(it) }
    }

    /** Guardar la base nueva en la dirección personalizada (persistente), solo para la sección de la página, o ir. */
    private fun showRebaseChoices(base: String, url: String, entry: CustomAddress) {
        val label = (AddressRebase.join(base, "") as? AddressRebase.Join.Ok)?.url?.let { CustomAddresses.shortAddress(it) } ?: base
        val section = sectionFor(entry)
        lastRebaseChoice = base to url
        lastRebaseSection = section
        val old = CustomAddresses.shortAddress(entry.address)
        lateinit var dialog: Dialog
        val content = w.vertical(spacingDp = 4) {
            val scope = if (entry.sections.isEmpty()) "para todas sus páginas" else "en ${CustomAddresses.formatSections(entry.sections)}"
            addView(w.row(R.drawable.icarus_check, "Guardar $label como dirección personalizada", "Sustituye a $old $scope") {
                saveRebaseBase(base, entry)
            })
            if (section != null) {
                addView(w.row(R.drawable.icarus_check, "Guardar $label solo para #$section", "Las demás secciones del sitio conservan su dirección") {
                    saveRebaseSection(base, entry, section)
                })
            }
            addView(w.row(R.drawable.icarus_globe, "Ir a ${CustomAddresses.shortAddress(url)}", "Abre esa dirección con la misma ruta") {
                dialog.dismiss()
                submitAddress(url, offerRebase = false)
            })
        }
        dialog = w.dialog("Nueva dirección base", content = content)
        rebaseDialog = dialog
        dialog.show()
    }

    /**
     * Guarda la base nueva en la dirección personalizada (mismo destino y estado) con la
     * validación del editor. La página no cambia: la barra la muestra con la base nueva.
     */
    fun saveRebaseBase(base: String, entry: CustomAddress): Boolean {
        rebaseDialog?.dismiss()
        rebaseDialog = null
        // Mismas secciones: renombrar una dirección de secciones no la convierte en la de todo el sitio.
        return when (val result = app.profile.saveCustomAddress(entry.target, base, entry.enabled, entry.id, CustomAddresses.formatSections(entry.sections))) {
            is CustomAddresses.Validation.Ok -> {
                showMessage("Dirección personalizada guardada: ${CustomAddresses.shortAddress(result.address)}")
                render()
                true
            }
            is CustomAddresses.Validation.Errors -> {
                showMessage(rebaseError(result.errors["address"] ?: result.errors["sections"] ?: result.errors["target"]))
                false
            }
        }
    }

    /** «Guardar solo para #sección»: la base nueva se usa en esa sección del destino y el resto conserva la suya. */
    fun saveRebaseSection(base: String, entry: CustomAddress, section: String): Boolean {
        rebaseDialog?.dismiss()
        rebaseDialog = null
        return when (val result = app.profile.saveSectionAddress(entry.target, section, base)) {
            is CustomAddresses.SectionSave.Ok -> {
                showMessage("#$section se mostrará como ${CustomAddresses.shortAddress(result.entry.address)}")
                render()
                true
            }
            is CustomAddresses.SectionSave.Failure -> {
                val errors = result.errors.errors
                showMessage(rebaseError(errors["address"] ?: errors["sections"] ?: errors["target"]))
                false
            }
        }
    }

    private fun rebaseError(code: String?): String = when (code) {
        "required" -> "Escribe la dirección base."
        "has-query" -> "La base no puede incluir «?» ni «#»: se conservan los de la página."
        "unsupported-protocol" -> "La base debe empezar por http:// o https://."
        "protocol-mismatch" -> "La dirección personalizada debe usar el mismo protocolo que el sitio (http o https)."
        "same-as-target" -> "Esa es la dirección real del sitio: no hace falta personalizarla."
        "address-in-use" -> "Otra dirección personalizada ya usa esa base."
        "address-is-target" -> "Esa base es la dirección real de otra entrada."
        "invalid-url" -> "La base no es una dirección válida."
        else -> "No se pudo guardar la dirección personalizada."
    }

    /** Estrella: añade la página a Favoritos o, si ya lo es, abre su editor. Pública para las pruebas. */
    fun toggleBookmark() {
        val tab = currentTab?.takeIf { !it.showingNewTab } ?: return
        val existing = app.bookmarks.find(tab.url)
        if (existing != null) {
            BookmarkEditor.show(this, w, existing, isNew = false) { updateChrome() }
            return
        }
        when (val result = app.bookmarks.add(AddressFormat.title(tab.url, tab.title), tab.url)) {
            is BookmarksStore.AddResult.Ok -> showMessage("Añadido a Favoritos. Toca la estrella para editarlo.")
            is BookmarksStore.AddResult.Failure -> showMessage(if (result.error == "limit") "Has llegado al máximo de favoritos." else "Solo se pueden guardar páginas web.")
        }
        updateChrome()
    }

    /** Abre lo escrito en la barra de direcciones. Público para las pruebas instrumentadas. */
    fun submitAddress(text: String, offerRebase: Boolean = true) {
        // Cambiar a mano solo la base de una página personalizada también ofrece guardarla.
        val split = if (offerRebase) omnibox.currentSplit() else null
        val entry = split?.entry
        val edit = if (split != null && entry != null) AddressRebase.classify(split, text) else null
        omnibox.clearFocus()
        suggestions.hide()
        if (edit is AddressRebase.Edit.Rebase && entry != null) {
            showRebaseChoices(edit.base, edit.url, entry)
            return
        }
        val settings = app.profile.settings
        // Las direcciones personalizadas se resuelven aquí: WebView siempre recibe la URL real.
        when (val result = InputResolver.resolve(text, settings.searchProvider, app.profile.customAddresses)) {
            InputResolution.Empty -> Unit
            is InputResolution.Url -> navigate(result.url)
            is InputResolution.Search -> navigate(result.url)
            is InputResolution.Custom -> navigate(result.url)
            is InputResolution.Internal -> openInternal(result.page)
            is InputResolution.InternalUnknown -> showMessage("La página interna «${result.text}» no existe.")
            is InputResolution.Blocked -> if (result.dangerous) {
                showMessage(Omnibox.blockedMessage(result))
            } else {
                confirmExternal(Uri.parse(text.trim()))
            }
        }
    }

    private fun navigate(url: String) {
        val tab = currentTab ?: openNewTab()
        tab.load(url)
        render()
    }

    private fun openInternal(page: InternalPage) {
        when (page) {
            InternalPage.NEW_TAB -> currentTab?.showNewTab()
            InternalPage.BLANK -> navigate("about:blank")
            InternalPage.HISTORY -> startActivity(Intent(this, HistoryActivity::class.java))
            InternalPage.BOOKMARKS -> startActivity(Intent(this, BookmarksActivity::class.java))
            InternalPage.DOWNLOADS -> startActivity(Intent(this, DownloadsActivity::class.java))
            InternalPage.SETTINGS -> openSettings(null)
        }
    }

    private fun openSettings(section: String?) {
        startActivity(Intent(this, SettingsActivity::class.java).apply { if (section != null) putExtra(SettingsActivity.EXTRA_SECTION, section) })
    }

    /**
     * Información del sitio: estado real de la conexión y, si se muestra una dirección
     * personalizada, a qué sitio van las solicitudes (nunca se oculta al pedirla).
     */
    private fun showSiteInfo() {
        val tab = currentTab ?: return
        if (tab.showingNewTab) {
            omnibox.focus()
            return
        }
        val certificate = tab.error?.kind == PageError.Kind.CERTIFICATE
        val url = if (certificate) tab.error!!.url else tab.url
        val display = AddressFormat.display(url, applyCustom = !certificate)
        val realHost = UrlUtils.parseWebUrl(url)?.host ?: url
        val shownHost = CustomAddresses.formatAddress(display.full, false).host
        val lines = ArrayList<String>()
        when {
            certificate -> lines.add("${app.sharedText("addressBar", "insecureTitle")}. ${app.sharedText("addressBar", "dangerousBody", "host" to realHost)}")
            display.secure -> lines.add("${app.sharedText("addressBar", "secureTitle")}. WebView de Android verificó el certificado de $realHost.")
            display.insecure -> lines.add("${app.sharedText("addressBar", "insecureTitle")}. ${app.sharedText("addressBar", "insecureBody")}")
        }
        val custom = display.custom
        if (custom != null) {
            lines.add("${app.sharedText("addressBar", "customTitle")}: ${app.sharedText("addressBar", "customBody", "shown" to shownHost, "real" to realHost)}")
        }
        val content = w.vertical(spacingDp = 8) {
            addView(w.button("Copiar dirección") { copy(display.full) }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        val origin = UrlUtils.parseWebUrl(url)?.let { "${it.protocol}//${it.host}/" }
        w.dialog(
            shownHost,
            lines.joinToString("\n\n"),
            content,
            positive = if (certificate || origin == null) null else if (custom != null) "Editar dirección personalizada" else "Personalizar dirección",
            negative = "Cerrar",
        ) {
            startActivity(
                Intent(this, SettingsActivity::class.java)
                    .putExtra(SettingsActivity.EXTRA_SECTION, "addresses")
                    .apply { if (custom != null) putExtra(SettingsActivity.EXTRA_EDIT_ID, custom.id) else putExtra(SettingsActivity.EXTRA_TARGET, origin) },
            )
            true
        }.show()
    }

    private fun copy(text: String) {
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Dirección", text))
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) showMessage("Copiado.")
    }

    /* --------------------------------- Hojas --------------------------------- */

    /**
     * Menú principal, como en Chrome para Android: arriba, Adelante, Favorito,
     * Compartir e Información del sitio; debajo, las páginas y herramientas.
     */
    private fun showMenu() {
        val tab = currentTab
        lateinit var dialog: Dialog
        val p = look.palette
        val page = tab?.takeIf { !it.showingNewTab }
        val bookmarked = page != null && app.bookmarks.find(page.url) != null
        val content = w.vertical {
            addView(w.horizontal {
                gravity = Gravity.CENTER
                setPadding(dp(8), dp(4), dp(8), dp(4))
                val actions = listOf(
                    Triple(R.drawable.icarus_forward, "Adelante", tab?.canGoForward == true) to { tab?.goForward() },
                    Triple(if (bookmarked) R.drawable.icarus_star_filled else R.drawable.icarus_star, if (bookmarked) "Editar favorito" else "Añadir a Favoritos", page != null) to { toggleBookmark() },
                    Triple(R.drawable.icarus_external, "Compartir", page != null) to { page?.let { share(it) } },
                    Triple(R.drawable.icarus_info, "Información del sitio", page != null) to { showSiteInfo() },
                )
                actions.forEach { (spec, action) ->
                    val (icon, label, enabled) = spec
                    val color = if (!enabled) p.fg3 else if (icon == R.drawable.icarus_star_filled) look.accent else p.fg1
                    addView(w.iconButton(icon, label, color) { dialog.dismiss(); action() }.apply { isEnabled = enabled },
                        LinearLayout.LayoutParams(0, dp(52), 1f))
                }
            })
            val update = app.updates.state
            if (update.shouldNotify) {
                addView(w.row(R.drawable.icarus_upgrade, "Actualizar ICARUS", "Versión ${update.available?.version} disponible") { dialog.dismiss(); openSettings("updates") })
            }
            addView(w.row(R.drawable.icarus_plus, "Nueva pestaña") { dialog.dismiss(); openNewTab() })
            addView(w.row(R.drawable.icarus_bookmarks, "Favoritos") { dialog.dismiss(); openInternal(InternalPage.BOOKMARKS) })
            addView(w.row(R.drawable.icarus_history, "Historial") { dialog.dismiss(); openInternal(InternalPage.HISTORY) })
            addView(w.row(R.drawable.icarus_download, "Descargas") { dialog.dismiss(); openInternal(InternalPage.DOWNLOADS) })
            if (!shieldInToolbar) {
                val blocked = page?.blocked?.get() ?: 0
                addView(w.row(R.drawable.icarus_shield, "ICARUS Shield", if (page == null) null else "$blocked ${if (blocked == 1) "solicitud bloqueada" else "solicitudes bloqueadas"} en esta página") {
                    dialog.dismiss()
                    showShieldSheet()
                })
            }
            if (page != null) {
                addView(w.row(R.drawable.icarus_search, "Buscar en la página") { dialog.dismiss(); openFind() })
                addView(w.row(R.drawable.icarus_copy, "Copiar dirección real") { dialog.dismiss(); copy(page.url) })
                if (UrlUtils.parseWebUrl(page.url) != null) {
                    addView(w.row(R.drawable.icarus_sparkle, "Añadir a accesos directos") { dialog.dismiss(); addShortcutFor(page) })
                }
            }
            addView(w.row(R.drawable.icarus_settings, "Configuración") { dialog.dismiss(); openSettings(null) })
        }
        dialog = w.sheet(content)
        menuDialog = dialog
        dialog.show()
    }

    private fun share(tab: BrowserTab) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, tab.url).putExtra(Intent.EXTRA_SUBJECT, tab.title)
        startActivity(Intent.createChooser(send, "Compartir"))
    }

    private fun showTabsSheet() {
        lateinit var dialog: Dialog
        val p = look.palette
        val content = w.vertical {
            addView(w.horizontal {
                setPadding(dp(20), dp(8), dp(8), dp(4))
                addView(w.text(if (tabs.size == 1) "1 pestaña" else "${tabs.size} pestañas", 18f, p.fg1, bold = true), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                addView(w.iconButton(R.drawable.icarus_plus, "Nueva pestaña") { dialog.dismiss(); openNewTab() })
            })
            for (tab in tabs.toList()) {
                val subtitle = if (tab.showingNewTab) "icarus://nueva-pestana" else AddressFormat.display(tab.url).text
                val close = w.iconButton(R.drawable.icarus_close, "Cerrar ${AddressFormat.title(tab.url, tab.title)}") { dialog.dismiss(); closeTab(tab); showTabsSheet() }
                val row = w.row(R.drawable.icarus_globe, AddressFormat.title(if (tab.showingNewTab) InternalPage.NEW_TAB.url else tab.url, tab.title), subtitle, close) {
                    dialog.dismiss()
                    select(tab)
                }
                if (tab == currentTab) row.background = pressable(look, rounded(look.accentSoft, 16), 16)
                addView(row)
            }
            if (tabs.size > 1) addView(w.row(R.drawable.icarus_trash, "Cerrar todas las pestañas") { dialog.dismiss(); closeAllTabs() })
        }
        dialog = w.sheet(content)
        dialog.show()
    }

    private fun showShieldSheet() {
        val page = currentTab?.takeIf { !it.showingNewTab }
        val state = app.shield.state()
        val p = look.palette
        val number = NumberFormat.getIntegerInstance(spanish)
        lateinit var dialog: Dialog
        val host = page?.let { UrlUtils.parseWebUrl(it.url)?.hostname }
        val content = w.vertical(paddingDp = 12, spacingDp = 10) {
            addView(w.horizontal(spacingDp = 10) {
                setPadding(dp(8), 0, 0, 0)
                addView(ImageView(context).apply { setIcon(R.drawable.icarus_shield, look.accent) }, LinearLayout.LayoutParams(dp(26), dp(26)))
                addView(w.text("ICARUS Shield", 19f, p.fg1, bold = true))
            })
            when {
                !state.enabled -> addView(w.text("Shield está desactivado. Puedes activarlo en Configuración.", 15f, p.fg2).apply { setPadding(dp(8), 0, dp(8), 0) })
                page == null || host == null -> addView(w.text("Abre una página web para ver qué se bloquea en ella.", 15f, p.fg2).apply { setPadding(dp(8), 0, dp(8), 0) })
                else -> {
                    val allowed = app.shield.isSiteAllowed(page.url)
                    addView(w.horizontal(spacingDp = 12) {
                        setPadding(dp(8), 0, dp(8), 0)
                        addView(w.text(number.format(page.blocked.get()), 40f, look.accent, bold = true))
                        addView(w.text("solicitudes de anuncios y rastreadores bloqueadas en esta página.", 15f, p.fg2), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                    })
                    addView(w.switchRow(
                        "Activo en $host",
                        if (allowed) "Este sitio está en tus excepciones: no se bloquea nada." else "Bloquea anuncios y rastreadores en este sitio. Al cambiarlo se vuelve a cargar la página.",
                        checked = !allowed,
                    ) { enabled ->
                        app.shield.setSiteAllowed(host, !enabled)
                        dialog.dismiss()
                        page.reload()
                    })
                }
            }
            addView(w.hint("${number.format(state.totalBlocked)} solicitudes bloqueadas en total.").apply { setPadding(dp(8), 0, dp(8), 0) })
            addView(w.row(R.drawable.icarus_settings, "Configuración de Shield") { dialog.dismiss(); openSettings("shield") })
        }
        dialog = w.sheet(content)
        dialog.show()
    }

    /* ----------------------------- Accesos directos ----------------------------- */

    private fun addShortcutFor(tab: BrowserTab) {
        when (val result = app.profile.saveShortcut(AddressFormat.title(tab.url, tab.title).take(Profile.SHORTCUT_TITLE_MAX), tab.url)) {
            is Profile.ShortcutResult.Ok -> showMessage("Acceso directo añadido.")
            is Profile.ShortcutResult.Errors -> showMessage(
                if (result.limit) "Puedes tener como máximo ${Profile.MAX_SHORTCUTS} accesos directos."
                else result.errors.values.firstOrNull()?.let { app.sharedText("shortcutErrors", it) } ?: "No se pudo añadir.",
            )
        }
    }

    private fun editShortcut(shortcut: Shortcut?) {
        val title = w.field("Nombre", shortcut?.title.orEmpty(), "Ej. Noticias")
        val url = w.field("Dirección", shortcut?.url.orEmpty(), "ejemplo.com", inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        lateinit var dialog: Dialog
        val content = w.vertical(spacingDp = 12) {
            addView(title.view)
            addView(url.view)
            if (shortcut != null) {
                addView(w.button("Eliminar acceso directo", danger = true) {
                    app.profile.removeShortcut(shortcut.id)
                    dialog.dismiss()
                })
            }
        }
        dialog = w.dialog(if (shortcut == null) "Nuevo acceso directo" else "Editar acceso directo", content = content, positive = "Guardar") {
            when (val result = app.profile.saveShortcut(title.value, url.value, shortcut?.id)) {
                is Profile.ShortcutResult.Ok -> true
                is Profile.ShortcutResult.Errors -> {
                    if (result.limit) showMessage("Puedes tener como máximo ${Profile.MAX_SHORTCUTS} accesos directos.")
                    title.setError(result.errors["title"]?.let { app.sharedText("shortcutErrors", it) })
                    url.setError(result.errors["url"]?.let { app.sharedText("shortcutErrors", it) })
                    result.limit
                }
            }
        }
        dialog.show()
    }

    private fun onProfileChanged() {
        val next = app.look()
        if (next != lastLook) {
            applyNightMode(app.profile.settings.colorMode)
            rebuildUi()
        } else {
            render()
        }
    }

    /* ------------------------------ Errores de página ------------------------------ */

    private fun showError(tab: BrowserTab, error: PageError) {
        val p = look.palette
        errorHolder.removeAllViews()
        val (icon, title) = when (error.kind) {
            PageError.Kind.CERTIFICATE -> R.drawable.icarus_lock to "La conexión no es segura"
            PageError.Kind.NETWORK -> R.drawable.icarus_warning to "No se pudo abrir la página"
            PageError.Kind.CRASHED -> R.drawable.icarus_warning to "La página dejó de funcionar"
        }
        val body = w.vertical(paddingDp = 28, spacingDp = 14) {
            addView(ImageView(context).apply { setIcon(icon, if (error.kind == PageError.Kind.CERTIFICATE) p.danger else p.fg2) }, LinearLayout.LayoutParams(dp(40), dp(40)))
            addView(w.title(title))
            addView(w.text(error.detail, 16f, p.fg2))
            if (error.kind == PageError.Kind.CERTIFICATE) {
                addView(w.text("ICARUS no permite continuar a un sitio con un certificado no válido: alguien podría estar suplantándolo o leyendo la conexión.", 15f, p.fg2))
            }
            addView(w.text(error.url, 13f, p.fg3).apply { setTextIsSelectable(true) })
            addView(w.horizontal(spacingDp = 10) {
                when (error.kind) {
                    PageError.Kind.CERTIFICATE -> addView(w.button("Volver", primary = true) { leaveError(tab) })
                    PageError.Kind.NETWORK, PageError.Kind.CRASHED -> {
                        addView(w.button("Reintentar", primary = true) { tab.reload() })
                        addView(w.button("Volver") { leaveError(tab) })
                    }
                }
            })
        }
        errorHolder.addView(w.scroll(body), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        errorHolder.visibility = View.VISIBLE
    }

    private fun leaveError(tab: BrowserTab) {
        val view = tab.webView
        if (view != null && view.canGoBack()) {
            tab.clearError()
            view.goBack()
        } else {
            tab.showNewTab()
        }
    }

    /* ------------------------------- Peticiones web ------------------------------- */

    override fun requestAuth(tab: BrowserTab, handler: HttpAuthHandler, host: String, realm: String) {
        val user = w.field("Usuario")
        val password = w.field("Contraseña", inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val insecure = tab.url.startsWith("http://", ignoreCase = true)
        val message = buildString {
            append("$host solicita un usuario y una contraseña.")
            if (realm.isNotBlank()) append("\nEl sitio dice: «$realm»")
            if (insecure) append("\n\nLa conexión con este sitio no es privada: las credenciales se envían sin cifrar.")
        }
        val content = w.vertical(spacingDp = 12) {
            addView(user.view)
            addView(password.view)
        }
        w.dialog("Iniciar sesión", message, content, positive = "Iniciar sesión", onNegative = { handler.cancel() }) {
            handler.proceed(user.value, password.edit.text.toString())
            true
        }.show()
    }

    override fun requestPermission(tab: BrowserTab, origin: String, permissions: Set<SitePermission>, callback: (Boolean) -> Unit) {
        val decisions = permissions.map { app.profile.permission(origin, it) }
        when {
            decisions.any { it == false } -> callback(false)
            decisions.all { it == true } -> ensureRuntimePermissions(permissions, callback)
            else -> {
                val names = permissions.joinToString(" y ") {
                    when (it) {
                        SitePermission.LOCATION -> "tu ubicación"
                        SitePermission.CAMERA -> "la cámara"
                        SitePermission.MICROPHONE -> "el micrófono"
                    }
                }
                var answered = false
                w.dialog(
                    "Permiso del sitio",
                    "$origin quiere usar $names.\n\nPuedes cambiar la decisión en Configuración → Privacidad → Permisos de sitios.",
                    positive = "Permitir",
                    negative = "Bloquear",
                    onNegative = {
                        if (!answered) {
                            answered = true
                            permissions.forEach { app.profile.setPermission(origin, it, false) }
                            callback(false)
                        }
                    },
                ) {
                    answered = true
                    permissions.forEach { app.profile.setPermission(origin, it, true) }
                    ensureRuntimePermissions(permissions, callback)
                    true
                }.apply { setCancelable(false) }.show()
            }
        }
    }

    /** Si el sitio tiene permiso en ICARUS, Android también debe concedérselo a la app. */
    private fun ensureRuntimePermissions(permissions: Set<SitePermission>, callback: (Boolean) -> Unit) {
        val needed = permissions.flatMap {
            when (it) {
                SitePermission.LOCATION -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                SitePermission.CAMERA -> listOf(Manifest.permission.CAMERA)
                SitePermission.MICROPHONE -> listOf(Manifest.permission.RECORD_AUDIO)
            }
        }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) {
            callback(true)
            return
        }
        pendingPermission?.invoke(false)
        pendingPermission = callback
        requestPermissions(needed.toTypedArray(), REQUEST_PERMISSIONS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PERMISSIONS) return
        val callback = pendingPermission ?: return
        pendingPermission = null
        // Para la ubicación basta con la aproximada.
        val granted = permissions.indices.all { index ->
            grantResults.getOrNull(index) == PackageManager.PERMISSION_GRANTED || permissions[index] == Manifest.permission.ACCESS_FINE_LOCATION &&
                permissions.indices.any { permissions[it] == Manifest.permission.ACCESS_COARSE_LOCATION && grantResults.getOrNull(it) == PackageManager.PERMISSION_GRANTED }
        }
        if (!granted) showMessage("Android no concedió el permiso a ICARUS.")
        callback(granted)
    }

    @Suppress("DEPRECATION")
    override fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        return try {
            startActivityForResult(params.createIntent(), REQUEST_FILE)
            true
        } catch (_: ActivityNotFoundException) {
            fileCallback = null
            showMessage("No hay ninguna app para elegir archivos.")
            false
        }
    }

    @Deprecated("API de Activity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    override fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        fullscreenHolder.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        fullscreenHolder.visibility = View.VISIBLE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
    }

    override fun hideCustomView() {
        val view = customView ?: return
        fullscreenHolder.removeView(view)
        fullscreenHolder.visibility = View.GONE
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.insetsController?.show(WindowInsets.Type.systemBars())
    }

    override fun startDownload(tab: BrowserTab, url: String, userAgent: String?, contentDisposition: String?, mimeType: String?, length: Long) {
        val scheme = Uri.parse(url).scheme
        if (scheme != "http" && scheme != "https") {
            showMessage("Esta descarga (enlace $scheme:) no es compatible con ICARUS para Android.")
            return
        }
        val name = app.downloads.suggestedName(url, contentDisposition, mimeType)
        val size = if (length > 0) Formatter.formatShortFileSize(this, length) else "tamaño desconocido"
        val source = Uri.parse(url).host.orEmpty()
        w.dialog("¿Descargar el archivo?", "$name\n$size · $source\n\nSe guardará en la carpeta Descargas.", positive = "Descargar") {
            when (val result = app.downloads.start(url, userAgent, contentDisposition, mimeType, tab.url)) {
                is DownloadsStore.StartResult.Started -> showMessage("Descarga iniciada: ${result.name}")
                DownloadsStore.StartResult.Unsupported -> showMessage("Esta descarga no es compatible con ICARUS para Android.")
                is DownloadsStore.StartResult.Failed -> showMessage(result.message)
            }
            true
        }.show()
    }

    override fun openExternal(tab: BrowserTab, uri: Uri, userGesture: Boolean) {
        if (!userGesture) {
            showMessage("ICARUS bloqueó un intento de abrir otra aplicación sin que lo pidieras.")
            return
        }
        if (uri.scheme.equals("intent", ignoreCase = true)) {
            val intent = try {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
            } catch (_: Exception) {
                return
            }
            val fallback = intent.getStringExtra("browser_fallback_url")
            // Solo se abren actividades navegables: nada de componentes concretos.
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.component = null
            intent.selector = null
            if (intent.resolveActivity(packageManager) == null) {
                if (fallback != null && UrlUtils.parseWebUrl(fallback) != null) tab.load(fallback) else showMessage("Ninguna aplicación puede abrir este enlace.")
                return
            }
            confirmExternal(intent, intent.`package` ?: "otra aplicación")
            return
        }
        confirmExternal(uri)
    }

    private fun confirmExternal(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        confirmExternal(intent, "${uri.scheme}:")
    }

    private fun confirmExternal(intent: Intent, label: String) {
        w.dialog("¿Abrir en otra aplicación?", "Este enlace ($label) se abrirá fuera de ICARUS.", positive = "Abrir") {
            try {
                startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                showMessage("Ninguna aplicación puede abrir este enlace.")
            } catch (_: SecurityException) {
                showMessage("Android no permite abrir este enlace.")
            }
            true
        }.show()
    }

    /**
     * Aviso discreto (sin interrumpir la navegación): una vez por versión nueva no
     * pospuesta, y la confirmación tras actualizar. El menú muestra «Actualizar ICARUS».
     */
    private fun notifyUpdate(state: UpdateManager.State) {
        state.justUpdated?.let { (_, to) ->
            if (notifiedUpdates.add("updated:$to")) showMessage("ICARUS se ha actualizado a la versión $to.")
        }
        val version = state.available?.version ?: return
        if (state.shouldNotify && state.status == UpdateManager.Status.AVAILABLE && notifiedUpdates.add(version)) {
            showMessage("ICARUS $version está disponible. Instálala desde el menú → Actualizar ICARUS.")
        }
    }

    override fun showMessage(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    /* ---------------------------------- Atrás ---------------------------------- */

    private fun handleBack() {
        val tab = currentTab
        when {
            customView != null -> hideCustomView()
            findBar.visibility == View.VISIBLE -> closeFind()
            omnibox.edit.hasFocus() -> {
                omnibox.clearFocus()
                suggestions.hide()
            }
            tab != null && tab.error != null -> leaveError(tab)
            tab != null && tab.canGoBack -> tab.goBack()
            else -> moveTaskToBack(true)
        }
    }

    /* ------------------------- Ayuda para las pruebas ------------------------- */

    /** Texto visible en la barra de direcciones (dirección personalizada o real, en forma corta). */
    val addressText: String get() = omnibox.text
    val tabCount: Int get() = tabs.size
    val toolbarView: View get() = toolbar
    val contentView: View get() = webHolder
    /** Última base nueva ofrecida para guardar (base, URL con el sufijo conservado). */
    var lastRebaseChoice: Pair<String, String>? = null
        private set
    /** Sección que se ofreció guardar aparte con la última base nueva (null si no se ofreció). */
    var lastRebaseSection: String? = null
        private set
    private var rebaseDialog: Dialog? = null
    fun currentAddressSplit(): AddressRebase.Split? = omnibox.currentSplit()
    fun focusAddressBar() = omnibox.focus()
    fun leaveAddressBar() {
        omnibox.clearFocus()
        suggestions.hide()
    }
    private var menuDialog: Dialog? = null
    fun openMenuForTest() = showMenu()
    fun closeMenuForTest() {
        menuDialog?.dismiss()
        menuDialog = null
    }

    companion object {
        private const val REQUEST_FILE = 1
        private const val REQUEST_PERMISSIONS = 2
    }
}

/** Línea de progreso de carga (2 dp) con el color de acento. */
class ProgressLine(context: Context, color: Int) : View(context) {
    private val paint = Paint().apply { this.color = color }
    private var value = 100

    fun setProgress(progress: Int) {
        value = progress
        visibility = if (progress in 0..99) VISIBLE else INVISIBLE
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width * value / 100f, height.toFloat(), paint)
    }
}
