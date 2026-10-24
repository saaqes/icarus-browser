package io.github.saaqes.icarusbrowser

import android.content.Intent
import android.net.Uri
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import io.github.saaqes.icarusbrowser.core.ClearRange
import java.text.DateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

class HistoryActivity : ScreenActivity() {
    private val spanish = Locale.forLanguageTag("es-ES")
    private var query = ""

    override fun rootTitle() = "Historial"

    override fun buildRoot(): View {
        val search = w.field("Buscar en el historial", query, "Título o dirección")
        val list = w.vertical(spacingDp = 6)
        fun renderList() {
            list.removeAllViews()
            val items = app.history.search(query)
            if (items.isEmpty()) {
                list.addView(w.hint(if (query.isBlank()) "El historial está vacío." else "Ninguna página coincide con la búsqueda.").apply {
                    setPadding(dp(4), dp(16), dp(4), 0)
                })
                return
            }
            val zone = ZoneId.systemDefault()
            val time = DateFormat.getTimeInstance(DateFormat.SHORT, spanish)
            items.take(500).groupBy { Instant.ofEpochMilli(it.visitedAt).atZone(zone).toLocalDate() }.forEach { (day, entries) ->
                list.addView(w.sectionLabel(dayLabel(day)))
                list.addView(w.card {
                    for (item in entries) {
                        val remove = w.iconButton(R.drawable.icarus_close, "Quitar del historial") { app.history.remove(item.id); renderList() }
                        addView(w.row(null, AddressFormat.title(item.url, item.title), "${time.format(Date(item.visitedAt))} · ${AddressFormat.display(item.url).text}", remove) {
                            startActivity(Intent(this@HistoryActivity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(item.url)))
                            finish()
                        })
                    }
                })
            }
            if (items.size > 500) list.addView(w.hint("Se muestran las 500 entradas más recientes. Usa la búsqueda para encontrar otras."))
        }
        search.edit.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                query = s.toString()
                renderList()
            }
        })
        renderList()
        return pageColumn {
            addView(search.view, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(w.button("Borrar historial…", danger = true) { clearDialog { renderList() } }.apply {
                layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(8) }
            })
            addView(list, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
    }

    /** El historial cambia mientras se navega en segundo plano; aquí solo se redibuja al volver. */
    override fun onDataChanged() = Unit

    private fun dayLabel(day: LocalDate): String {
        val today = LocalDate.now()
        return when (day) {
            today -> "Hoy"
            today.minusDays(1) -> "Ayer"
            else -> day.format(DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM 'de' yyyy", spanish))
        }
    }

    private fun clearDialog(onDone: () -> Unit) {
        lateinit var dialog: android.app.Dialog
        val content = w.vertical(spacingDp = 4) {
            listOf(ClearRange.HOUR to "La última hora", ClearRange.DAY to "El último día", ClearRange.WEEK to "La última semana", ClearRange.ALL to "Todo el historial")
                .forEach { (range, label) ->
                    addView(w.row(R.drawable.icarus_trash, label) {
                        app.history.clear(range)
                        dialog.dismiss()
                        onDone()
                    })
                }
        }
        dialog = w.dialog("Borrar historial", "Elige qué periodo borrar. Las cookies y la caché se borran en Configuración → Privacidad.", content, positive = null)
        dialog.show()
    }
}
