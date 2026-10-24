package io.github.saaqes.icarusbrowser

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.github.saaqes.icarusbrowser.core.Shortcut
import io.github.saaqes.icarusbrowser.core.ThemeId
import io.github.saaqes.icarusbrowser.core.UrlUtils
import java.text.NumberFormat
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Página de nueva pestaña (nativa, no es una página web). Cada estilo tiene su
 * propia distribución, como en escritorio:
 * - Esencial: logotipo y buscador centrados, accesos en círculos.
 * - Panorama: saludo con fecha sobre un degradado y accesos en tarjetas.
 * - ICARUS: cabecera oscura con la marca y accesos en un dock desplazable.
 */
class NewTabView(
    private val context: Context,
    private val w: Widgets,
    private val onSearch: () -> Unit,
    private val onOpen: (String) -> Unit,
    private val onEditShortcut: (Shortcut?) -> Unit,
    private val onShield: () -> Unit,
) {
    private val p = w.look.palette
    private val app = IcarusApp.instance
    val view = ScrollView(context).apply { isFillViewport = true }
    private val spanish = Locale.forLanguageTag("es-ES")

    fun render() {
        view.removeAllViews()
        val settings = app.profile.settings
        val content = when (w.look.theme) {
            ThemeId.ESSENTIAL -> essential()
            ThemeId.PANORAMA -> panorama()
            ThemeId.ICARUS -> icarus()
        }
        if (settings.showShortcuts) content.addView(shortcuts(w.look.theme))
        content.addView(shieldLine())
        view.addView(content, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun searchBox(radius: Int, fill: Int, textColor: Int) = w.horizontal(spacingDp = 12) {
        background = context.pressable(w.look, context.rounded(fill, radius, p.border1), radius)
        setPadding(w.dp(18), 0, w.dp(18), 0)
        minimumHeight = w.dp(52)
        addView(ImageView(context).apply { setIcon(R.drawable.icarus_search, textColor) }, LinearLayout.LayoutParams(w.dp(22), w.dp(22)))
        addView(w.text("Busca o escribe una dirección", 16f, textColor), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        contentDescription = "Buscar o escribir una dirección"
        setOnClickListener { onSearch() }
    }

    private fun essential() = w.vertical(spacingDp = 22) {
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(w.dp(20), w.dp(56), w.dp(20), w.dp(24))
        setBackgroundColor(p.pageBg)
        addView(w.horizontal(spacingDp = 12) {
            gravity = Gravity.CENTER
            addView(ImageView(context).apply { setImageResource(R.drawable.icarus_logo) }, LinearLayout.LayoutParams(w.dp(44), w.dp(44)))
            addView(w.text("ICARUS", 30f, p.fg1, bold = true).apply { letterSpacing = 0.08f })
        })
        addView(searchBox(26, p.surface1, p.fg3), LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun panorama() = w.vertical(spacingDp = 18) {
        setPadding(w.dp(20), w.dp(36), w.dp(20), w.dp(24))
        val top = Look.withAlpha(p.accent, if (w.look.dark) 0x55 else 0x40)
        background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(top, p.pageBg, p.pageBg))
        val now = LocalDateTime.now()
        val greeting = when (now.hour) {
            in 6..13 -> "Buenos días"
            in 14..20 -> "Buenas tardes"
            else -> "Buenas noches"
        }
        val date = now.format(DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM", spanish)).replaceFirstChar { it.titlecase(spanish) }
        addView(w.vertical(spacingDp = 2) {
            addView(w.text(greeting, 28f, p.fg1, bold = true))
            addView(w.text(date, 15f, p.fg2))
        })
        addView(searchBox(12, p.surface1, p.fg3), LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun icarus() = w.vertical(spacingDp = 20) {
        setPadding(w.dp(20), w.dp(40), w.dp(20), w.dp(24))
        val glow = Look.withAlpha(p.accent, if (w.look.dark) 0x66 else 0x33)
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(glow, p.pageBg, p.pageBg))
        addView(ImageView(context).apply { setImageResource(R.drawable.icarus_logo) }, LinearLayout.LayoutParams(w.dp(56), w.dp(56)))
        addView(w.vertical(spacingDp = 4) {
            addView(w.text("ICARUS", 34f, p.fg1, bold = true).apply { letterSpacing = 0.12f })
            addView(w.text("Navega más alto, sin rastreadores.", 15f, p.fg2))
        })
        addView(searchBox(26, p.surface2, p.fg2), LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun shortcuts(theme: ThemeId): View {
        val items = app.profile.shortcuts
        val tiles = items.map { shortcutTile(it, theme) } + addTile(theme)
        if (theme == ThemeId.ICARUS) {
            val row = w.horizontal(spacingDp = 10) {
                setPadding(w.dp(20), w.dp(4), w.dp(20), w.dp(4))
                tiles.forEach { addView(it) }
            }
            return HorizontalScrollView(context).apply {
                isHorizontalScrollBarEnabled = false
                addView(row)
            }
        }
        val columns = if (context.resources.configuration.screenWidthDp >= 600) 6 else 4
        val grid = GridLayout(context).apply {
            columnCount = columns
            setPadding(w.dp(12), w.dp(4), w.dp(12), w.dp(4))
        }
        tiles.forEach { tile ->
            grid.addView(tile, GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                width = 0
                setMargins(w.dp(4), w.dp(6), w.dp(4), w.dp(6))
            })
        }
        return grid
    }

    private fun badge(shortcut: Shortcut?, sizeDp: Int, radius: Int): View {
        val host = shortcut?.let { UrlUtils.parseWebUrl(it.url)?.hostname }
        val icon = host?.let { app.favicons.get(it) }
        val frame = FrameLayout(context).apply { background = context.rounded(p.surface2, radius, p.border1) }
        if (shortcut == null) {
            frame.addView(ImageView(context).apply { setIcon(R.drawable.icarus_plus, p.fg2) }, FrameLayout.LayoutParams(w.dp(22), w.dp(22), Gravity.CENTER))
        } else if (icon != null) {
            frame.addView(ImageView(context).apply { setImageBitmap(icon) }, FrameLayout.LayoutParams(w.dp(24), w.dp(24), Gravity.CENTER))
        } else {
            frame.addView(w.text(shortcut.title.take(1).uppercase(), 18f, w.look.accent, bold = true).apply { gravity = Gravity.CENTER },
                FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
        frame.layoutParams = LinearLayout.LayoutParams(w.dp(sizeDp), w.dp(sizeDp))
        return frame
    }

    private fun tile(shortcut: Shortcut?, label: String, theme: ThemeId, onClick: () -> Unit, onLongClick: (() -> Unit)?): View {
        val panorama = theme == ThemeId.PANORAMA
        return w.vertical(spacingDp = 8) {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(w.dp(6), w.dp(10), w.dp(6), w.dp(10))
            background = context.pressable(w.look, if (panorama) context.rounded(p.surface1, 14, p.border1) else null, 14)
            if (theme == ThemeId.ICARUS) minimumWidth = w.dp(76)
            addView(badge(shortcut, if (panorama) 40 else 52, if (panorama) 12 else 26))
            addView(TextView(context).apply {
                text = label
                textStyle(13f, p.fg2)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            contentDescription = label
            setOnClickListener { onClick() }
            if (onLongClick != null) setOnLongClickListener { onLongClick(); true }
        }
    }

    private fun shortcutTile(shortcut: Shortcut, theme: ThemeId) =
        tile(shortcut, shortcut.title, theme, onClick = { onOpen(shortcut.url) }, onLongClick = { onEditShortcut(shortcut) })

    private fun addTile(theme: ThemeId) = tile(null, "Añadir", theme, onClick = { onEditShortcut(null) }, onLongClick = null)

    private fun shieldLine(): View {
        val state = app.shield.state()
        val total = NumberFormat.getIntegerInstance(spanish).format(state.totalBlocked)
        val message = if (state.enabled) "ICARUS Shield ha bloqueado $total solicitudes de anuncios y rastreadores." else "ICARUS Shield está desactivado."
        return w.row(if (state.enabled) R.drawable.icarus_shield else R.drawable.icarus_shield_off, message, "Ver la configuración de Shield") { onShield() }.apply {
            val margin = w.dp(16)
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { setMargins(margin, margin, margin, margin) }
            background = context.pressable(w.look, context.rounded(p.surface1, 16, p.border1), 16)
        }
    }
}
