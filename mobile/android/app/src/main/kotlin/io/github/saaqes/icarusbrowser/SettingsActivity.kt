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
import io.github.saaqes.icarusbrowser.core.ClearRange
import io.github.saaqes.icarusbrowser.core.ColorMode
import io.github.saaqes.icarusbrowser.core.CustomAddress
import io.github.saaqes.icarusbrowser.core.CustomAddresses
import io.github.saaqes.icarusbrowser.core.Profile
import io.github.saaqes.icarusbrowser.core.SearchProvider
import io.github.saaqes.icarusbrowser.core.SitePermission
import io.github.saaqes.icarusbrowser.core.ThemeId
import io.github.saaqes.icarusbrowser.core.Themes
import io.github.saaqes.icarusbrowser.core.UrlUtils
import io.github.saaqes.icarusbrowser.core.shield.ShieldListInfo
import io.github.saaqes.icarusbrowser.core.shield.ShieldState
import io.github.saaqes.icarusbrowser.core.shield.ShieldStore
import io.github.saaqes.icarusbrowser.core.update.UpdateChannel
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

    /** Durante la descarga solo cambia el texto del progreso (redibujar movería la página). */
    private var updateProgress: TextView? = null
    private var shownUpdateStatus: UpdateManager.Status? = null
    private val updatesListener: (UpdateManager.State) -> Unit = { state ->
        val label = updateProgress
        val progress = state.progress
        if (currentTitle == UPDATES_TITLE && label != null && progress != null && state.status == shownUpdateStatus) {
            label.text = progressText(progress)
        } else if (currentTitle == UPDATES_TITLE || currentTitle == rootTitle()) {
            refresh()
        }
    }

    override fun rootTitle() = "Configuración"

    override fun openInitialPage() {
        app.addShieldListener(shieldListener)
        app.updates.addListener(updatesListener)
        when (intent.getStringExtra(EXTRA_SECTION)) {
            "updates" -> push(UPDATES_TITLE, ::updatesPage)
            "shield" -> push("ICARUS Shield", ::shieldPage)
            "addresses" -> {
                push(addressesTitle, ::addressesPage)
                val editing = intent.getStringExtra(EXTRA_EDIT_ID)?.let { id -> app.profile.customAddresses.firstOrNull { it.id == id } }
                if (editing != null) editAddress(editing) else intent.getStringExtra(EXTRA_TARGET)?.let { editAddress(null, it) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Al volver de los ajustes de Android (permiso para instalar apps) se actualiza la página.
        if (currentTitle == UPDATES_TITLE) refresh()
    }

    override fun onDestroy() {
        app.updates.removeListener(updatesListener)
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
            addView(w.switchRow(app.sharedText("addressBar", "showFullUrls"), app.sharedText("addressBar", "showFullUrlsHint"), settings.showFullUrls) { value ->
                app.profile.updateSettings { it.copy(showFullUrls = value) }
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
        val addresses = app.profile.customAddresses
        addView(w.card {
            val summary = if (addresses.isEmpty()) "Ninguna dirección personalizada" else "${addresses.count { it.enabled }} de ${addresses.size} direcciones activas"
            addView(w.row(R.drawable.icarus_globe, "Personalizar direcciones URL",
                "Elige qué dirección muestra la barra para un sitio (por ejemplo, miweb.com en lugar de bot.deriv.me).\n$summary") {
                push(addressesTitle, ::addressesPage)
            })
        })

        addView(w.sectionLabel("ICARUS"))
        addView(w.card {
            addView(w.row(R.drawable.icarus_upgrade, UPDATES_TITLE, updatesSummary(app.updates.state)) { push(UPDATES_TITLE, ::updatesPage) })
            addView(w.row(R.drawable.icarus_info, "Acerca de ICARUS", "Versión, motor y licencias") { push("Acerca de ICARUS", ::aboutPage) })
        })
    }

    /* ------------------------------ Actualizaciones ------------------------------ */

    private fun updatesSummary(state: UpdateManager.State): String = when {
        state.mode == UpdateManager.Mode.PLAY_STORE -> "Las actualizaciones llegan por Google Play"
        state.mode == UpdateManager.Mode.NO_KEY -> "Versión ${state.currentVersion} · esta compilación no busca actualizaciones"
        state.status == UpdateManager.Status.READY -> "La versión ${state.available?.version} está lista para instalarse"
        state.available != null -> "Hay una versión nueva: ${state.available.version}"
        state.status == UpdateManager.Status.UP_TO_DATE -> "ICARUS ${state.currentVersion} está actualizado"
        else -> "Versión ${state.currentVersion}"
    }

    private fun progressText(progress: Pair<Long, Long>): String {
        val (received, total) = progress
        val percent = if (total > 0) (received * 100 / total).toInt() else 0
        val mb = { bytes: Long -> NumberFormat.getNumberInstance(spanish).apply { maximumFractionDigits = 1 }.format(bytes / 1048576.0) }
        return "$percent % · ${mb(received)} MB de ${mb(total)} MB"
    }

    private fun updateStatusText(state: UpdateManager.State): String? {
        val version = state.available?.version.orEmpty()
        return when (state.status) {
            UpdateManager.Status.CHECKING -> "Buscando actualizaciones…"
            UpdateManager.Status.UP_TO_DATE -> "ICARUS está actualizado."
            UpdateManager.Status.AVAILABLE -> "Hay una versión nueva: $version."
            UpdateManager.Status.DOWNLOADING -> "Descargando la versión $version…"
            UpdateManager.Status.VERIFYING -> "Comprobando el paquete: SHA-256, identificador, versión y certificado…"
            UpdateManager.Status.READY -> "La versión $version está descargada y verificada. Android te pedirá confirmación para instalarla."
            UpdateManager.Status.INSTALLING -> "Abriendo el instalador de Android…"
            UpdateManager.Status.ERROR -> null
            UpdateManager.Status.IDLE -> null
        }
    }

    private fun updatesPage(): View = pageColumn {
        val updates = app.updates
        val state = updates.state
        shownUpdateStatus = state.status
        updateProgress = null
        val dateFormat = DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.SHORT, spanish)

        state.justUpdated?.let { (from, to) ->
            addView(w.card {
                addView(w.row(R.drawable.icarus_check, "ICARUS se ha actualizado", "De la versión $from a la $to.",
                    w.iconButton(R.drawable.icarus_close, "Cerrar aviso") { updates.acknowledge() }, null))
            })
        }
        addView(w.card {
            val channel = if (state.channel == UpdateChannel.PREVIEW) "vista previa" else "estable"
            addView(w.row(R.drawable.icarus_info, "Versión instalada", "ICARUS ${state.currentVersion} · Canal $channel", null, null))
            if (state.mode == UpdateManager.Mode.APK) {
                addView(w.row(R.drawable.icarus_clock, "Última comprobación",
                    state.lastCheckedAt?.let { dateFormat.format(Date(it)) } ?: "Todavía no se ha buscado ninguna actualización.", null, null))
            }
        })

        when (state.mode) {
            UpdateManager.Mode.PLAY_STORE -> {
                addView(w.hint("Instalaste ICARUS desde Google Play: las actualizaciones llegan por Google Play y ICARUS no descarga paquetes por su cuenta.").apply { setPadding(dp(4), dp(8), dp(4), dp(8)) })
                addView(w.button("Abrir en Google Play", primary = true) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=$packageName"))) }
                })
                return@pageColumn
            }
            UpdateManager.Mode.NO_KEY -> {
                addView(w.hint("Esta compilación no incluye la clave pública para verificar actualizaciones, así que ICARUS no las busca. Descarga las versiones nuevas desde la página del proyecto.").apply { setPadding(dp(4), dp(8), dp(4), dp(8)) })
                return@pageColumn
            }
            UpdateManager.Mode.APK -> Unit
        }

        updateStatusText(state)?.let { addView(w.text(it, 15f, p.fg1, bold = true).apply { setPadding(dp(4), dp(12), dp(4), dp(4)) }) }
        if (state.error != null) addView(w.text(UpdateManager.errorText(state.error), 14f, if (state.error == "install-cancelled") p.fg2 else p.danger).apply { setPadding(dp(4), dp(8), dp(4), dp(4)) })
        if (state.status == UpdateManager.Status.DOWNLOADING && state.progress != null) {
            val label = w.hint(progressText(state.progress)).apply { setPadding(dp(4), 0, dp(4), dp(4)) }
            updateProgress = label
            addView(label)
        }

        addView(w.horizontal(spacingDp = 10) {
            setPadding(0, dp(10), 0, 0)
            val available = state.available
            when {
                state.status == UpdateManager.Status.DOWNLOADING -> addView(w.button("Cancelar descarga") { updates.cancel() })
                state.status == UpdateManager.Status.READY -> addView(w.button("Instalar", primary = true) { installUpdate() })
                available != null && (state.status == UpdateManager.Status.AVAILABLE || state.status == UpdateManager.Status.ERROR) ->
                    addView(w.button(if (state.status == UpdateManager.Status.ERROR) "Reintentar" else "Descargar actualización", primary = true) { updates.download() })
                !state.busy -> addView(w.button(if (state.status == UpdateManager.Status.ERROR) "Reintentar" else "Buscar actualizaciones", primary = true) { updates.check() })
            }
            if (available != null && state.status == UpdateManager.Status.AVAILABLE && available.version != state.postponedVersion) {
                addView(w.button("Recordármelo más tarde") { updates.postpone() })
            }
        })
        if (state.available != null && state.available.version == state.postponedVersion) {
            addView(w.hint("No se volverá a avisar de esta versión. Puedes instalarla aquí cuando quieras.").apply { setPadding(dp(4), dp(8), dp(4), 0) })
        }

        state.available?.let { manifest ->
            addView(w.sectionLabel("Novedades de la versión ${manifest.version}"))
            val size = state.asset?.size?.let { " · ${NumberFormat.getNumberInstance(spanish).apply { maximumFractionDigits = 1 }.format(it / 1048576.0)} MB" }.orEmpty()
            addView(w.hint("Publicada el ${DateFormat.getDateInstance(DateFormat.LONG, spanish).format(Date.from(java.time.Instant.parse(manifest.releasedAt)))}$size").apply { setPadding(dp(4), 0, dp(4), dp(6)) })
            // Las notas son texto: no se interpretan como HTML.
            addView(w.card { addView(w.text(manifest.notes.ifBlank { "Esta versión no incluye notas." }, 14f, p.fg2).apply { setPadding(dp(14), dp(12), dp(14), dp(12)) }) })
        }

        addView(w.sectionLabel("Canal de actualizaciones"))
        addView(segmented(listOf(UpdateChannel.STABLE to "Estable", UpdateChannel.PREVIEW to "Vista previa"), state.channel) { channel ->
            if (state.busy || state.status == UpdateManager.Status.READY) toast("Espera a que termine la actualización en curso.") else updates.setChannel(channel)
        })
        addView(w.hint("Estable: solo versiones publicadas y probadas. Vista previa: también versiones preliminares, que pueden tener errores. Al volver a estable no se instala una versión anterior: ICARUS sigue en la actual hasta que salga una estable más reciente.").apply {
            setPadding(dp(4), dp(8), dp(4), 0)
        })

        addView(w.sectionLabel("Cómo se instala"))
        addView(w.hint("ICARUS descarga el APK, comprueba la firma del manifiesto de ICARUS, el SHA-256, que es ICARUS, que es una versión posterior y que está firmado con el mismo certificado que la app instalada. Después lo entrega al instalador de Android, que siempre te pide confirmación. Es una actualización de la misma app: tus pestañas, accesos directos, historial, direcciones personalizadas y ajustes se conservan.").apply {
            setPadding(dp(4), 0, dp(4), 0)
        })
    }

    /** Android pide permiso una vez para que ICARUS pueda abrir el instalador de apps. */
    private fun installUpdate() {
        if (app.updates.canRequestInstall()) {
            app.updates.install()
            return
        }
        w.dialog(
            "Permitir instalar actualizaciones",
            "Android necesita que permitas a ICARUS instalar aplicaciones. Solo se usa para instalar actualizaciones de ICARUS ya verificadas, y Android te pedirá confirmación cada vez.",
            positive = "Abrir ajustes",
        ) {
            runCatching {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName")))
            }.onFailure { toast("No se pudieron abrir los ajustes de Android.") }
            true
        }.show()
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

    /* ------------------------- Direcciones personalizadas ------------------------- */

    private val addressesTitle get() = app.sharedText("customAddresses", "title")
    private fun ca(key: String, vararg params: Pair<String, String>) = app.sharedText("customAddresses", key, *params)
    private fun caForm(key: String, vararg params: Pair<String, String>) = app.sharedText("customAddresses", "form", key, *params)
    private fun short(url: String) = CustomAddresses.shortAddress(url)

    private fun addressesPage(): View = pageColumn {
        addView(w.text(ca("subtitle"), 15f, p.fg2).apply { setPadding(dp(4), dp(8), dp(4), dp(8)) })
        addView(w.horizontal(spacingDp = 10) {
            addView(w.button(ca("add"), primary = true) { editAddress(null) })
        })
        val entries = app.profile.customAddresses
        if (entries.isEmpty()) {
            addView(w.hint(ca("empty")).apply { setPadding(dp(4), dp(16), dp(4), 0) })
        } else {
            addView(w.sectionLabel(addressesTitle))
            addView(w.card {
                for (entry in entries) {
                    val address = short(entry.address)
                    val sections = if (entry.sections.isEmpty()) "" else " · " + ca("sectionsOf", "sections" to CustomAddresses.formatSections(entry.sections))
                    val subtitle = ca("targetOf", "target" to short(entry.target)) + sections + if (entry.enabled) "" else " · ${ca("disabled")}"
                    val row = w.switchRow(address, subtitle, entry.enabled) { enabled ->
                        val conflict = app.profile.setCustomAddressEnabled(entry.id, enabled)
                        if (conflict != null) {
                            toast(ca("toggleConflict", "address" to short(conflict.address), "target" to short(conflict.target)))
                            refresh() // vuelve a mostrar el interruptor desactivado
                        } else {
                            toast(ca(if (enabled) "enabledToast" else "disabledToast", "address" to address))
                        }
                    }
                    row.setOnClickListener { editAddress(entry) }
                    row.contentDescription = "Editar $address"
                    row.addView(w.iconButton(R.drawable.icarus_trash, "Eliminar $address") {
                        w.dialog(ca("deleteTitle"), ca("deleteBody", "address" to address, "target" to short(entry.target)), positive = "Eliminar", destructive = true) {
                            app.profile.removeCustomAddress(entry.id)
                            toast(ca("deleted"))
                            true
                        }.show()
                    }, 1)
                    addView(row)
                }
            })
        }
        val howTo = app.strings.optJSONObject("customAddresses")?.optJSONObject("howTo")
        addView(w.sectionLabel(howTo?.optString("title").orEmpty()))
        addView(w.card {
            setPadding(dp(16), dp(12), dp(16), dp(12))
            val steps = howTo?.optJSONArray("steps")
            for (index in 0 until (steps?.length() ?: 0)) addView(w.text("${index + 1}. ${steps!!.optString(index)}", 14f, p.fg2).apply { setPadding(0, dp(4), 0, dp(4)) })
            addView(w.hint(howTo?.optString("security").orEmpty()).apply { setPadding(0, dp(8), 0, 0) })
        })
    }

    /** Páginas que ya tiene el usuario, para elegir el destino sin escribirlo. */
    private fun destinationChoices(): List<String> {
        val seen = LinkedHashSet<String>()
        for (url in app.profile.shortcuts.map { it.url } + app.history.list().sortedByDescending { it.visitedAt }.map { it.url }) {
            val parsed = UrlUtils.parseWebUrl(url) ?: continue
            seen.add("${parsed.protocol}//${parsed.host}/")
            if (seen.size >= 8) break
        }
        return seen.toList()
    }

    /** Crear o editar una dirección: los conflictos se muestran en el campo y nunca se sobrescribe otra entrada. */
    private fun editAddress(entry: CustomAddress?, initialTarget: String? = null) {
        // Completas, como en escritorio: así se conserva el protocolo (p. ej. un destino http://).
        val target = w.field(caForm("target"), entry?.target ?: initialTarget.orEmpty(), caForm("targetPlaceholder"),
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI)
        val address = w.field(caForm("address"), entry?.address.orEmpty(), caForm("addressPlaceholder"),
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI)
        val sections = w.field(caForm("sections"), entry?.sections?.let(CustomAddresses::formatSections).orEmpty(), caForm("sectionsPlaceholder"),
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        val enabled = CheckBox(this).apply {
            text = caForm("enabled")
            isChecked = entry?.enabled ?: true
            textStyle(15f, p.fg1)
            buttonTintList = android.content.res.ColorStateList.valueOf(look.accent)
        }
        val preview = w.text("", 14f, p.fg2)
        fun updatePreview() {
            val result = CustomAddresses.validate(target.value, address.value, true, sectionsText = sections.value)
            preview.text = if (result is CustomAddresses.Validation.Ok) {
                val shownTarget = short(result.target)
                val shownAddress = short(result.address)
                val example = "${result.target.trimEnd('/')}/pagina?x=1" + (result.sections.firstOrNull()?.let { "#$it" } ?: "")
                val sample = CustomAddress("preview", result.target, result.address, true, "", "", result.sections)
                val exampleShown = CustomAddresses.displayUrlFor(example, listOf(sample))?.url ?: example
                val lines = mutableListOf(
                    caForm("previewShows", "target" to shownTarget, "address" to shownAddress),
                    caForm("previewOpens", "address" to shownAddress, "target" to shownTarget),
                    caForm("previewPaths", "real" to short(example), "shown" to short(exampleShown)),
                )
                if (result.sections.isNotEmpty()) lines.add(caForm("previewSections", "sections" to CustomAddresses.formatSections(result.sections)))
                lines.joinToString("\n")
            } else {
                caForm("previewIncomplete")
            }
        }
        val watcher = object : android.text.TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(text: android.text.Editable?) = updatePreview()
        }
        target.edit.addTextChangedListener(watcher)
        address.edit.addTextChangedListener(watcher)
        sections.edit.addTextChangedListener(watcher)
        updatePreview()
        val choices = destinationChoices()
        val content = w.vertical(spacingDp = 12) {
            addView(target.view)
            addView(w.hint(caForm("targetHint")))
            if (choices.isNotEmpty()) {
                addView(w.hint(caForm("chooseFrom")))
                addView(HorizontalScrollView(context).apply {
                    isHorizontalScrollBarEnabled = false
                    addView(w.horizontal(spacingDp = 6) {
                        for (choice in choices) {
                            addView(TextView(context).apply {
                                text = short(choice)
                                textStyle(14f, p.fg1)
                                background = pressable(look, rounded(p.surface2, 16, p.border1), 16)
                                setPadding(dp(12), dp(8), dp(12), dp(8))
                                setOnClickListener { target.edit.setText(choice) }
                            })
                        }
                    })
                })
            }
            addView(address.view)
            addView(w.hint(caForm("addressHint")))
            addView(sections.view)
            addView(w.hint(caForm("sectionsHint")))
            addView(w.text(caForm("preview"), 14f, p.fg2, bold = true))
            addView(preview)
            addView(w.hint(caForm("limitation")))
            addView(enabled)
        }
        w.dialog(if (entry == null) caForm("createTitle") else caForm("editTitle"), content = content, positive = "Guardar") {
            when (val result = app.profile.saveCustomAddress(target.value, address.value, enabled.isChecked, entry?.id, sections.value)) {
                is CustomAddresses.Validation.Ok -> {
                    toast(if (entry == null) ca("created", "address" to short(result.address)) else ca("saved"))
                    true
                }
                is CustomAddresses.Validation.Errors -> {
                    fun message(field: String): String? {
                        val code = result.errors[field] ?: return null
                        if (code == "limit") return ca("limit")
                        val other = result.conflicts[field]
                        return app.sharedText("customAddressErrors", code,
                            "address" to other?.address?.let(::short).orEmpty(), "target" to other?.target?.let(::short).orEmpty())
                    }
                    target.setError(message("target"))
                    address.setError(message("address"))
                    sections.setError(message("sections"))
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
        const val UPDATES_TITLE = "Actualizaciones"
        /** Con la sección "addresses": entrada que se abre para editar. */
        const val EXTRA_EDIT_ID = "editId"
        /** Con la sección "addresses": destino con el que se empieza una entrada nueva. */
        const val EXTRA_TARGET = "target"
    }
}
