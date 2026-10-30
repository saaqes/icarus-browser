import { useAppearance } from '../../hooks/useAppearance';
import { useMessages } from '../../i18n';
import type { PagePresentation } from '../../services/tabs/pages';
import { getCurrentEntry } from '../../services/tabs/tabs';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { IcarusMark } from '../common/IcarusLogo';
import { MenuButton, type MenuEntry } from '../common/Menu';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { shortAddress } from '../../services/custom-addresses/display';
import './TabBar.css';

function TabIcon({ presentation, loading, favicon }: { presentation: PagePresentation; loading: boolean; favicon: string | null }) {
  const m = useMessages();
  if (loading) return <span className="tab__spinner" role="img" aria-label={m.tabs.loading} />;
  switch (presentation.icon) {
    case 'history':
      return <Icon name="history" size={16} />;
    case 'downloads':
      return <Icon name="download" size={16} />;
    case 'bookmarks':
      return <Icon name="bookmarks" size={16} />;
    case 'icarus':
      return <IcarusMark size={16} />;
    case 'settings':
      return <Icon name="settings" size={16} />;
    case 'blank':
      return <Icon name="page" size={16} />;
    case 'site':
      // Icono real del sitio informado por el motor; si no hay, el de /favicon.ico o una inicial.
      return favicon ? <img className="favicon" src={favicon} alt="" width={16} height={16} /> : <Favicon url={presentation.realUrl} label={presentation.title} size={16} />;
  }
}

/** Barra superior de pestañas visuales. */
export function TabBar() {
  const m = useMessages();
  const { themeId } = useAppearance();
  const { session, describe, activateTab, closeTab, newTab, webState } = useBrowser();

  // Como Microsoft Edge, el estilo Panorama no muestra la marca de la aplicación en la
  // esquina: un botón cuadrado con un chevron abre la lista de pestañas abiertas.
  const tabMenu: MenuEntry[] = [
    ...session.tabs.map((tab) => {
      const presentation = describe(getCurrentEntry(tab).page);
      return {
        id: tab.id,
        label: presentation.title,
        icon: (tab.id === session.activeTabId ? 'check' : undefined) as 'check' | undefined,
        onSelect: () => activateTab(tab.id),
      };
    }),
    { id: 'tabs-sep', separator: true },
    { id: 'tabs-new', label: m.tabs.newTab, icon: 'plus', shortcut: 'Ctrl+T', onSelect: newTab },
  ];

  return (
    <div className="tabstrip">
      {themeId === 'edge-inspired' ? (
        <MenuButton label={m.tabs.list} items={tabMenu} className="tabstrip__tabmenu" align="start">
          <Icon name="chevronDown" size={16} />
        </MenuButton>
      ) : (
        <div className="tabstrip__brand" aria-hidden="true">
          <IcarusMark size={20} />
        </div>
      )}
      <div className="tabstrip__tabs" role="tablist" aria-label={m.tabs.list}>
        {session.tabs.map((tab) => {
          const presentation = describe(getCurrentEntry(tab).page);
          const active = tab.id === session.activeTabId;
          // Como en la barra: la dirección personalizada si la página está dentro de su destino.
          const tooltip = presentation.kind === 'web' ? `${presentation.title}\n${shortAddress(presentation.addressUrl)}` : presentation.title;
          return (
            <div key={tab.id} className={`tab${active ? ' is-active' : ''}`} title={tooltip}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="tab__main"
                onClick={() => activateTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id);
                }}
              >
                <span className="tab__icon">
                  <TabIcon presentation={presentation} loading={tab.loading} favicon={webState[tab.id]?.favicon ?? null} />
                </span>
                <span className="tab__title">{presentation.title}</span>
              </button>
              <button type="button" className="tab__close" onClick={() => closeTab(tab.id)} aria-label={m.tabs.close(presentation.title)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
        <button type="button" className="tabstrip__new" onClick={newTab} aria-label={m.tabs.newTab} title={m.tabs.newTab}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}
