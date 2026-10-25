package io.github.saaqes.icarusbrowser

import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import io.github.saaqes.icarusbrowser.core.CustomAddress
import io.github.saaqes.icarusbrowser.core.CustomAddresses
import io.github.saaqes.icarusbrowser.core.InputResolution
import io.github.saaqes.icarusbrowser.core.InputResolver
import io.github.saaqes.icarusbrowser.core.InternalPage
import io.github.saaqes.icarusbrowser.core.UrlUtils

/**
 * Cómo se presenta una dirección, igual que en escritorio y en Chrome: la dirección
 * personalizada si la página está dentro de su destino; si no, la real. Sin foco,
 * en forma corta (sin https:// ni www.); al editar, completa.
 */
object AddressFormat {
    /**
     * `text`: lo que se ve sin foco; `full`: lo que se edita; `secure`/`insecure`:
     * protocolo real de la página; `custom`: entrada aplicada (o null).
     */
    data class Display(val text: String, val full: String, val secure: Boolean, val insecure: Boolean, val custom: CustomAddress?)

    fun display(url: String, applyCustom: Boolean = true): Display {
        if (url == InternalPage.NEW_TAB.url) return Display("", "", secure = false, insecure = false, custom = null)
        val parsed = UrlUtils.parseWebUrl(url) ?: return Display(url, url, secure = false, insecure = false, custom = null)
        val profile = IcarusApp.instance.profile
        val match = if (applyCustom) CustomAddresses.displayUrlFor(url, profile.customAddresses) else null
        val shown = match?.url ?: url
        val text = CustomAddresses.formatAddress(shown, profile.settings.showFullUrls).toString()
        return Display(text, CustomAddresses.formatAddress(shown, true).toString(), parsed.protocol == "https:", parsed.protocol == "http:", match?.entry)
    }

    /** Título visible de una página: el de la página o, si no tiene, su dirección visible. */
    fun title(url: String, pageTitle: String): String {
        if (url == InternalPage.NEW_TAB.url) return "Nueva pestaña"
        return pageTitle.ifBlank { display(url).let { CustomAddresses.shortAddress(it.full) } }
    }
}

/**
 * Barra de direcciones, como en Chrome: una sola dirección (la personalizada si
 * existe); al tocarla, la dirección completa seleccionada; mientras se escribe,
 * nada la sustituye. El icono indica la conexión real y, con un certificado no
 * válido, se muestra la dirección real que falló.
 */
