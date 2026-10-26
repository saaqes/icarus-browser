/**
 * Zoom real de la página (el de Chromium, por sitio y guardado), como en Chrome y
 * Edge: indicador en la barra de direcciones cuando no es 100 % y fila «Zoom» en el
 * menú. Solo en la aplicación de escritorio (la versión web no controla la página).
 */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useMessages } from '../../i18n';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useBrowser } from './BrowserContext';

/** Porcentaje de zoom de la página web activa, o null si no hay una cargada en la pestaña. */
export function useActiveZoom(): number | null {
  const { liveWebTabId, webState } = useBrowser();
  if (!liveWebTabId) return null;
  return webState[liveWebTabId]?.zoom ?? 100;
}

/** − 110 % + y «Restablecer». */
export function ZoomStepper({ zoom, showReset = true, inMenu = false }: { zoom: number; showReset?: boolean; inMenu?: boolean }) {
  const m = useMessages();
  const { zoomPage } = useBrowser();
  // Dentro del menú principal, los botones participan en la navegación con flechas.
  const role = inMenu ? 'menuitem' : undefined;
  return (
    <div className="zoom-stepper" role="group" aria-label={m.zoom.label}>
      <button type="button" role={role} className="icon-btn icon-btn--sm" onClick={() => zoomPage('out')} disabled={zoom <= 25} aria-label={m.zoom.zoomOut} title={m.zoom.zoomOut}>
        <Icon name="minus" size={16} />
      </button>
      <output className="zoom-stepper__value" aria-live="polite" data-testid="zoom-value">
        {m.zoom.value(zoom)}
      </output>
      <button type="button" role={role} className="icon-btn icon-btn--sm" onClick={() => zoomPage('in')} disabled={zoom >= 500} aria-label={m.zoom.zoomIn} title={m.zoom.zoomIn}>
        <Icon name="plus" size={16} />
      </button>
      {showReset && (
        <button type="button" role={role} className="btn btn--ghost btn--sm" onClick={() => zoomPage('reset')} disabled={zoom === 100}>
          {m.zoom.reset}
        </button>
      )}
    </div>
  );
}

/** Fila «Zoom» del menú principal. */
export function ZoomMenuRow({ zoom }: { zoom: number }) {
  const m = useMessages();
  return (
    <div className="zoom-row">
      <Icon name="zoomIn" size={16} />
      <span className="zoom-row__label">{m.zoom.label}</span>
      <ZoomStepper zoom={zoom} showReset={false} inMenu />
    </div>
  );
}

/** Lupa en la barra de direcciones cuando la página no está al 100 %. */
export function ZoomIndicator() {
  const m = useMessages();
  const zoom = useActiveZoom();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);
  if (zoom === null || (zoom === 100 && !open)) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn icon-btn--sm omnibox__action"
        aria-label={m.zoom.indicator(zoom)}
        title={m.zoom.indicator(zoom)}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        data-testid="zoom-indicator"
      >
        <Icon name={zoom > 100 ? 'zoomIn' : 'zoomOut'} size={16} />
      </button>
      {open && (
        <div ref={panelRef} className="omnibox-popover" role="dialog" aria-label={m.zoom.label}>
          <p className="omnibox-popover__title">{m.zoom.indicator(zoom)}</p>
          <ZoomStepper zoom={zoom} />
          <p className="omnibox-popover__hint">{m.zoom.perSite}</p>
        </div>
      )}
    </>
  );
}
