package io.github.saaqes.icarusbrowser.core

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BookmarksTest {
    private fun store(dir: java.io.File = Files.createTempDirectory("icarus-favoritos").toFile()) = dir to BookmarksStore(java.io.File(dir, "bookmarks.json"))

    @Test
    fun `guarda una sola vez cada página y el fragmento distingue secciones`() {
        val (_, bookmarks) = store()
        val first = assertIs<BookmarksStore.AddResult.Ok>(bookmarks.add("Panel", "https://bot.deriv.me/#dashboard"))
        assertTrue(first.created)
        val again = assertIs<BookmarksStore.AddResult.Ok>(bookmarks.add("Otra vez", "https://BOT.deriv.me/#dashboard"))
        assertEquals(false, again.created)
        assertEquals(1, bookmarks.data.items.size)
        assertNull(bookmarks.find("https://bot.deriv.me/#chart"))
        assertIs<BookmarksStore.AddResult.Failure>(bookmarks.add("x", "javascript:alert(1)"))
    }

    @Test
    fun `carpetas, nombre, mover y borrar sin perder favoritos y se conserva al reiniciar`() {
        val (dir, bookmarks) = store()
        val added = assertIs<BookmarksStore.AddResult.Ok>(bookmarks.add("A", "https://ejemplo.com/")).bookmark
        val folder = assertNotNull(bookmarks.addFolder("Trabajo"))
        assertEquals(folder.id, bookmarks.addFolder("trabajo")?.id)
        assertNull(bookmarks.addFolder("   "))
        bookmarks.update(added.id, title = "  Mi página ", folderId = folder.id)
        assertEquals("Mi página", bookmarks.data.items.single().title)
        assertEquals(folder.id, bookmarks.data.items.single().folderId)
        bookmarks.flush()
        val reopened = BookmarksStore(java.io.File(dir, "bookmarks.json"))
        assertEquals(listOf("Favoritos", "Trabajo"), reopened.data.folders.map { it.name })
        reopened.removeFolder(folder.id)
        assertEquals(BookmarksStore.DEFAULT_FOLDER_ID, reopened.data.items.single().folderId)
        reopened.remove(added.id)
        assertTrue(reopened.data.items.isEmpty())
    }
}
