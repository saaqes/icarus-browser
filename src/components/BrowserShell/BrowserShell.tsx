import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { AddressBar } from '../AddressBar/AddressBar';
import { Icon } from '../common/Icon';
import { MenuButton, type MenuItem } from '../common/Menu';
import { useOverlayActive } from '../common/overlayLayer';
import { CustomizeDrawer } from '../Customize/CustomizeDrawer';
import { BlankPage } from '../InternalPages/BlankPage';
import { DownloadsPage } from '../InternalPages/DownloadsPage';
import { ExternalPage } from '../InternalPages/ExternalPage';
import { HistoryPage } from '../InternalPages/HistoryPage';
import { NavigationControls } from '../NavigationControls/NavigationControls';
import { NewTabPage } from '../NewTabPage/NewTabPage';
import { SettingsPage } from '../Settings/SettingsPage';
import { TabBar } from '../TabBar/TabBar';
import { AuthDialog } from './AuthDialog';
import { useBrowser } from './BrowserContext';
import { DownloadsButton } from './DownloadsButton';
import { FindBar } from './FindBar';
import { Infobar } from './Infobar';
import { ShieldButton } from './ShieldButton';
import { WebArea } from './WebArea';
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
  const { newTab, openSettings, openPage, currentEntry, setCustomizeOpen, embedded, reopenClosedTab } = useBrowser();
  const items: MenuItem[] = [
    { id: 'new-tab', label: m.menu.newTab, icon: 'plus', shortcut: 'Ctrl+T', onSelect: newTab },
  ];
  if (embedded) {
    items.push(
      { id: 'reopen', label: m.menu.reopenClosedTab, icon: 'restore', shortcut: 'Ctrl+Mayús+T', onSelect: reopenClosedTab },
      { id: 'history', label: m.menu.history, icon: 'history', shortcut: 'Ctrl+H', onSelect: () => openPage({ kind: 'history' }, { newTab: true }) },
      { id: 'downloads', label: m.menu.downloads, icon: 'download', shortcut: 'Ctrl+J', onSelect: () => openPage({ kind: 'downloads' }, { newTab: true }) },
    );
  }
  items.push(
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
  );
  return (
    <div className="toolbar__actions">
      {embedded && <ShieldButton />}
      {embedded && <DownloadsButton />}
      <button type="button" className="icon-btn" onClick={() => openSettings()} aria-label={m.toolbar.settings} title={m.toolbar.settings}>
        <Icon name="settings" />
      </button>
      <MenuButton label={m.toolbar.menu} items={items}>
        <Icon name="more" />
      </MenuButton>
    </div>
  );
}

function TabContent() {
  const { activeTab, currentEntry, embedded } = useBrowser();
  const key = `${activeTab.id}:${currentEntry.id}:${activeTab.reloadToken}`;
  const page = currentEntry.page;
  switch (page.kind) {
    case 'newtab':
      return <NewTabPage key={key} />;
    case 'blank':
      return <BlankPage key={key} />;
    case 'settings':
      return <SettingsPage key={`${activeTab.id}:${activeTab.reloadToken}`} section={page.section} />;
    case 'history':
      return <HistoryPage key={key} />;
    case 'downloads':
      return <DownloadsPage key={key} />;
    case 'web':
      return embedded ? <WebArea key={activeTab.id} tabId={activeTab.id} /> : <ExternalPage key={key} page={page} />;
  }
}

const SNAPSHOT_FALLBACK_MS = 500;

/**
 * Coloca la vista web nativa de la pestaña activa sobre el área de contenido y
 * la sustituye por una captura mientras hay menús o diálogos abiertos.
 */
function useNativeViewport(viewportRef: React.RefObject<HTMLElement | null>) {
  const { native } = useServices();
  const { liveWebTabId, webState } = useBrowser();
  const overlayActive = useOverlayActive();
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const visibleTab = liveWebTabId && !webState[liveWebTabId]?.error ? liveWebTabId : null;

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!native || !element) return undefined;
    const report = () => {
      const rect = element.getBoundingClientRect();
      native.tabs.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [native, viewportRef]);

  useEffect(() => {
    if (!native || !visibleTab || !overlayActive) {
      setSuspended(false);
      const frame = requestAnimationFrame(() => setSnapshot(null));
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    // La vista nativa se dibuja encima del HTML: si la captura no llega a tiempo (página
    // sin pintar), se oculta igualmente para que el menú o el diálogo sean visibles.
    const fallback = setTimeout(() => !cancelled && setSuspended(true), SNAPSHOT_FALLBACK_MS);
    void native.tabs.snapshot(visibleTab).then((image) => {
      if (cancelled) return;
      clearTimeout(fallback);
      setSnapshot(image);
      // Se oculta la vista cuando la captura ya está pintada, para evitar parpadeos.
      requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setSuspended(true)));
    });
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [native, overlayActive, visibleTab]);

  useEffect(() => {
    native?.tabs.show(visibleTab && !suspended ? visibleTab : null);
  }, [native, suspended, visibleTab]);

  return visibleTab ? snapshot : null;
}

/** Ventana del navegador: pestañas, barra de herramientas y contenido de la pestaña activa. */
export function BrowserShell() {
  const m = useMessages();
  const { native } = useServices();
  const viewportRef = useRef<HTMLElement>(null);
  const snapshot = useNativeViewport(viewportRef);
  return (
    <div className={`browser${native ? ' browser--desktop' : ''}`} data-platform={native?.platform}>
      <header className="browser__chrome">
        <TabBar />
        <div className="toolbar" role="toolbar" aria-label={m.toolbar.label}>
          <NavigationControls />
          <AddressBar />
          <ToolbarActions />
        </div>
        <ProgressBar />
        {native && <FindBar />}
        {native && <Infobar />}
      </header>
      <main className="viewport" id="icarus-viewport" ref={viewportRef}>
        <TabContent />
        {snapshot && <img className="viewport__snapshot" src={snapshot} alt="" aria-hidden="true" />}
      </main>
      <CustomizeDrawer />
      {native && <AuthDialog />}
    </div>
  );
}
