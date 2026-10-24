package io.github.saaqes.icarusbrowser.core

import com.sun.net.httpserver.HttpServer
import io.github.saaqes.icarusbrowser.core.shield.FetchResult
import io.github.saaqes.icarusbrowser.core.shield.HttpListFetcher
import io.github.saaqes.icarusbrowser.core.shield.ListError
import io.github.saaqes.icarusbrowser.core.shield.ListFetcher
import io.github.saaqes.icarusbrowser.core.shield.ResourceType
import io.github.saaqes.icarusbrowser.core.shield.ShieldStore
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShieldStoreTest {
    private val shared = File(System.getProperty("icarus.shared") ?: "../../shared")
    private val dir: File = Files.createTempDirectory("icarus-shield").toFile()
    private val basic = File(shared, "shield-basic.txt").readText()
    private val suffixes = PublicSuffixList(File(shared, "public-suffix-rules.txt").readText())

    /** Respuestas por URL; las que faltan fallan como sin conexión. */
    private val responses = HashMap<String, FetchResult>()
    private val fetcher = ListFetcher { url -> responses[url] ?: FetchResult.Failed(ListError.NETWORK) }

    @AfterTest
    fun cleanUp() {
        dir.deleteRecursively()
    }

    private fun store() = ShieldStore(dir, basic, suffixes, fetcher)

    @Test
    fun `sin conexión solo funciona la lista básica y el contador cuenta bloqueos reales`() {
        val shield = store()
        shield.updateLists(onlyStale = true)
        val state = shield.state()
        assertEquals(ListError.NETWORK, state.lists.first { it.id == "easylist" }.error)
        assertTrue(state.lists.first { it.id == ShieldStore.BUILTIN_ID }.ruleCount > 50)
        assertTrue(shield.shouldBlock("https://www.google-analytics.com/analytics.js", ResourceType.SCRIPT, "https://www.ejemplo.com/"))
        assertFalse(shield.shouldBlock("https://www.ejemplo.com/app.js", ResourceType.SCRIPT, "https://www.ejemplo.com/"))
        assertFalse(shield.shouldBlock("https://www.google-analytics.com/", ResourceType.DOCUMENT, "https://www.ejemplo.com/"))
        assertEquals(1, shield.state().totalBlocked)
    }

    @Test
    fun `las excepciones de sitio usan el dominio registrable`() {
        val shield = store()
        shield.setSiteAllowed("www.noticias.co.uk", true)
        assertEquals(listOf("noticias.co.uk"), shield.state().exceptions)
        assertFalse(shield.shouldBlock("https://www.google-analytics.com/analytics.js", ResourceType.SCRIPT, "https://m.noticias.co.uk/"))
        shield.setSiteAllowed("noticias.co.uk", false)
        assertTrue(shield.shouldBlock("https://www.google-analytics.com/analytics.js", ResourceType.SCRIPT, "https://m.noticias.co.uk/"))
    }

    @Test
    fun `una lista descargada se valida y se guarda en disco`() {
        responses["https://easylist.to/easylist/easylist.txt"] = FetchResult.Ok("[Adblock Plus 2.0]\n||anuncios-de-prueba.com^\n")
        responses["https://easylist.to/easylist/easyprivacy.txt"] = FetchResult.Ok("<!doctype html><html>Inicia sesión</html>")
        val shield = store()
        shield.updateLists(onlyStale = false)
        val lists = shield.state().lists.associateBy { it.id }
        assertEquals(1, lists.getValue("easylist").ruleCount)
        assertNull(lists.getValue("easylist").error)
        assertEquals(ListError.NOT_A_LIST, lists.getValue("easyprivacy").error)
        assertTrue(shield.shouldBlock("https://cdn.anuncios-de-prueba.com/a.js", ResourceType.SCRIPT, "https://ejemplo.com/"))

        // Si falla la actualización se conserva la copia anterior.
        responses.remove("https://easylist.to/easylist/easylist.txt")
        shield.updateLists(onlyStale = false)
        assertEquals(ListError.NETWORK, shield.state().lists.first { it.id == "easylist" }.error)
        assertTrue(shield.shouldBlock("https://cdn.anuncios-de-prueba.com/a.js", ResourceType.SCRIPT, "https://ejemplo.com/"))

        shield.flush()
        val reopened = store()
        assertTrue(reopened.shouldBlock("https://cdn.anuncios-de-prueba.com/a.js", ResourceType.SCRIPT, "https://ejemplo.com/"))
    }

    @Test
    fun `listas propias, reglas personalizadas y desactivar Shield`() {
        val shield = store()
        assertEquals(ListError.INVALID_URL, assertIs<ShieldStore.AddResult.Failed>(shield.addList("HTTP", "http://listas.com/a.txt")).error)
        assertEquals(ListError.NETWORK, assertIs<ShieldStore.AddResult.Failed>(shield.addList("Sin red", "https://listas.com/sin-red.txt")).error)
        assertTrue(shield.state().lists.all { it.builtIn }, "una lista que no se pudo descargar no se añade")
        responses["https://listas.com/vacia.txt"] = FetchResult.Ok("! solo comentarios\n")
        assertEquals(ListError.EMPTY, assertIs<ShieldStore.AddResult.Failed>(shield.addList("Vacía", "https://listas.com/vacia.txt")).error)
        responses["https://listas.com/propia.txt"] = FetchResult.Ok("||propia-bloqueada.com^\n")
        assertIs<ShieldStore.AddResult.Ok>(shield.addList("", "https://listas.com/propia.txt"))
        assertEquals(ListError.DUPLICATE, assertIs<ShieldStore.AddResult.Failed>(shield.addList("Otra vez", "https://listas.com/propia.txt")).error)
        val custom = shield.state().lists.first { !it.builtIn }
        assertEquals("listas.com", custom.name)
        assertTrue(shield.shouldBlock("https://propia-bloqueada.com/x.png", ResourceType.IMAGE, "https://ejemplo.com/"))

        shield.setCustomRules("||regla-personal.net^\n/roto(/\n")
        assertEquals(1, shield.state().customRuleCount)
        assertEquals(1, shield.state().customInvalidCount)
        assertTrue(shield.shouldBlock("https://regla-personal.net/p.gif", ResourceType.IMAGE, "https://ejemplo.com/"))

        shield.setEnabled(false)
        assertFalse(shield.shouldBlock("https://regla-personal.net/p.gif", ResourceType.IMAGE, "https://ejemplo.com/"))
        shield.setEnabled(true)
        shield.removeList(custom.id)
        assertFalse(shield.shouldBlock("https://propia-bloqueada.com/x.png", ResourceType.IMAGE, "https://ejemplo.com/"))
    }

    @Test
    fun `el descargador HTTP respeta códigos, tamaño y HTML`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/lista.txt") { exchange ->
            val body = "||servidor-local.com^\n".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/falta") { exchange ->
            exchange.sendResponseHeaders(404, -1)
            exchange.close()
        }
        server.createContext("/enorme") { exchange ->
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.use { output ->
                val chunk = ByteArray(1024 * 1024) { 'a'.code.toByte() }
                runCatching { repeat(16) { output.write(chunk) } }
            }
        }
        server.start()
        try {
            val base = "http://127.0.0.1:${server.address.port}"
            val fetcher = HttpListFetcher(timeoutMs = 5000)
            assertEquals("||servidor-local.com^\n", assertIs<FetchResult.Ok>(fetcher.fetch("$base/lista.txt")).text)
            assertEquals(ListError.HTTP, assertIs<FetchResult.Failed>(fetcher.fetch("$base/falta")).error)
            assertEquals(ListError.TOO_LARGE, assertIs<FetchResult.Failed>(fetcher.fetch("$base/enorme")).error)
            assertEquals(ListError.NETWORK, assertIs<FetchResult.Failed>(fetcher.fetch("http://127.0.0.1:1/x")).error)
        } finally {
            server.stop(0)
        }
    }
}
