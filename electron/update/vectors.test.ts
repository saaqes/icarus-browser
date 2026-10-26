// @vitest-environment node
/**
 * Vectores de actualización compartidos con Android e iPhone
 * (mobile/shared/test-vectors/updates.json): versiones, manifiestos firmados,
 * manipulados o no válidos y la decisión esperada para cada plataforma. Las
 * pruebas de Kotlin y de Swift comprueban que sus implementaciones dan los mismos
 * resultados que la de escritorio.
 *
 * Las firmas ECDSA son aleatorias, así que el archivo no se compara byte a byte:
 * esta prueba comprueba que la implementación de escritorio sigue dando los
 * resultados anotados. Para regenerarlo (con una clave de prueba nueva, que solo
 * existe durante la generación):
 *   UPDATE_MOBILE_SHARED=1 npx vitest run electron/update/vectors.test.ts
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateManifest, parseManifest, type AssetArch, type AssetKind, type AssetPlatform, type UpdateChannel } from './manifest';
import { verifyManifestSignature } from './signature';
import { androidVersionCode, compareVersions, parseVersion } from './version';

const FILE = join(__dirname, '..', '..', 'mobile', 'shared', 'test-vectors', 'updates.json');

interface DecisionCase {
  current: string;
  channel: UpdateChannel;
  platform: AssetPlatform;
  arch: AssetArch;
  kinds: readonly AssetKind[];
  /** up-to-date | available | rejected:older | rejected:channel | rejected:no-asset */
  result: string;
  file: string | null;
}

interface ManifestCase {
  name: string;
  text: string;
  signature: string;
  signatureValid: boolean;
  /** ok o el código de error de parseManifest. */
  parse: string;
  decisions: DecisionCase[];
}

interface Vectors {
  publicKey: string;
  versions: Array<{ text: string; valid: boolean; versionCode: number | null }>;
  /** Versiones válidas de menor a mayor. */
  order: string[];
  manifests: ManifestCase[];
}

/* --------------------------------- Generación --------------------------------- */

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const fakeHash = (name: string) => createHash('sha256').update(name).digest('hex');

function assets(version: string, platforms: AssetPlatform[]) {
  const code = androidVersionCode(parseVersion(version)!);
  const all = [
    { platform: 'windows', arch: 'x64', kind: 'nsis', file: `ICARUS-Browser-Setup-${version}.exe` },
    { platform: 'windows', arch: 'x64', kind: 'zip', file: `ICARUS-Browser-${version}-win-x64.zip` },
    { platform: 'macos', arch: 'arm64', kind: 'zip', file: `ICARUS-Browser-${version}-mac-arm64.zip` },
    { platform: 'macos', arch: 'x64', kind: 'zip', file: `ICARUS-Browser-${version}-mac-x64.zip` },
    { platform: 'macos', arch: 'arm64', kind: 'dmg', file: `ICARUS-Browser-${version}-mac-arm64.dmg` },
    { platform: 'android', arch: 'universal', kind: 'apk', file: `ICARUS-Browser-${version}-android.apk`, versionCode: code },
    { platform: 'ios', arch: 'universal', kind: 'ipa', file: `ICARUS-Browser-${version}-ios-sin-firmar.ipa` },
  ];
  return all.filter((item) => platforms.includes(item.platform as AssetPlatform)).map((item, index) => ({ ...item, size: 1_000_000 + index, sha256: fakeHash(item.file) }));
}

