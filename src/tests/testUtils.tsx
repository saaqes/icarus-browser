import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../app/App';
import { createAppServices } from '../app/services';
import { createExternalBrowserEngine } from '../services/navigation/externalEngine';
import { createMemoryStorage, type KeyValueStorage } from '../services/persistence/storage';

export const FIXED_NOW = new Date('2026-05-04T10:30:00.000Z');

/**
 * Renderiza ICARUS con almacenamiento en memoria, un `window.open` simulado y un
 * reloj fijo. Para simular «cerrar y volver a abrir», se desmonta y se vuelve a
 * llamar con el mismo `storage`.
 */
export function renderApp(options: { storage?: KeyValueStorage } = {}) {
  const storage = options.storage ?? createMemoryStorage();
  const open = vi.fn();
  const services = createAppServices({
    storage,
    engine: createExternalBrowserEngine({ open }),
    now: () => FIXED_NOW,
  });
  const user = userEvent.setup();
  const view = render(<App services={services} />);
  const root = () => view.container.querySelector<HTMLElement>('.icarus-root')!;
  return { ...view, storage, open, services, user, root };
}
