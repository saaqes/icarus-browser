/**
 * Secciones de una dirección personalizada: partes de un sitio identificadas por el
 * fragmento (`#inicio`, `#catalogo`, `#/usuarios/10`).
 *
 * Una entrada con secciones solo se aplica cuando la sección de la página es una de
 * las suyas, y entonces gana a la entrada general del mismo destino. Así un sitio
 * puede mostrarse como `miweb.com` en `#inicio` y `#catalogo`, y como `otraweb.com`
 * en `#home` y `#usuario`, en cualquier pestaña.
 *
 * La sección es el primer tramo del fragmento, sin `#`, `!` ni `/` iniciales y en
 * minúsculas: `#Home`, `#/home`, `#!/home/2` y `#home?tab=1` son la sección `home`.
 *
 * Funciones puras compartidas con Android e iPhone mediante los vectores de
 * mobile/shared/test-vectors/.
 */

export const MAX_SECTIONS = 20;

/** Letras y números de cualquier idioma, `_`, `.`, `~` y `-`. */
const SECTION_NAME = /^[\p{L}\p{N}_.~-]{1,60}$/u;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function sectionName(token: string): string {
  return decode(token.replace(/^#/, '').replace(/^[!/]+/, '')).toLowerCase();
}

/** Sección de un fragmento (`url.hash`, con o sin `#`), o null si no tiene ninguna. */
export function sectionOf(hash: string): string | null {
  const head = hash.replace(/^#/, '').replace(/^[!/]+/, '').split(/[/?&=]/, 1)[0] ?? '';
  const name = sectionName(head);
  return SECTION_NAME.test(name) ? name : null;
}

export type SectionsError = 'invalid-section' | 'too-many-sections';
export type SectionsResult = { ok: true; sections: string[] } | { ok: false; error: SectionsError };

/** Lee las secciones como las escribe el usuario: `#home, #usuario`, `home usuario`… */
export function parseSections(text: string): SectionsResult {
  const sections: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token.replace(/^#/, '').replace(/^[!/]+/, '')) continue;
    const name = sectionName(token);
    if (!SECTION_NAME.test(name)) return { ok: false, error: 'invalid-section' };
    if (!sections.includes(name)) sections.push(name);
  }
  return sections.length > MAX_SECTIONS ? { ok: false, error: 'too-many-sections' } : { ok: true, sections };
}

/** Texto para el editor y los mensajes: `#home, #usuario`. */
export function formatSections(sections: readonly string[] | undefined): string {
  return (sections ?? []).map((name) => `#${name}`).join(', ');
}

/** ¿Tienen alguna sección en común? */
export function sectionsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((name) => b.includes(name));
}
