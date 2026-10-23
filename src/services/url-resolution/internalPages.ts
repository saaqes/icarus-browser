/**
 * Páginas internas de ICARUS (`icarus://`). Son vistas de la propia aplicación,
 * equivalentes a las páginas internas de otros navegadores.
 */

import { SETTINGS_SECTIONS, type PageEntry, type SettingsSection } from '../../types/tabs';

export const INTERNAL_PROTOCOL = 'icarus:';

const SECTION_SLUGS: Record<SettingsSection, string> = {
  general: 'general',
  appearance: 'apariencia',
  navigation: 'navegacion',
  advanced: 'avanzado',
  about: 'acerca-de',
};

const NEW_TAB_URL = 'icarus://nueva-pestana';
const BLANK_URL = 'icarus://en-blanco';

export function internalUrlForPage(page: PageEntry): string | null {
  switch (page.kind) {
    case 'newtab':
      return NEW_TAB_URL;
    case 'blank':
      return BLANK_URL;
    case 'settings':
      return `icarus://configuracion/${SECTION_SLUGS[page.section]}`;
    case 'external':
      return null;
  }
}

/** Convierte `icarus://…` en una página interna. Devuelve null si no existe. */
export function parseInternalUrl(text: string): PageEntry | null {
  const match = /^icarus:\/\/([^?#]*)/i.exec(text.trim());
  if (!match) return null;
  const parts = (match[1] ?? '').toLowerCase().split('/').filter(Boolean);
  const [root, sub] = parts;
  if (parts.length === 0 || root === 'inicio' || root === 'nueva-pestana') {
    return parts.length <= 1 ? { kind: 'newtab' } : null;
  }
  if (root === 'en-blanco') return parts.length === 1 ? { kind: 'blank' } : null;
  if (root === 'configuracion') {
    if (parts.length === 1) return { kind: 'settings', section: 'general' };
    const section = SETTINGS_SECTIONS.find((id) => SECTION_SLUGS[id] === sub);
    return section && parts.length === 2 ? { kind: 'settings', section } : null;
  }
  return null;
}
