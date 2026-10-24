package io.github.saaqes.icarusbrowser

import android.app.Dialog
import android.content.Intent
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import android.widget.CheckBox
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import io.github.saaqes.icarusbrowser.core.AliasMatchType
import io.github.saaqes.icarusbrowser.core.AliasRule
import io.github.saaqes.icarusbrowser.core.AliasRules
import io.github.saaqes.icarusbrowser.core.ClearRange
import io.github.saaqes.icarusbrowser.core.ColorMode
import io.github.saaqes.icarusbrowser.core.Profile
import io.github.saaqes.icarusbrowser.core.SearchProvider
import io.github.saaqes.icarusbrowser.core.SitePermission
import io.github.saaqes.icarusbrowser.core.ThemeId
import io.github.saaqes.icarusbrowser.core.Themes
import io.github.saaqes.icarusbrowser.core.shield.ShieldListInfo
import io.github.saaqes.icarusbrowser.core.shield.ShieldState
import io.github.saaqes.icarusbrowser.core.shield.ShieldStore
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import java.util.Locale

class SettingsActivity : ScreenActivity() {
    private val spanish = Locale.forLanguageTag("es-ES")
    private val number get() = NumberFormat.getIntegerInstance(spanish)
    /** Los contadores cambian mientras se navega: no se redibuja si el usuario está escribiendo. */
    private val shieldListener: (ShieldState) -> Unit = {
        if (currentFocus !is android.widget.EditText && (currentTitle == "ICARUS Shield" || currentTitle == rootTitle())) refresh()
    }

    override fun rootTitle() = "Configuración"

    override fun openInitialPage() {
        app.addShieldListener(shieldListener)
        when (intent.getStringExtra(EXTRA_SECTION)) {
            "shield" -> push("ICARUS Shield", ::shieldPage)
            "aliases" -> push("Cambiar nombre de URL", ::aliasPage)
        }
    }

    override fun onDestroy() {
        app.removeShieldListener(shieldListener)
        super.onDestroy()
    }

    private val p get() = look.palette

    override fun buildRoot(): View = pageColumn {
        val settings = app.profile.settings

        addView(w.sectionLabel("Apariencia"))
        addView(w.card {
            for (theme in ThemeId.entries) {
                val info = app.themes.themes.getValue(theme)
                val selected = settings.theme == theme
                val check = if (selected) android.widget.ImageView(context).apply { setIcon(R.drawable.icarus_check, look.accent) } else null
                addView(w.row(R.drawable.icarus_brush, info.name, info.description, check) {
                    app.profile.updateSettings { it.copy(theme = theme) }
                })
            }
        })
        addView(segmented(
            listOf(ColorMode.SYSTEM to "Sistema", ColorMode.LIGHT to "Claro", ColorMode.DARK to "Oscuro"),
            settings.colorMode,
        ) { mode -> app.profile.updateSettings { it.copy(colorMode = mode) } })
        addView(accentPicker(settings.accent))

        addView(w.sectionLabel("Navegación"))
        addView(w.card {
            for (provider in SearchProvider.entries) {
                val check = if (settings.searchProvider == provider) android.widget.ImageView(context).apply { setIcon(R.drawable.icarus_check, look.accent) } else null
                addView(w.row(R.drawable.icarus_search, provider.displayName, "Buscador predeterminado", check) {
                    app.profile.updateSettings { it.copy(searchProvider = provider) }
                })
            }
            addView(w.switchRow("Mostrar accesos directos", "En la página de nueva pestaña.", settings.showShortcuts) { value ->
                app.profile.updateSettings { it.copy(showShortcuts = value) }
            })
            addView(w.row(R.drawable.icarus_sparkle, "Accesos directos", "${app.profile.shortcuts.size} de ${Profile.MAX_SHORTCUTS}") {
                push("Accesos directos", ::shortcutsPage)
            })
            addView(w.switchRow("Restaurar pestañas al abrir", "Vuelve a abrir las pestañas de la última sesión.", settings.restoreSession) { value ->
                app.profile.updateSettings { it.copy(restoreSession = value) }
            })
        })

        addView(w.sectionLabel("Protección"))
        val shield = app.shield.state()
        addView(w.card {
            addView(w.row(
                if (shield.enabled) R.drawable.icarus_shield else R.drawable.icarus_shield_off,
                "ICARUS Shield",
                if (shield.enabled) "${number.format(shield.activeRuleCount)} reglas activas · ${number.format(shield.totalBlocked)} solicitudes bloqueadas en total" else "Desactivado",
            ) { push("ICARUS Shield", ::shieldPage) })
        })

        addView(w.sectionLabel("Privacidad"))
        addView(w.card {
            addView(w.switchRow("Guardar el historial", "Las páginas visitadas se guardan solo en este dispositivo.", settings.saveHistory) { value ->
                app.profile.updateSettings { it.copy(saveHistory = value) }
            })
            addView(w.row(R.drawable.icarus_trash, "Borrar datos de navegación", "Historial, cookies, datos de sitios y caché") { clearDataDialog() })
            addView(w.row(R.drawable.icarus_lock, "Permisos de sitios", "Ubicación, cámara y micrófono") { push("Permisos de sitios", ::permissionsPage) })
        })

        addView(w.sectionLabel("Avanzado"))
        val rules = app.profile.aliasRules
        addView(w.card {
            addView(w.switchRow("Aplicar alias de URL en la interfaz",
                "Muestra los alias configurados en la barra de direcciones, las pestañas y el historial.", settings.showAliases) { value ->
                app.profile.updateSettings { it.copy(showAliases = value) }
            })
            addView(w.row(R.drawable.icarus_tag, "Cambiar nombre de URL", "${rules.count { it.enabled }} de ${rules.size} reglas activas") {
                push("Cambiar nombre de URL", ::aliasPage)
            })
        })

        addView(w.sectionLabel("ICARUS"))
        addView(w.card {
            addView(w.row(R.drawable.icarus_info, "Acerca de ICARUS", "Versión, motor y licencias") { push("Acerca de ICARUS", ::aboutPage) })
        })
    }

