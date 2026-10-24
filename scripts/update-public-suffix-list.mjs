/**
 * Descarga la Public Suffix List y genera electron/shield/publicSuffixList.ts.
 *
 * La lista se incluye en el ejecutable (no se descarga al usar ICARUS). Las
 * reglas se guardan en ASCII (punycode), como llegan los nombres de host en
 * las URL, y se conservan las secciones ICANN y PRIVATE.
 *
 * Uso: node scripts/update-public-suffix-list.mjs [url]
 * Por defecto usa https://publicsuffix.org/list/public_suffix_list.dat. Se
 * puede pasar otra URL del mismo proyecto (p. ej. su repositorio oficial en
 * GitHub) si publicsuffix.org no es accesible.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { domainToASCII, fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const source = process.argv[2] ?? DEFAULT_URL;
const output = fileURLToPath(new URL('../electron/shield/publicSuffixList.ts', import.meta.url));

const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error(`No se pudo descargar la lista (${response.status}) desde ${source}`);
const text = await response.text();
if (!text.includes('===BEGIN ICANN DOMAINS===') || !text.includes('===BEGIN PRIVATE DOMAINS===')) {
  throw new Error('El archivo descargado no parece la Public Suffix List');
}

/** Convierte una regla a ASCII conservando los prefijos «*.» y «!». */
function toAscii(rule) {
  const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : '';
  const domain = rule.slice(prefix.length);
  const ascii = domainToASCII(domain);
  if (!ascii) throw new Error(`Regla no válida en la lista: ${rule}`);
  return prefix + ascii;
}

const rules = [];
for (const line of text.split('\n')) {
  // Cada regla es la primera palabra de la línea; se ignoran comentarios y líneas vacías.
  const rule = line.trim().split(/\s/)[0];
  if (!rule || rule.startsWith('//')) continue;
  rules.push(toAscii(rule.toLowerCase()));
}
const unique = [...new Set(rules)];
if (unique.length < 5000) throw new Error(`La lista solo tiene ${unique.length} reglas; se esperaban más de 5000`);

const sha256 = createHash('sha256').update(text).digest('hex');
const module = `/**
 * Public Suffix List (https://publicsuffix.org/), incluida en ICARUS para
 * calcular el dominio registrable (eTLD+1) en ICARUS Shield.
 *
 * Archivo generado por scripts/update-public-suffix-list.mjs: no lo edites a mano.
 * Fuente: ${source}
 * Descargada: ${new Date().toISOString()}
 * SHA-256 del archivo original: ${sha256}
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export const PUBLIC_SUFFIX_RULE_COUNT = ${unique.length};

/** Reglas en ASCII separadas por saltos de línea (normales, «*.» comodín y «!» excepción). */
export const PUBLIC_SUFFIX_RULES = ${JSON.stringify(unique.join('\n'))};
`;
writeFileSync(output, module);
console.log(`Public Suffix List: ${unique.length} reglas → ${output}`);
