/**
 * Estilo propio de ICARUS: carbón con resplandor morado animado, saludo y hora
 * en grande, buscador de cristal, accesos en forma de dock y columna lateral de
 * tarjetas. Incluye un indicador honesto del estado del motor.
 */

import { useServices } from '../../app/ServicesContext';
import { CustomizeButton } from '../../components/NewTabPage/CustomizeButton';
import { SearchBox } from '../../components/SearchBox/SearchBox';
import { ShortcutGrid } from '../../components/ShortcutGrid/ShortcutGrid';
import { capitalizeFirst, greetingFor } from '../../components/WidgetPanel/widgets';
import { WidgetPanel } from '../../components/WidgetPanel/WidgetPanel';
import { useNow } from '../../hooks/useNow';
import { useMessages } from '../../i18n';
import type { HomeLayoutProps } from '../types';
import './icarus-home.css';

export function IcarusHome({ layout }: HomeLayoutProps) {
  const m = useMessages();
  const now = useNow();
  const { engine } = useServices();
  const side = layout.showWidgets && layout.widgetPlacement === 'side';

  return (
    <div className={`icarus-home${side ? ' icarus-home--side' : ''}`}>
      <div className="icarus-home__glow" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="icarus-home__content">
        <div className="icarus-home__main">
          <div className="icarus-home__greeting">
            <p className="icarus-home__hello">{greetingFor(now, m.widgets.greeting)}</p>
            <p className="icarus-home__time">{now.toLocaleTimeString(m.locale, { hour: '2-digit', minute: '2-digit' })}</p>
            <p className="icarus-home__date">{capitalizeFirst(now.toLocaleDateString(m.locale, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          </div>
          <SearchBox variant="glass" />
          {layout.showShortcuts && <ShortcutGrid shortcutStyle={layout.shortcutStyle} columns={layout.shortcutColumns} />}
          {layout.showWidgets && !side && <WidgetPanel placement="below" exclude={['clock']} />}
        </div>
        {side && (
          <aside className="icarus-home__aside">
            <WidgetPanel placement="side" exclude={['clock']} />
          </aside>
        )}
      </div>
      <footer className="icarus-home__footer">
        <CustomizeButton />
        <p className="icarus-home__status">
          <span className="status-dot" aria-hidden="true" />
          {m.externalPage.engine(engine.info.name)} · {m.app.prototype}
        </p>
      </footer>
    </div>
  );
}
