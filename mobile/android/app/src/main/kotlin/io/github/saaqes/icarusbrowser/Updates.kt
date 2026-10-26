package io.github.saaqes.icarusbrowser

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.SigningInfo
import android.os.Build
import io.github.saaqes.icarusbrowser.core.store.JsonFile
import io.github.saaqes.icarusbrowser.core.update.GitHubUpdateSource
import io.github.saaqes.icarusbrowser.core.update.UpdateAsset
import io.github.saaqes.icarusbrowser.core.update.UpdateChannel
import io.github.saaqes.icarusbrowser.core.update.UpdateCheckException
import io.github.saaqes.icarusbrowser.core.update.UpdateClient
import io.github.saaqes.icarusbrowser.core.update.UpdateDecision
import io.github.saaqes.icarusbrowser.core.update.UpdateDownloadException
import io.github.saaqes.icarusbrowser.core.update.UpdateManifest
import io.github.saaqes.icarusbrowser.core.update.UpdateManifests
import io.github.saaqes.icarusbrowser.core.update.UpdateSignature
import io.github.saaqes.icarusbrowser.core.update.UpdateSource
import io.github.saaqes.icarusbrowser.core.update.UpdateTarget
import io.github.saaqes.icarusbrowser.core.update.UpdateVersion
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Actualizaciones de ICARUS para Android, con el mismo manifiesto firmado que
 * escritorio:
 *
 * 1. Busca la versión nueva (al abrir, como mucho cada 6 horas, o a petición).
 * 2. Descarga el APK y comprueba su SHA-256 y tamaño (manifiesto firmado), que es
 *    ICARUS (mismo identificador), una versión posterior y que está firmado con el
 *    mismo certificado que la app instalada.
 * 3. Lo entrega al instalador de Android, que SIEMPRE pide confirmación al usuario
 *    (y, la primera vez, permiso para instalar apps desde ICARUS). Los datos de la
 *    app se conservan: es una actualización del mismo paquete.
 *
 * Si ICARUS se instaló desde Google Play, las actualizaciones llegan por Google Play
 * y aquí no se descarga nada.
 */
class UpdateManager(private val app: IcarusApp) {
    enum class Status { IDLE, CHECKING, UP_TO_DATE, AVAILABLE, DOWNLOADING, VERIFYING, READY, INSTALLING, ERROR }

    /** APK: descarga e instalación con confirmación; PLAY_STORE: las gestiona Google Play; NO_KEY: compilación sin clave. */
    enum class Mode { APK, PLAY_STORE, NO_KEY }

    data class State(
        val currentVersion: String,
        val channel: UpdateChannel,
        val mode: Mode,
        val status: Status = Status.IDLE,
        val lastCheckedAt: Long? = null,
        val available: UpdateManifest? = null,
        val asset: UpdateAsset? = null,
        val progress: Pair<Long, Long>? = null,
        /** Código del error (ver [errorText]) y detalle técnico. */
        val error: String? = null,
        val errorDetail: String? = null,
        val postponedVersion: String? = null,
        /** Versión anterior y nueva si ICARUS se acaba de actualizar. */
        val justUpdated: Pair<String, String>? = null,
    ) {
        val busy get() = status in setOf(Status.CHECKING, Status.DOWNLOADING, Status.VERIFYING, Status.INSTALLING)
        /** Aviso discreto: hay versión nueva y el usuario no la ha pospuesto. */
        val shouldNotify get() = mode == Mode.APK && available != null && available.version != postponedVersion &&
            status in setOf(Status.AVAILABLE, Status.DOWNLOADING, Status.VERIFYING, Status.READY)
    }

    private data class Stored(
        val channel: UpdateChannel = UpdateChannel.STABLE,
        val lastCheckedAt: Long? = null,
        val postponedVersion: String? = null,
        val lastVersionCode: Long? = null,
        val lastVersionName: String? = null,
    )

    private val installed: PackageInfo = packageInfo(app.packageName)
    private val currentVersion = installed.versionName.orEmpty()
    private val file = JsonFile(File(app.filesDir, "icarus/updates.json"), ::encode, ::decode, ::Stored, delayMs = 200)
    private val executor = Executors.newSingleThreadExecutor { Thread(it, "icarus-updates").apply { isDaemon = true } }
    private val listeners = CopyOnWriteArrayList<(State) -> Unit>()
    @Volatile private var cancelRequested = false
    private var apkFile: File? = null

    // Solo para las pruebas instrumentadas (servidor local y clave de prueba): ver useTestServer.
    private var sourceOverride: UpdateSource? = null
    private var publicKeyOverride: String? = null

