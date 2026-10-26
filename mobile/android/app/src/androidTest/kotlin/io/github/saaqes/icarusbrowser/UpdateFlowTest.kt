package io.github.saaqes.icarusbrowser

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.saaqes.icarusbrowser.core.update.LoopbackUpdateSource
import io.github.saaqes.icarusbrowser.core.update.UpdateVersion
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import kotlin.concurrent.thread

/**
 * Flujo de actualización de Android contra un servidor local con la estructura de
 * GitHub Releases y una clave de prueba: aviso de la versión nueva, descarga con
 * SHA-256 y comprobaciones del APK antes de llegar al instalador del sistema.
 *
 * El paquete servido es el propio APK instalado anunciado como versión siguiente:
 * su SHA-256 y su firma son válidos, pero su versionCode no es el del manifiesto,
 * así que ICARUS debe rechazarlo antes de pedir la instalación. La instalación en
 * sí (confirmación del usuario en el instalador de Android) no se prueba aquí.
 */
@RunWith(AndroidJUnit4::class)
class UpdateFlowTest {
    private lateinit var server: ServerSocket
    private val files = HashMap<String, ByteArray>()
    private val app get() = IcarusApp.instance
    private val keys: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val publicKey = "-----BEGIN PUBLIC KEY-----\n" + Base64.encodeToString(keys.public.encoded, Base64.DEFAULT) + "-----END PUBLIC KEY-----\n"

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
        val reader = it.getInputStream().bufferedReader()
        val path = reader.readLine().orEmpty().split(' ').getOrNull(1).orEmpty()
        while (reader.readLine().orEmpty().isNotEmpty()) Unit
        val body = files[path]
        val out = it.getOutputStream()
        if (body == null) {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
        } else {
            out.write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(body)
        }
        out.flush()
    }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun sign(bytes: ByteArray, pair: KeyPair = keys) =
        Base64.encodeToString(Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(bytes); sign() }, Base64.NO_WRAP)

    /** Publica la versión siguiente a la instalada con el APK instalado como paquete. */
    private fun publishNext(signWith: KeyPair = keys): String {
        val current = UpdateVersion.parse(app.updates.state.currentVersion)!!
        val next = UpdateVersion(current.major, current.minor, current.patch + 1, null)
        val apk = File(app.applicationInfo.sourceDir).readBytes()
        val file = "ICARUS-Browser-$next-android.apk"
        val manifest = JSONObject()
            .put("schema", 1).put("product", "icarus-browser").put("version", next.toString()).put("channel", "stable")
            .put("tag", "v$next").put("commit", "0123456789abcdef0123456789abcdef01234567").put("releasedAt", "2026-10-20T12:00:00Z")
            .put("notes", "Novedades de prueba")
            .put("assets", JSONArray().put(JSONObject()
                .put("platform", "android").put("arch", "universal").put("kind", "apk").put("file", file)
                .put("size", apk.size).put("sha256", sha256(apk)).put("versionCode", next.versionCode)))
            .toString(2).toByteArray()
        files["/releases/latest/download/icarus-update.json"] = manifest
        files["/releases/latest/download/icarus-update.json.sig"] = sign(manifest, signWith).toByteArray()
        files["/releases/download/v$next/$file"] = apk
        return next.toString()
    }

    private fun waitFor(message: String, timeoutMs: Long = 60_000, condition: (UpdateManager.State) -> Boolean): UpdateManager.State {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            val state = app.updates.state
            if (condition(state)) return state
            Thread.sleep(200)
        }
        throw AssertionError("$message (estado: ${app.updates.state})")
    }

    @Test
    fun avisaDescargaYVerificaAntesDeInstalar() {
        val next = publishNext()
        app.updates.useTestServer(LoopbackUpdateSource("http://127.0.0.1:${server.localPort}"), publicKey)
        app.updates.check()
        val available = waitFor("No se detectó la versión nueva") { it.status == UpdateManager.Status.AVAILABLE }
        assertEquals(next, available.available?.version)
        assertTrue("El aviso discreto debe mostrarse", available.shouldNotify)

        app.updates.download()
        val rejected = waitFor("La descarga no terminó") { it.status == UpdateManager.Status.ERROR }
        // SHA-256 correcto, pero el APK no es la versión que anuncia el manifiesto: no se instala.
        assertEquals("verification-failed", rejected.error)
        assertTrue(rejected.errorDetail.orEmpty(), rejected.errorDetail.orEmpty().contains("versionCode"))
        assertFalse("El APK rechazado debe borrarse", File(app.cacheDir, "updates/$next/ICARUS-Browser-$next-android.apk").exists())
    }

    @Test
    fun rechazaUnManifiestoFirmadoConOtraClave() {
        val other = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        publishNext(signWith = other)
        app.updates.useTestServer(LoopbackUpdateSource("http://127.0.0.1:${server.localPort}"), publicKey)
        app.updates.check()
        val state = waitFor("La comprobación no terminó") { !it.busy && it.status != UpdateManager.Status.IDLE }
        assertEquals(UpdateManager.Status.ERROR, state.status)
        assertEquals("signature", state.error)
        assertEquals(null, state.available)
    }

    @Test
    fun recordarMasTardeNoVuelveAAvisarDeEsaVersion() {
        val next = publishNext()
        app.updates.useTestServer(LoopbackUpdateSource("http://127.0.0.1:${server.localPort}"), publicKey)
        app.updates.check()
        waitFor("No se detectó la versión nueva") { it.status == UpdateManager.Status.AVAILABLE }
        app.updates.postpone()
        val state = waitFor("No se guardó la versión pospuesta") { it.postponedVersion == next }
        assertFalse(state.shouldNotify)
        assertNotNull(state.available)
    }
}
