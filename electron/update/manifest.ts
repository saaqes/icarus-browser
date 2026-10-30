/**
 * Manifiesto de actualización (`icarus-update.json`), generado y firmado en CI
 * (scripts/release/make-manifest.mjs) y adjunto a cada versión publicada.
 *
 * La aplicación no confía en el nombre de los archivos ni en la API: valida cada
 * campo, exige que el manifiesto esté firmado con la clave de ICARUS y solo
 * descarga archivos cuyo nombre, tamaño y SHA-256 figuran en él, desde una URL que
 * construye ella misma (nunca una URL que venga en la respuesta).
 */

import { MAX_ASSET_BYTES, MAX_NOTES_LENGTH, PRODUCT_ID } from './config';
import { compareVersions, parseVersion, type Version } from './version';

export type UpdateChannel = 'stable' | 'preview';
export type AssetPlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';
export type AssetArch = 'x64' | 'arm64' | 'universal';
export type AssetKind = 'nsis' | 'zip' | 'dmg' | 'appimage' | 'apk' | 'ipa';

export interface UpdateAsset {
  platform: AssetPlatform;
  arch: AssetArch;
  kind: AssetKind;
  file: string;
  size: number;
  sha256: string;
  /** Solo Android: código de versión del APK. */
  versionCode?: number;
}

export interface UpdateManifest {
  schema: 1;
  product: typeof PRODUCT_ID;
  version: string;
  channel: UpdateChannel;
  tag: string;
  commit: string;
  releasedAt: string;
  notes: string;
  assets: UpdateAsset[];
}

export type ManifestError =
  | 'not-json'
  | 'schema'
  | 'product'
  | 'version'
  | 'channel'
  | 'tag'
  | 'commit'
  | 'date'
  | 'notes'
  | 'assets';

export type ManifestResult = { ok: true; manifest: UpdateManifest; version: Version } | { ok: false; error: ManifestError; detail?: string };

const PLATFORMS: readonly AssetPlatform[] = ['windows', 'macos', 'linux', 'android', 'ios'];
const ARCHES: readonly AssetArch[] = ['x64', 'arm64', 'universal'];
const EXTENSIONS: Record<AssetKind, string> = { nsis: 'exe', zip: 'zip', dmg: 'dmg', appimage: 'AppImage', apk: 'apk', ipa: 'ipa' };
const FILE_NAME = /^ICARUS-Browser-[A-Za-z0-9._-]{1,80}\.(exe|zip|dmg|AppImage|apk|ipa)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee un paquete. Devuelve el motivo si no es válido, o null si es de una
 * plataforma, arquitectura o tipo que esta versión no conoce: esos se ignoran, para
 * que añadir un tipo de paquete en el futuro no deje sin actualizaciones a las
 * instalaciones existentes (el manifiesto sigue estando firmado entero).
 */
function readAsset(raw: unknown, version: string): UpdateAsset | string | null {
  if (!isRecord(raw)) return 'asset';
  const { platform, arch, kind, file, size, sha256, versionCode } = raw;
  if (typeof platform !== 'string' || typeof arch !== 'string' || typeof kind !== 'string') return 'asset';
  if (!PLATFORMS.includes(platform as AssetPlatform) || !ARCHES.includes(arch as AssetArch) || !Object.hasOwn(EXTENSIONS, kind)) return null;
  if (typeof file !== 'string' || !FILE_NAME.test(file) || file.includes('..')) return 'file';
  // El nombre debe corresponder a la versión y al tipo de paquete.
  if (!file.includes(version) || !file.endsWith(`.${EXTENSIONS[kind as AssetKind]}`)) return 'file';
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) return 'size';
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return 'sha256';
  const asset: UpdateAsset = { platform: platform as AssetPlatform, arch: arch as AssetArch, kind: kind as AssetKind, file, size, sha256 };
  if (platform === 'android') {
    if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) return 'versionCode';
    asset.versionCode = versionCode;
  } else if (versionCode !== undefined) {
    return 'versionCode';
  }
  return asset;
}