    private fun <T> segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit): View = w.horizontal(spacingDp = 6) {
        setPadding(0, dp(10), 0, 0)
        for ((value, label) in options) {
            val active = value == selected
            addView(TextView(context).apply {
                text = label
                gravity = Gravity.CENTER
                textStyle(15f, if (active) look.onAccent else p.fg1, bold = active)
                background = pressable(look, rounded(if (active) look.accent else p.surface1, 20, p.border1), 20)
                minHeight = dp(44)
                contentDescription = "Modo $label"
                setOnClickListener { onSelect(value) }
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        }
    }

    private fun accentPicker(selected: String): View {
        val row = w.horizontal(spacingDp = 10) { setPadding(dp(2), dp(12), dp(2), dp(4)) }
        val choices = listOf("default") + app.themes.accents.keys
        for (id in choices) {
            val color = if (id == "default") app.themes.palette(look.theme, look.dark).accent
            else app.themes.accents.getValue(id).let { if (look.dark) it.second else it.first }
            val active = id == selected
            row.addView(android.widget.FrameLayout(this).apply {
                background = rounded(color, 20, if (active) p.fg1 else p.border1, if (active) 3 else 1)
                contentDescription = if (id == "default") "Acento del estilo" else "Acento $id"
                if (active) {
                    addView(android.widget.ImageView(context).apply { setIcon(R.drawable.icarus_check, Themes.contrastOn(color)) },
                        android.widget.FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER))
                }
                setOnClickListener { app.profile.updateSettings { it.copy(accent = id) } }
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        }
        return HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
    }

    /* ---------------------------------- Shield ---------------------------------- */

    private fun shieldPage(): View = pageColumn {
        val state = app.shield.state()
        addView(w.text(app.sharedText("shield", "intro"), 15f, p.fg2).apply { setPadding(dp(4), dp(8), dp(4), dp(8)) })
        addView(w.card {
            addView(w.switchRow("Activar ICARUS Shield", "${number.format(state.activeRuleCount)} reglas activas · ${number.format(state.totalBlocked)} solicitudes bloqueadas en total", state.enabled) {
                app.shield.setEnabled(it)
            })
        })
        addView(w.hint("El contador suma solo las solicitudes que ICARUS canceló de verdad. En Android, WebView no indica el tipo de cada recurso: Shield lo deduce, así que las reglas limitadas a un tipo (p. ej. \$image) pueden no aplicarse a todos los recursos.").apply {
            setPadding(dp(4), dp(8), dp(4), 0)
        })

        addView(w.sectionLabel("Listas de filtros"))
        addView(w.hint(app.sharedText("shield", "listsHint")).apply { setPadding(dp(4), 0, dp(4), dp(8)) })
        addView(w.card { state.lists.forEach { addView(listRow(it)) } })
        addView(w.horizontal(spacingDp = 10) {
            setPadding(0, dp(10), 0, 0)
            addView(w.button(if (state.lists.any { it.updating }) "Actualizando…" else "Actualizar listas ahora", primary = true) { updateLists() })
            addView(w.button("Añadir lista") { addListDialog() })
        })

        addView(w.sectionLabel("Reglas propias"))
        addView(w.hint(app.sharedText("shield", "customHint")).apply { setPadding(dp(4), 0, dp(4), dp(8)) })
        val rules = w.field("Reglas (una por línea)", state.customRules, "||anuncios.ejemplo.com^", multiline = true)
        addView(rules.view)
        addView(w.hint("${state.customRuleCount} reglas válidas" + if (state.customInvalidCount > 0) " · ${state.customInvalidCount} no válidas" else "").apply {
            setPadding(dp(4), dp(4), dp(4), dp(4))
        })
        addView(w.button("Guardar reglas propias") {
            app.shield.setCustomRules(rules.value)
            toast("Reglas guardadas.")
        })

        addView(w.sectionLabel("Sitios sin Shield"))
        if (state.exceptions.isEmpty()) {
            addView(w.hint("No hay excepciones. Puedes desactivar Shield en un sitio desde el botón del escudo.").apply { setPadding(dp(4), 0, dp(4), 0) })
        } else {
            addView(w.card {
                for (domain in state.exceptions) {
                    addView(w.row(R.drawable.icarus_globe, domain, null, w.iconButton(R.drawable.icarus_trash, "Quitar $domain") {
                        app.shield.setSiteAllowed(domain, false)
                    }, null))
                }
            })
        }
    }

    private fun listRow(list: ShieldListInfo): View {
        val status = when {
            list.updating -> "Actualizando…"
            list.error != null && list.ruleCount == 0 -> app.sharedText("shieldListErrors", list.error!!.id)
            list.error != null -> "${number.format(list.ruleCount)} reglas · ${app.sharedText("shieldListErrors", list.error!!.id)}"
            list.builtIn && list.url == null -> "Incluida en ICARUS · ${number.format(list.ruleCount)} reglas"
            list.lastUpdated == null -> "Aún no descargada"
            else -> "${number.format(list.ruleCount)} reglas · Actualizada ${DateFormat.getDateInstance(DateFormat.MEDIUM, spanish).format(Date(list.lastUpdated!!))}"
        }
        val row = w.switchRow(list.name, status, list.enabled) { enabled ->
            app.shield.setListEnabled(list.id, enabled)
            if (enabled && app.shield.needsDownload(list.id)) app.background.execute { app.shield.updateLists(onlyStale = true) }
        }
        if (!list.builtIn) {
            row.addView(w.iconButton(R.drawable.icarus_trash, "Quitar ${list.name}") {
                w.dialog("Quitar la lista", "Se dejará de usar «${list.name}».", positive = "Quitar", destructive = true) {
                    app.shield.removeList(list.id)
                    true
                }.show()
            }, 1)
        }
        return row
    }

    private fun updateLists() {
        app.background.execute {
            app.shield.updateLists(onlyStale = false)
            val failed = app.shield.state().lists.filter { it.enabled && it.error != null }
            runOnUiThread { toast(if (failed.isEmpty()) "Listas actualizadas." else "No se pudieron actualizar: ${failed.joinToString { it.name }}.") }
        }
    }

    private fun addListDialog() {
        val name = w.field("Nombre")
        val url = w.field("Dirección (https)", hintText = "https://")
        val content = w.vertical(spacingDp = 12) {
            addView(name.view)
            addView(url.view)
        }
        lateinit var dialog: Dialog
        dialog = w.dialog("Añadir lista", content = content, positive = "Añadir lista") {
            url.setError(null)
            val nameValue = name.value
            val urlValue = url.value
            app.background.execute {
                val result = app.shield.addList(nameValue, urlValue)
                runOnUiThread {
                    when (result) {
                        ShieldStore.AddResult.Ok -> {
                            toast("Lista añadida.")
                            dialog.dismiss()
                        }
                        is ShieldStore.AddResult.Failed -> url.setError(app.sharedText("shieldListErrors", result.error.id))
                    }
                }
            }
            false
        }
        dialog.show()
    }

    /* ------------------------------ Alias de URL ------------------------------ */

    private fun aliasPage(): View = pageColumn {
        addView(w.text(app.sharedText("aliasManager", "subtitle"), 15f, p.fg2).apply { setPadding(dp(4), dp(8), dp(4), dp(8)) })
        addView(w.horizontal(spacingDp = 10) {
            addView(w.button("Nueva regla", primary = true) { editAlias(null) })
            addView(w.button("Restaurar predeterminadas") {
                w.dialog("Restaurar reglas predeterminadas", "Se eliminarán tus reglas y se restaurarán las de ejemplo.", positive = "Restaurar", destructive = true) {
                    app.profile.resetAliasRules()
                    toast("Reglas predeterminadas restauradas.")
                    true
                }.show()
            })
        })
        val rules = app.profile.aliasRules
        if (rules.isEmpty()) {
            addView(w.hint("No hay reglas. Crea una para empezar.").apply { setPadding(dp(4), dp(16), dp(4), 0) })
        } else {
            addView(w.sectionLabel("${rules.size} reglas"))
            addView(w.card {
                for (rule in rules) {
                    val row = w.switchRow("${rule.alias}  ←  ${rule.displayName}", "${matchName(rule.matchType)}: ${rule.pattern}\nDestino: ${rule.targetUrl}", rule.enabled) { enabled ->
                        app.profile.setAliasEnabled(rule.id, enabled)
                    }
                    row.setOnClickListener { editAlias(rule) }
                    row.addView(w.iconButton(R.drawable.icarus_trash, "Eliminar ${rule.name}") {
                        w.dialog("Eliminar regla", "Se eliminará «${rule.name}».", positive = "Eliminar", destructive = true) {
                            app.profile.removeAliasRule(rule.id)
                            true
                        }.show()
                    }, 1)
                    addView(row)
                }
            })
        }
        addView(w.hint(app.sharedText("aliasManager", "priorityNote")).apply { setPadding(dp(4), dp(12), dp(4), 0) })
    }

    private fun matchName(type: AliasMatchType) = app.strings.optJSONObject("aliasManager")?.optJSONObject("matchTypes")?.optString(type.id).orEmpty()

    private fun editAlias(rule: AliasRule?) {
        val shared = app.strings.optJSONObject("aliasManager")
        var matchType = rule?.matchType ?: AliasMatchType.EXACT
        val name = w.field("Nombre de la regla", rule?.name.orEmpty(), "Ej. Buscador del trabajo")
        val pattern = w.field("URL original o patrón de coincidencia", rule?.pattern.orEmpty())
        val displayName = w.field("Nombre visible del sitio", rule?.displayName.orEmpty(), "Ej. Buscar")
        val alias = w.field("Alias mostrado en ICARUS", rule?.alias.orEmpty(), "buscar.icarus")
        val target = w.field("URL de destino real", rule?.targetUrl.orEmpty(), "https://www.ejemplo.com/")
        val enabled = CheckBox(this).apply {
            text = "Regla activa"
            isChecked = rule?.enabled ?: true
            textStyle(15f, p.fg1)
            buttonTintList = android.content.res.ColorStateList.valueOf(look.accent)
        }
        val matchHint = w.hint("")
        val typeRow = w.horizontal(spacingDp = 6)
        fun renderTypes() {
            typeRow.removeAllViews()
            for (type in AliasMatchType.entries) {
                val active = type == matchType
                typeRow.addView(TextView(this).apply {
                    text = matchName(type)
                    gravity = Gravity.CENTER
                    textStyle(14f, if (active) look.onAccent else p.fg1, bold = active)
                    background = pressable(look, rounded(if (active) look.accent else p.surface2, 18, p.border1), 18)
                    minHeight = dp(40)
                    setOnClickListener {
                        matchType = type
                        renderTypes()
                    }
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            }
            matchHint.text = shared?.optJSONObject("matchHints")?.optString(matchType.id).orEmpty()
            pattern.edit.hint = shared?.optJSONObject("patternPlaceholders")?.optString(matchType.id).orEmpty()
        }
        renderTypes()
        val content = w.vertical(spacingDp = 12) {
            addView(name.view)
            addView(w.text("Tipo de coincidencia", 14f, p.fg2, bold = true))
            addView(typeRow, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(matchHint)
            addView(pattern.view)
            addView(displayName.view)
            addView(w.hint(app.sharedText("aliasManager", "displayNameHint")))
            addView(alias.view)
            addView(w.hint(app.sharedText("aliasManager", "aliasHint")))
            addView(target.view)
            addView(w.hint(app.sharedText("aliasManager", "targetHint")))
            addView(w.button("Usar la URL original") { target.edit.setText(pattern.value) })
            addView(enabled)
        }
        w.dialog(if (rule == null) "Nueva regla" else "Editar regla", content = content, positive = "Guardar") {
            val input = AliasRules.Input(name.value, matchType, pattern.value, displayName.value, alias.value, target.value, enabled.isChecked)
            when (val result = app.profile.saveAliasRule(input, rule?.id)) {
                is AliasRules.Validation.Ok -> true
                is AliasRules.Validation.Errors -> {
                    val message = { field: String -> result.errors[field]?.let { app.sharedText("aliasErrors", it) } }
                    name.setError(message("name"))
                    pattern.setError(message("pattern"))
                    displayName.setError(message("displayName"))
                    alias.setError(message("alias"))
                    target.setError(message("targetUrl"))
                    false
                }
            }
        }.show()
    }

    /* ----------------------------- Accesos directos ----------------------------- */

    private fun shortcutsPage(): View = pageColumn {
        addView(w.horizontal(spacingDp = 10) {
            setPadding(0, dp(8), 0, dp(8))
            addView(w.button("Añadir", primary = true) { editShortcut(null) })
            addView(w.button("Restaurar predeterminados") {
                w.dialog("Restaurar accesos directos", "Se sustituirán tus accesos por los predeterminados.", positive = "Restaurar", destructive = true) {
                    app.profile.resetShortcuts()
                    toast("Accesos directos restaurados.")
                    true
                }.show()
            })
        })
        addView(w.card {
            for (shortcut in app.profile.shortcuts) {
                addView(w.row(R.drawable.icarus_globe, shortcut.title, shortcut.url, w.iconButton(R.drawable.icarus_trash, "Eliminar ${shortcut.title}") {
                    app.profile.removeShortcut(shortcut.id)
                }) { editShortcut(shortcut) })
            }
        })
    }

    private fun editShortcut(shortcut: io.github.saaqes.icarusbrowser.core.Shortcut?) {
        val title = w.field("Nombre", shortcut?.title.orEmpty())
        val url = w.field("Dirección", shortcut?.url.orEmpty(), "ejemplo.com")
        val content = w.vertical(spacingDp = 12) {
            addView(title.view)
            addView(url.view)
        }
        w.dialog(if (shortcut == null) "Nuevo acceso directo" else "Editar acceso directo", content = content, positive = "Guardar") {
            when (val result = app.profile.saveShortcut(title.value, url.value, shortcut?.id)) {
                is Profile.ShortcutResult.Ok -> true
                is Profile.ShortcutResult.Errors -> {
                    if (result.limit) toast("Puedes tener como máximo ${Profile.MAX_SHORTCUTS} accesos directos.")
                    title.setError(result.errors["title"]?.let { app.sharedText("shortcutErrors", it) })
                    url.setError(result.errors["url"]?.let { app.sharedText("shortcutErrors", it) })
                    result.limit
                }
            }
        }.show()
    }

    /* -------------------------------- Privacidad -------------------------------- */

    private fun clearDataDialog() {
        var range = ClearRange.HOUR
        val ranges = listOf(ClearRange.HOUR to "Última hora", ClearRange.DAY to "Último día", ClearRange.WEEK to "Última semana", ClearRange.ALL to "Todo")
        val rangeRow = w.horizontal(spacingDp = 6)
        fun renderRanges() {
            rangeRow.removeAllViews()
            for ((value, label) in ranges) {
                val active = value == range
                rangeRow.addView(TextView(this).apply {
                    text = label
                    gravity = Gravity.CENTER
                    textStyle(13f, if (active) look.onAccent else p.fg1, bold = active)
                    background = pressable(look, rounded(if (active) look.accent else p.surface2, 16, p.border1), 16)
                    minHeight = dp(40)
                    setPadding(dp(6), 0, dp(6), 0)
                    setOnClickListener {
                        range = value
                        renderRanges()
                    }
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            }
        }
        renderRanges()
        fun box(label: String, checked: Boolean) = CheckBox(this).apply {
            text = label
            isChecked = checked
            textStyle(15f, p.fg1)
            buttonTintList = android.content.res.ColorStateList.valueOf(look.accent)
        }
        val history = box("Historial de navegación", true)
        val cookies = box("Cookies y datos de sitios (cierra las sesiones iniciadas)", false)
        val cache = box("Imágenes y archivos en caché", true)
        val content = w.vertical(spacingDp = 8) {
            addView(w.text("Historial", 14f, p.fg2, bold = true))
            addView(rangeRow, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(history)
            addView(cookies)
            addView(cache)
            addView(w.hint("Las cookies, los datos de sitios y la caché se borran por completo: WebView no permite borrarlos por intervalo."))
        }
        w.dialog("Borrar datos de navegación", content = content, positive = "Borrar", destructive = true) {
            if (history.isChecked) app.history.clear(range)
            if (cookies.isChecked) {
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                WebStorage.getInstance().deleteAllData()
                WebViewDatabase.getInstance(this).clearHttpAuthUsernamePassword()
            }
            if (cache.isChecked) {
                WebView(this).apply {
                    clearCache(true)
                    destroy()
                }
                app.favicons.clear()
            }
            toast("Datos borrados.")
            true
        }.show()
    }

    private fun permissionsPage(): View = pageColumn {
        val sites = app.profile.sitePermissions()
        addView(w.hint("Decisiones que tomaste cuando un sitio pidió acceso. Android también debe conceder el permiso a ICARUS.").apply {
            setPadding(dp(4), dp(8), dp(4), dp(8))
        })
        if (sites.isEmpty()) {
            addView(w.hint("Ningún sitio ha pedido permisos todavía.").apply { setPadding(dp(4), dp(8), dp(4), 0) })
            return@pageColumn
        }
        addView(w.card {
            for ((origin, decisions) in sites) {
                val summary = decisions.entries.joinToString(" · ") { (permission, allowed) ->
                    val name = when (permission) {
                        SitePermission.LOCATION -> "Ubicación"
                        SitePermission.CAMERA -> "Cámara"
                        SitePermission.MICROPHONE -> "Micrófono"
                    }
                    "$name: ${if (allowed) "permitido" else "bloqueado"}"
                }
                addView(w.row(R.drawable.icarus_globe, origin, summary, w.iconButton(R.drawable.icarus_trash, "Olvidar $origin") {
                    app.profile.forgetPermissions(origin)
                }, null))
            }
        })
        addView(w.button("Olvidar todas las decisiones", danger = true) { app.profile.forgetPermissions() }.apply {
            layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(12) }
        })
    }

    /* --------------------------------- Acerca de --------------------------------- */

    private fun aboutPage(): View = pageColumn {
        val version = packageManager.getPackageInfo(packageName, 0).versionName
        val engine = WebView.getCurrentWebViewPackage()
        addView(w.card {
            addView(w.row(R.drawable.icarus_info, "ICARUS para Android", "Versión $version", null, null))
            addView(w.row(R.drawable.icarus_globe, "Motor", "${engine?.packageName ?: "WebView de Android"} ${engine?.versionName.orEmpty()} (Chromium del sistema, se actualiza desde Google Play)", null, null))
            addView(w.row(R.drawable.icarus_monitor, "Android", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})", null, null))
        })
        addView(w.sectionLabel("Cómo funciona"))
        addView(w.card {
            listOf(
                "Todas las pestañas comparten cookies, almacenamiento y caché: no están aisladas entre sí, igual que el perfil predeterminado de escritorio.",
                "Las cookies de terceros están bloqueadas (comportamiento predeterminado de WebView).",
                "ICARUS no permite continuar en sitios con certificados no válidos.",
                "Algunos servicios (por ejemplo, el inicio de sesión de Google) pueden rechazar los navegadores basados en WebView.",
                "Los datos se guardan solo en este dispositivo y no se incluyen en las copias de seguridad de Android.",
            ).forEach { addView(w.row(null, it, null, null, null)) }
        })
        addView(w.sectionLabel("Licencias de terceros"))
        addView(w.card {
            addView(w.row(null, "EasyList y EasyPrivacy", "GPLv3 / CC BY-SA 3.0 · easylist.to", null, null))
            addView(w.row(null, "Lista de Peter Lowe", "pgl.yoyo.org/adservers (uso no comercial gratuito)", null, null))
            addView(w.row(null, "Public Suffix List", "Mozilla Public License 2.0 · publicsuffix.org", null, null))
            addView(w.row(null, "Kotlin", "Apache License 2.0", null, null))
        })
        addView(w.button("Ver el código fuente") {
            startActivity(Intent(this@SettingsActivity, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(android.net.Uri.parse("https://github.com/saaqes/icarus-browser")))
        }.apply { layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(12) } })
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    companion object {
        const val EXTRA_SECTION = "section"
    }
}
