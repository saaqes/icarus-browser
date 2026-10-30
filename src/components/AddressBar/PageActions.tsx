/**
 * Acciones de la página dentro de la barra en Panorama (Edge), junto a la estrella:
 * añadir la página a Nueva pestaña (icono de aplicaciones) y el modo lectura.
 */

import { useServices } from '../../app/ServicesContext';
import { useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { addShortcut, MAX_SHORTCUTS, removeShortcut, SHORTCUT_TITLE_MAX } from '../../services/shortcuts/shortcuts';
import { getHostname } from '../../services/url-resolution/urlUtils';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';

/** Añade la página a los accesos directos de Nueva pestaña, o la quita si ya está. */
export function useAppShortcut(url: string, title: string) {
  const m = useMessages();
  const services = useServices();
  const notify = useToast();
  const [shortcuts, setShortcuts] = useShortcuts();
  const existing = shortcuts.find((shortcut) => shortcut.url === url) ?? null;
  const toggle = () => {
    const current = services.shortcuts.getSnapshot();
    const found = current.find((shortcut) => shortcut.url === url);
    if (found) {
      setShortcuts(removeShortcut(current, found.id));
      notify('info', m.appShortcut.removed(found.title));
      return;
    }
    const name = (title.trim() || getHostname(url) || url).slice(0, SHORTCUT_TITLE_MAX).trim();
    const result = addShortcut(current, { title: name, url }, { id: services.createId(), now: services.now() });
    if (!result.ok) {
      notify('error', result.limit ? m.shortcuts.limit(MAX_SHORTCUTS) : m.shortcuts.errors[result.errors.url ?? result.errors.title ?? 'invalid-url']);
      return;
    }
    setShortcuts(result.shortcuts);
    notify('success', m.appShortcut.added(result.shortcut.title));
  };
  return { added: existing !== null, toggle };
}

export function AppShortcutButton({ url, title }: { url: string; title: string }) {
  const m = useMessages();
  const { added, toggle } = useAppShortcut(url, title);
  const label = added ? m.appShortcut.remove : m.appShortcut.add;
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--sm omnibox__action${added ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={added}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
      data-testid="app-shortcut-button"
    >
      <Icon name={added ? 'appsAdded' : 'appsAdd'} size={16} />
    </button>
  );
}

export function ReaderButton() {
  const m = useMessages();
  const { reader, toggleReader, activeTab } = useBrowser();
  const open = reader?.tabId === activeTab.id;
  const label = open ? m.reader.close : m.reader.openTitle;
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--sm omnibox__action${open ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={open}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggleReader}
      data-testid="reader-button"
    >
      <Icon name="reader" size={16} />
    </button>
  );
}
