/**
 * ICARUS Shield en la barra: solicitudes bloqueadas en la página y excepción por
 * sitio. En Esencial e ICARUS tiene su propio botón; en Panorama (Edge) está dentro
 * del botón «Extensiones», como una extensión integrada.
 */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useNative, useShieldState } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { hostnameOf } from '../../services/format';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { Toggle } from '../common/Controls';
import { useBrowser } from './BrowserContext';

/** Estado de Shield en la página visible. */
function useShieldPage() {
  const [state] = useShieldState();
  const { liveWebTabId, webState } = useBrowser();
  const tab = liveWebTabId ? webState[liveWebTabId] : undefined;
  const host = tab ? hostnameOf(tab.url) : '';
  const enabled = state?.enabled ?? true;
  const activeHere = enabled && Boolean(host) && !tab?.shieldAllowed;
  return { host, activeHere, count: tab && activeHere ? tab.blockedCount : 0 };
}

/** Contenido del panel de Shield (recuento, excepción del sitio y total). */
function ShieldControls({ onOpenSettings }: { onOpenSettings: () => void }) {
  const m = useMessages();
  const t = m.shield.popover;
  const native = useNative();
  const [state, setState] = useShieldState();
  const { liveWebTabId, webState } = useBrowser();
  const { host, count } = useShieldPage();
  const tab = liveWebTabId ? webState[liveWebTabId] : undefined;
  if (!native) return null;
  const enabled = state?.enabled ?? true;
  return (
    <>
      {!enabled ? (
        <p className="field-hint">{t.disabledGlobally}</p>
      ) : host ? (
        <>
          <p className="shield-popover__count">
            <strong>{count}</strong> {t.blockedOnPage}
          </p>
          <Toggle
            label={t.activeOn(host)}
            description={tab?.shieldAllowed ? t.allowedHint : t.activeHint}
            checked={!tab?.shieldAllowed}
            onChange={(active) => {
              void native.shield.setSiteAllowed(host, !active).then((next) => {
                setState(next);
                if (liveWebTabId) native.tabs.reload(liveWebTabId);
              });
            }}
          />
        </>
      ) : (
        <p className="field-hint">{t.noPage}</p>
      )}
      <p className="field-hint">{t.total(state?.totalBlocked ?? 0)}</p>
      <button type="button" className="link-btn" onClick={onOpenSettings}>
        {t.settings}
      </button>
    </>
  );
}

/** Ventana emergente de la barra con su botón (Shield o Extensiones). */
function usePopover() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);
  return { open, setOpen, buttonRef, panelRef };
}

export function ShieldButton() {
  const m = useMessages();
  const native = useNative();
  const { openSettings } = useBrowser();
  const { host, activeHere, count } = useShieldPage();
  const { open, setOpen, buttonRef, panelRef } = usePopover();
  if (!native) return null;
  const label = activeHere ? m.shield.buttonLabel(count) : m.shield.buttonLabelOff;

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn shield-btn${activeHere ? ' is-active' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={activeHere || !host ? 'shield' : 'shieldOff'} />
        {count > 0 && <span className="toolbar-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover" role="dialog" aria-label={m.shield.name}>
          <h2 className="toolbar-popover__title">
            <Icon name="shield" size={18} />
            {m.shield.name}
          </h2>
          <ShieldControls
            onOpenSettings={() => {
              setOpen(false);
              openSettings('shield');
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Botón «Extensiones» de Panorama (pieza de puzle, como en Edge). ICARUS no instala
 * extensiones de otras tiendas: el panel muestra Shield, la extensión integrada, con
 * sus controles reales. El número de bloqueos de la página aparece sobre el icono.
 */
export function ExtensionsButton() {
  const m = useMessages();
  const native = useNative();
  const { openSettings } = useBrowser();
  const { activeHere, count } = useShieldPage();
  const { open, setOpen, buttonRef, panelRef } = usePopover();
  if (!native) return null;
  const shieldLabel = activeHere ? m.shield.buttonLabel(count) : m.shield.buttonLabelOff;
  const label = `${m.toolbar.extensions} · ${shieldLabel}`;

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn extensions-btn${activeHere ? ' is-active' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="extensions-button"
      >
        <Icon name="puzzle" />
        {count > 0 && <span className="toolbar-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover extensions-panel" role="dialog" aria-label={m.extensions.title}>
          <h2 className="toolbar-popover__title">
            <Icon name="puzzle" size={18} />
            {m.extensions.title}
          </h2>
          <section className="extensions-panel__item" aria-label={m.shield.name}>
            <h3 className="extensions-panel__name">
              <Icon name={activeHere ? 'shield' : 'shieldOff'} size={18} />
              <span>
                {m.shield.name}
                <small>{m.extensions.builtIn}</small>
              </span>
            </h3>
            <ShieldControls
              onOpenSettings={() => {
                setOpen(false);
                openSettings('shield');
              }}
            />
          </section>
          <p className="field-hint">{m.extensions.note}</p>
        </div>
      )}
    </div>
  );
}
