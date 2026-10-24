package io.github.saaqes.icarusbrowser

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Descargas mediante DownloadManager de Android, que las hace en segundo plano,
 * las guarda en la carpeta Descargas y muestra su notificación.
 *
 * ICARUS solo informa de que una descarga terminó cuando DownloadManager devuelve
 * STATUS_SUCCESSFUL; mientras tanto se muestra como «en curso» o «pendiente».
 */
class DownloadsStore(private val app: IcarusApp) {
    enum class Status { PENDING, RUNNING, PAUSED, SUCCESSFUL, FAILED, MISSING }

    data class Item(
        val id: Long,
        val name: String,
        val url: String,
        val startedAt: Long,
        val status: Status,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val reason: Int,
    )

    private val prefs = app.getSharedPreferences("downloads", Context.MODE_PRIVATE)
    private val manager: DownloadManager = checkNotNull(app.getSystemService(DownloadManager::class.java)) { "DownloadManager no disponible" }
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            val item = list().firstOrNull { it.id == id } ?: return
            val message = when (item.status) {
                Status.SUCCESSFUL -> "Descarga completada: ${item.name}"
                Status.FAILED -> "La descarga de ${item.name} falló."
                else -> null
            }
            if (message != null) Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            listeners.forEach { it() }
        }
    }

    init {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        // El aviso lo envía el proveedor de descargas del sistema (otra app).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else app.registerReceiver(receiver, filter)
    }

    fun addListener(listener: () -> Unit) = listeners.add(listener)
    fun removeListener(listener: () -> Unit) = listeners.remove(listener)

    sealed interface StartResult {
        data class Started(val name: String) : StartResult
        /** blob:, data: u otros esquemas que DownloadManager no puede descargar. */
        data object Unsupported : StartResult
        data class Failed(val message: String) : StartResult
    }

    fun suggestedName(url: String, contentDisposition: String?, mimeType: String?): String =
        URLUtil.guessFileName(url, contentDisposition, mimeType).replace(Regex("[\\\\/:*?\"<>|]"), "_")

    fun start(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?, referer: String?): StartResult {
        val uri = Uri.parse(url)
        if (uri.scheme != "http" && uri.scheme != "https") return StartResult.Unsupported
        val name = suggestedName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(uri).apply {
            if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
            CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
            if (!userAgent.isNullOrBlank()) addRequestHeader("User-Agent", userAgent)
            if (!referer.isNullOrBlank() && referer.startsWith("http")) addRequestHeader("Referer", referer)
            setTitle(name)
            setDescription(uri.host)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        }
        val id = try {
            manager.enqueue(request)
        } catch (error: Exception) {
            return StartResult.Failed(error.message ?: "No se pudo iniciar la descarga.")
        }
        val entries = stored()
        val entry = JSONObject().put("id", id).put("name", name).put("url", url).put("startedAt", System.currentTimeMillis())
        save(JSONArray(listOf(entry) + (0 until minOf(entries.length(), 199)).mapNotNull { entries.optJSONObject(it) }))
        listeners.forEach { it() }
        return StartResult.Started(name)
    }

    /** Descargas iniciadas desde ICARUS, con el estado que informa DownloadManager. */
    fun list(): List<Item> {
        val entries = stored()
        val items = ArrayList<Item>()
        val ids = (0 until entries.length()).mapNotNull { entries.optJSONObject(it) }
        val statuses = HashMap<Long, IntArray>()
        val sizes = HashMap<Long, LongArray>()
        if (ids.isNotEmpty()) {
            val query = DownloadManager.Query().setFilterById(*ids.map { it.optLong("id") }.toLongArray())
            manager.query(query)?.use { cursor ->
                val idColumn = cursor.getColumnIndex(DownloadManager.COLUMN_ID)
                val statusColumn = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                val reasonColumn = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                val soFarColumn = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                val totalColumn = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idColumn)
                    statuses[id] = intArrayOf(cursor.getInt(statusColumn), cursor.getInt(reasonColumn))
                    sizes[id] = longArrayOf(cursor.getLong(soFarColumn), cursor.getLong(totalColumn))
                }
            }
        }
        for (entry in ids) {
            val id = entry.optLong("id")
            val (rawStatus, reason) = statuses[id]?.let { it[0] to it[1] } ?: (-1 to 0)
            val status = when (rawStatus) {
                DownloadManager.STATUS_PENDING -> Status.PENDING
                DownloadManager.STATUS_RUNNING -> Status.RUNNING
                DownloadManager.STATUS_PAUSED -> Status.PAUSED
                DownloadManager.STATUS_SUCCESSFUL -> Status.SUCCESSFUL
                DownloadManager.STATUS_FAILED -> Status.FAILED
                else -> Status.MISSING
            }
            val size = sizes[id] ?: longArrayOf(0, -1)
            items.add(Item(id, entry.optString("name"), entry.optString("url"), entry.optLong("startedAt"), status, size[0], size[1], reason))
        }
        return items
    }

    fun openIntent(item: Item): Intent? {
        if (item.status != Status.SUCCESSFUL) return null
        val uri = manager.getUriForDownloadedFile(item.id) ?: return null
        val type = manager.getMimeTypeForDownloadedFile(item.id) ?: "*/*"
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /** Quita la descarga de la lista de ICARUS; con `deleteFile`, también borra el archivo. */
    fun remove(item: Item, deleteFile: Boolean) {
        if (deleteFile || item.status != Status.SUCCESSFUL) manager.remove(item.id)
        val entries = stored()
        save(JSONArray((0 until entries.length()).mapNotNull { entries.optJSONObject(it) }.filter { it.optLong("id") != item.id }))
        listeners.forEach { it() }
    }

    private fun stored(): JSONArray = runCatching { JSONArray(prefs.getString("items", "[]")) }.getOrDefault(JSONArray())

    private fun save(array: JSONArray) {
        prefs.edit().putString("items", array.toString()).apply()
    }
}