    private val publicKey: String? get() = publicKeyOverride ?: BuildConfig.UPDATE_PUBLIC_KEY.takeIf { UpdateSignature.isValidPublicKey(it) }
    private val client get() = UpdateClient(sourceOverride ?: GitHubUpdateSource(), "ICARUS-Android/$currentVersion")

    @Volatile var state: State
        private set

    init {
        val stored = file.get()
        val code = installed.longVersionCode
        val justUpdated = stored.lastVersionCode?.takeIf { it < code }?.let { (stored.lastVersionName ?: "?") to currentVersion }
        if (stored.lastVersionCode != code) file.set(stored.copy(lastVersionCode = code, lastVersionName = currentVersion, postponedVersion = if (justUpdated != null) null else stored.postponedVersion))
        state = State(
            currentVersion = currentVersion,
            channel = stored.channel,
            mode = when {
                installedFromPlay() -> Mode.PLAY_STORE
                publicKey == null -> Mode.NO_KEY
                else -> Mode.APK
            },
            lastCheckedAt = stored.lastCheckedAt,
            postponedVersion = if (justUpdated != null) null else stored.postponedVersion,
            justUpdated = justUpdated,
        )
        // Paquetes de versiones anteriores que ya no sirven.
        if (justUpdated != null) executor.execute { File(app.cacheDir, "updates").deleteRecursively() }
    }

    fun addListener(listener: (State) -> Unit) = listeners.add(listener)
    fun removeListener(listener: (State) -> Unit) = listeners.remove(listener)

    private fun update(transform: (State) -> State) {
        val next = synchronized(this) { transform(state).also { state = it } }
        app.main.post { listeners.forEach { it(next) } }
    }

