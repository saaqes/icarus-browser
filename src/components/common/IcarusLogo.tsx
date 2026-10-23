/**
 * Identidad de ICARUS: un sol naciente atravesado por un ala de tres plumas.
 * Diseño original; no reproduce marcas de terceros.
 */

import { useId } from 'react';

interface MarkProps {
  size?: number;
  className?: string;
  /** Dibuja el fondo carbón redondeado (icono de aplicación). */
  tile?: boolean;
}

export function IcarusMark({ size = 28, className, tile = false }: MarkProps) {
  const id = useId().replace(/:/g, '');
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
          <stop offset="0" stopColor="#6d28d9" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f5f0ff" />
          <stop offset="1" stopColor="#b9a4ff" />
        </radialGradient>
      </defs>
      {tile && <rect width="64" height="64" rx="16" fill="#16141c" />}
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
