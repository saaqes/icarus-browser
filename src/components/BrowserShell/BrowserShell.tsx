import { useMessages } from '../../i18n';
import { AddressBar } from '../AddressBar/AddressBar';
import { Icon } from '../common/Icon';
import { MenuButton } from '../common/Menu';
import { CustomizeDrawer } from '../Customize/CustomizeDrawer';
import { BlankPage } from '../InternalPages/BlankPage';
import { ExternalPage } from '../InternalPages/ExternalPage';
import { NavigationControls } from '../NavigationControls/NavigationControls';
import { NewTabPage } from '../NewTabPage/NewTabPage';
import { SettingsPage } from '../Settings/SettingsPage';
import { TabBar } from '../TabBar/TabBar';
import { useBrowser } from './BrowserContext';
import './BrowserShell.css';

function ProgressBar() {
  const { activeTab, currentEntry } = useBrowser();
  // Se vuelve a montar en cada navegación para reproducir la animación de avance.
  return (
    <div className="progress" aria-hidden="true">
      <div key={`${activeTab.id}:${currentEntry.id}:${activeTab.reloadToken}`} className={`progress__bar${activeTab.loading ? ' is-loading' : ''}`} />
    </div>
  );
}

function ToolbarActions() {
  const m = useMessages();
  const { newTab, openSettings, openPage, currentEntry, setCustomizeOpen } = useBrowser();
  return (
    <div className="toolbar__actions">
      <button type="button" className="icon-btn" onClick={() => openSettings()} aria-label={m.toolbar.settings} title={m.toolbar.settings}>
        <Icon name="settings" />
      </button>
      <MenuButton
        label={m.toolbar.menu}
        items={[
          { id: 'new-tab', label: m.menu.newTab, icon: 'plus', shortcut: 'Ctrl+T', onSelect: newTab },
          {
            id: 'customize',
            label: m.menu.customize,
            icon: 'brush',
            onSelect: () => {
              if (currentEntry.page.kind !== 'newtab') openPage({ kind: 'newtab' });
              setCustomizeOpen(true);
            },
          },
          { id: 'settings', label: m.menu.settings, icon: 'settings', onSelect: () => openSettings() },
          { id: 'about', label: m.menu.about, icon: 'info', onSelect: () => openSettings('about') },
        ]}
      >
        <Icon name="more" />
      </MenuButton>
    </div>
  );
}

function TabContent() {
  const { activeTab, currentEntry } = useBrowser();
  const key = `${activeTab.id}:${currentEntry.id}:${activeTab.reloadToken}`;
  const page = currentEntry.page;
  switch (page.kind) {
    case 'newtab':
      return <NewTabPage key={key} />;
    case 'blank':
      return <BlankPage key={key} />;
    case 'settings':
      return <SettingsPage key={`${activeTab.id}:${activeTab.reloadToken}`} section={page.section} />;
    case 'external':
      return <ExternalPage key={key} page={page} />;
  }
}

/** Ventana del navegador: pestañas, barra de herramientas y contenido de la pestaña activa. */
export function BrowserShell() {
  const m = useMessages();
  return (
    <div className="browser">
      <header className="browser__chrome">
        <TabBar />
        <div className="toolbar" role="toolbar" aria-label={m.toolbar.label}>
          <NavigationControls />
          <AddressBar />
          <ToolbarActions />
        </div>
        <ProgressBar />
      </header>
      <main className="viewport" id="icarus-viewport">
        <TabContent />
      </main>
      <CustomizeDrawer />
    </div>
  );
}
