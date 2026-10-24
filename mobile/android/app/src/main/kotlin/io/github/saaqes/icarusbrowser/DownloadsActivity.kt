package io.github.saaqes.icarusbrowser

import android.content.ActivityNotFoundException
import android.text.format.Formatter
import android.view.View
import android.widget.Toast
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class DownloadsActivity : ScreenActivity() {
    private val listener: () -> Unit = { runOnUiThread { refresh() } }
    private val poll = object : Runnable {
        override fun run() {
            if (app.downloads.list().any { it.status == DownloadsStore.Status.RUNNING || it.status == DownloadsStore.Status.PENDING }) {
                refresh()
                app.main.postDelayed(this, 1000)
            }
        }
    }

    override fun rootTitle() = "Descargas"

    override fun openInitialPage() {
        app.downloads.addListener(listener)
    }

    override fun onResume() {
        super.onResume()
        refresh()
        app.main.post(poll)
    }

    override fun onPause() {
        app.main.removeCallbacks(poll)
        super.onPause()
    }

    override fun onDestroy() {
        app.downloads.removeListener(listener)
        super.onDestroy()
    }

    override fun buildRoot(): View = pageColumn {
        val items = app.downloads.list()
        addView(w.hint("Las descargas las realiza el gestor de descargas de Android y se guardan en la carpeta Descargas.").apply {
            setPadding(dp(4), dp(8), dp(4), dp(8))
        })
        if (items.isEmpty()) {
            addView(w.hint("No hay descargas.").apply { setPadding(dp(4), dp(16), dp(4), 0) })
            return@pageColumn
        }
        val format = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, Locale.forLanguageTag("es-ES"))
        addView(w.card {
            for (item in items) {
                val status = when (item.status) {
                    DownloadsStore.Status.PENDING -> "Pendiente"
                    DownloadsStore.Status.RUNNING -> if (item.totalBytes > 0) {
                        "Descargando · ${Formatter.formatShortFileSize(context, item.downloadedBytes)} de ${Formatter.formatShortFileSize(context, item.totalBytes)}"
                    } else {
                        "Descargando · ${Formatter.formatShortFileSize(context, item.downloadedBytes)}"
                    }
                    DownloadsStore.Status.PAUSED -> "En pausa (esperando conexión)"
                    DownloadsStore.Status.SUCCESSFUL -> "Completada · ${Formatter.formatShortFileSize(context, item.totalBytes.coerceAtLeast(item.downloadedBytes))}"
                    DownloadsStore.Status.FAILED -> "Error (código ${item.reason})"
                    DownloadsStore.Status.MISSING -> "Ya no está en el gestor de descargas"
                }
                val remove = w.iconButton(R.drawable.icarus_trash, "Quitar ${item.name}") { removeDialog(item) }
                addView(w.row(R.drawable.icarus_download, item.name, "$status\n${format.format(Date(item.startedAt))}", remove) {
                    val intent = app.downloads.openIntent(item)
                    if (intent == null) {
                        toast(if (item.status == DownloadsStore.Status.SUCCESSFUL) "No se encontró el archivo." else "La descarga aún no ha terminado.")
                    } else {
                        try {
                            startActivity(intent)
                        } catch (_: ActivityNotFoundException) {
                            toast("Ninguna aplicación puede abrir este archivo.")
                        }
                    }
                })
            }
        })
    }

    private fun removeDialog(item: DownloadsStore.Item) {
        if (item.status != DownloadsStore.Status.SUCCESSFUL) {
            app.downloads.remove(item, deleteFile = true)
            return
        }
        w.dialog("Quitar la descarga", "«${item.name}»", positive = "Borrar también el archivo", negative = "Quitar de la lista", destructive = true,
            onNegative = { app.downloads.remove(item, deleteFile = false) }, onCancel = {}) {
            app.downloads.remove(item, deleteFile = true)
            true
        }.show()
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
}
