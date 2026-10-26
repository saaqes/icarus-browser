package io.github.saaqes.icarusbrowser.core.update

import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * De dónde se descargan las versiones. Las direcciones se construyen aquí: el
 * manifiesto solo aporta nombres de archivo validados, nunca una URL.
 */
interface UpdateSource {
    fun latestManifest(): String
    fun latestSignature(): String
    fun releasesList(): String
    fun asset(tag: String, file: String): String
    fun releasePage(tag: String): String
    fun isAllowed(url: URL): Boolean
}

private val TAG = Regex("^v[0-9A-Za-z.-]{1,40}$")
private val FILE = Regex("^[A-Za-z0-9._-]{1,120}$")

private fun checked(tag: String, file: String) {
    require(TAG.matches(tag) && FILE.matches(file) && !file.contains("..")) { "Etiqueta o archivo no válidos" }
}

/** GitHub Releases del repositorio (sin credenciales ni API para el canal estable). */
class GitHubUpdateSource(repository: String = "saaqes/icarus-browser") : UpdateSource {
    private val base = "https://github.com/$repository"
    private val api = "https://api.github.com/repos/$repository"
    private val hosts = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "api.github.com")

    override fun latestManifest() = "$base/releases/latest/download/${UpdateManifests.MANIFEST_FILE}"
    override fun latestSignature() = "$base/releases/latest/download/${UpdateManifests.SIGNATURE_FILE}"
    override fun releasesList() = "$api/releases?per_page=30"
    override fun asset(tag: String, file: String) = checked(tag, file).let { "$base/releases/download/$tag/$file" }
    override fun releasePage(tag: String) = checked(tag, UpdateManifests.MANIFEST_FILE).let { "$base/releases/tag/$tag" }
    override fun isAllowed(url: URL) =
        url.protocol == "https" && url.userInfo == null && (url.port == -1 || url.port == 443) && url.host in hosts
}

/** Servidor de la propia máquina con la misma estructura (solo pruebas). */
class LoopbackUpdateSource(origin: String) : UpdateSource {
    private val root = URL(origin)
    init {
        require(root.protocol == "http" && root.host in setOf("127.0.0.1", "localhost", "[::1]") && root.userInfo == null) { "Solo se admite un servidor local" }
    }
    private val base = "${root.protocol}://${root.authority}"

    override fun latestManifest() = "$base/releases/latest/download/${UpdateManifests.MANIFEST_FILE}"
    override fun latestSignature() = "$base/releases/latest/download/${UpdateManifests.SIGNATURE_FILE}"
    override fun releasesList() = "$base/api/releases"
    override fun asset(tag: String, file: String) = checked(tag, file).let { "$base/releases/download/$tag/$file" }
    override fun releasePage(tag: String) = "$base/releases/tag/$tag"
    override fun isAllowed(url: URL) = url.protocol == root.protocol && url.authority == root.authority
}

/** network, rate-limited, not-found, signature, invalid-manifest o no-key, como en escritorio. */
class UpdateCheckException(val code: String, message: String? = null) : Exception(message ?: code)

/** network, interrupted, hash-mismatch, size-mismatch, disk-space, write, not-found o forbidden-host. */
class UpdateDownloadException(val code: String, message: String) : IOException(message)

