/**
 * Identidad de ICARUS: un sol naciente atravesado por un ala de tres plumas.
 * Diseño original; no reproduce marcas de terceros.
 */

import { useId } from 'react';
import type { ThemeId } from '../../types/settings';

interface MarkProps {
  size?: number;
  className?: string;
  /** Dibuja el fondo redondeado (icono de aplicación). */
  tile?: boolean;
  /** Variante del icono de aplicación de cada estilo (build/icons/*.svg); por defecto, la de ICARUS. */
  variant?: ThemeId;
}

interface Palette {
  wing: [string, string];
  sun: [string, string];
  tile: string | [string, string];
  border?: string;
}

/** Los mismos colores que los iconos de la aplicación de cada estilo (build/icons). */
const PALETTES: Record<ThemeId, Palette> = {
  icarus: { wing: ['#6d28d9', '#c4b5fd'], sun: ['#f5f0ff', '#b9a4ff'], tile: '#16141c' },
  'google-inspired': { wing: ['#1f63d1', '#86aef5'], sun: ['#fff4d6', '#f3b552'], tile: '#ffffff', border: '#d6dde9' },
  'edge-inspired': { wing: ['#d7f1ff', '#ffffff'], sun: ['#ffffff', '#9fd8ff'], tile: ['#0b63c4', '#0f7a80'] },
};

export function IcarusMark({ size = 28, className, tile = false, variant = 'icarus' }: MarkProps) {
  const id = useId().replace(/:/g, '');
  const palette = PALETTES[tile ? variant : 'icarus'];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="ICARUS"
    >
      <defs>
        <linearGradient id={`${id}-wing`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={palette.wing[0]} />
          <stop offset="1" stopColor={palette.wing[1]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={palette.sun[0]} />
          <stop offset="1" stopColor={palette.sun[1]} />
        </radialGradient>
        {Array.isArray(palette.tile) && (
          <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={palette.tile[0]} />
            <stop offset="1" stopColor={palette.tile[1]} />
          </linearGradient>
        )}
      </defs>
      {tile && <rect width="64" height="64" rx="16" fill={Array.isArray(palette.tile) ? `url(#${id}-tile)` : palette.tile} />}
      {tile && palette.border && <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" fill="none" stroke={palette.border} strokeWidth="1.5" />}
      <circle cx="41" cy="22" r="9" fill={`url(#${id}-sun)`} />
      <path d="M10 48c11-1.5 23.5-8.5 34-21-4.6 12.6-15.4 21.5-31 24.5Z" fill={`url(#${id}-wing)`} />
      <path d="M12.5 39.5c8.6-1.4 17.4-6.3 24.4-14.4-3.6 9.2-11.4 15.7-22.8 18Z" fill={`url(#${id}-wing)`} opacity="0.8" />
      <path d="M16 31.5c6-1.1 11.2-4.2 15.5-9-2.2 6-7 10.2-14.2 11.8Z" fill={`url(#${id}-wing)`} opacity="0.6" />
    </svg>
  );
}

export function IcarusWordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'} aria-label="ICARUS">
      <span aria-hidden="true">ICARUS</span>
    </span>
  );
}
