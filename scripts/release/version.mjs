/**
 * Versión única de ICARUS Browser: la de package.json.
 *
 * - Escritorio (Electron) la lee de package.json al empaquetar.
 * - Android la lee de package.json en Gradle (versionName y versionCode).
 * - iPhone/iPad: XcodeGen no puede leer package.json, así que este script copia la
 *   versión en mobile/ios/App/project.yml (MARKETING_VERSION = X.Y.Z, porque Apple
 *   solo admite números, y CURRENT_PROJECT_VERSION = el mismo código que Android).
 *
 * Uso:
 *   node scripts/release/version.mjs sync                # actualiza project.yml
 *   node scripts/release/version.mjs check [--tag vX.Y.Z] # comprueba y muestra la versión
 *
 * `npm version 0.3.0` ejecuta `sync` automáticamente (script «version» de package.json).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { describeVersion, fail, packageVersion, projectDir } from './core.mjs';

const IOS_PROJECT = join(projectDir, 'mobile', 'ios', 'App', 'project.yml');
const MARKETING = /^(\s*MARKETING_VERSION:\s*)"([^"]*)"/m;
const BUILD = /^(\s*CURRENT_PROJECT_VERSION:\s*)"([^"]*)"/m;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { tag: { type: 'string' } } });
const command = positionals[0];
const version = packageVersion();
const info = describeVersion(version);
if (!info) fail(`La versión de package.json («${version}») no es válida: usa X.Y.Z o X.Y.Z-preview.N (N entre 1 y 98).`);

const project = readFileSync(IOS_PROJECT, 'utf8');
if (!MARKETING.test(project) || !BUILD.test(project)) fail(`${IOS_PROJECT} no tiene MARKETING_VERSION y CURRENT_PROJECT_VERSION.`);

if (command === 'sync') {
  const next = project.replace(MARKETING, `$1"${info.marketingVersion}"`).replace(BUILD, `$1"${info.versionCode}"`);
  if (next !== project) writeFileSync(IOS_PROJECT, next);
  console.log(`iPhone/iPad: MARKETING_VERSION ${info.marketingVersion}, CURRENT_PROJECT_VERSION ${info.versionCode}`);
} else if (command === 'check') {
  const marketing = MARKETING.exec(project)[2];
  const build = BUILD.exec(project)[2];
  if (marketing !== info.marketingVersion || build !== String(info.versionCode)) {
    fail(
      `mobile/ios/App/project.yml tiene ${marketing} (${build}) pero package.json tiene ${version} (${info.versionCode}): ejecuta «node scripts/release/version.mjs sync».`,
    );
  }
  if (values.tag !== undefined && values.tag !== info.tag) fail(`La etiqueta ${values.tag} no coincide con la versión de package.json (${info.tag}).`);
  console.log(JSON.stringify(info));
} else {
  fail('Uso: node scripts/release/version.mjs sync | check [--tag vX.Y.Z]');
}
