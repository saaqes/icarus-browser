import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../services/persistence/keys';
import { createMemoryStorage } from '../../services/persistence/storage';
import { renderApp } from '../testUtils';

describe('recuperación de preferencias', () => {
  it('arranca con datos dañados, avisa y conserva lo que es válido', async () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.settings]: JSON.stringify({ version: 1, data: { appearance: { theme: 'google-inspired', themes: 'roto' } } }),
      [STORAGE_KEYS.shortcuts]: '{esto no es json',
    });
    const { root } = renderApp({ storage });
    expect(root()).toHaveAttribute('data-theme', 'google-inspired');
    expect(await screen.findByText(/no eran válidas y se restauraron/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir Google' })).toBeInTheDocument();
    expect(storage.getItem(`${STORAGE_KEYS.shortcuts}.backup`)).toBe('{esto no es json');
  });

  it('restaura pestañas solo si el usuario lo elige', async () => {
    const first = renderApp();
    first.services.settings.set((s) => ({ ...s, general: { ...s.general, startup: 'restore-session' } }));
    const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
    await first.user.type(bar, 'example.com{Enter}');
    first.unmount();

    const second = renderApp({ storage: first.storage });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('example.com');
    // Al restaurar no se vuelve a abrir la página automáticamente.
    expect(second.open).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Abrir en el navegador externo' })).toBeInTheDocument();
    second.services.settings.set((s) => ({ ...s, general: { ...s.general, startup: 'new-tab' } }));
    second.unmount();

    renderApp({ storage: first.storage });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Nueva pestaña');
  });
});
