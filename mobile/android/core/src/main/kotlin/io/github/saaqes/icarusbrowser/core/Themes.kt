package io.github.saaqes.icarusbrowser.core

import org.json.JSONObject

/** Colores de un estilo en un modo, como enteros ARGB (los mismos tokens que el CSS de escritorio). */
class Palette(private val colors: Map<String, Int>) {
    operator fun get(token: String): Int = colors[token] ?: error("Falta el color --$token")

    val appBg get() = this["app-bg"]
    val toolbarBg get() = this["toolbar-bg"]
    val toolbarBorder get() = this["toolbar-border"]
    val omniboxBg get() = this["omnibox-bg"]
    val omniboxFg get() = this["omnibox-fg"]
    val omniboxDim get() = this["omnibox-dim"]
    val pageBg get() = this["page-bg"]
    val surface1 get() = this["surface-1"]
    val surface2 get() = this["surface-2"]
    val border1 get() = this["border-1"]
    val fg1 get() = this["fg-1"]
    val fg2 get() = this["fg-2"]
    val fg3 get() = this["fg-3"]
    val danger get() = this["danger"]
    val success get() = this["success"]
    val accent get() = this["accent"]

    fun withAccent(color: Int) = Palette(colors + ("accent" to color))
}

data class ThemeInfo(val id: ThemeId, val name: String, val description: String, val light: Palette, val dark: Palette)

/** Lee mobile/shared/themes.json (generado desde src/styles y src/themes). */
class Themes(json: String) {
    val themes: Map<ThemeId, ThemeInfo>
    /** id → (claro, oscuro). */
    val accents: Map<String, Pair<Int, Int>>

    init {
        val root = JSONObject(json)
        val rawThemes = root.getJSONObject("themes")
        themes = ThemeId.entries.associateWith { id ->
            val theme = rawThemes.getJSONObject(id.id)
            ThemeInfo(id, theme.getString("name"), theme.getString("description"), palette(theme.getJSONObject("light")), palette(theme.getJSONObject("dark")))
        }
        val rawAccents = root.getJSONObject("accents")
        accents = rawAccents.keys().asSequence().associateWith { key ->
            val pair = rawAccents.getJSONObject(key)
            parseColor(pair.getString("light")) to parseColor(pair.getString("dark"))
        }
    }

    fun palette(theme: ThemeId, dark: Boolean, accent: String = "default"): Palette {
        val info = themes.getValue(theme)
        val base = if (dark) info.dark else info.light
        val custom = accents[accent] ?: return base
        return base.withAccent(if (dark) custom.second else custom.first)
    }

    companion object {
        private fun palette(json: JSONObject) = Palette(json.keys().asSequence().associateWith { parseColor(json.getString(it)) })

        /** `#RRGGBB` o `#RRGGBBAA` (orden CSS) → ARGB. */
        fun parseColor(text: String): Int {
            require(text.startsWith("#") && (text.length == 7 || text.length == 9)) { "Color no válido: $text" }
            val rgb = text.substring(1, 7).toLong(16)
            val alpha = if (text.length == 9) text.substring(7, 9).toLong(16) else 0xFF
            return ((alpha shl 24) or rgb).toInt()
        }

        /** Luminancia relativa (WCAG) de un color ARGB, para elegir texto claro u oscuro. */
        fun luminance(color: Int): Double {
            fun channel(shift: Int): Double {
                val value = ((color shr shift) and 0xFF) / 255.0
                return if (value <= 0.03928) value / 12.92 else Math.pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }

        fun contrastOn(background: Int): Int = if (luminance(background) > 0.4) 0xFF16141C.toInt() else 0xFFFFFFFF.toInt()
    }
}