function manifest(version: string, platforms: AssetPlatform[] = ['windows', 'macos', 'android', 'ios'], patch: Record<string, unknown> = {}) {
  const parsed = parseVersion(version);
  return {
    schema: 1,
    product: 'icarus-browser',
    version,
    channel: parsed?.preview === null ? 'stable' : 'preview',
    tag: `v${version}`,
    commit: COMMIT,
    releasedAt: '2026-10-20T12:00:00.000Z',
    notes: `Novedades de ICARUS ${version}\n- Mejoras «con acentos» y <etiquetas> como texto.`,
    assets: assets(version, platforms),
    ...patch,
  };
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const signText = (body: string, key: KeyObject) => `${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'der' }).toString('base64')}\n`;

const ANDROID = { platform: 'android', arch: 'universal', kinds: ['apk'] } as const;
const IOS = { platform: 'ios', arch: 'universal', kinds: [] } as const;
const WINDOWS = { platform: 'windows', arch: 'x64', kinds: ['nsis'] } as const;
const MAC = { platform: 'macos', arch: 'arm64', kinds: ['zip'] } as const;

function generate(): Vectors {
  const main = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const stable = text(manifest('0.3.0'));
  const preview = text(manifest('0.3.0-preview.2', ['android', 'ios']));
  const windowsOnly = text(manifest('0.3.1', ['windows']));
  const cases: Array<Omit<ManifestCase, 'signatureValid' | 'parse' | 'decisions'> & { decisions: Array<Omit<DecisionCase, 'result' | 'file'>> }> = [
    {
      name: 'estable 0.3.0',
      text: stable,
      signature: signText(stable, main.privateKey),
      decisions: [
        { current: '0.2.0', channel: 'stable', ...ANDROID },
        { current: '0.3.0', channel: 'stable', ...ANDROID },
        { current: '0.4.0', channel: 'stable', ...ANDROID },
        { current: '0.3.0-preview.5', channel: 'preview', ...ANDROID },
        { current: '0.2.0', channel: 'stable', ...IOS },
        { current: '0.2.0', channel: 'stable', ...WINDOWS },
        { current: '0.2.0', channel: 'stable', ...MAC },
      ],
    },
    {
      name: 'preliminar 0.3.0-preview.2',
      text: preview,
      signature: signText(preview, main.privateKey),
      decisions: [
        { current: '0.2.0', channel: 'stable', ...ANDROID },
        { current: '0.2.0', channel: 'preview', ...ANDROID },
        { current: '0.3.0-preview.2', channel: 'preview', ...ANDROID },
        { current: '0.3.0', channel: 'preview', ...ANDROID },
        { current: '0.2.0', channel: 'preview', ...IOS },
      ],
    },
    {
      name: 'sin paquete de Android',
      text: windowsOnly,
      signature: signText(windowsOnly, main.privateKey),
      decisions: [
        { current: '0.3.0', channel: 'stable', ...ANDROID },
        { current: '0.3.0', channel: 'stable', ...IOS },
      ],
    },
    // El manifiesto cambia después de firmarlo.
    { name: 'manipulado', text: stable.replace('Mejoras', 'Cambios'), signature: signText(stable, main.privateKey), decisions: [] },
    { name: 'firmado con otra clave', text: stable, signature: signText(stable, other.privateKey), decisions: [] },
    { name: 'firma vacía', text: stable, signature: '\n', decisions: [] },
    { name: 'firma que no es base64', text: stable, signature: 'no*es*base64\n', decisions: [] },
  ];
  const invalid: Array<[string, string]> = [
    ['no es JSON', '{"schema": 1, "product": '],
    ['esquema 2', text(manifest('0.3.0', undefined, { schema: 2 }))],
    ['otro producto', text(manifest('0.3.0', undefined, { product: 'otro-navegador' }))],
    ['versión no válida', text(manifest('0.3.0', undefined, { version: '0.3' }))],
    ['preliminar marcada como estable', text(manifest('0.3.0-preview.1', undefined, { channel: 'stable' }))],
    ['estable marcada como preliminar', text(manifest('0.3.0', undefined, { channel: 'preview' }))],
    ['etiqueta distinta', text(manifest('0.3.0', undefined, { tag: 'v0.3.1' }))],
    ['commit corto', text(manifest('0.3.0', undefined, { commit: '0123abc' }))],
    ['fecha no válida', text(manifest('0.3.0', undefined, { releasedAt: '20 de octubre' }))],
    ['notas demasiado largas', text(manifest('0.3.0', undefined, { notes: 'x'.repeat(20_001) }))],
    ['sin paquetes', text(manifest('0.3.0', undefined, { assets: [] }))],
    ['archivo de otra versión', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], file: 'ICARUS-Browser-0.2.9-android.apk' }] }))],
    ['archivo con ruta', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], file: '../ICARUS-Browser-0.3.0-android.apk' }] }))],
    ['extensión distinta del tipo', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], kind: 'ipa' }] }))],
    ['APK sin versionCode', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], versionCode: undefined }] }))],
    ['versionCode fuera de Android', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['windows'])[0], versionCode: 3 }] }))],
    ['SHA-256 en mayúsculas', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], sha256: fakeHash('x').toUpperCase() }] }))],
    ['tamaño cero', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], size: 0 }] }))],
    ['paquete repetido', text(manifest('0.3.0', undefined, { assets: [...assets('0.3.0', ['android']), ...assets('0.3.0', ['android'])] }))],
    ['plataforma desconocida', text(manifest('0.3.0', undefined, { assets: [{ ...assets('0.3.0', ['android'])[0], platform: 'symbian' }] }))],
  ];
  for (const [name, body] of invalid) cases.push({ name, text: body, signature: signText(body, main.privateKey), decisions: [] });

  const publicKey = main.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const versions = ['0.2.0', '0.3.0-preview.1', '1.0.0', '2000.99.99', '0.2', '01.2.3', '1.2.3-beta.1', '1.2.3-preview.0', '1.2.3-preview.99', '2001.0.0', '1.100.0', ' 1.2.3', 'v1.2.3', '1.2.3-preview.98'];
  return {
    publicKey,
    versions: versions.map((value) => {
      const parsed = parseVersion(value);
      return { text: value, valid: parsed !== null, versionCode: parsed ? androidVersionCode(parsed) : null };
    }),
    order: ['0.2.0', '0.2.1-preview.1', '0.2.1-preview.2', '0.2.1', '0.3.0-preview.1', '0.3.0', '0.10.0', '1.0.0'],
    manifests: cases.map((item) => {
      const result = parseManifest(item.text);
      return {
        name: item.name,
        text: item.text,
        signature: item.signature,
        signatureValid: verifyManifestSignature(Buffer.from(item.text), item.signature, publicKey),
        parse: result.ok ? 'ok' : result.error,
        decisions: item.decisions.map((decision) => {
          if (!result.ok) throw new Error(`${item.name}: no se puede decidir sobre un manifiesto no válido`);
          const outcome = evaluateManifest(result, parseVersion(decision.current)!, decision.channel, decision);
          return {
            ...decision,
            kinds: [...decision.kinds],
            result: outcome.status === 'rejected' ? `rejected:${outcome.reason}` : outcome.status,
            file: outcome.status === 'available' ? (outcome.asset?.file ?? null) : null,
          };
        }),
      };
    }),
  };
}

