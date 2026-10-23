import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../testUtils';

async function openCustomize(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('button', { name: 'Personalizar' }));
  return screen.getByRole('dialog', { name: 'Personalizar' });
}

describe('apariencia y temas', () => {
  it('arranca con el estilo ICARUS oscuro y su distribución propia', () => {
    const { root } = renderApp();
    expect(root()).toHaveAttribute('data-theme', 'icarus');
    expect(root()).toHaveAttribute('data-mode', 'dark');
    expect(document.querySelector('.icarus-home')).toBeInTheDocument();
    expect(screen.getByText('Buenos días')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Accesos directos' })).toHaveClass('shortcuts--dock');
  });

  it('cambia de estilo al instante, con distribución diferente y sin tocar otras preferencias', async () => {
    const { user, root, services } = renderApp();
    const shortcutsBefore = services.shortcuts.getSnapshot();
    const panel = await openCustomize(user);

    await user.click(within(panel).getByRole('radio', { name: /Esencial/ }));
    expect(root()).toHaveAttribute('data-theme', 'google-inspired');
    expect(root()).toHaveAttribute('data-mode', 'light');
    expect(document.querySelector('.essential')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Accesos directos' })).toHaveClass('shortcuts--circle');

    await user.click(within(panel).getByRole('radio', { name: /Panorama/ }));
    expect(root()).toHaveAttribute('data-theme', 'edge-inspired');
    expect(document.querySelector('.panorama')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Accesos directos' })).toHaveClass('shortcuts--tile');
    expect(document.querySelector('.home')).toHaveAttribute('data-surface', 'image');

    expect(services.shortcuts.getSnapshot()).toBe(shortcutsBefore);
    expect(services.settings.getSnapshot().general.searchProvider).toBe('google');
  });

  it('cambia el modo de color y conserva la configuración de cada estilo', async () => {
    const { user, root } = renderApp();
    const panel = await openCustomize(user);
    await user.click(within(panel).getByRole('radio', { name: 'Claro' }));
    expect(root()).toHaveAttribute('data-mode', 'light');

    await user.click(within(panel).getByRole('radio', { name: /Esencial/ }));
    await user.click(within(panel).getByRole('radio', { name: 'Oscuro' }));
    expect(root()).toHaveAttribute('data-mode', 'dark');

    await user.click(within(panel).getByRole('radio', { name: /ICARUS/ }));
    expect(root()).toHaveAttribute('data-mode', 'light');
  });

  it('el modo automático sigue al sistema', async () => {
    const { user, root } = renderApp();
    const panel = await openCustomize(user);
    await user.click(within(panel).getByRole('radio', { name: 'Automático' }));
    // El entorno de pruebas simula un sistema en modo claro.
    expect(root()).toHaveAttribute('data-mode', 'light');
  });

  it('muestra u oculta accesos y widgets, y cambia la distribución', async () => {
    const { user } = renderApp();
    const panel = await openCustomize(user);

    await user.click(within(panel).getByRole('switch', { name: 'Mostrar accesos directos' }));
    expect(screen.queryByRole('region', { name: 'Accesos directos' })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('switch', { name: 'Mostrar tarjetas y widgets' }));
    expect(screen.queryByRole('region', { name: 'Tarjetas y widgets' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('switch', { name: 'Mostrar tarjetas y widgets' }));
    expect(screen.getByRole('article', { name: 'Notas rápidas' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('checkbox', { name: /Notas rápidas/ }));
    expect(screen.queryByRole('article', { name: 'Notas rápidas' })).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('radio', { name: 'Arriba' }));
    expect(document.querySelector('.home')).toHaveAttribute('data-search', 'top');
    await user.click(within(panel).getByRole('radio', { name: 'Compacta' }));
    expect(document.querySelector('.home')).toHaveAttribute('data-density', 'compact');
  });

  it('elige un fondo de color, lo restaura y restablece el estilo', async () => {
    const { user } = renderApp();
    const panel = await openCustomize(user);
    await user.click(within(panel).getByRole('radio', { name: '#1e2230' }));
    expect(document.querySelector('.home')).toHaveAttribute('data-surface', 'color-dark');
    await user.click(within(panel).getByRole('radio', { name: 'Aurora' }));
    expect(document.querySelector('.home')).toHaveAttribute('data-surface', 'image');
    await user.click(within(panel).getByRole('button', { name: 'Restaurar fondo predeterminado' }));
    expect(document.querySelector('.home')).toHaveAttribute('data-surface', 'theme');

    await user.click(within(panel).getByRole('switch', { name: 'Mostrar accesos directos' }));
    await user.click(within(panel).getByRole('button', { name: 'Restablecer «ICARUS»' }));
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    expect(screen.getByRole('region', { name: 'Accesos directos' })).toBeInTheDocument();
  });

  it('conserva el estilo y el modo después de reiniciar', async () => {
    const first = renderApp();
    const panel = await openCustomize(first.user);
    await first.user.click(within(panel).getByRole('radio', { name: /Panorama/ }));
    await first.user.click(within(panel).getByRole('radio', { name: 'Oscuro' }));
    first.unmount();

    const second = renderApp({ storage: first.storage });
    expect(second.root()).toHaveAttribute('data-theme', 'edge-inspired');
    expect(second.root()).toHaveAttribute('data-mode', 'dark');
  });
});
