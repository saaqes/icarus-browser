import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { useAppearance } from '../../hooks/useAppearance';
import { AddressBar } from '../AddressBar/AddressBar';
import { useAppShortcut } from '../AddressBar/PageActions';
import { BookmarksButton } from '../Bookmarks/BookmarksButton';
import { BookmarksPage } from '../Bookmarks/BookmarksPage';
import { Icon } from '../common/Icon';
import { MenuButton, type MenuEntry } from '../common/Menu';
import { useOverlayActive } from '../common/overlayLayer';
import { CustomizeDrawer } from '../Customize/CustomizeDrawer';
import { BlankPage } from '../InternalPages/BlankPage';
import { DownloadsPage } from '../InternalPages/DownloadsPage';
import { ExternalPage } from '../InternalPages/ExternalPage';
import { HistoryPage } from '../InternalPages/HistoryPage';
import { NavigationControls } from '../NavigationControls/NavigationControls';
import { NewTabPage } from '../NewTabPage/NewTabPage';
import { ProfileButton } from '../Profile/ProfileButton';
import { ReaderView } from '../Reader/ReaderView';
import { SettingsPage } from '../Settings/SettingsPage';
import { TabBar } from '../TabBar/TabBar';
import { AuthDialog } from './AuthDialog';
import { useBrowser } from './BrowserContext';
import { DownloadsButton } from './DownloadsButton';
import { FindBar } from './FindBar';
import { Infobar } from './Infobar';
import { ExtensionsButton, ShieldButton } from './ShieldButton';
import { UpdateButton } from './UpdateButton';
import { WebArea } from './WebArea';
import { useActiveZoom, ZoomMenuRow } from './ZoomControls';
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

/**
 * Derecha de la barra, en el orden de Chrome y Edge: herramientas (Shield,
 * descargas, actualización), favoritos, el perfil y el menú principal. En Panorama
 * se ordena como Edge: Extensiones (con Shield dentro), Favoritos, descargas y
 * actualización si las hay, el perfil y «…».
 */
function ToolbarActions() {
  const m = useMessages();
  const { themeId } = useAppearance();
  const edgeStyle = themeId === 'edge-inspired';
  const { newTab, openSettings, openPage, currentEntry, setCustomizeOpen, embedded, reopenClosedTab, openFind, liveWebTabId, describe, toggleReader } =
    useBrowser();
  const zoom = useActiveZoom();
  const presentation = describe(currentEntry.page);
  const isWebPage = presentation.kind === 'web';
  const appShortcut = useAppShortcut(isWebPage ? presentation.realUrl : '', presentation.title);
  const items: MenuEntry[] = [
    { id: 'new-tab', label: m.menu.newTab, icon: 'plus', shortcut: 'Ctrl+T', onSelect: newTab },
  ];
  if (embedded) items.push({ id: 'reopen', label: m.menu.reopenClosedTab, icon: 'restore', shortcut: 'Ctrl+Mayús+T', onSelect: reopenClosedTab });
  items.push({ id: 'sep-pages', separator: true });
  if (embedded) {
    items.push(
      { id: 'history', label: m.menu.history, icon: 'history', shortcut: 'Ctrl+H', onSelect: () => openPage({ kind: 'history' }, { newTab: true }) },
      { id: 'downloads', label: m.menu.downloads, icon: 'download', shortcut: 'Ctrl+J', onSelect: () => openPage({ kind: 'downloads' }, { newTab: true }) },
    );
  }
  items.push({ id: 'bookmarks', label: m.menu.bookmarks, icon: 'bookmarks', shortcut: 'Ctrl+Mayús+O', onSelect: () => openPage({ kind: 'bookmarks' }, { newTab: true }) });
  if (embedded) {
    items.push({ id: 'sep-zoom', separator: true }, { id: 'zoom', custom: <ZoomMenuRow zoom={zoom ?? 100} />, height: 40 });
    if (zoom === null) items.pop();
    items.push({ id: 'find', label: m.menu.find, icon: 'search', shortcut: 'Ctrl+F', disabled: !liveWebTabId, onSelect: openFind });
    items.push({ id: 'reader', label: m.menu.reader, icon: 'reader', disabled: !liveWebTabId, onSelect: toggleReader });
  }
  if (isWebPage) {
    items.push({ id: 'add-to-new-tab', label: appShortcut.added ? m.appShortcut.remove : m.menu.addToNewTab, icon: 'appsAdd', onSelect: appShortcut.toggle });
  }
  items.push(
    { id: 'sep-settings', separator: true },
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
      {embedded && (edgeStyle ? <ExtensionsButton /> : <ShieldButton />)}
      {edgeStyle && <BookmarksButton />}
      {embedded && <DownloadsButton />}
      {embedded && <UpdateButton />}
      {!edgeStyle && <BookmarksButton />}
      <ProfileButton />
      <MenuButton label={m.toolbar.menu} items={items}>
        <Icon name={edgeStyle ? 'moreHorizontal' : 'more'} />
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
    case 'bookmarks':
      return <BookmarksPage key={key} />;
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

/** Modo lectura de la pestaña activa, sobre su página (que sigue cargada debajo). */
function ActiveReader() {
  const { reader, activeTab, liveWebTabId } = useBrowser();
  if (!reader || reader.tabId !== activeTab.id || liveWebTabId !== activeTab.id) return null;
  return <ReaderView key={`${reader.tabId}:${reader.url}`} tabId={reader.tabId} url={reader.url} />;
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
        <ActiveReader />
      </main>
      <CustomizeDrawer />
      {native && <AuthDialog />}
    </div>
  );
}
