import { useState } from 'react';
import { faviconUrlFor } from '../../services/tabs/pages';
import { getHostname } from '../../services/url-resolution/urlUtils';
import { useSettings } from '../../hooks/useStores';

interface FaviconProps {
  url: string;
  size?: number;
  label?: string;
  className?: string;
}

function monogramColor(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 52% 46%)`;
}

/**
 * Icono de un sitio. Se pide `/favicon.ico` al propio sitio (sin servicios de
 * terceros) y, si no existe o el usuario lo desactiva, se muestra una inicial.
 */
export function Favicon({ url, size = 16, label, className }: FaviconProps) {
  const [settings] = useSettings();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = settings.navigation.loadFavicons ? faviconUrlFor(url) : null;
  const host = getHostname(url)?.replace(/^www\./, '') ?? url;
  const letter = (label?.trim() || host).charAt(0).toUpperCase() || '?';
  const style = { width: size, height: size };

  if (!src || failedSrc === src) {
    return (
      <span
        className={`favicon favicon--letter${className ? ` ${className}` : ''}`}
        style={{ ...style, background: monogramColor(host), fontSize: Math.round(size * 0.58) }}
        aria-hidden="true"
      >
        {letter}
      </span>
    );
  }
  return (
    <img
      className={`favicon${className ? ` ${className}` : ''}`}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
}