    private fun packageInfo(name: String): PackageInfo =
        if (Build.VERSION.SDK_INT >= 33) app.packageManager.getPackageInfo(name, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
        else @Suppress("DEPRECATION") app.packageManager.getPackageInfo(name, PackageManager.GET_SIGNING_CERTIFICATES)

    private fun installedFromPlay(): Boolean = runCatching {
        val installer = if (Build.VERSION.SDK_INT >= 30) app.packageManager.getInstallSourceInfo(app.packageName).installingPackageName
        else @Suppress("DEPRECATION") app.packageManager.getInstallerPackageName(app.packageName)
        installer == "com.android.vending"
    }.getOrDefault(false)

    /* ------------------------------- Comprobación ------------------------------ */

    /** Al abrir ICARUS: comprueba si han pasado 6 horas desde la última vez. */
    fun checkIfDue() {
        val last = state.lastCheckedAt ?: 0
        if (System.currentTimeMillis() - last >= CHECK_INTERVAL_MS) check(manual = false)
    }

    fun check(manual: Boolean = true) {
        if (state.mode != Mode.APK || state.busy || state.status == Status.READY) return
        update { it.copy(status = Status.CHECKING, error = if (manual) null else it.error) }
        executor.execute {
            val now = System.currentTimeMillis()
            file.update { it.copy(lastCheckedAt = now) }
            try {
                val result = client.fetchSignedManifest(state.channel, publicKey)
                val current = UpdateVersion.parse(currentVersion) ?: throw UpdateCheckException("invalid-manifest", "current-version")
                when (val decision = UpdateManifests.evaluate(result, current, state.channel, TARGET)) {
                    is UpdateDecision.Available -> update {
                        it.copy(status = Status.AVAILABLE, lastCheckedAt = now, available = result.manifest, asset = decision.asset, error = null)
                    }
                    is UpdateDecision.Rejected -> update {
                        if (decision.reason == "no-asset") it.copy(status = Status.ERROR, lastCheckedAt = now, available = null, error = "no-asset")
                        else it.copy(status = Status.UP_TO_DATE, lastCheckedAt = now, available = null, error = null)
                    }
                    UpdateDecision.UpToDate -> update { it.copy(status = Status.UP_TO_DATE, lastCheckedAt = now, available = null, error = null) }
                }
            } catch (error: UpdateCheckException) {
                update {
                    when {
                        // Sin versión publicada todavía: no hay nada nuevo.
                        error.code == "not-found" || error.code == "no-key" -> it.copy(status = Status.UP_TO_DATE, lastCheckedAt = now, available = null)
                        // Las comprobaciones automáticas no muestran los fallos de red.
                        !manual && (error.code == "network" || error.code == "rate-limited") ->
                            it.copy(status = if (it.available != null) Status.AVAILABLE else Status.IDLE, lastCheckedAt = now)
                        else -> it.copy(status = Status.ERROR, lastCheckedAt = now, error = error.code, errorDetail = error.message)
                    }
                }
            } catch (error: Exception) {
                update { it.copy(status = if (manual) Status.ERROR else Status.IDLE, lastCheckedAt = now, error = if (manual) "network" else it.error, errorDetail = error.message) }
            }
        }
    }

    /* --------------------------- Descarga y verificación ------------------------- */

    fun download() {
        val manifest = state.available ?: return
        val asset = state.asset ?: return
        if (state.mode != Mode.APK || state.busy) return
        cancelRequested = false
        update { it.copy(status = Status.DOWNLOADING, progress = 0L to asset.size, error = null, errorDetail = null) }
        executor.execute {
            val destination = File(app.cacheDir, "updates/${manifest.version}/${asset.file}")
            var lastEmit = 0L
            try {
                client.download(manifest.tag, asset, destination, onProgress = { received, total ->
                    val now = System.currentTimeMillis()
                    if (received == total || now - lastEmit > 250) {
                        lastEmit = now
                        update { it.copy(progress = received to total) }
                    }
                }, cancelled = { cancelRequested })
                update { it.copy(status = Status.VERIFYING, progress = null) }
                verifyApk(destination, asset, manifest)
                apkFile = destination
                update { it.copy(status = Status.READY) }
            } catch (error: UpdateDownloadException) {
                if (cancelRequested) {
                    // Cancelada: el archivo parcial queda para reanudarla.
                    update { it.copy(status = Status.AVAILABLE, progress = null) }
                } else {
                    if (error.code == "verification-failed") destination.delete()
                    update { it.copy(status = Status.ERROR, progress = null, error = error.code, errorDetail = error.message) }
                }
            } catch (error: Exception) {
                update { it.copy(status = Status.ERROR, progress = null, error = "network", errorDetail = error.message) }
            }
        }
    }

    fun cancel() {
        cancelRequested = true
    }

    /** Comprobaciones de Android sobre el APK ya verificado por SHA-256. */
    private fun verifyApk(file: File, asset: UpdateAsset, manifest: UpdateManifest) {
        fun reject(reason: String): Nothing = throw UpdateDownloadException("verification-failed", reason)
        // El SHA-256 se vuelve a calcular justo antes de usar el archivo.
        if (UpdateClient.sha256(file) != asset.sha256) reject("El archivo cambió tras descargarse")
        val pm = app.packageManager
        val archive = (if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(file.path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
        else @Suppress("DEPRECATION") pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES)) ?: reject("No es un APK válido")
        if (archive.packageName != app.packageName) reject("El APK es de otra aplicación (${archive.packageName})")
        if (archive.longVersionCode != asset.versionCode?.toLong()) reject("El versionCode del APK no coincide con el manifiesto")
        if (archive.versionName != manifest.version) reject("La versión del APK no coincide con el manifiesto")
        if (archive.longVersionCode <= installed.longVersionCode) reject("No es una versión posterior a la instalada")
        val current = signers(installed.signingInfo)
        if (current.isEmpty() || signers(archive.signingInfo) != current) reject("El APK no está firmado con el mismo certificado que ICARUS instalado")
    }

    private fun signers(info: SigningInfo?): Set<String> =
        info?.apkContentsSigners.orEmpty().map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()

    /* --------------------------------- Instalación -------------------------------- */

    /** Android pide permiso una vez para que ICARUS pueda abrir el instalador. */
    fun canRequestInstall(): Boolean = app.packageManager.canRequestPackageInstalls()

    /**
     * Entrega el APK verificado al instalador del sistema. Android muestra siempre su
     * confirmación; el resultado llega a [UpdateInstallReceiver].
     */
    fun install() {
        val apk = apkFile ?: return
        if (state.status != Status.READY || !canRequestInstall()) return
        update { it.copy(status = Status.INSTALLING, error = null, errorDetail = null) }
        executor.execute {
            try {
                val installer = app.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(app.packageName)
                    setSize(apk.length())
                    if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
                }
                val id = installer.createSession(params)
                installer.openSession(id).use { session ->
                    session.openWrite("icarus.apk", 0, apk.length()).use { output ->
                        apk.inputStream().use { it.copyTo(output) }
                        session.fsync(output)
                    }
                    val intent = Intent(app, UpdateInstallReceiver::class.java).setAction(ACTION_INSTALL_RESULT)
                    // El instalador añade el resultado al Intent: tiene que ser mutable (y es explícito).
                    val pending = PendingIntent.getBroadcast(app, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                    session.commit(pending.intentSender)
                }
            } catch (error: Exception) {
                update { it.copy(status = Status.ERROR, error = "install-failed", errorDetail = error.message) }
            }
        }
    }

    /** Resultado del instalador (si la instalación tiene éxito, Android cierra ICARUS). */
    fun onInstallResult(status: Int, message: String?) {
        when (status) {
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> update { it.copy(status = Status.READY, error = "install-cancelled", errorDetail = null) }
            else -> update { it.copy(status = Status.ERROR, error = "install-failed", errorDetail = message) }
        }
    }

    /* ------------------------------ Preferencias ------------------------------ */

    fun postpone() {
        val version = state.available?.version ?: return
        file.update { it.copy(postponedVersion = version) }
        file.flush()
        update { it.copy(postponedVersion = version) }
    }

    fun setChannel(channel: UpdateChannel) {
        if (channel == state.channel || state.busy || state.status == Status.READY) return
        file.update { it.copy(channel = channel) }
        file.flush()
        apkFile = null
        update { it.copy(channel = channel, available = null, asset = null, status = Status.IDLE, error = null) }
        check(manual = true)
    }

    fun acknowledge() = update { it.copy(justUpdated = null) }

    /** Pruebas instrumentadas: servidor de la propia máquina (LoopbackUpdateSource) y clave de prueba. */
    fun useTestServer(source: UpdateSource, publicKey: String) {
        sourceOverride = source
        publicKeyOverride = publicKey
        apkFile = null
        update { it.copy(mode = Mode.APK, status = Status.IDLE, available = null, asset = null, error = null, postponedVersion = null) }
    }

    fun flush() = file.flush()

    companion object {
        const val ACTION_INSTALL_RESULT = "io.github.saaqes.icarusbrowser.UPDATE_INSTALL_RESULT"
        const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        val TARGET = UpdateTarget("android", "universal", listOf("apk"))

        private fun encode(stored: Stored): String = JSONObject()
            .put("version", 1)
            .put("channel", stored.channel.id)
            .put("lastCheckedAt", stored.lastCheckedAt ?: JSONObject.NULL)
            .put("postponedVersion", stored.postponedVersion ?: JSONObject.NULL)
            .put("lastVersionCode", stored.lastVersionCode ?: JSONObject.NULL)
            .put("lastVersionName", stored.lastVersionName ?: JSONObject.NULL)
            .toString(2)

        private fun decode(text: String): Stored {
            val json = JSONObject(text)
            fun optLong(name: String) = if (json.isNull(name)) null else json.optLong(name)
            fun optString(name: String) = if (json.isNull(name)) null else json.optString(name)
            return Stored(
                channel = if (json.optString("channel") == "preview") UpdateChannel.PREVIEW else UpdateChannel.STABLE,
                lastCheckedAt = optLong("lastCheckedAt"),
                postponedVersion = optString("postponedVersion")?.takeIf { UpdateVersion.parse(it) != null },
                lastVersionCode = optLong("lastVersionCode"),
                lastVersionName = optString("lastVersionName"),
            )
        }

        /** Mensajes comprensibles para cada error. */
        fun errorText(code: String?): String = when (code) {
            "network" -> "No se pudo conectar con el servidor de actualizaciones. Comprueba tu conexión e inténtalo de nuevo."
            "rate-limited" -> "GitHub ha limitado temporalmente las consultas. Vuelve a intentarlo dentro de un rato."
            "not-found" -> "No se encontró el paquete de la actualización en el servidor."
            "signature" -> "La información de la actualización no tiene una firma válida de ICARUS y se ha descartado."
            "invalid-manifest", "forbidden-host" -> "La información de la actualización no es válida y se ha descartado."
            "no-asset" -> "La versión nueva no incluye un paquete para Android."
            "hash-mismatch" -> "El archivo descargado no coincide con el publicado (SHA-256) y se ha eliminado."
            "size-mismatch" -> "El archivo descargado no tiene el tamaño esperado y se ha descartado."
            "interrupted" -> "La descarga se interrumpió. Pulsa «Reintentar» para continuarla."
            "disk-space" -> "No hay espacio suficiente para descargar la actualización."
            "write" -> "No se pudo guardar la actualización."
            "verification-failed" -> "El APK descargado no superó las comprobaciones (identificador, versión o certificado) y no se instalará."
            "install-cancelled" -> "Instalación cancelada. Puedes instalarla cuando quieras."
            "install-failed" -> "Android no completó la instalación. ICARUS sigue en la versión actual."
            else -> "No se pudo completar la actualización."
        }
    }
}

/** Recibe el resultado de PackageInstaller (no exportado: solo lo envía el sistema con nuestro PendingIntent). */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UpdateManager.ACTION_INSTALL_RESULT) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // La confirmación del sistema: el usuario decide si instala la actualización.
            val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
            if (confirm != null) context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        IcarusApp.instance.updates.onInstallResult(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    }
}
