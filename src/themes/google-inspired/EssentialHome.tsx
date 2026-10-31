/**
 * «Esencial» (inspirado en Google Chrome): columna centrada, el icono y el nombre de la
 * aplicación elegidos (Apariencia → Icono de la aplicación) encima del buscador en
 * píldora, y accesos circulares. Mucho espacio en blanco.
 */

import { CustomizeButton } from '../../components/NewTabPage/CustomizeButton';
import { IcarusMark } from '../../components/common/IcarusLogo';
import { useAppName } from '../../hooks/useAppName';
import { useAppearance } from '../../hooks/useAppearance';
import { SearchBox } from '../../components/SearchBox/SearchBox';
import { ShortcutGrid } from '../../components/ShortcutGrid/ShortcutGrid';
import { WidgetPanel } from '../../components/WidgetPanel/WidgetPanel';
import type { HomeLayoutProps } from '../types';
import './essential.css';

export function EssentialHome({ layout }: HomeLayoutProps) {
  const side = layout.showWidgets && layout.widgetPlacement === 'side';
  const appName = useAppName();
  const { appIcon } = useAppearance();
  return (
    <div className={`essential${side ? ' essential--side' : ''}`}>
      <div className="essential__main">
        <div className="essential__logo">
          <IcarusMark size={52} tile variant={appIcon} />
          <span className="wordmark essential__wordmark" data-testid="home-app-name">{appName}</span>
        </div>
        <SearchBox variant="pill" />
        {layout.showShortcuts && <ShortcutGrid shortcutStyle={layout.shortcutStyle} columns={layout.shortcutColumns} />}
        {layout.showWidgets && !side && <WidgetPanel placement="below" />}
      </div>
      {side && (
        <aside className="essential__aside">
          <WidgetPanel placement="side" />
        </aside>
      )}
      <CustomizeButton className="essential__customize" />
    </div>
  );
}
