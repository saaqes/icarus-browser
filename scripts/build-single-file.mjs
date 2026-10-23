/**
 * Genera dist/icarus-browser.html: ICARUS en un único archivo HTML autocontenido
 * (CSS, JavaScript e icono incrustados). Se puede abrir con doble clic, enviar
 * por correo o subir a cualquier alojamiento estático. Ejecutar después de
 * `vite build` (lo hace `npm run build:single`).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">/);
if (!scriptMatch || !styleMatch) throw new Error('No se encontraron los recursos de dist/index.html; ejecuta vite build primero.');

const js = readFileSync(join(dist, scriptMatch[1]), 'utf8');
const css = readFileSync(join(dist, styleMatch[1]), 'utf8');
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('El paquete contiene etiquetas de cierre que impiden incrustarlo.');

const icon = readFileSync(join(dist, 'icarus.svg')).toString('base64');
const script = `\n${js}\n`;
// La CSP permite exactamente este script en línea mediante su hash.
const hash = createHash('sha256').update(script).digest('base64');

html = html
  .replace(scriptMatch[0], '')
  .replace(styleMatch[0], () => `<style>\n${css}\n</style>`)
  .replace("script-src 'self'", `script-src 'sha256-${hash}'`)
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}" />`)
  .replace('</body>', () => `<script type="module">${script}</script>\n  </body>`);

const out = join(dist, 'icarus-browser.html');
writeFileSync(out, html);
console.log(`Generado ${out} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
