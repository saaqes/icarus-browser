import { useState } from 'react';
import { useMessages } from '../../i18n';
import { MAX_SHORTCUTS } from '../../services/shortcuts/shortcuts';
import type { Shortcut } from '../../types/shortcuts';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { ShortcutDialog } from './ShortcutDialog';
import { useShortcutActions } from './useShortcutActions';

/** Lista editable de accesos directos para la página de configuración. */
export function ShortcutManager() {
  const m = useMessages();
  const { shortcuts, save, remove, move, restoreDefaults, canAdd } = useShortcutActions();
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Shortcut | null>(null);
  const [restoring, setRestoring] = useState(false);

  return (
    <div className="shortcut-manager">
      {shortcuts.length === 0 ? (
        <p className="widget-empty">{m.shortcuts.empty}</p>
      ) : (
        <ol className="manager-list" aria-label={m.shortcuts.title}>
          {shortcuts.map((shortcut, index) => (
            <li key={shortcut.id} className="manager-row">
              <Favicon url={shortcut.url} label={shortcut.title} size={20} />
              <span className="manager-row__text">
                <span className="manager-row__title">{shortcut.title}</span>
                <span className="manager-row__detail mono">{shortcut.url}</span>
              </span>
              <span className="manager-row__actions">
                <button type="button" className="icon-btn icon-btn--sm" disabled={index === 0} onClick={() => move(shortcut.id, index - 1)} aria-label={`${m.common.moveUp}: ${shortcut.title}`}>
                  <Icon name="chevronUp" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  disabled={index === shortcuts.length - 1}
                  onClick={() => move(shortcut.id, index + 1)}
                  aria-label={`${m.common.moveDown}: ${shortcut.title}`}
                >
                  <Icon name="chevronDown" size={16} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" onClick={() => setEditing(shortcut)} aria-label={`${m.common.edit}: ${shortcut.title}`}>
                  <Icon name="edit" size={16} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => setDeleting(shortcut)} aria-label={`${m.common.delete}: ${shortcut.title}`}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="manager-actions">
        <button type="button" className="btn btn--primary btn--sm" disabled={!canAdd} onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} />
          {m.shortcuts.add}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRestoring(true)}>
          <Icon name="restore" size={14} />
          {m.shortcuts.restoreDefaults}
        </button>
        {!canAdd && <span className="field-hint">{m.shortcuts.limit(MAX_SHORTCUTS)}</span>}
      </div>

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
      <ConfirmDialog
        open={restoring}
        title={m.shortcuts.confirmRestoreTitle}
        message={m.shortcuts.confirmRestore}
        confirmLabel={m.common.restore}
        onCancel={() => setRestoring(false)}
        onConfirm={() => {
          restoreDefaults();
          setRestoring(false);
        }}
      />
    </div>
  );
}
