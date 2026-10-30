/**
 * Iconos de trazo propios de ICARUS (rejilla 24×24, trazo de 1,8 px).
 * Se dibujan con `currentColor` para heredar el color del tema.
 */

import type { ReactNode } from 'react';

const ICONS = {
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  forward: <path d="M5 12h14m-6-6 6 6-6 6" />,
  reload: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <path d="M19.38 10.17 21.84 10.24 21.84 13.76 19.38 13.83 18.51 15.92 20.2 17.72 17.72 20.2 15.92 18.51 13.83 19.38 13.76 21.84 10.24 21.84 10.17 19.38 8.08 18.51 6.28 20.2 3.8 17.72 5.49 15.92 4.62 13.83 2.16 13.76 2.16 10.24 4.62 10.17 5.49 8.08 3.8 6.28 6.28 3.8 8.08 5.49 10.17 4.62 10.24 2.16 13.76 2.16 13.83 4.62 15.92 5.49 17.72 3.8 20.2 6.28 18.51 8.08Z" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  home: <path d="M4 11.5 12 5l8 6.5M6.5 9.8V19h4v-5h3v5h4V9.8" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.1" fill="currentColor" />
    </>
  ),
  /** «…» horizontal, el menú principal de Edge. */
  moreHorizontal: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
    </>
  ),
  /** Silueta del perfil sin foto ni nombre. */
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 19.5c.9-3.4 3.7-5.4 7-5.4s6.1 2 7 5.4" />
    </>
  ),
  /** Extensiones (pieza de puzle, como en Edge y Chrome). */
  puzzle: (
    <path d="M9 4.5a2 2 0 0 1 4 0V6h3.5a1.5 1.5 0 0 1 1.5 1.5V11h-1.5a2 2 0 0 0 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 0 0-4 0V20H5.5A1.5 1.5 0 0 1 4 18.5V15h1.5a2 2 0 0 0 0-4H4V7.5A1.5 1.5 0 0 1 5.5 6H9Z" />
  ),
  /** Añadir a la página Nueva pestaña (tres cuadros y un «+», como el de aplicaciones de Edge). */
  appsAdd: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <path d="M16.75 4v6.5M13.5 7.25H20" />
    </>
  ),
  /** Igual, ya añadido. */
  appsAdded: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <path d="m13.6 7.3 2.1 2.1 4-4.2" />
    </>
  ),
  /** Modo lectura (página con líneas de texto, como el lector inmersivo de Edge). */
  reader: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.8" r="3.3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm10-12 3 3" />,
  trash: <path d="M5 7h14M10 7V5h4v2m-7 0 .8 12h8.4L17 7M10.5 11v5m3-5v5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </>
  ),
  star: <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8L12 3.8Z" />,
  starFilled: <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8L12 3.8Z" fill="currentColor" />,
  bookmarks: (
    <>
      <path d="M8.5 4.2l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6 1.8-3.6Z" />
      <path d="M15.5 13.5H21M13 17h8M13 20.5h8" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5M8.3 11h5.4M11 8.3v5.4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5M8.3 11h5.4" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  external: <path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  brush: <path d="M15 4.5 19.5 9 11 17.5 6.5 13 15 4.5ZM6.5 13c-2 0-3 1.5-3 3.2 0 1.6-.6 2.6-1.5 3.3 3.2.6 6.9-.4 7.7-3.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  monitor: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  grip: (
    <>
      <circle cx="9" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="17" r="1" fill="currentColor" />
      <circle cx="15" cy="17" r="1" fill="currentColor" />
    </>
  ),
  upload: <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />,
  download: <path d="M12 4v12m-5-5 5 5 5-5M5 20h14" />,
  upgrade: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 16.5v-9M8.5 11 12 7.5l3.5 3.5" />
    </>
  ),
  restore: (
    <>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v5h5" />
    </>
  ),
  warning: <path d="M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.6v.1" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  note: <path d="M6 4h9l4 4v12H6V4Zm9 0v4h4M9 12h6M9 16h4" />,
  tasks: <path d="m4.5 7 1.5 1.5L9 5.5M4.5 13l1.5 1.5L9 11.5M4.5 19l1.5 1.5L9 17.5M12.5 7h7M12.5 13h7M12.5 19h7" />,
  feed: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="2" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </>
  ),
  layout: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 10v10" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  page: <path d="M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4" />,
  sparkle: <path d="M12 3.5c.8 4.2 2.3 5.7 6.5 6.5-4.2.8-5.7 2.3-6.5 6.5-.8-4.2-2.3-5.7-6.5-6.5 4.2-.8 5.7-2.3 6.5-6.5ZM18.5 15.5c.4 1.7 1 2.3 2.5 2.6-1.5.3-2.1.9-2.5 2.6-.4-1.7-1-2.3-2.5-2.6 1.5-.3 2.1-.9 2.5-2.6Z" />,
  keyboard: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
    </>
  ),
  shield: <path d="M12 3.5 5 6.3v5.2c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6.3L12 3.5Z" />,
  shieldOff: (
    <>
      <path d="M12 3.5 5 6.3v5.2c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6.3L12 3.5Z" />
      <path d="m4 4 16 16" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 1.8" />
    </>
  ),
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9M4 12h13m3 0h0" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
      <circle cx="18.5" cy="12" r="1.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
      <path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
