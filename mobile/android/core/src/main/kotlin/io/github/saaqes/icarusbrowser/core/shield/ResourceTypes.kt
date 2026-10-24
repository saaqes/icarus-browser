package io.github.saaqes.icarusbrowser.core.shield

/**
 * WebView de Android no indica el tipo de cada subsolicitud (Chromium de
 * escritorio sí: `details.resourceType`). Se deduce, por este orden, de:
 * 1. la cabecera `Sec-Fetch-Dest`, si WebView la incluye;
 * 2. `Accept` y `X-Requested-With`;
 * 3. la extensión de la ruta.
 * Si nada encaja el tipo es `other`: las reglas sin opción de tipo se aplican
 * igual, pero una regla `$image` no bloquea una imagen que no se pudo reconocer.
 */
object ResourceTypes {
    fun infer(url: String, isMainFrame: Boolean, headers: Map<String, String>): ResourceType {
        if (isMainFrame) return ResourceType.DOCUMENT
        val lower = url.lowercase()
        if (lower.startsWith("ws:") || lower.startsWith("wss:")) return ResourceType.WEBSOCKET
        val header = { name: String -> headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.lowercase()?.trim() }

        when (header("Sec-Fetch-Dest")) {
            "iframe", "frame", "document" -> return ResourceType.SUBDOCUMENT
            "image" -> return ResourceType.IMAGE
            "script", "worker", "sharedworker", "serviceworker", "audioworklet", "paintworklet" -> return ResourceType.SCRIPT
            "style" -> return ResourceType.STYLESHEET
            "font" -> return ResourceType.FONT
            "audio", "video", "track" -> return ResourceType.MEDIA
            "object", "embed" -> return ResourceType.OBJECT
            "report" -> return ResourceType.OTHER
            "empty" -> return ResourceType.XMLHTTPREQUEST
        }
        if (header("X-Requested-With") == "xmlhttprequest") return ResourceType.XMLHTTPREQUEST
        val accept = header("Accept").orEmpty()
        when {
            accept.startsWith("text/css") -> return ResourceType.STYLESHEET
            accept.startsWith("image/") -> return ResourceType.IMAGE
            accept.startsWith("text/html") -> return ResourceType.SUBDOCUMENT
        }

        val path = lower.substringBefore('#').substringBefore('?')
        val extension = path.substringAfterLast('/').substringAfterLast('.', "")
        return when (extension) {
            "js", "mjs" -> ResourceType.SCRIPT
            "css" -> ResourceType.STYLESHEET
            "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp" -> ResourceType.IMAGE
            "woff", "woff2", "ttf", "otf", "eot" -> ResourceType.FONT
            "mp4", "webm", "mp3", "m4a", "ogg", "oga", "wav", "m3u8", "mpd", "ts" -> ResourceType.MEDIA
            "json" -> ResourceType.XMLHTTPREQUEST
            "html", "htm" -> ResourceType.SUBDOCUMENT
            else -> ResourceType.OTHER
        }
    }
}
