import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useOverlayRoot } from '../common/OverlayRoot';
import {
  AccentControl,
  BackgroundControl,
  ColorModeControl,
  LayoutControl,
  ResetThemeControl,
  ThemePicker,
  VisibilityControl,
} from './AppearanceControls';

/** Panel lateral «Personalizar»: los cambios se aplican y guardan al instante. */
export function CustomizeDrawer() {
  const m = useMessages();
  const [settings] = useSettings();
  const container = useOverlayRoot();
  const { customizeOpen, setCustomizeOpen, openSettings } = useBrowser();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setCustomizeOpen(false), [setCustomizeOpen]);
  useOverlayLayer(customizeOpen);

  useEffect(() => {
    if (!customizeOpen) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.modal-layer')) close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [customizeOpen, close]);

  if (!customizeOpen) return null;
  const themeName = m.themes[settings.appearance.theme].name;

  return createPortal(
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={close} aria-hidden="true" />
      <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="customize-title" tabIndex={-1}>
        <header className="drawer__header">
          <Icon name="brush" size={18} />
          <h2 id="customize-title">{m.customize.title}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={m.customize.close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer__body">
          <ThemePicker />
          <p className="drawer__note">{m.customize.perTheme(themeName)}</p>
          <ColorModeControl />
          <AccentControl />
          <BackgroundControl />
          <LayoutControl />
          <VisibilityControl />
        </div>
        <footer className="drawer__footer">
          <ResetThemeControl />
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              close();
              openSettings('appearance');
            }}
          >
            {m.customize.moreSettings}
          </button>
        </footer>
      </aside>
    </div>,
    container ?? document.body,
  );
}
