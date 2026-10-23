import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { canGoBack, canGoForward } from '../../services/tabs/tabs';
import { Icon } from '../common/Icon';
import { useBrowser } from '../BrowserShell/BrowserContext';

/** Botones atrás, adelante, recargar/detener y página principal. */
export function NavigationControls() {
  const m = useMessages();
  const [settings] = useSettings();
  const { activeTab, goBack, goForward, reload, stop, goHome } = useBrowser();
  return (
    <div className="nav-controls">
      <button type="button" className="icon-btn" onClick={goBack} disabled={!canGoBack(activeTab)} aria-label={m.toolbar.back} title={m.toolbar.back}>
        <Icon name="back" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={goForward}
        disabled={!canGoForward(activeTab)}
        aria-label={m.toolbar.forward}
        title={m.toolbar.forward}
      >
        <Icon name="forward" />
      </button>
      {activeTab.loading ? (
        <button type="button" className="icon-btn" onClick={stop} aria-label={m.toolbar.stop} title={m.toolbar.stop}>
          <Icon name="close" />
        </button>
      ) : (
        <button type="button" className="icon-btn" onClick={reload} aria-label={m.toolbar.reload} title={m.toolbar.reload}>
          <Icon name="reload" />
        </button>
      )}
      {settings.general.showHomeButton && (
        <button type="button" className="icon-btn nav-controls__home" onClick={goHome} aria-label={m.toolbar.home} title={m.toolbar.home}>
          <Icon name="home" />
        </button>
      )}
    </div>
  );
}
