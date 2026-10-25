/**
 * Comprobación de actualizaciones: obtiene el manifiesto del canal, verifica su
 * firma sobre los bytes exactos recibidos y lo valida campo a campo.
 */

import { MANIFEST_FILE, MAX_MANIFEST_BYTES, MAX_SIGNATURE_BYTES, SIGNATURE_FILE } from './config';
import { parseManifest, type ManifestError, type UpdateChannel, type UpdateManifest } from './manifest';
import { verifyManifestSignature } from './signature';
import { fetchAllowed, pickNewestTag, readLimited, UpdateHttpError, type FetchLike, type UpdateSource } from './source';
import type { Version } from './version';

export type CheckError = 'network' | 'rate-limited' | 'not-found' | 'signature' | 'invalid-manifest' | 'no-key';

export type ManifestFetch =
  | { ok: true; manifest: UpdateManifest; version: Version }
  | { ok: false; error: CheckError; detail?: string };

export interface CheckOptions {
  fetch: FetchLike;
  source: UpdateSource;
  channel: UpdateChannel;
  /** Clave pública PEM; sin ella no se acepta ninguna actualización. */
  publicKey: string | null;
  signal?: AbortSignal;
  /** Cabeceras extra (p. ej. agente de usuario). */
  headers?: Record<string, string>;
}

function failure(error: unknown): ManifestFetch {
  if (error instanceof UpdateHttpError) {
    if (error.code === 'rate-limited') return { ok: false, error: 'rate-limited' };
    if (error.code === 'not-found') return { ok: false, error: 'not-found' };
    if (error.code === 'too-large' || error.code === 'forbidden-host') return { ok: false, error: 'invalid-manifest', detail: error.code };
    return { ok: false, error: 'network', detail: error.message };
  }
  if ((error as Error)?.name === 'AbortError') throw error;
  return { ok: false, error: 'network', detail: (error as Error)?.message };
}

async function download(options: CheckOptions, url: string, max: number): Promise<Uint8Array> {
  const response = await fetchAllowed(options.fetch, options.source, url, { headers: options.headers, signal: options.signal });
  return readLimited(response, max);
}

export async function fetchSignedManifest(options: CheckOptions): Promise<ManifestFetch> {
  if (!options.publicKey) return { ok: false, error: 'no-key' };
  let manifestUrl: string;
  let signatureUrl: string;
  let expectedTag: string | null = null;
  try {
    if (options.channel === 'stable') {
      ({ manifest: manifestUrl, signature: signatureUrl } = options.source.latestStable());
    } else {
      const listBytes = await download(options, options.source.releasesListUrl(), 2 * 1024 * 1024);
      let list: unknown;
      try {
        list = JSON.parse(new TextDecoder().decode(listBytes));
      } catch {
        return { ok: false, error: 'invalid-manifest', detail: 'releases' };
      }
      expectedTag = pickNewestTag(list);
      if (!expectedTag) return { ok: false, error: 'not-found' };
      manifestUrl = options.source.assetUrl(expectedTag, MANIFEST_FILE);
      signatureUrl = options.source.assetUrl(expectedTag, SIGNATURE_FILE);
    }
    const [manifestBytes, signatureBytes] = await Promise.all([
      download(options, manifestUrl, MAX_MANIFEST_BYTES),
      download(options, signatureUrl, MAX_SIGNATURE_BYTES),
    ]);
    if (!verifyManifestSignature(manifestBytes, new TextDecoder().decode(signatureBytes), options.publicKey)) {
      return { ok: false, error: 'signature' };
    }
    const parsed = parseManifest(new TextDecoder().decode(manifestBytes));
    if (!parsed.ok) return { ok: false, error: 'invalid-manifest', detail: detailOf(parsed.error, parsed.detail) };
    // El manifiesto firmado debe ser el de la versión que se pidió.
    if (expectedTag && parsed.manifest.tag !== expectedTag) return { ok: false, error: 'invalid-manifest', detail: 'tag' };
    if (options.channel === 'stable' && parsed.manifest.channel !== 'stable') return { ok: false, error: 'invalid-manifest', detail: 'channel' };
    return { ok: true, manifest: parsed.manifest, version: parsed.version };
  } catch (error) {
    return failure(error);
  }
}

function detailOf(error: ManifestError, detail?: string): string {
  return detail ? `${error}:${detail}` : error;
}
