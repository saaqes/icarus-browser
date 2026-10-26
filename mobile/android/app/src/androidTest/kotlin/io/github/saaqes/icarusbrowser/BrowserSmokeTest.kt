package io.github.saaqes.icarusbrowser

import android.content.Intent
import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.saaqes.icarusbrowser.core.ColorMode
import io.github.saaqes.icarusbrowser.core.CustomAddresses
import io.github.saaqes.icarusbrowser.core.ThemeId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * Prueba de humo en un emulador: abre páginas reales en WebView y comprueba que
 * ICARUS Shield cancela solicitudes de verdad, que las direcciones personalizadas
 * se aplican y que
 * las direcciones peligrosas no se abren.
 *
 * Con el argumento `internet=1` comprueba además un certificado no válido real
 * (self-signed.badssl.com).
 */
@RunWith(AndroidJUnit4::class)
class BrowserSmokeTest {
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
    }

    @After
    fun stopServer() {
        server.close()
    }

    private fun serve(socket: Socket) = socket.use {
        val request = it.getInputStream().bufferedReader().readLine().orEmpty()
        val path = request.split(' ').getOrNull(1).orEmpty()
        val (type, body) = when (path) {
            "/pagina.html" -> "text/html; charset=utf-8" to """
                <!doctype html><html><head><title>Prueba ICARUS</title><meta name="viewport" content="width=device-width"></head>
                <body style="font-family:sans-serif;padding:24px"><h1>Hola desde ICARUS</h1><p>Esta página carga un anuncio y un rastreador.</p>
                <img src="https://securepubads.g.doubleclick.net/pagead/anuncio.png" width="10" height="10">
                <script src="https://www.google-analytics.com/analytics.js"></script>
                <img src="/propia.png" width="10" height="10"></body></html>
            """.trimIndent().toByteArray()
            "/propia.png" -> "image/png" to Base64.decode(PIXEL_PNG, Base64.DEFAULT)
            else -> "text/plain" to "No encontrado".toByteArray()
        }
        val status = if (type == "text/plain") "404 Not Found" else "200 OK"
        val output = it.getOutputStream()
        output.write("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
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

    /** Captura reducida en el registro (CI la extrae entre marcadores). */
    private fun screenshot(name: String) {
        Thread.sleep(1200)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val scaled = Bitmap.createScaledBitmap(shot, 360, 360 * shot.height / shot.width, true)
        val bytes = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 70, it) }.toByteArray()
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        Log.i("IcarusScreenshot", "BEGIN $name ${encoded.length}")
        encoded.chunked(3000).forEach { Log.i("IcarusScreenshot", it) }
        Log.i("IcarusScreenshot", "END $name")
    }

    private fun setLook(theme: ThemeId, mode: ColorMode) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            app.profile.updateSettings { it.copy(theme = theme, colorMode = mode) }
        }
    }

    @Test
    fun navegarConShieldAliasYPestanas() {
        setLook(ThemeId.ICARUS, ColorMode.DARK)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitFor(scenario, "pestaña inicial") { it.currentTab != null }
            screenshot("icarus-nueva-pestana")

            // 1. Página local con un anuncio y un rastreador de la lista básica.
            val page = "$base/pagina.html"
            onMain(scenario) { it.submitAddress(page) }
            waitFor(scenario, "título de la página") { it.currentTab?.title == "Prueba ICARUS" && it.currentTab?.loading == false }
            waitFor(scenario, "dos solicitudes bloqueadas por Shield") { (it.currentTab?.blocked?.get() ?: 0) >= 2 }
            assertEquals(2, onMain(scenario) { it.currentTab!!.blocked.get() })
            assertTrue(app.shield.state().totalBlocked >= 2)
            // Como Chrome: sin foco, la barra no muestra el protocolo (el icono indica «No seguro»).
            assertEquals(CustomAddresses.shortAddress(page), onMain(scenario) { it.addressText })
            assertTrue("se guarda en el historial", app.history.list().any { it.url == page })
            screenshot("icarus-pagina-con-shield")

            // 2. Dirección personalizada sin sufijos: la barra muestra solo miweb.com (con la ruta
            //    real) y escribirla abre el sitio real. El protocolo es el del destino (HTTP aquí).
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                app.profile.customAddresses.forEach { app.profile.removeCustomAddress(it.id) }
                assertTrue(app.profile.saveCustomAddress(base, "miweb.com", true) is CustomAddresses.Validation.Ok)
            }
            waitFor(scenario, "dirección personalizada en la barra") { it.addressText == "miweb.com/pagina.html" }
            onMain(scenario) { it.openNewTab(focus = false) }
            assertEquals(2, onMain(scenario) { it.tabCount })
            onMain(scenario) { it.submitAddress("miweb.com/pagina.html") }
            waitFor(scenario, "la dirección personalizada abre la URL real") { it.currentTab?.url == page && it.currentTab?.title == "Prueba ICARUS" }
            assertEquals("miweb.com/pagina.html", onMain(scenario) { it.addressText })
            screenshot("direccion-personalizada")

            // 3. Direcciones peligrosas y búsquedas.
            onMain(scenario) { it.submitAddress("javascript:alert(1)") }
            assertEquals(page, onMain(scenario) { it.currentTab!!.url })
            onMain(scenario) { it.submitAddress("file:///etc/hosts") }
            assertEquals(page, onMain(scenario) { it.currentTab!!.url })
            onMain(scenario) { it.submitAddress("hola mundo") }
            assertEquals("https://www.google.com/search?q=hola%20mundo", onMain(scenario) { it.currentTab!!.url })

            // 4. Certificado no válido (solo con Internet): se cancela, nunca se continúa.
            if (InstrumentationRegistry.getArguments().getString("internet") == "1") {
                onMain(scenario) { it.submitAddress("https://self-signed.badssl.com/") }
                waitFor(scenario, "error de certificado", 45_000) { it.currentTab?.error?.kind == PageError.Kind.CERTIFICATE }
                waitFor(scenario, "la barra muestra el sitio real que falló, completo") { it.addressText == "https://self-signed.badssl.com/" }
                screenshot("certificado-no-valido")
            }

            // 5. Los otros estilos cambian la distribución sin cerrar las pestañas.
            onMain(scenario) { it.openNewTab(focus = false) }
            setLook(ThemeId.ESSENTIAL, ColorMode.LIGHT)
            waitFor(scenario, "estilo Esencial") { it.tabCount == 3 && it.currentTab?.showingNewTab == true }
            screenshot("esencial-nueva-pestana")
            setLook(ThemeId.PANORAMA, ColorMode.LIGHT)
            waitFor(scenario, "estilo Panorama") { it.tabCount == 3 }
            screenshot("panorama-nueva-pestana")
            onMain(scenario) { it.submitAddress(page) }
            waitFor(scenario, "página en Panorama") { it.currentTab?.title == "Prueba ICARUS" && it.currentTab?.loading == false }
            screenshot("panorama-pagina")
        }
    }

    /** Las pantallas secundarias abren sin errores (se capturan para revisarlas). */
    @Test
    fun pantallasSecundarias() {
        setLook(ThemeId.ICARUS, ColorMode.LIGHT)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val settings = { section: String? ->
            Intent(context, SettingsActivity::class.java).apply { if (section != null) putExtra(SettingsActivity.EXTRA_SECTION, section) }
        }
        ActivityScenario.launch<SettingsActivity>(settings(null)).use { screenshot("configuracion") }
        ActivityScenario.launch<SettingsActivity>(settings("shield")).use { screenshot("configuracion-shield") }
        ActivityScenario.launch<SettingsActivity>(settings("addresses")).use { screenshot("direcciones-personalizadas") }
        ActivityScenario.launch(HistoryActivity::class.java).use { screenshot("historial") }
        ActivityScenario.launch(DownloadsActivity::class.java).use { screenshot("descargas") }
    }

    companion object {
        /** PNG de 1×1 píxel. */
        private const val PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    }
}
