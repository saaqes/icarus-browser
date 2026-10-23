/** Utilidades de color para decidir el contraste del texto sobre fondos de color. */

export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tono del fondo: "dark" si el texto blanco contrasta mejor que el negro. */
export function toneForColor(hex: string): 'light' | 'dark' {
  const luminance = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? 'dark' : 'light';
}

export const BACKGROUND_SWATCHES = ['#f4f1ea', '#e8eef9', '#e9f4ee', '#f8e8ee', '#1e2230', '#13231f', '#2a1838', '#3a2a1c'] as const;
