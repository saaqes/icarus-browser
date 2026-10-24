package io.github.saaqes.icarusbrowser.core

/** Páginas internas `icarus://…` disponibles en la app. */
enum class InternalPage(val kind: String, val url: String) {
    NEW_TAB("newtab", "icarus://nueva-pestana"),
    BLANK("blank", "icarus://en-blanco"),
    HISTORY("history", "icarus://historial"),
    DOWNLOADS("downloads", "icarus://descargas"),
    SETTINGS("settings", "icarus://configuracion");

    companion object {
        const val PROTOCOL = "icarus:"
        private val URL = Regex("^icarus://([^?#]*)", RegexOption.IGNORE_CASE)

        /** Secciones de configuración de escritorio que también se aceptan en la dirección. */
        private val SETTINGS_SLUGS = setOf("general", "apariencia", "navegacion", "privacidad", "shield", "descargas", "avanzado", "acerca-de")

        /** Convierte `icarus://…` en una página interna. Devuelve null si no existe. */
        fun parse(text: String): InternalPage? {
            val match = URL.find(text.trim()) ?: return null
            val parts = match.groupValues[1].lowercase().split('/').filter { it.isNotEmpty() }
            val root = parts.firstOrNull()
            return when {
                parts.isEmpty() || root == "inicio" || root == "nueva-pestana" -> if (parts.size <= 1) NEW_TAB else null
                root == "en-blanco" -> if (parts.size == 1) BLANK else null
                root == "historial" -> if (parts.size == 1) HISTORY else null
                root == "descargas" -> if (parts.size == 1) DOWNLOADS else null
                root == "configuracion" -> when {
                    parts.size == 1 -> SETTINGS
                    parts.size == 2 && parts[1] in SETTINGS_SLUGS -> SETTINGS
                    else -> null
                }
                else -> null
            }
        }
    }
}
