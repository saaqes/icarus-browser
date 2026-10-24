/** Botón de ICARUS Shield: solicitudes bloqueadas en la página y excepción por sitio. */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useNative, useShieldState } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { hostnameOf } from '../../services/format';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { Toggle } from '../common/Controls';
import { useBrowser } from './BrowserContext';

export function ShieldButton() {
  const m = useMessages();
  const t = m.shield.popover;
  const native = useNative();
  const [state, setState] = useShieldState();
  const { liveWebTabId, webState, openSettings } = useBrowser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);

  if (!native) return null;
  const tab = liveWebTabId ? webState[liveWebTabId] : undefined;
  const host = tab ? hostnameOf(tab.url) : '';
  const enabled = state?.enabled ?? true;
  const activeHere = enabled && Boolean(host) && !tab?.shieldAllowed;
  const count = tab && activeHere ? tab.blockedCount : 0;
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
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setOpen(false);
              openSettings('shield');
            }}
          >
            {t.settings}
          </button>
        </div>
      )}
    </div>
  );
}
