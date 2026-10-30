package io.github.saaqes.icarusbrowser.core.update

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.Instant

/**
 * Versiones y manifiesto de actualización, igual que electron/update/version.ts y
 * manifest.ts. Los vectores de mobile/shared/test-vectors/updates.json comprueban
 * que las tres plataformas deciden lo mismo.
 */
data class UpdateVersion(val major: Int, val minor: Int, val patch: Int, val preview: Int?) : Comparable<UpdateVersion> {
    /** versionCode de Android: ((mayor·100 + menor)·100 + parche)·100 + (preliminar o 99). */
    val versionCode: Int get() = ((major * 100 + minor) * 100 + patch) * 100 + (preview ?: 99)

    override fun compareTo(other: UpdateVersion): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch }, { it.preview ?: Int.MAX_VALUE })

    override fun toString() = "$major.$minor.$patch" + (preview?.let { "-preview.$it" } ?: "")

    companion object {
        private val PATTERN = Regex("^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)(?:-preview\\.([1-9]\\d?))?$")

        fun parse(text: String?): UpdateVersion? {
            val match = PATTERN.matchEntire(text ?: return null) ?: return null
            val (major, minor, patch, preview) = match.destructured
            val version = UpdateVersion(major.toInt(), minor.toInt(), patch.toInt(), preview.toIntOrNull())
            if (version.major > 2000 || (version.preview ?: 0) > 98) return null
            return version
        }
    }
}

enum class UpdateChannel(val id: String) { STABLE("stable"), PREVIEW("preview") }

data class UpdateAsset(
    val platform: String,
    val arch: String,
    val kind: String,
    val file: String,
    val size: Long,
    val sha256: String,
    val versionCode: Int?,
)

data class UpdateManifest(
    val version: String,
    val channel: UpdateChannel,
    val tag: String,
    val commit: String,
    val releasedAt: String,
    val notes: String,
    val assets: List<UpdateAsset>,
)

sealed class ManifestResult {
    data class Ok(val manifest: UpdateManifest, val version: UpdateVersion) : ManifestResult()
    /** `error`: not-json, schema, product, version, channel, tag, commit, date, notes o assets. */
    data class Invalid(val error: String, val detail: String? = null) : ManifestResult()
}

/** Paquete que necesita esta instalación. `kinds` vacío: solo se avisa (iPhone). */
data class UpdateTarget(val platform: String, val arch: String, val kinds: List<String>)

sealed class UpdateDecision {
    object UpToDate : UpdateDecision()
    data class Available(val asset: UpdateAsset?) : UpdateDecision()
    /** `reason`: older, channel o no-asset. */
    data class Rejected(val reason: String) : UpdateDecision()
}

object UpdateManifests {
    const val PRODUCT = "icarus-browser"
    const val MANIFEST_FILE = "icarus-update.json"
    const val SIGNATURE_FILE = "icarus-update.json.sig"
    const val MAX_MANIFEST_BYTES = 256 * 1024
    const val MAX_SIGNATURE_BYTES = 1024
    const val MAX_ASSET_BYTES = 1024L * 1024 * 1024
    const val MAX_NOTES_LENGTH = 20_000

    private val PLATFORMS = setOf("windows", "macos", "linux", "android", "ios")
    private val ARCHES = setOf("x64", "arm64", "universal")
    private val EXTENSIONS = mapOf("nsis" to "exe", "zip" to "zip", "dmg" to "dmg", "appimage" to "AppImage", "apk" to "apk", "ipa" to "ipa")
    private val FILE_NAME = Regex("^ICARUS-Browser-[A-Za-z0-9._-]{1,80}\\.(exe|zip|dmg|AppImage|apk|ipa)$")
    private val SHA256 = Regex("^[0-9a-f]{64}$")
    private val COMMIT = Regex("^[0-9a-f]{40}$")
    private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$")

    /** Número entero de JSON (los decimales no son válidos). */
    private fun integer(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        else -> null
    }