class Omnibox(
    private val context: Context,
    private val w: Widgets,
    private val onSubmit: (String) -> Unit,
    private val onSecurityInfo: () -> Unit,
    private val onFocusChanged: (Boolean) -> Unit,
    private val onQueryChanged: (String) -> Unit,
) {
    private val p = w.look.palette
    private var realUrl: String = InternalPage.NEW_TAB.url
    private var certificateError = false
    private var updating = false

    private val securityIcon = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER
        background = context.pressable(w.look, null, 18)
        setOnClickListener { onSecurityInfo() }
    }

    val edit: EditText = EditText(context).apply {
        background = null
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        hint = "Busca o escribe una dirección"
        textStyle(16f, p.omniboxFg)
        setHintTextColor(p.omniboxDim)
        setSelectAllOnFocus(true)
        setPadding(0, 0, 0, 0)
        contentDescription = "Barra de direcciones"
        setOnEditorActionListener { _, actionId, event ->
            val enter = event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
            if (actionId == EditorInfo.IME_ACTION_GO || enter) {
                submit()
                true
            } else {
                false
            }
        }
        // Escape con teclado físico, como en Chrome: el primero recupera la dirección, el segundo sale de la barra.
        setOnKeyListener { _, keyCode, event ->
            if (keyCode != KeyEvent.KEYCODE_ESCAPE || event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
            val full = currentDisplay().full
            if (text.toString() != full) {
                updating = true
                setText(full)
                selectAll()
                updating = false
                onQueryChanged(full)
            } else {
                this@Omnibox.clearFocus()
            }
            true
        }
        setOnFocusChangeListener { _, focused ->
            updating = true
            if (focused) {
                setText(currentDisplay().full)
                selectAll()
            } else {
                showDisplay()
            }
            updating = false
            refreshIcon()
            onFocusChanged(focused)
            if (focused) onQueryChanged(text.toString())
        }
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (!updating && hasFocus()) onQueryChanged(s.toString())
            }
        })
    }

    val view: LinearLayout = w.horizontal(spacingDp = 4) {
        background = context.rounded(p.omniboxBg, if (w.look.theme == io.github.saaqes.icarusbrowser.core.ThemeId.PANORAMA) 12 else 22, p.border1)
        setPadding(w.dp(4), 0, w.dp(12), 0)
        minimumHeight = w.dp(44)
        addView(securityIcon, LinearLayout.LayoutParams(w.dp(36), w.dp(36)))
        addView(edit, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { gravity = Gravity.CENTER_VERTICAL })
    }

    /** `certificateError`: la página no se cargó porque su certificado no es válido. */
    fun setUrl(url: String, certificateError: Boolean = false) {
        realUrl = url
        this.certificateError = certificateError
        if (!edit.hasFocus()) showDisplay()
        refreshIcon()
    }

    /** Con un error de certificado, la dirección real (sin dirección personalizada) y completa. */
    private fun currentDisplay(): AddressFormat.Display {
        val display = AddressFormat.display(realUrl, applyCustom = !certificateError)
        return if (certificateError) display.copy(text = display.full) else display
    }

    fun focus() {
        edit.requestFocus()
        context.getSystemService(InputMethodManager::class.java)?.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
    }

    fun clearFocus() {
        edit.clearFocus()
        context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(edit.windowToken, 0)
    }

    val text: String get() = edit.text.toString()

    private fun submit() {
        val value = edit.text.toString()
        clearFocus()
        onSubmit(value)
    }

    private fun showDisplay() {
        edit.setText(currentDisplay().text)
    }

    private fun refreshIcon() {
        val display = currentDisplay()
        val (icon, color, description) = when {
            realUrl == InternalPage.NEW_TAB.url -> Triple(R.drawable.icarus_search, p.omniboxDim, "Buscar")
            certificateError -> Triple(R.drawable.icarus_warning, p.danger, "No seguro: el certificado no es válido")
            display.secure -> Triple(R.drawable.icarus_sliders, p.fg2, "Información del sitio")
            display.insecure -> Triple(R.drawable.icarus_warning, p.warning, "No seguro: ver información del sitio")
            else -> Triple(R.drawable.icarus_info, p.fg2, "Información del sitio")
        }
        securityIcon.setIcon(icon, color)
        securityIcon.contentDescription = description
    }

    /** Filas de sugerencia para el texto escrito. */
    data class Suggestion(val icon: Int, val title: String, val subtitle: String?, val action: (() -> Unit)?)

    companion object {
        fun suggestions(query: String, open: (String) -> Unit): List<Suggestion> {
            val app = IcarusApp.instance
            val settings = app.profile.settings
            val entries = app.profile.customAddresses
            val result = ArrayList<Suggestion>()
            val trimmed = query.trim()
            val shown = { url: String -> CustomAddresses.shortAddress(AddressFormat.display(url).full) }
            if (trimmed.isNotEmpty()) {
                when (val resolution = InputResolver.resolve(trimmed, settings.searchProvider, entries)) {
                    is InputResolution.Url -> result.add(Suggestion(R.drawable.icarus_globe, "Ir a ${shown(resolution.url)}", null) { open(trimmed) })
                    is InputResolution.Custom -> result.add(
                        Suggestion(R.drawable.icarus_globe, "Ir a ${CustomAddresses.shortAddress(resolution.address)}", "Dirección personalizada") { open(trimmed) },
                    )
                    is InputResolution.Search -> result.add(
                        Suggestion(R.drawable.icarus_search, "Buscar «${resolution.query}»", "con ${resolution.provider.displayName}") { open(trimmed) },
                    )
                    is InputResolution.Internal -> result.add(Suggestion(R.drawable.icarus_page, "Abrir ${internalName(resolution.page)}", resolution.page.url) { open(trimmed) })
                    is InputResolution.InternalUnknown -> result.add(Suggestion(R.drawable.icarus_warning, "Página interna desconocida", trimmed, null))
                    is InputResolution.Blocked -> result.add(Suggestion(R.drawable.icarus_shield, blockedMessage(resolution), null, null))
                    InputResolution.Empty -> Unit
                }
            }
            val needle = trimmed.lowercase()
            if (needle.isNotEmpty()) {
                CustomAddresses.startingWith(trimmed, entries)
                    .filter { entry -> result.none { it.subtitle == "Dirección personalizada" && it.title.endsWith(CustomAddresses.shortAddress(entry.address)) } }
                    .take(2)
                    .forEach { entry -> result.add(Suggestion(R.drawable.icarus_globe, CustomAddresses.shortAddress(entry.address), "Dirección personalizada") { open(entry.target) }) }
            }
            // Accesos directos e historial se comparan y se muestran con la dirección visible.
            val matches = { title: String, url: String -> needle.isEmpty() || title.lowercase().contains(needle) || shown(url).lowercase().contains(needle) }
            app.profile.shortcuts.filter { matches(it.title, it.url) }.take(if (needle.isEmpty()) 0 else 3).forEach { shortcut ->
                result.add(Suggestion(R.drawable.icarus_sparkle, shortcut.title, shown(shortcut.url)) { open(shortcut.url) })
            }
            val seen = HashSet<String>()
            app.history.search("").asSequence().filter { matches(it.title, it.url) && seen.add(it.url) }.take(if (needle.isEmpty()) 6 else 5).forEach { item ->
                result.add(Suggestion(R.drawable.icarus_clock, AddressFormat.title(item.url, item.title), shown(item.url)) { open(item.url) })
            }
            return result
        }

        fun blockedMessage(resolution: InputResolution.Blocked) = if (resolution.dangerous) {
            "ICARUS bloquea las direcciones ${resolution.protocol} por seguridad."
        } else {
            "ICARUS no abre direcciones ${resolution.protocol} en una pestaña."
        }

        fun internalName(page: InternalPage) = when (page) {
            InternalPage.NEW_TAB -> "Nueva pestaña"
            InternalPage.BLANK -> "Página en blanco"
            InternalPage.HISTORY -> "Historial"
            InternalPage.DOWNLOADS -> "Descargas"
            InternalPage.SETTINGS -> "Configuración"
        }
    }
}

/** Lista de sugerencias bajo (o sobre) la barra de direcciones. */
class SuggestionsView(context: Context, private val w: Widgets) {
    val view: LinearLayout = w.vertical(paddingDp = 8) {
        background = context.rounded(w.look.palette.surface1, 0)
        isClickable = true
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
    }

    fun show(items: List<Omnibox.Suggestion>) {
        view.removeAllViews()
        if (items.isEmpty()) {
            view.addView(w.hint("Escribe una dirección o una búsqueda.").apply { setPadding(w.dp(16), w.dp(16), w.dp(16), w.dp(16)) })
        }
        for (item in items) {
            view.addView(w.row(item.icon, item.title, item.subtitle, onClick = item.action?.let { action -> { _: View -> action() } }))
        }
        view.visibility = View.VISIBLE
    }

    fun hide() {
        view.visibility = View.GONE
    }
}
