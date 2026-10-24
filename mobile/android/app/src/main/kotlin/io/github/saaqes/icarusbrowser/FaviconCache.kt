package io.github.saaqes.icarusbrowser

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.io.File

/**
 * Iconos de los sitios que WebView ya descargó al visitarlos (onReceivedIcon).
 * Se guardan por nombre de host en la caché de la app; ICARUS no pide iconos a
 * sitios que no se han visitado (en su lugar muestra la inicial).
 */
class FaviconCache(private val dir: File) {
    private val memory = LruCache<String, Bitmap>(64)

    fun get(host: String): Bitmap? {
        val key = key(host) ?: return null
        memory.get(key)?.let { return it }
        val file = File(dir, "$key.png")
        if (!file.isFile) return null
        return BitmapFactory.decodeFile(file.path)?.also { memory.put(key, it) }
    }

    fun put(host: String, icon: Bitmap) {
        val key = key(host) ?: return
        memory.put(key, icon)
        IcarusApp.instance.background.execute {
            runCatching {
                dir.mkdirs()
                val scaled = if (icon.width > 96) Bitmap.createScaledBitmap(icon, 96, 96 * icon.height / maxOf(1, icon.width), true) else icon
                File(dir, "$key.png").outputStream().use { scaled.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        }
    }

    fun clear() {
        memory.evictAll()
        dir.deleteRecursively()
    }

    private fun key(host: String): String? = host.lowercase().removePrefix("www.").takeIf { HOST.matches(it) }

    companion object {
        private val HOST = Regex("^[a-z0-9.-]{1,253}$")
    }
}
