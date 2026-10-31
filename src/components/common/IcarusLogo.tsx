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
  /** Fondo cuadrado redondeado (ICARUS) o redondo (Esencial y Panorama). */
  shape: 'square' | 'circle';
  wing: [string, string];
  /** Un color por pluma (de la mayor a la menor) en lugar del degradado del ala. */
  feathers?: [string, string, string];
  sun: [string, string];
  /** Color o degradado (de abajo a la izquierda a arriba a la derecha). */
  tile: string | string[];
  border?: string;
}

/** Los mismos diseños que los iconos de la aplicación de cada estilo (build/icons). */
const PALETTES: Record<ThemeId, Palette> = {
  icarus: { shape: 'square', wing: ['#6d28d9', '#c4b5fd'], sun: ['#f5f0ff', '#b9a4ff'], tile: '#16141c' },
  'google-inspired': {
    shape: 'circle',
    wing: ['#34a853', '#34a853'],
    feathers: ['#34a853', '#fbbc04', '#ea4335'],
    sun: ['#4285f4', '#4285f4'],
    tile: '#ffffff',
    border: '#dadce0',
  },
  'edge-inspired': { shape: 'circle', wing: ['#d9f1ff', '#ffffff'], sun: ['#ffffff', '#c8f5d6'], tile: ['#0c59a4', '#1b9de2', '#2fc4c4', '#5ed66e'] },
};

const FEATHERS = [
  'M10 48c11-1.5 23.5-8.5 34-21-4.6 12.6-15.4 21.5-31 24.5Z',
  'M12.5 39.5c8.6-1.4 17.4-6.3 24.4-14.4-3.6 9.2-11.4 15.7-22.8 18Z',
  'M16 31.5c6-1.1 11.2-4.2 15.5-9-2.2 6-7 10.2-14.2 11.8Z',
];

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
          <linearGradient id={`${id}-tile`} x1="0.1" y1="0.95" x2="0.95" y2="0.1">
            {palette.tile.map((color, index, all) => (
              <stop key={color} offset={index / (all.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        )}
      </defs>
      {tile &&
        (palette.shape === 'circle' ? (
          <circle cx="32" cy="32" r="31" fill={Array.isArray(palette.tile) ? `url(#${id}-tile)` : palette.tile} />
        ) : (
          <rect width="64" height="64" rx="16" fill={Array.isArray(palette.tile) ? `url(#${id}-tile)` : palette.tile} />
        ))}
      {tile && palette.border && <circle cx="32" cy="32" r="30.25" fill="none" stroke={palette.border} strokeWidth="1.5" />}
      <circle cx="41" cy="22" r="9" fill={`url(#${id}-sun)`} />
      {FEATHERS.map((d, index) => (
        <path
          key={d}
          d={d}
          fill={palette.feathers ? palette.feathers[index] : `url(#${id}-wing)`}
          opacity={palette.feathers ? undefined : [1, 0.8, 0.6][index]}
        />
      ))}
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
