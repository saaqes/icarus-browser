/**
 * Genera el manifiesto de actualización (icarus-update.json) a partir de los
 * paquetes ya compilados: tamaño y SHA-256 de cada archivo, versión, canal,
 * etiqueta, commit y notas. Falta un paquete → error (no se publica nada).
 *
 * Uso:
 *   node scripts/release/make-manifest.mjs --dir release --version 0.3.0 --commit <sha>
 *     [--notes-file notas.md] [--released-at 2026-10-26T10:00:00Z]
 *     [--platforms windows,macos] [--select windows/x64/nsis,macos/arm64/zip]
 *
 * `--platforms` y `--select` solo sirven para las pruebas de actualización de CI
 * (que compilan un paquete); una publicación incluye siempre todos.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { expectedAssets, fail, MANIFEST_FILE, MAX_NOTES_LENGTH, parseManifest, parseVersion, PLATFORMS, sha256File } from './core.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'release' },
    version: { type: 'string' },
    commit: { type: 'string' },
    'notes-file': { type: 'string' },
    'released-at': { type: 'string' },
    platforms: { type: 'string', default: PLATFORMS.join(',') },
    select: { type: 'string' },
  },
});

const version = values.version;
const parsed = parseVersion(version);
if (!parsed) fail(`Versión no válida: ${version}`);
if (!/^[0-9a-f]{40}$/.test(values.commit ?? '')) fail('--commit debe ser el SHA completo del commit (40 caracteres hexadecimales).');
const platforms = values.platforms.split(',').map((item) => item.trim());
for (const platform of platforms) if (!PLATFORMS.includes(platform)) fail(`Plataforma desconocida: ${platform}`);

const notes = values['notes-file'] ? readFileSync(values['notes-file'], 'utf8').trim() : '';
if (notes.length > MAX_NOTES_LENGTH) fail(`Las notas tienen ${notes.length} caracteres; el máximo es ${MAX_NOTES_LENGTH}.`);

const releasedAt = values['released-at'] ?? new Date().toISOString();
const assets = [];
const missing = [];
const selected = values.select?.split(',').map((item) => item.trim());
const wanted = (item) => (selected ? selected.includes(`${item.platform}/${item.arch}/${item.kind}`) : platforms.includes(item.platform));
if (selected && expectedAssets(version).filter(wanted).length !== selected.length) fail(`--select contiene paquetes desconocidos: ${values.select}`);
for (const expected of expectedAssets(version).filter(wanted)) {
  const path = join(values.dir, expected.file);
  if (!existsSync(path)) {
    missing.push(expected.file);
    continue;
  }
  assets.push({ ...expected, size: statSync(path).size, sha256: await sha256File(path) });
}
if (missing.length) fail(`Faltan paquetes en ${values.dir}: ${missing.join(', ')}`);

const manifest = {
  schema: 1,
  product: 'icarus-browser',
  version,
  channel: parsed.preview === null ? 'stable' : 'preview',
  tag: `v${version}`,
  commit: values.commit,
  releasedAt,
  notes,
  assets,
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
// El manifiesto debe superar la misma validación que hace la aplicación.
const check = parseManifest(text);
if (!check.ok) fail(`El manifiesto generado no es válido (${check.error}${check.detail ? `: ${check.detail}` : ''}).`);

const out = join(values.dir, MANIFEST_FILE);
writeFileSync(out, text);
console.log(`${out}: ${version} (${manifest.channel}), ${assets.length} paquetes`);
for (const asset of assets) console.log(`  ${asset.sha256}  ${asset.file}  ${asset.size} B`);
