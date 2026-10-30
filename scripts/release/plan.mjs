/**
 * Primer paso de .github/workflows/release.yml: decide qué se publica y lo
 * rechaza todo antes de compilar si algo no cuadra.
 *
 * - Etiqueta vX.Y.Z → «stable»; vX.Y.Z-preview.N → «preview». La etiqueta debe
 *   coincidir con package.json, la versión no puede estar ya publicada ni ser
 *   anterior o igual a otra publicada, y deben existir la clave pública del
 *   repositorio y el secreto de firma del manifiesto. Sin el almacén de claves de
 *   Android se publica igualmente, pero el APK no entra en el manifiesto.
 * - Lanzamiento manual → «draft»: un borrador privado que nunca llega a los usuarios.
 *
 * Lee las variables de GitHub Actions y escribe mode, version, tag, channel y android
 * (include | omit) en GITHUB_OUTPUT. Para probarlo en local: GITHUB_EVENT_NAME=push GITHUB_REF_TYPE=tag
 * GITHUB_REF_NAME=v0.3.0 node scripts/release/plan.mjs
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { compareVersions, describeVersion, fail, packageVersion, parseVersion, projectDir, repositoryPublicKey } from './core.mjs';

const env = process.env;
const version = packageVersion();
const info = describeVersion(version);
if (!info) fail(`La versión de package.json («${version}») no es válida.`);
// package.json y mobile/ios/App/project.yml deben coincidir.
execFileSync(process.execPath, ['scripts/release/version.mjs', 'check'], { cwd: projectDir, stdio: ['ignore', 'ignore', 'inherit'] });

const warn = (message) => console.log(env.GITHUB_ACTIONS ? `::warning::${message}` : `Aviso: ${message}`);
let mode;
let tag;
if (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF_TYPE === 'tag') {
  tag = env.GITHUB_REF_NAME;
  if (tag !== info.tag) fail(`La etiqueta ${tag} no coincide con la versión de package.json (${info.tag}). Cambia la versión con «npm version» y vuelve a etiquetar.`);
  mode = info.channel;
} else if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  mode = 'draft';
  // Un nombre que no es una versión: aunque alguien lo publicara a mano, la app no lo ofrecería.
  tag = `v${version}-borrador.${env.GITHUB_RUN_NUMBER ?? '0'}`;
} else {
  fail('Solo se publica desde una etiqueta vX.Y.Z / vX.Y.Z-preview.N o lanzándolo a mano (borrador).');
}

const missing = [];
if (!repositoryPublicKey()) missing.push('build/update-public-key.pem (node scripts/release/generate-update-key.mjs)');
if (env.HAS_SIGNING_KEY !== 'true') missing.push('el secreto ICARUS_UPDATE_SIGNING_KEY');
// Android solo acepta una actualización firmada con el mismo certificado que la app instalada:
// sin almacén de claves fijo, el APK se adjunta pero no se ofrece como actualización.
const android = env.HAS_KEYSTORE === 'true' ? 'include' : 'omit';
if (android === 'omit') warn('Faltan los secretos del almacén de claves de Android: el APK no entrará en el manifiesto (ver docs/UPDATES.md).');
if (missing.length) {
  const text = `Falta ${missing.join('; ')}. Ver docs/UPDATES.md.`;
  if (mode === 'draft') warn(`${text} El borrador se creará igualmente, pero no sirve para publicar.`);
  else fail(text);
}

if (mode !== 'draft') {
  // Versiones ya publicadas (los borradores no cuentan: no llegan a nadie).
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases?per_page=100`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'user-agent': 'ICARUS-release' },
  });
  if (!response.ok) fail(`No se pudo consultar las versiones publicadas (HTTP ${response.status}).`);
  const current = parseVersion(version);
  for (const release of await response.json()) {
    if (release.draft) continue;
    if (release.tag_name === tag) fail(`La versión ${tag} ya está publicada: no se publica dos veces.`);
    const published = typeof release.tag_name === 'string' ? parseVersion(release.tag_name.replace(/^v/, '')) : null;
    if (published && compareVersions(current, published) <= 0) {
      fail(`${tag} no es posterior a ${release.tag_name}, ya publicada: las instalaciones la rechazarían.`);
    }
  }
}

console.log(`Publicación: ${mode} · ${tag} · versión ${version} (versionCode ${info.versionCode})`);
if (env.GITHUB_OUTPUT) {
  appendFileSync(env.GITHUB_OUTPUT, `mode=${mode}\nversion=${version}\ntag=${tag}\nchannel=${info.channel}\nandroid=${android}\n`);
}
