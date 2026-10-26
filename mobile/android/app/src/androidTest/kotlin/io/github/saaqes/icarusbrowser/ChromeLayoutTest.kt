package io.github.saaqes.icarusbrowser

import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import android.util.Log
import android.view.WindowInsets
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.saaqes.icarusbrowser.core.AddressRebase
import io.github.saaqes.icarusbrowser.core.BookmarksStore
import io.github.saaqes.icarusbrowser.core.ColorMode
import io.github.saaqes.icarusbrowser.core.CustomAddresses
import io.github.saaqes.icarusbrowser.core.ThemeId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs

/**
 * Diseño como Chrome para Android: la barra está arriba y fija en los tres estilos
 * (no se mueve al desplazar, al abrir el menú ni con el teclado), favoritos reales y
 * edición de la base de la dirección conservando la ruta.
 */
@RunWith(AndroidJUnit4::class)
class ChromeLayoutTest {
    private lateinit var server: ServerSocket
    private val base get() = "http://127.0.0.1:${server.localPort}"
    private val app get() = IcarusApp.instance

    @Before
    fun startServer() {
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                // El WebView puede cerrar una conexión a medias (al cambiar de página): no es un fallo
                // de la prueba, y una excepción sin capturar en este hilo cerraría la aplicación.
                thread(isDaemon = true) { try { serve(socket) } catch (closed: IOException) {} }
            }
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            app.profile.customAddresses.forEach { app.profile.removeCustomAddress(it.id) }
            app.bookmarks.data.items.forEach { app.bookmarks.remove(it.id) }
        }
    }

    @After
    fun stopServer() {
        server.close()
    }

    private fun serve(socket: Socket) = socket.use {
        val request = it.getInputStream().bufferedReader().readLine().orEmpty()
        val path = request.split(' ').getOrNull(1).orEmpty().substringBefore('?')
        val body = when (path) {
            "/larga.html" -> "<!doctype html><title>Larga</title><meta name=viewport content='width=device-width'><body style='margin:0'>" +
                (1..200).joinToString("") { n -> "<p style='height:40px;margin:0'>Línea $n</p>" } + "</body>"
            else -> "<!doctype html><title>App ICARUS</title><meta name=viewport content='width=device-width'><body><h1 id=r>App</h1>" +
                "<script>const f=()=>r.textContent=location.pathname+location.search+location.hash;f();addEventListener('hashchange',f)</script></body>"
        }.toByteArray()
        val output = it.getOutputStream()
        output.write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
        output.write(body)
        output.flush()
    }

    private fun <T> onMain(scenario: ActivityScenario<MainActivity>, block: (MainActivity) -> T): T {
        var result: T? = null
        scenario.onActivity { result = block(it) }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun waitFor(scenario: ActivityScenario<MainActivity>, description: String, timeoutMs: Long = 30_000, condition: (MainActivity) -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (onMain(scenario, condition)) return
            Thread.sleep(250)
        }
        throw AssertionError("Tiempo agotado esperando: $description")
    }

    private fun screenshot(name: String) {
        Thread.sleep(1000)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val scaled = Bitmap.createScaledBitmap(shot, 360, 360 * shot.height / shot.width, true)
        val bytes = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 70, it) }.toByteArray()
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        Log.i("IcarusScreenshot", "BEGIN $name ${encoded.length}")
        encoded.chunked(3000).forEach { Log.i("IcarusScreenshot", it) }
        Log.i("IcarusScreenshot", "END $name")
    }

    private fun setLook(theme: ThemeId) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            app.profile.updateSettings { it.copy(theme = theme, colorMode = ColorMode.LIGHT) }
        }
    }

    /** Posición vertical de la barra en pantalla y el margen superior del sistema (barra de estado). */
    private fun toolbarTop(activity: MainActivity): Pair<Int, Int> {
        val location = IntArray(2)
        activity.toolbarView.getLocationOnScreen(location)
        val insets = activity.window.decorView.rootWindowInsets
        @Suppress("DEPRECATION")
        val statusBar = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()).top
        } else {
            insets.systemWindowInsetTop
        }
        return location[1] to statusBar
    }

    @Test
    fun laBarraEstaArribaYFijaEnLosTresEstilos() {
        for (theme in listOf(ThemeId.ICARUS, ThemeId.ESSENTIAL, ThemeId.PANORAMA)) {
            setLook(theme)
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                waitFor(scenario, "pestaña inicial") { it.currentTab != null && it.toolbarView.height > 0 }
                onMain(scenario) { it.submitAddress("$base/larga.html") }
                waitFor(scenario, "página larga") { it.currentTab?.title == "Larga" && it.currentTab?.loading == false }
                val (top, statusBar) = onMain(scenario) { toolbarTop(it) }
                // Justo debajo de la barra de estado, sin solaparse con ella.
                assertTrue("$theme: barra en y=$top, barra de estado $statusBar", abs(top - statusBar) <= 2)
                // La página queda debajo de la barra (nada de barras inferiores de navegación).
                val (toolbarBottom, contentTop, contentBottom, screen) = onMain(scenario) {
                    val content = IntArray(2).also { location -> it.contentView.getLocationOnScreen(location) }
                    listOf(top + it.toolbarView.height, content[1], content[1] + it.contentView.height, it.window.decorView.height)
                }
                assertTrue("$theme: el contenido empieza bajo la barra", contentTop >= toolbarBottom)
                assertTrue("$theme: el contenido llega casi al final de la pantalla", screen - contentBottom < 200)
                screenshot("barra-${theme.id}")

                // Al desplazar la página la barra no se mueve.
                onMain(scenario) { it.currentTab!!.webView!!.evaluateJavascript("window.scrollTo(0, 4000)", null) }
                Thread.sleep(800)
                assertEquals("$theme: la barra no se mueve al desplazar", top, onMain(scenario) { toolbarTop(it).first })

                // Abrir y cerrar el menú tampoco la mueve.
                onMain(scenario) { it.openMenuForTest() }
                Thread.sleep(600)
                assertEquals("$theme: la barra no se mueve con el menú", top, onMain(scenario) { toolbarTop(it).first })
                onMain(scenario) { it.closeMenuForTest() }

                // Con el teclado para escribir la dirección, la barra sigue arriba y visible.
                onMain(scenario) { it.focusAddressBar() }
                Thread.sleep(1500)
                val imeVisible = onMain(scenario) {
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && it.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime())
                }
                assertEquals("$theme: la barra no se mueve con el teclado", top, onMain(scenario) { toolbarTop(it).first })
                if (imeVisible) {
                    // El contenido se encoge por encima del teclado en lugar de quedar tapado.
                    val bottom = onMain(scenario) { activity ->
                        IntArray(2).also { activity.contentView.getLocationOnScreen(it) }[1] + activity.contentView.height
                    }
                    assertTrue("$theme: el contenido no queda bajo el teclado", bottom < screen - 200)
                }
                Log.i("IcarusLayout", "$theme: barra en y=$top (estado $statusBar), teclado ${if (imeVisible) "visible" else "no mostrado por el emulador"}")
                if (theme == ThemeId.ESSENTIAL) screenshot("barra-con-teclado")
                onMain(scenario) { it.leaveAddressBar() }
            }
        }
    }

    @Test
    fun otroDominioSoloParaUnasSeccionesDelSitio() {
        setLook(ThemeId.ESSENTIAL)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitFor(scenario, "pestaña inicial") { it.currentTab != null }
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                assertTrue(app.profile.saveCustomAddress(base, "miweb.com", true) is CustomAddresses.Validation.Ok)
            }
            onMain(scenario) { it.submitAddress("miweb.com/app.html#home") }
            waitFor(scenario, "página en #home") { it.currentTab?.url == "$base/app.html#home" && it.currentTab?.loading == false }

            // Cambiar la base en #home ofrece guardarla solo para esa sección.
            onMain(scenario) { it.submitAddress("http://otraweb.com/app.html#home") }
            assertEquals("home", onMain(scenario) { it.lastRebaseSection })
            val general = app.profile.customAddresses.single()
            assertTrue(onMain(scenario) { it.saveRebaseSection("otraweb.com", general, "home") })
            waitFor(scenario, "#home con otraweb.com") { it.addressText == "otraweb.com/app.html#home" }
            assertEquals(listOf("http://miweb.com/" to emptyList<String>(), "http://otraweb.com/" to listOf("home")), app.profile.customAddresses.map { it.address to it.sections })

            // Otra sección de la misma página conserva la dirección general del sitio.
            onMain(scenario) { it.currentTab!!.webView!!.evaluateJavascript("location.hash = 'inicio'", null) }
            waitFor(scenario, "#inicio con miweb.com") { it.addressText == "miweb.com/app.html#inicio" }
            // Escribir la dirección de la sección abre esa sección del sitio real.
            onMain(scenario) { it.submitAddress("otraweb.com/app.html") }
            waitFor(scenario, "otraweb.com abre #home") { it.currentTab?.url == "$base/app.html#home" && it.addressText == "otraweb.com/app.html#home" }
            screenshot("seccion-home")

            // Guardado en disco: se relee igual (con sus secciones) desde el archivo del perfil.
            app.profile.flush()
            val stored = File(File(app.filesDir, "icarus"), "profile.json")
            val entries = CustomAddresses.sanitize(org.json.JSONObject(stored.readText()).optJSONArray("customAddresses"))
            assertEquals(listOf("home"), entries.single { it.address == "http://otraweb.com/" }.sections)
        }
    }

    @Test
    fun favoritosYEdicionDeLaBaseConservandoLaRuta() {
        setLook(ThemeId.ESSENTIAL)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitFor(scenario, "pestaña inicial") { it.currentTab != null }
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                assertTrue(app.profile.saveCustomAddress(base, "miweb.com", true) is CustomAddresses.Validation.Ok)
            }
            val real = "$base/app.html#inicio"
            onMain(scenario) { it.submitAddress("miweb.com/app.html#inicio") }
            waitFor(scenario, "página personalizada") { it.currentTab?.url == real && it.currentTab?.loading == false }
            assertEquals("miweb.com/app.html#inicio", onMain(scenario) { it.addressText })

            // Favoritos: estrella, sin duplicados y guardado en disco.
            onMain(scenario) { it.toggleBookmark() }
            val saved = app.bookmarks.find(real)
            assertNotNull("la página está en Favoritos", saved)
            saved!!
            assertEquals(1, app.bookmarks.data.items.size)
            screenshot("favorito-guardado")
            app.bookmarks.flush()
            val reloaded = BookmarksStore(File(File(app.filesDir, "icarus"), "bookmarks.json"))
            assertEquals(saved.url, reloaded.find(real)?.url)
            InstrumentationRegistry.getInstrumentation().runOnMainSync { app.bookmarks.remove(saved.id) }
            assertNull(app.bookmarks.find(real))

            // Cambiar a mano solo la base ofrece guardarla; se conserva /app.html#inicio.
            onMain(scenario) { it.submitAddress("http://otrapagina.com/app.html#inicio") }
            assertEquals("http://otrapagina.com" to "http://otrapagina.com/app.html#inicio", onMain(scenario) { it.lastRebaseChoice })
            val entry = app.profile.customAddresses.single()
            assertTrue(onMain(scenario) { it.saveRebaseBase("http://otrapagina.com", entry) })
            assertEquals("http://otrapagina.com/", app.profile.customAddresses.single().address)
            waitFor(scenario, "la barra muestra la base nueva con la misma ruta") { it.addressText == "otrapagina.com/app.html#inicio" }
            // Navegar a otra sección mantiene la misma configuración.
            onMain(scenario) { it.currentTab!!.webView!!.evaluateJavascript("location.hash = 'dashboard'", null) }
            waitFor(scenario, "otra sección") { it.addressText == "otrapagina.com/app.html#dashboard" }
            assertEquals(1, app.profile.customAddresses.size)
            screenshot("base-editada")

            // Una dirección completa nueva no hereda la ruta anterior ni ofrece guardar nada.
            val choice = onMain(scenario) { it.lastRebaseChoice }
            onMain(scenario) { it.submitAddress("$base/larga.html") }
            waitFor(scenario, "dirección nueva") { it.currentTab?.url == "$base/larga.html" }
            assertEquals(choice, onMain(scenario) { it.lastRebaseChoice })

            // Sin dirección personalizada, «Editar base» cambia el origen y conserva ruta y consulta.
            InstrumentationRegistry.getInstrumentation().runOnMainSync { app.profile.customAddresses.forEach { app.profile.removeCustomAddress(it.id) } }
            onMain(scenario) { it.submitAddress("$base/panel/usuarios.html?id=10") }
            waitFor(scenario, "panel") { it.currentTab?.url == "$base/panel/usuarios.html?id=10" && it.currentTab?.loading == false }
            val split = onMain(scenario) { it.currentAddressSplit() }
            assertNotNull("la dirección tiene base y ruta", split)
            split!!
            assertEquals(AddressRebase.Split(base, "/panel/usuarios.html?id=10", null), split)
            val port = server.localPort
            onMain(scenario) { it.submitRebase("localhost:$port", split) }
            waitFor(scenario, "base nueva con la ruta") { it.currentTab?.url == "http://localhost:$port/panel/usuarios.html?id=10" }
        }
    }
}
