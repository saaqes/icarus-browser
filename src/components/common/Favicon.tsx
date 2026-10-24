import { useEffect, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { faviconUrlFor } from '../../services/tabs/pages';
import { getHostname, parseWebUrl } from '../../services/url-resolution/urlUtils';
import { useSettings } from '../../hooks/useStores';
import type { IcarusNativeApi } from '../../types/native';

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

/** Iconos ya pedidos al proceso principal, por origen. */
const nativeCache = new Map<string, Promise<string | null>>();

function nativeFavicon(native: IcarusNativeApi, url: string): Promise<string | null> {
  const origin = parseWebUrl(url)?.origin;
  if (!origin) return Promise.resolve(null);
  let promise = nativeCache.get(origin);
  if (!promise) {
    promise = native.favicons.get(url).catch(() => null);
    nativeCache.set(origin, promise);
  }
  return promise;
}

/**
 * Icono de un sitio. En la versión web se pide `/favicon.ico` al propio sitio;
 * en la aplicación de escritorio lo descarga el proceso principal y llega como
 * data URL, de modo que la interfaz no carga contenido remoto. Si no hay icono
 * (o el usuario lo desactiva) se muestra una inicial.
 */
export function Favicon({ url, size = 16, label, className }: FaviconProps) {
  const [settings] = useSettings();
  const { native } = useServices();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [nativeSrc, setNativeSrc] = useState<string | null>(null);
  const enabled = settings.navigation.loadFavicons;

  useEffect(() => {
    if (!native || !enabled) return undefined;
    let active = true;
    void nativeFavicon(native, url).then((data) => active && setNativeSrc(data));
    return () => {
      active = false;
    };
  }, [enabled, native, url]);

  const src = !enabled ? null : native ? nativeSrc : faviconUrlFor(url);
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
