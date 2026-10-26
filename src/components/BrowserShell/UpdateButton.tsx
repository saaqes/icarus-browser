/**
 * Aviso discreto de actualización: una píldora en la barra que solo aparece cuando
 * hay una versión nueva que el usuario no ha pospuesto. No interrumpe la
 * navegación; al pulsarla se muestran las acciones. Tras actualizar, confirma la
 * versión que se está ejecutando.
 */

import { useEffect, useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useUpdateState } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useToast } from '../common/Toast';
import { shouldShowUpdateButton, UpdateButtons, UpdateStatus, useUpdateActions } from '../Updates/UpdateControls';
import { useBrowser } from './BrowserContext';

export function UpdateButton() {
  const m = useMessages();
  const t = m.updates;
  const state = useUpdateState();
  const actions = useUpdateActions();
  const notify = useToast();
  const { openSettings } = useBrowser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  const visible = shouldShowUpdateButton(state);
  useOverlayLayer(open && visible);

  const updatedTo = state?.justUpdated?.to ?? null;
  useEffect(() => {
    if (updatedTo) notify('success', t.justUpdatedToast(updatedTo));
  }, [notify, t, updatedTo]);

  if (!state || !actions || !visible) return null;
  const available = state.available!;
  const progress = state.status === 'downloading' && state.progress && state.progress.total > 0 ? Math.floor((state.progress.received / state.progress.total) * 100) : null;

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className="update-btn"
        aria-label={t.button(available.version)}
        title={t.button(available.version)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="upgrade" size={16} />
        {progress !== null ? <span className="update-btn__progress">{progress} %</span> : t.buttonLabel}
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover toolbar-popover--wide update-popover" role="dialog" aria-label={t.popoverTitle(available.version)}>
          <h2 className="toolbar-popover__title">
            <Icon name="upgrade" size={18} />
            {t.popoverTitle(available.version)}
          </h2>
          <UpdateStatus state={state} />
          {available.notes.trim() && state.status === 'available' && <div className="update-notes">{available.notes.trim()}</div>}
          <UpdateButtons state={state} actions={actions} compact />
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setOpen(false);
              openSettings('updates');
            }}
          >
            {t.details}
          </button>
        </div>
      )}
    </div>
  );
}