/** Valida un manifiesto ya leído como texto (los bytes firmados). */
export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isRecord(raw) || raw.schema !== 1) return { ok: false, error: 'schema' };
  if (raw.product !== PRODUCT_ID) return { ok: false, error: 'product' };
  const version = parseVersion(raw.version);
  if (!version) return { ok: false, error: 'version' };
  const versionText = raw.version as string;
  if (raw.channel !== 'stable' && raw.channel !== 'preview') return { ok: false, error: 'channel' };
  // Una versión preliminar nunca se presenta como estable, ni al revés.
  if ((raw.channel === 'stable') !== (version.preview === null)) return { ok: false, error: 'channel' };
  if (raw.tag !== `v${versionText}`) return { ok: false, error: 'tag' };
  if (typeof raw.commit !== 'string' || !COMMIT.test(raw.commit)) return { ok: false, error: 'commit' };
  if (typeof raw.releasedAt !== 'string' || !ISO_DATE.test(raw.releasedAt) || Number.isNaN(Date.parse(raw.releasedAt))) {
    return { ok: false, error: 'date' };
  }
  if (typeof raw.notes !== 'string' || raw.notes.length > MAX_NOTES_LENGTH) return { ok: false, error: 'notes' };
  if (!Array.isArray(raw.assets) || raw.assets.length === 0 || raw.assets.length > 40) return { ok: false, error: 'assets' };
  const assets: UpdateAsset[] = [];
  const keys = new Set<string>();
  for (const item of raw.assets) {
    const asset = readAsset(item, versionText);
    if (asset === null) continue;
    if (typeof asset === 'string') return { ok: false, error: 'assets', detail: asset };
    const key = `${asset.platform}/${asset.arch}/${asset.kind}`;
    if (keys.has(key)) return { ok: false, error: 'assets', detail: 'duplicate' };
    keys.add(key);
    assets.push(asset);
  }
  return {
    ok: true,
    version,
    manifest: {
      schema: 1,
      product: PRODUCT_ID,
      version: versionText,
      channel: raw.channel,
      tag: raw.tag as string,
      commit: raw.commit,
      releasedAt: raw.releasedAt,
      notes: raw.notes,
      assets,
    },
  };
}

/** Qué paquete necesita esta instalación. `kinds` vacío: solo se avisa (iOS, Linux sin AppImage). */
export interface UpdateTarget {
  platform: AssetPlatform;
  arch: AssetArch;
  kinds: readonly AssetKind[];
}

export type UpdateDecision =
  | { status: 'up-to-date' }
  | { status: 'available'; asset: UpdateAsset | null }
  | { status: 'rejected'; reason: 'older' | 'channel' | 'no-asset' };

/**
 * Decide si el manifiesto ofrece una actualización para esta instalación. Nunca se
 * ofrece una versión inferior (ni la misma): no hay forma de forzar un retroceso.
 */
export function evaluateManifest(
  result: { manifest: UpdateManifest; version: Version },
  current: Version,
  channel: UpdateChannel,
  target: UpdateTarget,
): UpdateDecision {
  const order = compareVersions(result.version, current);
  if (order === 0) return { status: 'up-to-date' };
  if (order < 0) return { status: 'rejected', reason: 'older' };
  if (channel === 'stable' && result.manifest.channel !== 'stable') return { status: 'rejected', reason: 'channel' };
  if (target.kinds.length === 0) return { status: 'available', asset: null };
  for (const kind of target.kinds) {
    const asset = result.manifest.assets.find(
      (item) => item.platform === target.platform && item.kind === kind && (item.arch === target.arch || item.arch === 'universal'),
    );
    if (asset) return { status: 'available', asset };
  }
  return { status: 'rejected', reason: 'no-asset' };
}
