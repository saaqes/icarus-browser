package io.github.saaqes.icarusbrowser.core.update

import com.sun.net.httpserver.HttpServer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Comprobación y descarga contra un servidor local con la estructura de GitHub. */
class UpdateClientTest {
    private val keys = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val publicKey = "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(keys.public.encoded) + "\n-----END PUBLIC KEY-----\n"
    private val files = HashMap<String, ByteArray>()
    private val requests = ArrayList<String>()
    private var cutAfter: Int? = null
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            val path = exchange.requestURI.path
            val range = exchange.requestHeaders.getFirst("Range")
            synchronized(requests) { requests.add(path + (range?.let { " $it" } ?: "")) }
            val body = files[path]
            when {
                path == "/redirect" -> {
                    exchange.responseHeaders.add("Location", "https://ejemplo.com/malicioso.apk")
                    exchange.sendResponseHeaders(302, -1)
                }
                body == null -> exchange.sendResponseHeaders(404, -1)
                range != null -> {
                    val start = range.removePrefix("bytes=").removeSuffix("-").toInt()
                    exchange.responseHeaders.add("Content-Range", "bytes $start-${body.size - 1}/${body.size}")
                    exchange.sendResponseHeaders(206, (body.size - start).toLong())
                    exchange.responseBody.write(body, start, body.size - start)
                }
                else -> {
                    exchange.sendResponseHeaders(200, body.size.toLong())
                    val limit = cutAfter
                    // Corte simulado: se envía una parte y se cierra la conexión.
                    exchange.responseBody.write(body, 0, limit ?: body.size)
                }
            }
            exchange.close()
        }
        start()
    }
    private val origin = "http://127.0.0.1:${server.address.port}"
    private val client = UpdateClient(LoopbackUpdateSource(origin), "ICARUS-pruebas")
    private val apk = ByteArray(300_000) { (it % 251).toByte() }

    @AfterTest
    fun stop() = server.stop(0)

    private fun sign(bytes: ByteArray): String =
        Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withECDSA").run { initSign(keys.private); update(bytes); sign() })

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun publish(version: String, tagPath: String = "latest/download", payload: ByteArray = apk, signature: ((ByteArray) -> String)? = null): String {
        val parsed = UpdateVersion.parse(version)!!
        val manifest = JSONObject()
            .put("schema", 1).put("product", "icarus-browser").put("version", version)
            .put("channel", if (parsed.preview == null) "stable" else "preview").put("tag", "v$version")
            .put("commit", "0123456789abcdef0123456789abcdef01234567").put("releasedAt", "2026-10-20T12:00:00Z")
            .put("notes", "Novedades de $version")
            .put("assets", JSONArray().put(JSONObject()
                .put("platform", "android").put("arch", "universal").put("kind", "apk")
                .put("file", "ICARUS-Browser-$version-android.apk").put("size", payload.size).put("sha256", sha(apk))
                .put("versionCode", parsed.versionCode)))
            .toString(2).toByteArray()
        files["/releases/$tagPath/icarus-update.json"] = manifest
        files["/releases/$tagPath/icarus-update.json.sig"] = (signature ?: ::sign)(manifest).toByteArray()
        files["/releases/download/v$version/ICARUS-Browser-$version-android.apk"] = payload
        files["/releases/download/v$version/icarus-update.json"] = manifest
        files["/releases/download/v$version/icarus-update.json.sig"] = files.getValue("/releases/$tagPath/icarus-update.json.sig")
        return "ICARUS-Browser-$version-android.apk"
    }

    @Test
    fun `canal estable con manifiesto firmado y decisión`() {
        publish("0.3.0")
        val result = client.fetchSignedManifest(UpdateChannel.STABLE, publicKey)
        val decision = UpdateManifests.evaluate(result, UpdateVersion.parse("0.2.0")!!, UpdateChannel.STABLE, UpdateTarget("android", "universal", listOf("apk")))
        assertEquals("ICARUS-Browser-0.3.0-android.apk", (decision as UpdateDecision.Available).asset?.file)
    }

    @Test
    fun `rechaza una firma de otra clave y la falta de clave`() {
        val other = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        publish("0.3.0") { bytes -> Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withECDSA").run { initSign(other.private); update(bytes); sign() }) }
        assertEquals("signature", assertFailsWith<UpdateCheckException> { client.fetchSignedManifest(UpdateChannel.STABLE, publicKey) }.code)
        assertEquals("no-key", assertFailsWith<UpdateCheckException> { client.fetchSignedManifest(UpdateChannel.STABLE, null) }.code)
    }

    @Test
    fun `el canal estable no acepta una preliminar`() {
        publish("0.3.0-preview.1")
        assertEquals("invalid-manifest", assertFailsWith<UpdateCheckException> { client.fetchSignedManifest(UpdateChannel.STABLE, publicKey) }.code)
    }

    @Test
    fun `vista previa usa la versión publicada más reciente con manifiesto, sin borradores`() {
        publish("0.3.0-preview.2", tagPath = "download/v0.3.0-preview.2")
        val release = { tag: String, draft: Boolean, withManifest: Boolean ->
            JSONObject().put("tag_name", tag).put("draft", draft).put("assets", JSONArray().apply {
                if (withManifest) put(JSONObject().put("name", "icarus-update.json")).put(JSONObject().put("name", "icarus-update.json.sig"))
            })
        }
        files["/api/releases"] = JSONArray()
            .put(release("v0.4.0", true, true))
            .put(release("v0.3.0-preview.3", false, false))
            .put(release("v0.3.0-preview.2", false, true))
            .put(release("v0.2.0", false, true))
            .toString().toByteArray()
        val result = client.fetchSignedManifest(UpdateChannel.PREVIEW, publicKey)
        assertEquals("0.3.0-preview.2", result.manifest.version)
    }

    @Test
    fun `sin versión publicada equivale a no encontrada y sin red es error de red`() {
        assertEquals("not-found", assertFailsWith<UpdateCheckException> { client.fetchSignedManifest(UpdateChannel.STABLE, publicKey) }.code)
        val offline = UpdateClient(LoopbackUpdateSource("http://127.0.0.1:9"), "ICARUS-pruebas")
        assertEquals("network", assertFailsWith<UpdateCheckException> { offline.fetchSignedManifest(UpdateChannel.STABLE, publicKey) }.code)
    }

    /** Origen cuyo paquete redirige a otro host. (Fuera de la prueba: su nombre con tildes no sirve para una clase.) */
    private fun redirectingClient() = UpdateClient(object : UpdateSource by LoopbackUpdateSource(origin) {
        override fun asset(tag: String, file: String) = "$origin/redirect"
    }, "ICARUS-pruebas")

    @Test
    fun `una redirección a otro host se rechaza`() {
        assertEquals("forbidden-host", assertFailsWith<UpdateDownloadException> { redirectingClient().download("v0.3.0", asset("0.3.0"), tempFile()) }.code)
    }

    private fun asset(version: String) = UpdateAsset("android", "universal", "apk", "ICARUS-Browser-$version-android.apk", apk.size.toLong(), sha(apk), UpdateVersion.parse(version)!!.versionCode)

    private fun tempFile() = File(Files.createTempDirectory("icarus-update").toFile(), "paquete.apk")

    @Test
    fun `descarga verificada con progreso y reanudación tras un corte`() {
        publish("0.3.0")
        val destination = tempFile()
        cutAfter = 100_000
        assertEquals("interrupted", assertFailsWith<UpdateDownloadException> { client.download("v0.3.0", asset("0.3.0"), destination) }.code)
        assertEquals(100_000L, File(destination.path + ".part").length())
        cutAfter = null
        var last = 0L
        client.download("v0.3.0", asset("0.3.0"), destination, onProgress = { received, _ -> last = received })
        assertContentEquals(apk, destination.readBytes())
        assertEquals(apk.size.toLong(), last)
        assertTrue(requests.any { it.endsWith("bytes=100000-") }, requests.joinToString())
        assertFalse(File(destination.path + ".part").exists())
    }

    @Test
    fun `un paquete con otro SHA-256 se borra y no se usa`() {
        publish("0.3.0", payload = ByteArray(apk.size) { 7 })
        val destination = tempFile()
        assertEquals("hash-mismatch", assertFailsWith<UpdateDownloadException> { client.download("v0.3.0", asset("0.3.0"), destination) }.code)
        assertFalse(destination.exists())
        assertFalse(File(destination.path + ".part").exists())
    }

    @Test
    fun `sin espacio en disco no empieza la descarga`() {
        publish("0.3.0")
        assertEquals("disk-space", assertFailsWith<UpdateDownloadException> { client.download("v0.3.0", asset("0.3.0"), tempFile(), freeSpace = { 1_000 }) }.code)
        assertTrue(requests.none { it.contains(".apk") })
    }

    @Test
    fun `un tamaño distinto del manifiesto se rechaza`() {
        publish("0.3.0", payload = apk + ByteArray(10))
        assertEquals("size-mismatch", assertFailsWith<UpdateDownloadException> { client.download("v0.3.0", asset("0.3.0"), tempFile()) }.code)
    }

    @Test
    fun `GitHub con direcciones construidas localmente y solo hosts permitidos`() {
        val github = GitHubUpdateSource()
        assertEquals("https://github.com/saaqes/icarus-browser/releases/latest/download/icarus-update.json", github.latestManifest())
        assertEquals("https://github.com/saaqes/icarus-browser/releases/download/v0.3.0/ICARUS-Browser-0.3.0-android.apk", github.asset("v0.3.0", "ICARUS-Browser-0.3.0-android.apk"))
        assertTrue(github.isAllowed(java.net.URL("https://objects.githubusercontent.com/x")))
        assertFalse(github.isAllowed(java.net.URL("http://github.com/x")))
        assertFalse(github.isAllowed(java.net.URL("https://github.com.evil.com/x")))
        assertFalse(github.isAllowed(java.net.URL("https://user@github.com/x")))
        assertFailsWith<IllegalArgumentException> { github.asset("v0.3.0", "../../otro.apk") }
        assertFailsWith<IllegalArgumentException> { LoopbackUpdateSource("http://192.168.1.2:80") }
    }
}
