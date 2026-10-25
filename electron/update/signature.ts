/**
 * Firma del manifiesto: ECDSA P-256 con SHA-256, en DER y codificada en base64
 * (`icarus-update.json.sig`). Es el mismo algoritmo que verifican Android
 * (`SHA256withECDSA`) e iOS (`P256.Signing`), así que una sola firma sirve para
 * todas las plataformas.
 *
 * La clave privada solo existe en los secretos de GitHub Actions; la aplicación
 * lleva únicamente la clave pública (build/update-public-key.pem).
 */

import { createPublicKey, verify } from 'node:crypto';
import { MAX_SIGNATURE_BYTES } from './config';

/** Comprueba que el texto es una clave pública EC P-256 válida. */
export function isValidPublicKey(pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

export function verifyManifestSignature(manifest: Uint8Array, signatureText: string, publicKeyPem: string): boolean {
  const compact = signatureText.trim();
  if (!compact || compact.length > MAX_SIGNATURE_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return verify('sha256', manifest, { key, dsaEncoding: 'der' }, Buffer.from(compact, 'base64'));
  } catch {
    return false;
  }
}