/** Comprobación y descarga verificada, igual que electron/update/checker.ts y download.ts. */
class UpdateClient(
    private val source: UpdateSource,
    private val userAgent: String,
    private val open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
) {
    /** GET que sigue como mucho 5 redirecciones, todas hacia hosts permitidos. */
    private fun connect(url: String, headers: Map<String, String> = emptyMap()): HttpURLConnection {
        var current = URL(url)
        repeat(6) {
            if (!source.isAllowed(current)) throw UpdateDownloadException("forbidden-host", "Host no permitido: ${current.host}")
            val connection = try {
                open(current).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    useCaches = false
                    setRequestProperty("User-Agent", userAgent)
                    headers.forEach { (name, value) -> setRequestProperty(name, value) }
                }
            } catch (error: IOException) {
                throw UpdateDownloadException("network", error.message ?: "Error de red")
            }
            val status = try {
                connection.responseCode
            } catch (error: IOException) {
                connection.disconnect()
                throw UpdateDownloadException("network", error.message ?: "Error de red")
            }
            when {
                status in 300..399 -> {
                    val location = connection.getHeaderField("Location")
                    connection.disconnect()
                    if (location.isNullOrEmpty()) throw UpdateDownloadException("network", "Redirección sin destino ($status)")
                    current = URL(current, location)
                }
                status == 404 -> {
                    connection.disconnect()
                    throw UpdateDownloadException("not-found", "No encontrado")
                }
                status == 429 || (status == 403 && connection.getHeaderField("X-RateLimit-Remaining") == "0") -> {
                    connection.disconnect()
                    throw UpdateCheckException("rate-limited", "Límite de consultas de GitHub alcanzado")
                }
                else -> return connection
            }
        }
        throw UpdateDownloadException("network", "Demasiadas redirecciones")
    }

    private fun readLimited(url: String, max: Int): ByteArray {
        val connection = connect(url)
        try {
            if (connection.responseCode !in 200..299) throw UpdateDownloadException("network", "HTTP ${connection.responseCode}")
            connection.inputStream.use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(chunk)
                    if (read < 0) break
                    if (buffer.size() + read > max) throw UpdateCheckException("invalid-manifest", "too-large")
                    buffer.write(chunk, 0, read)
                }
                return buffer.toByteArray()
            }
        } catch (error: IOException) {
            if (error is UpdateDownloadException) throw error
            throw UpdateDownloadException("network", error.message ?: "Error de red")
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Manifiesto del canal, verificado con la clave pública sobre los bytes exactos
     * recibidos. Lanza UpdateCheckException con el código del error.
     */
    fun fetchSignedManifest(channel: UpdateChannel, publicKey: String?): ManifestResult.Ok {
        if (publicKey == null) throw UpdateCheckException("no-key")
        try {
            var expectedTag: String? = null
            val manifestUrl: String
            val signatureUrl: String
            if (channel == UpdateChannel.STABLE) {
                manifestUrl = source.latestManifest()
                signatureUrl = source.latestSignature()
            } else {
                val list = try {
                    JSONArray(String(readLimited(source.releasesList(), 2 * 1024 * 1024), Charsets.UTF_8))
                } catch (_: org.json.JSONException) {
                    throw UpdateCheckException("invalid-manifest", "releases")
                }
                expectedTag = newestTag(list) ?: throw UpdateCheckException("not-found")
                manifestUrl = source.asset(expectedTag, UpdateManifests.MANIFEST_FILE)
                signatureUrl = source.asset(expectedTag, UpdateManifests.SIGNATURE_FILE)
            }
            val manifest = readLimited(manifestUrl, UpdateManifests.MAX_MANIFEST_BYTES)
            val signature = String(readLimited(signatureUrl, UpdateManifests.MAX_SIGNATURE_BYTES), Charsets.UTF_8)
            if (!UpdateSignature.verify(manifest, signature, publicKey)) throw UpdateCheckException("signature")
            val parsed = UpdateManifests.parse(String(manifest, Charsets.UTF_8))
            if (parsed is ManifestResult.Invalid) throw UpdateCheckException("invalid-manifest", parsed.error)
            parsed as ManifestResult.Ok
            // El manifiesto firmado debe ser el de la versión que se pidió.
            if (expectedTag != null && parsed.manifest.tag != expectedTag) throw UpdateCheckException("invalid-manifest", "tag")
            if (channel == UpdateChannel.STABLE && parsed.manifest.channel != UpdateChannel.STABLE) throw UpdateCheckException("invalid-manifest", "channel")
            return parsed
        } catch (error: UpdateDownloadException) {
            throw when (error.code) {
                "not-found" -> UpdateCheckException("not-found")
                "forbidden-host" -> UpdateCheckException("invalid-manifest", "forbidden-host")
                else -> UpdateCheckException("network", error.message)
            }
        }
    }

    /**
     * Descarga el paquete en `destination` comprobando tamaño y SHA-256. Reanuda un
     * `.part` interrumpido con Range; si el resultado no coincide, lo borra.
     */
    fun download(
        tag: String,
        asset: UpdateAsset,
        destination: File,
        freeSpace: (File) -> Long = { it.usableSpace },
        onProgress: (Long, Long) -> Unit = { _, _ -> },
        cancelled: () -> Boolean = { false },
    ): File {
        destination.parentFile?.mkdirs()
        if (destination.isFile && destination.length() == asset.size && sha256(destination) == asset.sha256) return destination
        val part = File(destination.path + ".part")
        if (part.length() > asset.size) part.delete()
        if (part.length() == asset.size) {
            if (sha256(part) == asset.sha256 && part.renameTo(destination)) return destination
            part.delete()
        }
        val needed = asset.size - part.length() + 64L * 1024 * 1024
        if (freeSpace(destination.parentFile ?: destination) < needed) throw UpdateDownloadException("disk-space", "Espacio insuficiente")

        val digest = MessageDigest.getInstance("SHA-256")
        var offset = part.length()
        val connection = connect(source.asset(tag, asset.file), if (offset > 0) mapOf("Range" to "bytes=$offset-") else emptyMap())
        try {
            val status = connection.responseCode
            if (status == 206 && offset > 0) {
                part.inputStream().use { digestInto(digest, it) }
            } else if (status in 200..299) {
                offset = 0
                digest.reset()
            } else {
                throw UpdateDownloadException("network", "HTTP $status")
            }
            val length = connection.contentLengthLong
            if (length >= 0 && offset + length != asset.size) throw UpdateDownloadException("size-mismatch", "Tamaño anunciado distinto")
            var received = offset
            FileOutputStream(part, offset > 0).use { output ->
                connection.inputStream.use { input ->
                    val chunk = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled()) throw UpdateDownloadException("interrupted", "Cancelada")
                        val read = try {
                            input.read(chunk)
                        } catch (error: IOException) {
                            throw UpdateDownloadException("interrupted", error.message ?: "Descarga interrumpida")
                        }
                        if (read < 0) break
                        // Nunca se escribe más de lo anunciado en el manifiesto.
                        if (received + read > asset.size) throw UpdateDownloadException("size-mismatch", "Más datos de los esperados")
                        try {
                            output.write(chunk, 0, read)
                        } catch (error: IOException) {
                            throw UpdateDownloadException("write", error.message ?: "No se pudo escribir")
                        }
                        digest.update(chunk, 0, read)
                        received += read
                        onProgress(received, asset.size)
                    }
                }
            }
            if (received != asset.size) throw UpdateDownloadException("interrupted", "Descarga incompleta")
            if (hex(digest.digest()) != asset.sha256) {
                part.delete()
                throw UpdateDownloadException("hash-mismatch", "El SHA-256 no coincide")
            }
            destination.delete()
            if (!part.renameTo(destination)) throw UpdateDownloadException("write", "No se pudo guardar el paquete")
            return destination
        } catch (error: IOException) {
            if (error is UpdateDownloadException) throw error
            throw UpdateDownloadException("network", error.message ?: "Error de red")
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        fun sha256(file: File): String = file.inputStream().use { input ->
            MessageDigest.getInstance("SHA-256").also { digestInto(it, input) }.digest().let(::hex)
        }

        private fun digestInto(digest: MessageDigest, input: InputStream) {
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }

        private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

        /** Etiqueta de la versión publicada más reciente con manifiesto y firma (sin borradores). */
        fun newestTag(list: JSONArray): String? {
            var best: Pair<String, UpdateVersion>? = null
            for (index in 0 until list.length()) {
                val release = list.optJSONObject(index) ?: continue
                if (release.opt("draft") != false) continue
                val tag = release.opt("tag_name") as? String ?: continue
                if (!tag.startsWith("v") || !TAG.matches(tag)) continue
                val version = UpdateVersion.parse(tag.substring(1)) ?: continue
                val assets = release.optJSONArray("assets") ?: JSONArray()
                val names = (0 until assets.length()).mapNotNull { assets.optJSONObject(it)?.opt("name") as? String }
                if (UpdateManifests.MANIFEST_FILE !in names || UpdateManifests.SIGNATURE_FILE !in names) continue
                if (best == null || version > best.second) best = tag to version
            }
            return best?.first
        }
    }
}
