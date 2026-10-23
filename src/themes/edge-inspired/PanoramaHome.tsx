/**
 * «Panorama» (inspirado en Microsoft Edge): fondo de imagen a pantalla completa,
 * cabecera con marca y hora, buscador ancho con accesos en mosaico y una zona de
 * tarjetas configurable debajo (o en lateral).
 */

import { useBrowser } from '../../components/BrowserShell/BrowserContext';
import { CustomizeButton } from '../../components/NewTabPage/CustomizeButton';
import { Icon } from '../../components/common/Icon';
import { IcarusMark } from '../../components/common/IcarusLogo';
import { SearchBox } from '../../components/SearchBox/SearchBox';
import { ShortcutGrid } from '../../components/ShortcutGrid/ShortcutGrid';
import { WidgetPanel } from '../../components/WidgetPanel/WidgetPanel';
import { useNow } from '../../hooks/useNow';
import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { updateLayout } from '../../services/settings/settings';
import type { HomeLayoutProps } from '../types';
import './panorama.css';

export function PanoramaHome({ layout }: HomeLayoutProps) {
  const m = useMessages();
  const now = useNow();
  const [, updateSettings] = useSettings();
  const { setCustomizeOpen } = useBrowser();
  const side = layout.widgetPlacement === 'side';

  return (
    <div className={`panorama${side ? ' panorama--side' : ''}`}>
      <header className="panorama__top">
        <div className="panorama__brand">
          <IcarusMark size={26} />
          <span className="wordmark">ICARUS</span>
        </div>
        <div className="panorama__top-actions">
          <time className="panorama__time" dateTime={now.toISOString()}>
            {now.toLocaleTimeString(m.locale, { hour: '2-digit', minute: '2-digit' })}
          </time>
          <CustomizeButton compact />
        </div>
      </header>

      <div className="panorama__body">
        <div className="panorama__hero">
          <SearchBox variant="panel" />
          {layout.showShortcuts && <ShortcutGrid shortcutStyle={layout.shortcutStyle} columns={layout.shortcutColumns} />}
        </div>

        {layout.showWidgets ? (
          <section className="panorama__feed">
            <header className="panorama__feed-header">
              <h2>{m.widgets.region}</h2>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCustomizeOpen(true)}>
                <Icon name="layout" size={16} />
                {m.widgets.manage}
              </button>
            </header>
            <WidgetPanel placement={layout.widgetPlacement} />
          </section>
        ) : (
          <button
            type="button"
            className="panorama__show-cards"
            onClick={() => updateSettings((current) => updateLayout(current, 'edge-inspired', { showWidgets: true }))}
          >
            <Icon name="chevronUp" size={16} />
            {m.widgets.showCards}
          </button>
        )}
      </div>
    </div>
  );
}
