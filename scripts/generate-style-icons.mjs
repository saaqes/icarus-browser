/**
 * Iconos de la aplicación para cada estilo, a partir de build/icons/<estilo>.svg (diseños
 * propios de ICARUS: el mismo logotipo con los colores de cada estilo; ninguno usa
 * logotipos ni recursos de otros navegadores). Genera:
 *
 * - build/icons/<estilo>.png (512 px) y <estilo>.ico (16–256 px): ventana, Dock y accesos
 *   directos de Windows (electron-builder los copia a resources/icons);
 * - mobile/ios/App/Resources/Assets.xcassets/AppIcon-<Estilo>.appiconset: iconos
 *   alternativos de iPhone (1024 px, a sangre y sin transparencia, como exige Apple).
 *
 * Android usa los vectores de res/drawable/ic_launcher_<estilo>_foreground.xml.
 * Uso: node scripts/generate-style-icons.mjs (Chromium de Playwright e ImageMagick).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const projectDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const iconsDir = join(projectDir, 'build', 'icons');
const assetsDir = join(projectDir, 'mobile', 'ios', 'App', 'Resources', 'Assets.xcassets');

/** Estilo → nombre del icono alternativo de iPhone (ICARUS usa el principal, AppIcon). */
const STYLES = { icarus: null, esencial: 'AppIcon-Esencial', panorama: 'AppIcon-Panorama' };
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICO con las imágenes en PNG (Windows Vista y posteriores). */
function buildIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

/** iPhone recorta las esquinas: el fondo llega al borde y sin el contorno decorativo. */
function fullBleed(svg) {
  return svg.replace(/<rect x="0\.75"[^>]*\/>\s*/, '').replace('rx="16"', 'rx="0"');
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${source}" width="${size}" height="${size}">`);
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const scratch = join(tmpdir(), `icarus-icons-${process.pid}`);
mkdirSync(scratch, { recursive: true });
try {
  for (const [style, iosName] of Object.entries(STYLES)) {
    const svg = readFileSync(join(iconsDir, `${style}.svg`), 'utf8');
    writeFileSync(join(iconsDir, `${style}.png`), await render(svg, 512));
    const images = [];
    for (const size of ICO_SIZES) images.push({ size, png: await render(svg, size) });
    writeFileSync(join(iconsDir, `${style}.ico`), buildIco(images));
    if (iosName) {
      const set = join(assetsDir, `${iosName}.appiconset`);
      mkdirSync(set, { recursive: true });
      const raw = join(scratch, `${style}-1024.png`);
      writeFileSync(raw, await render(fullBleed(svg), 1024));
      // Sin canal alfa: App Store rechaza los iconos con transparencia.
      execFileSync('convert', [raw, '-background', '#ffffff', '-alpha', 'remove', '-alpha', 'off', join(set, `${iosName}.png`)]);
      writeFileSync(
        join(set, 'Contents.json'),
        `${JSON.stringify({ images: [{ filename: `${iosName}.png`, idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
      );
    }
    console.log(`${style}: ${style}.png, ${style}.ico${iosName ? ` y ${iosName}` : ''}`);
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
