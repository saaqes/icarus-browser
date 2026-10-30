/**
 * Modo lectura: extrae solo el texto principal de la página (títulos, párrafos,
 * listas, citas y código) para mostrarlo en la interfaz de ICARUS sin anuncios ni
 * scripts, como el lector inmersivo de Edge.
 *
 * El guion se ejecuta en un mundo aislado de la página (no comparte variables con
 * sus scripts) y devuelve únicamente texto. La interfaz lo pinta como texto, nunca
 * como HTML, así que la página no puede inyectar nada en ICARUS por esta vía.
 */

import type { ReaderContent } from '../../src/types/native';
import { isRecord } from './validate';

/** Mundo aislado propio de ICARUS (distinto del 0 de la página y del 999 de Electron). */
export const READER_WORLD_ID = 1717;
export const READER_TIMEOUT_MS = 5000;

const MAX_BLOCKS = 1500;
const MAX_BLOCK_CHARS = 20_000;
const MAX_TOTAL_CHARS = 400_000;

export const READER_BLOCK_TYPES = ['heading', 'paragraph', 'item', 'quote', 'code'] as const satisfies readonly ReaderBlockType[];
type ReaderBlockType = ReaderContent['blocks'][number]['type'];

/** Guion de extracción (solo lee el DOM y devuelve datos simples). */
export const READER_SCRIPT = `(() => {
  const textOf = (el) => (el.innerText || '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  const score = (el) => {
    let total = 0;
    for (const p of el.querySelectorAll('p')) total += textOf(p).length;
    return total;
  };
  let root = null;
  let best = 0;
  for (const el of document.querySelectorAll('article, main, [role="main"]')) {
    const value = score(el);
    if (value > best) { best = value; root = el; }
  }
  if (!root || best < 200) {
    const parents = new Map();
    for (const p of document.querySelectorAll('p')) {
      const length = textOf(p).length;
      if (length < 30 || !p.parentElement) continue;
      parents.set(p.parentElement, (parents.get(p.parentElement) || 0) + length);
    }
    for (const [el, value] of parents) if (value > best) { best = value; root = el; }
  }
  root = root || document.body;
  const blocks = [];
  let total = 0;
  if (root) {
    for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre')) {
      const outside = el.closest('nav, aside, footer, form, [aria-hidden="true"], [hidden]');
      if (outside && outside !== root && root.contains(outside)) continue;
      if (el.parentElement && el.parentElement.closest('p, li, blockquote, pre') && root.contains(el.parentElement.closest('p, li, blockquote, pre'))) continue;
      const text = textOf(el);
      if (!text) continue;
      const tag = el.tagName;
      const type = /^H[1-6]$/.test(tag) ? 'heading' : tag === 'LI' ? 'item' : tag === 'BLOCKQUOTE' ? 'quote' : tag === 'PRE' ? 'code' : 'paragraph';
      blocks.push({ type, level: type === 'heading' ? Number(tag[1]) : 0, text });
      total += text.length;
      if (blocks.length >= ${MAX_BLOCKS} || total > ${MAX_TOTAL_CHARS}) break;
    }
  }
  const meta = (name) => {
    const el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? String(el.getAttribute('content') || '') : '';
  };
  return { title: meta('og:title') || document.title || '', siteName: meta('og:site_name'), byline: meta('author'), blocks };
})()`;

const cleanLine = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Comprueba y limita lo que devuelve la página: solo texto y tipos conocidos. */
export function sanitizeReaderContent(raw: unknown): ReaderContent | null {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return null;
  const blocks: ReaderContent['blocks'] = [];
  let total = 0;
  for (const block of raw.blocks.slice(0, MAX_BLOCKS)) {
    if (!isRecord(block) || typeof block.text !== 'string') continue;
    const type = (READER_BLOCK_TYPES as readonly unknown[]).includes(block.type) ? (block.type as ReaderBlockType) : null;
    if (!type) continue;
    const text = (type === 'code' ? block.text : block.text.replace(/[ \t]+/g, ' ')).trim().slice(0, MAX_BLOCK_CHARS);
    if (!text) continue;
    const level = type === 'heading' && typeof block.level === 'number' ? Math.min(6, Math.max(1, Math.round(block.level))) : 0;
    blocks.push({ type, level, text });
    total += text.length;
    if (total > MAX_TOTAL_CHARS) break;
  }
  return { title: cleanLine(raw.title, 300), siteName: cleanLine(raw.siteName, 120), byline: cleanLine(raw.byline, 200), blocks };
}