if (process.env.UPDATE_MOBILE_SHARED === '1' || !existsSync(FILE)) writeFileSync(FILE, `${JSON.stringify(generate(), null, 2)}\n`);
const vectors = JSON.parse(readFileSync(FILE, 'utf8')) as Vectors;

/* ---------------------------------- Pruebas ---------------------------------- */

describe('vectores de actualización compartidos con Android e iPhone', () => {
  it('versiones y códigos de versión', () => {
    for (const item of vectors.versions) {
      const parsed = parseVersion(item.text);
      expect(parsed !== null, item.text).toBe(item.valid);
      expect(parsed ? androidVersionCode(parsed) : null, item.text).toBe(item.versionCode);
    }
    const order = vectors.order.map((value) => parseVersion(value)!);
    for (let index = 1; index < order.length; index++) {
      expect(compareVersions(order[index - 1]!, order[index]!), vectors.order[index]).toBeLessThan(0);
      expect(androidVersionCode(order[index - 1]!)).toBeLessThan(androidVersionCode(order[index]!));
    }
  });

  it('firmas, validación y decisión de cada manifiesto', () => {
    expect(vectors.manifests.length).toBeGreaterThanOrEqual(25);
    for (const item of vectors.manifests) {
      expect(verifyManifestSignature(Buffer.from(item.text), item.signature, vectors.publicKey), item.name).toBe(item.signatureValid);
      const result = parseManifest(item.text);
      expect(result.ok ? 'ok' : result.error, item.name).toBe(item.parse);
      for (const decision of item.decisions) {
        if (!result.ok) throw new Error(item.name);
        const outcome = evaluateManifest(result, parseVersion(decision.current)!, decision.channel, decision);
        const label = `${item.name}: ${decision.platform} ${decision.current} (${decision.channel})`;
        expect(outcome.status === 'rejected' ? `rejected:${outcome.reason}` : outcome.status, label).toBe(decision.result);
        expect(outcome.status === 'available' ? (outcome.asset?.file ?? null) : null, label).toBe(decision.file);
      }
    }
    // Lo esencial de los vectores, por si alguien los regenera con otra lógica.
    const byName = new Map(vectors.manifests.map((item) => [item.name, item]));
    expect(byName.get('manipulado')?.signatureValid).toBe(false);
    expect(byName.get('firmado con otra clave')?.signatureValid).toBe(false);
    expect(byName.get('estable 0.3.0')?.decisions.find((item) => item.platform === 'android' && item.current === '0.4.0')?.result).toBe('rejected:older');
    expect(byName.get('preliminar 0.3.0-preview.2')?.decisions.find((item) => item.channel === 'stable')?.result).toBe('rejected:channel');
  });
});
