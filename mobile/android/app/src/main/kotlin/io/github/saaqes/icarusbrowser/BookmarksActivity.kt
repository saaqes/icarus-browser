package io.github.saaqes.icarusbrowser

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import io.github.saaqes.icarusbrowser.core.Bookmark
import io.github.saaqes.icarusbrowser.core.BookmarksStore

/**
 * Editor de un favorito (como el de escritorio): nombre, carpeta (o una nueva) y
 * «Quitar». Muestra la dirección visible, nunca la original si hay una personalizada.
 */
object BookmarkEditor {
    fun show(context: Context, w: Widgets, bookmark: Bookmark, isNew: Boolean, onDone: () -> Unit = {}) {
        val store = IcarusApp.instance.bookmarks
        val name = w.field("Nombre", bookmark.title)
        var folderId = bookmark.folderId
        val folderName = w.field("Nombre de la carpeta nueva", "", "Ej. Trabajo").apply { view.visibility = View.GONE }
        val folders = w.vertical(spacingDp = 2)
        fun renderFolders() {
            folders.removeAllViews()
            folders.addView(w.text("Carpeta", 14f, w.look.palette.fg2, bold = true))
            for (folder in store.data.folders) {
                val selected = folder.id == folderId
                folders.addView(w.row(if (selected) R.drawable.icarus_check else R.drawable.icarus_folder, folder.name) {
                    folderId = folder.id
                    folderName.view.visibility = View.GONE
                    renderFolders()
                }.apply { if (selected) background = context.rounded(w.look.accentSoft, 14) })
            }
            folders.addView(w.row(R.drawable.icarus_plus, "Nueva carpeta…") {
                folderId = NEW_FOLDER
                folderName.view.visibility = View.VISIBLE
                folderName.edit.requestFocus()
                renderFolders()
            }.apply { if (folderId == NEW_FOLDER) background = context.rounded(w.look.accentSoft, 14) })
        }
        renderFolders()
        lateinit var dialog: Dialog
        val content = w.vertical(spacingDp = 12) {
            addView(w.hint(AddressFormat.display(bookmark.url).text))
            addView(name.view)
            addView(folders)
            addView(folderName.view)
            addView(w.button("Quitar de Favoritos", danger = true) {
                store.remove(bookmark.id)
                dialog.dismiss()
                onDone()
            }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        dialog = w.dialog(if (isNew) "Favorito añadido" else "Editar favorito", content = content, positive = "Hecho", negative = null, onCancel = onDone) {
            var target = folderId
            if (target == NEW_FOLDER) {
                val created = store.addFolder(folderName.value)
                if (created == null) {
                    folderName.setError("Escribe un nombre para la carpeta (máximo ${BookmarksStore.FOLDER_NAME_MAX} caracteres).")
                    return@dialog false
                }
                target = created.id
            }
            store.update(bookmark.id, title = name.value, folderId = target)
            onDone()
            true
        }
        dialog.show()
    }

    private const val NEW_FOLDER = "__nueva__"
}

/** Pantalla «Favoritos»: por carpeta, con búsqueda; tocar abre la página, el lápiz la edita. */
class BookmarksActivity : ScreenActivity() {
    private var query = ""

    override fun rootTitle() = "Favoritos"

    override fun buildRoot(): View {
        val search = w.field("Buscar en favoritos", query, "Nombre o dirección")
        val list = w.vertical(spacingDp = 6)
        fun renderList() {
            list.removeAllViews()
            val data = app.bookmarks.data
            val needle = query.trim().lowercase()
            val matching = data.items.filter {
                needle.isEmpty() || it.title.lowercase().contains(needle) || AddressFormat.display(it.url).text.lowercase().contains(needle)
            }
            if (matching.isEmpty()) {
                list.addView(w.hint(
                    if (data.items.isEmpty()) "Aún no tienes favoritos. Toca la estrella de la barra de direcciones para guardar la página actual."
                    else "Ningún favorito coincide con la búsqueda.",
                ).apply { setPadding(dp(4), dp(16), dp(4), 0) })
            }
            for (folder in data.folders) {
                val items = matching.filter { it.folderId == folder.id }
                if (items.isEmpty() && (needle.isNotEmpty() || folder.id == BookmarksStore.DEFAULT_FOLDER_ID)) continue
                list.addView(w.horizontal {
                    addView(w.sectionLabel(folder.name), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                    if (folder.id != BookmarksStore.DEFAULT_FOLDER_ID) {
                        addView(w.iconButton(R.drawable.icarus_trash, "Eliminar la carpeta ${folder.name}") {
                            app.bookmarks.removeFolder(folder.id)
                            renderList()
                        })
                    }
                })
                if (items.isEmpty()) {
                    list.addView(w.hint("Esta carpeta está vacía."))
                    continue
                }
                list.addView(w.card {
                    for (item in items) {
                        val edit = w.iconButton(R.drawable.icarus_edit, "Editar ${item.title}") { BookmarkEditor.show(this@BookmarksActivity, w, item, isNew = false) { renderList() } }
                        addView(w.row(R.drawable.icarus_star_filled, item.title, AddressFormat.display(item.url).text, edit) {
                            startActivity(Intent(this@BookmarksActivity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(item.url)))
                            finish()
                        })
                    }
                })
            }
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
            addView(w.button("Nueva carpeta") {
                val name = w.field("Nombre", "", "Ej. Trabajo")
                w.dialog("Nueva carpeta", content = name.view, positive = "Crear") {
                    if (app.bookmarks.addFolder(name.value) == null) {
                        name.setError("Escribe un nombre (máximo ${BookmarksStore.FOLDER_NAME_MAX} caracteres).")
                        false
                    } else {
                        renderList()
                        true
                    }
                }.show()
            }.apply { layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(8) } })
            addView(list, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
    }

    /** Los favoritos pueden cambiar desde la pestaña; aquí se redibuja al volver. */
    override fun onDataChanged() = Unit
}
