/**
 * Botón del perfil a la derecha de la barra (como Chrome y Edge): muestra la foto o
 * la inicial y abre un panel con el perfil y el acceso para personalizarlo.
 */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { ProfileAvatar } from './ProfileAvatar';
import './Profile.css';

export function ProfileButton() {
  const m = useMessages();
  const t = m.profile;
  const [settings] = useSettings();
  const { openSettings } = useBrowser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);
  const profile = settings.profile;
  const name = profile.name.trim() || t.defaultName;

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn profile-btn"
        aria-label={t.button(name)}
        title={t.button(name)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="profile-button"
      >
        <ProfileAvatar profile={profile} size={24} />
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover profile-panel" role="dialog" aria-label={t.panelTitle}>
          <div className="profile-panel__head">
            <ProfileAvatar profile={profile} size={56} />
            <div className="profile-panel__who">
              <p className="profile-panel__name">{name}</p>
              <p className="profile-panel__note">{t.local}</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setOpen(false);
              openSettings('profile');
            }}
          >
            <Icon name="edit" size={16} />
            {t.edit}
          </button>
        </div>
      )}
    </div>
  );
}
