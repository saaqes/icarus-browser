package io.github.saaqes.icarusbrowser.core.update

import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * El núcleo de Android decide igual que escritorio con los vectores de
 * mobile/shared/test-vectors/updates.json (generados por electron/update/vectors.test.ts).
 */
class UpdateVectorsTest {
    private val shared = File(System.getProperty("icarus.shared") ?: "../../shared")
    private val vectors = JSONObject(File(shared, "test-vectors/updates.json").readText())

    @Test
    fun `versiones y versionCode como en escritorio`() {
        val versions = vectors.getJSONArray("versions")
        for (index in 0 until versions.length()) {
            val item = versions.getJSONObject(index)
            val text = item.getString("text")
            val parsed = UpdateVersion.parse(text)
            assertEquals(item.getBoolean("valid"), parsed != null, text)
            assertEquals(if (item.isNull("versionCode")) null else item.getInt("versionCode"), parsed?.versionCode, text)
        }
        val order = vectors.getJSONArray("order").let { list -> (0 until list.length()).map { UpdateVersion.parse(list.getString(it))!! } }
        for (index in 1 until order.size) {
            assertTrue(order[index - 1] < order[index], "${order[index - 1]} < ${order[index]}")
            assertTrue(order[index - 1].versionCode < order[index].versionCode)
        }
    }

    @Test
    fun `firmas, validación y decisión de cada manifiesto`() {
        val publicKey = vectors.getString("publicKey")
        val manifests = vectors.getJSONArray("manifests")
        assertTrue(manifests.length() >= 25)
        val failures = ArrayList<String>()
        for (index in 0 until manifests.length()) {
            val item = manifests.getJSONObject(index)
            val name = item.getString("name")
            val text = item.getString("text")
            val signatureValid = UpdateSignature.verify(text.toByteArray(Charsets.UTF_8), item.getString("signature"), publicKey)
            if (signatureValid != item.getBoolean("signatureValid")) failures.add("$name: firma $signatureValid")
            val result = UpdateManifests.parse(text)
            val parse = if (result is ManifestResult.Invalid) result.error else "ok"
            if (parse != item.getString("parse")) failures.add("$name: se esperaba ${item.getString("parse")} y se obtuvo $parse")
            val decisions = item.getJSONArray("decisions")
            for (d in 0 until decisions.length()) {
                val case = decisions.getJSONObject(d)
                val kinds = case.getJSONArray("kinds").let { list -> (0 until list.length()).map { list.getString(it) } }
                val channel = if (case.getString("channel") == "preview") UpdateChannel.PREVIEW else UpdateChannel.STABLE
                val decision = UpdateManifests.evaluate(
                    result as ManifestResult.Ok,
                    UpdateVersion.parse(case.getString("current"))!!,
                    channel,
                    UpdateTarget(case.getString("platform"), case.getString("arch"), kinds),
                )
                val (status, file) = when (decision) {
                    is UpdateDecision.UpToDate -> "up-to-date" to null
                    is UpdateDecision.Available -> "available" to decision.asset?.file
                    is UpdateDecision.Rejected -> "rejected:${decision.reason}" to null
                }
                val expectedFile = if (case.isNull("file")) null else case.getString("file")
                if (status != case.getString("result") || file != expectedFile) {
                    failures.add("$name / ${case.getString("platform")} ${case.getString("current")}: $status $file ≠ ${case.getString("result")} $expectedFile")
                }
            }
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun `la clave debe ser P-256`() {
        assertTrue(UpdateSignature.isValidPublicKey(vectors.getString("publicKey")))
        assertEquals(false, UpdateSignature.isValidPublicKey("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"))
    }
}
