import { useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { useCustomAddresses, useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { shortAddress } from '../../services/custom-addresses/display';
import { displayUrlFor } from '../../services/custom-addresses/mapping';
import type { ShortcutColumns, ShortcutStyle } from '../../types/settings';
import type { Shortcut } from '../../types/shortcuts';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { MenuButton } from '../common/Menu';
import { ShortcutDialog } from './ShortcutDialog';
import { useShortcutActions } from './useShortcutActions';
import './ShortcutGrid.css';

interface ShortcutGridProps {
  shortcutStyle: ShortcutStyle;
  columns: ShortcutColumns;
}

const DRAG_TYPE = 'application/x-icarus-shortcut';

/** Rejilla de accesos directos: abrir, añadir, editar, eliminar y reordenar (arrastrando o desde el menú). */
export function ShortcutGrid({ shortcutStyle, columns }: ShortcutGridProps) {
  const m = useMessages();
  const [settings] = useSettings();
  const [customAddresses] = useCustomAddresses();
  const { openUrl } = useBrowser();
  const { shortcuts, save, remove, move, canAdd } = useShortcutActions();
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Shortcut | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const open = (shortcut: Shortcut, event: MouseEvent) => {
    const newTab = settings.navigation.shortcutOpenTarget === 'new-tab' || event.ctrlKey || event.metaKey || event.button === 1;
    openUrl(shortcut.url, { newTab });
  };

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(DRAG_TYPE) || dragId;
    if (id) move(id, index);
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <section className={`shortcuts shortcuts--${shortcutStyle}`} aria-label={m.shortcuts.title} style={{ '--columns': columns } as CSSProperties}>
      <ul className="shortcuts__list" title={shortcuts.length > 1 ? m.shortcuts.dragHint : undefined}>
        {shortcuts.map((shortcut, index) => {
          const tooltip = `${shortcut.title}\n${shortAddress(displayUrlFor(shortcut.url, customAddresses)?.url ?? shortcut.url)}`;
          return (
            <li
              key={shortcut.id}
              className={`shortcut${dragId === shortcut.id ? ' is-dragging' : ''}${dropIndex === index && dragId !== shortcut.id ? ' is-drop-target' : ''}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, shortcut.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragId(shortcut.id);
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setDropIndex(index);
              }}
              onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
            >
              <button
                type="button"
                className="shortcut__open"
                title={tooltip}
                aria-label={m.shortcuts.open(shortcut.title)}
                onClick={(event) => open(shortcut, event)}
                onAuxClick={(event) => {
                  if (event.button === 1) open(shortcut, event);
                }}
              >
                <span className="shortcut__icon">
                  <Favicon url={shortcut.url} label={shortcut.title} size={shortcutStyle === 'tile' ? 32 : 24} />
                </span>
                <span className="shortcut__title">{shortcut.title}</span>
              </button>
              <MenuButton
                label={m.shortcuts.options(shortcut.title)}
                className="shortcut__menu icon-btn icon-btn--sm"
                items={[
                  { id: 'edit', label: m.common.edit, icon: 'edit', onSelect: () => setEditing(shortcut) },
                  { id: 'left', label: m.shortcuts.moveLeft, icon: 'chevronLeft', disabled: index === 0, onSelect: () => move(shortcut.id, index - 1) },
                  {
                    id: 'right',
                    label: m.shortcuts.moveRight,
                    icon: 'chevronRight',
                    disabled: index === shortcuts.length - 1,
                    onSelect: () => move(shortcut.id, index + 1),
                  },
                  { id: 'delete', label: m.shortcuts.remove, icon: 'trash', danger: true, onSelect: () => setDeleting(shortcut) },
                ]}
              >
                <Icon name="more" size={16} />
              </MenuButton>
            </li>
          );
        })}
        {canAdd && (
          <li className="shortcut shortcut--add">
            <button type="button" className="shortcut__open" onClick={() => setEditing('new')} aria-label={m.shortcuts.add} title={m.shortcuts.add}>
              <span className="shortcut__icon">
                <Icon name="plus" size={22} />
              </span>
              <span className="shortcut__title">{m.shortcuts.addShort}</span>
            </button>
          </li>
        )}
      </ul>

      {editing && (
        <ShortcutDialog
          open
          shortcut={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            const errors = save(editing === 'new' ? null : editing.id, input);
            if (!errors) setEditing(null);
            return errors;
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={m.shortcuts.confirmDeleteTitle}
        message={deleting ? m.shortcuts.confirmDelete(deleting.title) : ''}
        confirmLabel={m.common.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
