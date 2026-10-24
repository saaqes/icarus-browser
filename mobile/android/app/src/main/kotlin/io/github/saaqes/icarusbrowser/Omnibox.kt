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
import io.github.saaqes.icarusbrowser.core.AliasRules
import io.github.saaqes.icarusbrowser.core.InputResolution
import io.github.saaqes.icarusbrowser.core.InputResolver
import io.github.saaqes.icarusbrowser.core.InternalPage
import io.github.saaqes.icarusbrowser.core.UrlUtils

/** Cómo se presenta una dirección: el alias si hay regla activa, o el host y la ruta. */
object AddressFormat {
    data class Display(val text: String, val alias: String?, val secure: Boolean, val insecure: Boolean)

    fun display(url: String, showAliases: Boolean = IcarusApp.instance.profile.settings.showAliases): Display {
        if (url == InternalPage.NEW_TAB.url) return Display("", null, secure = false, insecure = false)
        val parsed = UrlUtils.parseWebUrl(url) ?: return Display(url, null, secure = false, insecure = false)
        if (showAliases) {
            AliasRules.findMatch(url, IcarusApp.instance.profile.aliasRules)?.let { match ->
                return Display(match.rule.alias, match.rule.alias, secure = parsed.protocol == "https:", insecure = parsed.protocol == "http:")
            }
        }
        val path = (parsed.pathname + parsed.search).let { if (it == "/") "" else it }
        return if (parsed.protocol == "https:") {
            Display(parsed.host.removePrefix("www.") + path, null, secure = true, insecure = false)
        } else {
            Display("http://${parsed.host}$path", null, secure = false, insecure = !UrlUtils.isLoopbackHost(parsed.hostname))
        }
    }

    /** Título visible de una página: el nombre de la regla de alias, el título o el host. */
    fun title(url: String, pageTitle: String): String {
        if (url == InternalPage.NEW_TAB.url) return "Nueva pestaña"
        if (IcarusApp.instance.profile.settings.showAliases) {
            AliasRules.findMatch(url, IcarusApp.instance.profile.aliasRules)?.let { return it.rule.displayName }
        }
        return pageTitle.ifBlank { UrlUtils.parseWebUrl(url)?.hostname ?: url }
    }
}

/**
 * Barra de direcciones. Sin foco muestra el alias o el host; al tocarla muestra la
 * URL real completa. Las sugerencias usan el mismo resolvedor que escritorio.
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
        setOnFocusChangeListener { _, focused ->
            updating = true
            if (focused) {
                setText(if (realUrl == InternalPage.NEW_TAB.url) "" else realUrl)
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

    fun setUrl(url: String) {
        realUrl = url
        if (!edit.hasFocus()) showDisplay()
        refreshIcon()
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
        val display = AddressFormat.display(realUrl)
        edit.setText(display.text)
    }

    private fun refreshIcon() {
        val display = AddressFormat.display(realUrl)
        val (icon, color, description) = when {
            edit.hasFocus() || realUrl == InternalPage.NEW_TAB.url -> Triple(R.drawable.icarus_search, p.omniboxDim, "Buscar")
            display.alias != null -> Triple(R.drawable.icarus_tag, w.look.accent, "Alias de ICARUS: ver la dirección real")
            display.secure -> Triple(R.drawable.icarus_lock, p.fg2, "Conexión segura")
            display.insecure -> Triple(R.drawable.icarus_warning, p.danger, "Conexión no segura")
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
            val rules = app.profile.aliasRules
            val result = ArrayList<Suggestion>()
            val trimmed = query.trim()
            if (trimmed.isNotEmpty()) {
                when (val resolution = InputResolver.resolve(trimmed, settings.searchProvider, rules)) {
                    is InputResolution.Url -> result.add(Suggestion(R.drawable.icarus_globe, "Ir a ${resolution.url}", null) { open(trimmed) })
                    is InputResolution.Search -> result.add(
                        Suggestion(R.drawable.icarus_search, "Buscar «${resolution.query}»", "con ${resolution.provider.displayName}") { open(trimmed) },
                    )
                    is InputResolution.Alias -> result.add(
                        Suggestion(R.drawable.icarus_tag, "Abrir ${resolution.rule.alias}", "Alias de ICARUS → ${resolution.url}") { open(trimmed) },
                    )
                    is InputResolution.AliasUnresolved -> result.add(Suggestion(R.drawable.icarus_warning, resolution.alias, aliasProblem(resolution), null))
                    is InputResolution.Internal -> result.add(Suggestion(R.drawable.icarus_page, "Abrir ${internalName(resolution.page)}", resolution.page.url) { open(trimmed) })
                    is InputResolution.InternalUnknown -> result.add(Suggestion(R.drawable.icarus_warning, "Página interna desconocida", trimmed, null))
                    is InputResolution.Blocked -> result.add(Suggestion(R.drawable.icarus_shield, blockedMessage(resolution), null, null))
                    InputResolution.Empty -> Unit
                }
            }
            val needle = trimmed.lowercase()
            val shortcuts = app.profile.shortcuts.filter { needle.isEmpty() || it.title.lowercase().contains(needle) || it.url.lowercase().contains(needle) }
            shortcuts.take(if (needle.isEmpty()) 0 else 3).forEach { shortcut ->
                result.add(Suggestion(R.drawable.icarus_sparkle, shortcut.title, AddressFormat.display(shortcut.url).text) { open(shortcut.url) })
            }
            val seen = HashSet<String>()
            app.history.search(trimmed).asSequence().filter { seen.add(it.url) }.take(if (needle.isEmpty()) 6 else 5).forEach { item ->
                result.add(Suggestion(R.drawable.icarus_clock, AddressFormat.title(item.url, item.title), AddressFormat.display(item.url).text) { open(item.url) })
            }
            return result
        }

        fun aliasProblem(resolution: InputResolution.AliasUnresolved) = if (resolution.reason == "disabled") {
            "La regla del alias «${resolution.alias}» está desactivada."
        } else {
            "«${resolution.alias}» no corresponde a ninguna regla de alias. Los alias .icarus no son dominios de Internet."
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
            view.addView(w.hint("Escribe una dirección, una búsqueda o un alias .icarus.").apply { setPadding(w.dp(16), w.dp(16), w.dp(16), w.dp(16)) })
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
