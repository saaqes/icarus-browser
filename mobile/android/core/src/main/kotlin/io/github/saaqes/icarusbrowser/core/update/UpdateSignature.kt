package io.github.saaqes.icarusbrowser.core.update

import java.math.BigInteger
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Firma del manifiesto: ECDSA P-256 con SHA-256, en DER y en base64, igual que
 * electron/update/signature.ts. La app solo lleva la clave pública.
 */
object UpdateSignature {
    /** Orden de la curva P-256 (secp256r1): distingue la curva de otras de 256 bits. */
    private val P256_ORDER = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    private val BASE64 = Regex("^[A-Za-z0-9+/]+={0,2}$")

    fun publicKey(pem: String): ECPublicKey? = runCatching {
        val body = pem.trim()
        require(body.startsWith("-----BEGIN PUBLIC KEY-----") && body.endsWith("-----END PUBLIC KEY-----"))
        val der = Base64.getMimeDecoder().decode(body.removePrefix("-----BEGIN PUBLIC KEY-----").removeSuffix("-----END PUBLIC KEY-----"))
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der)) as ECPublicKey
        key.takeIf { it.params.order == P256_ORDER }
    }.getOrNull()

    fun isValidPublicKey(pem: String): Boolean = publicKey(pem) != null

    fun verify(manifest: ByteArray, signatureText: String, publicKeyPem: String): Boolean {
        val compact = signatureText.trim()
        if (compact.isEmpty() || compact.length > UpdateManifests.MAX_SIGNATURE_BYTES || !BASE64.matches(compact)) return false
        val key = publicKey(publicKeyPem) ?: return false
        return runCatching {
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(key)
                update(manifest)
                verify(Base64.getDecoder().decode(compact))
            }
        }.getOrDefault(false)
    }
}