    /**
     * Devuelve el paquete, el motivo si no es válido o null si es de una plataforma,
     * arquitectura o tipo que esta versión no conoce: esos se ignoran, para que un tipo
     * de paquete nuevo no deje sin actualizaciones a las instalaciones existentes.
     */
    private fun readAsset(raw: Any?, version: String): Any? {
        val item = raw as? JSONObject ?: return "asset"
        val platform = item.opt("platform") as? String ?: return "asset"
        val arch = item.opt("arch") as? String ?: return "asset"
        val kind = item.opt("kind") as? String ?: return "asset"
        if (platform !in PLATFORMS || arch !in ARCHES || kind !in EXTENSIONS) return null
        val extension = EXTENSIONS.getValue(kind)
        val file = item.opt("file") as? String
        if (file == null || !FILE_NAME.matches(file) || file.contains("..")) return "file"
        // El nombre debe corresponder a la versión y al tipo de paquete.
        if (!file.contains(version) || !file.endsWith(".$extension")) return "file"
        val size = integer(item.opt("size"))
        if (size == null || size <= 0 || size > MAX_ASSET_BYTES) return "size"
        val sha256 = item.opt("sha256") as? String
        if (sha256 == null || !SHA256.matches(sha256)) return "sha256"
        var versionCode: Int? = null
        if (platform == "android") {
            val code = integer(item.opt("versionCode"))
            if (code == null || code <= 0 || code > Int.MAX_VALUE) return "versionCode"
            versionCode = code.toInt()
        } else if (item.has("versionCode")) {
            return "versionCode"
        }
        return UpdateAsset(platform, arch, kind, file, size, sha256, versionCode)
    }

    /** Valida un manifiesto ya leído como texto (los bytes firmados). */
    fun parse(text: String): ManifestResult {
        val raw = try {
            JSONObject(text)
        } catch (_: JSONException) {
            return ManifestResult.Invalid("not-json")
        }
        if (integer(raw.opt("schema")) != 1L) return ManifestResult.Invalid("schema")
        if (raw.opt("product") != PRODUCT) return ManifestResult.Invalid("product")
        val versionText = raw.opt("version") as? String
        val version = UpdateVersion.parse(versionText) ?: return ManifestResult.Invalid("version")
        val channel = when (raw.opt("channel")) {
            "stable" -> UpdateChannel.STABLE
            "preview" -> UpdateChannel.PREVIEW
            else -> return ManifestResult.Invalid("channel")
        }
        // Una versión preliminar nunca se presenta como estable, ni al revés.
        if ((channel == UpdateChannel.STABLE) != (version.preview == null)) return ManifestResult.Invalid("channel")
        if (raw.opt("tag") != "v$versionText") return ManifestResult.Invalid("tag")
        val commit = raw.opt("commit") as? String
        if (commit == null || !COMMIT.matches(commit)) return ManifestResult.Invalid("commit")
        val releasedAt = raw.opt("releasedAt") as? String
        if (releasedAt == null || !ISO_DATE.matches(releasedAt) || runCatching { Instant.parse(releasedAt) }.isFailure) {
            return ManifestResult.Invalid("date")
        }
        val notes = raw.opt("notes") as? String
        if (notes == null || notes.length > MAX_NOTES_LENGTH) return ManifestResult.Invalid("notes")
        val list = raw.opt("assets") as? JSONArray
        if (list == null || list.length() == 0 || list.length() > 40) return ManifestResult.Invalid("assets")
        val assets = ArrayList<UpdateAsset>()
        val keys = HashSet<String>()
        for (index in 0 until list.length()) {
            val asset = readAsset(list.opt(index), versionText!!) ?: continue
            if (asset !is UpdateAsset) return ManifestResult.Invalid("assets", asset as String)
            if (!keys.add("${asset.platform}/${asset.arch}/${asset.kind}")) return ManifestResult.Invalid("assets", "duplicate")
            assets.add(asset)
        }
        return ManifestResult.Ok(UpdateManifest(versionText!!, channel, "v$versionText", commit, releasedAt, notes, assets), version)
    }

    /**
     * Decide si el manifiesto ofrece una actualización para esta instalación. Nunca se
     * ofrece una versión inferior (ni la misma).
     */
    fun evaluate(result: ManifestResult.Ok, current: UpdateVersion, channel: UpdateChannel, target: UpdateTarget): UpdateDecision {
        val order = result.version.compareTo(current)
        if (order == 0) return UpdateDecision.UpToDate
        if (order < 0) return UpdateDecision.Rejected("older")
        if (channel == UpdateChannel.STABLE && result.manifest.channel != UpdateChannel.STABLE) return UpdateDecision.Rejected("channel")
        if (target.kinds.isEmpty()) return UpdateDecision.Available(null)
        for (kind in target.kinds) {
            val asset = result.manifest.assets.firstOrNull {
                it.platform == target.platform && it.kind == kind && (it.arch == target.arch || it.arch == "universal")
            }
            if (asset != null) return UpdateDecision.Available(asset)
        }
        return UpdateDecision.Rejected("no-asset")
    }
}
