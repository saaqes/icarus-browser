/** Acciones de accesos directos compartidas por la página de inicio y la configuración. */

import { useCallback } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import {
  addShortcut,
  createDefaultShortcuts,
  MAX_SHORTCUTS,
  moveShortcut,
  removeShortcut,
  updateShortcut,
  type ShortcutErrors,
} from '../../services/shortcuts/shortcuts';
import type { ShortcutInput } from '../../types/shortcuts';
import { useToast } from '../common/Toast';

export function useShortcutActions() {
  const m = useMessages();
  const notify = useToast();
  const services = useServices();
  const [shortcuts, setShortcuts] = useShortcuts();

  /** Crea (id null) o edita un acceso. Devuelve errores o null si se guardó. */
  const save = useCallback(
    (id: string | null, input: ShortcutInput): ShortcutErrors | null => {
      const current = services.shortcuts.getSnapshot();
      const result = id
        ? updateShortcut(current, id, input, services.now())
        : addShortcut(current, input, { id: services.createId(), now: services.now() });
      if (!result.ok) {
        if (result.limit) notify('error', m.shortcuts.limit(MAX_SHORTCUTS));
        return result.errors;
      }
      setShortcuts(result.shortcuts);
      notify('success', id ? m.shortcuts.saved : m.shortcuts.added);
      return null;
    },
    [m, notify, services, setShortcuts],
  );

  const remove = useCallback(
    (id: string) => {
      setShortcuts((current) => removeShortcut(current, id));
      notify('success', m.shortcuts.removed);
    },
    [m, notify, setShortcuts],
  );

  const move = useCallback(
    (id: string, toIndex: number) => setShortcuts((current) => moveShortcut(current, id, toIndex)),
    [setShortcuts],
  );

  const restoreDefaults = useCallback(() => {
    setShortcuts(createDefaultShortcuts(services.now()));
    notify('success', m.shortcuts.restored);
  }, [m, notify, services, setShortcuts]);

  return { shortcuts, save, remove, move, restoreDefaults, canAdd: shortcuts.length < MAX_SHORTCUTS };
}
