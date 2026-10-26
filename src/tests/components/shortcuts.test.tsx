import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, openSettingsFromMenu } from '../testUtils';

const grid = () => screen.getByRole('region', { name: 'Accesos directos' });
const titles = () => within(grid()).getAllByRole('button', { name: /^Abrir / }).map((button) => button.getAttribute('aria-label'));

describe('accesos directos', () => {
  it('añade un acceso validando la URL y lo conserva al reiniciar', async () => {
    const { user, storage, unmount } = renderApp();
    await user.click(within(grid()).getByRole('button', { name: 'Añadir acceso directo' }));
    const dialog = screen.getByRole('dialog', { name: 'Añadir acceso directo' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Mi diario');
    await user.type(within(dialog).getByLabelText('URL'), 'javascript:alert(1)');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByText('Solo se admiten direcciones http:// o https://.')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('URL'));
    await user.type(within(dialog).getByLabelText('URL'), 'diario.example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(screen.queryByRole('dialog', { name: 'Añadir acceso directo' })).not.toBeInTheDocument();
    expect(titles()).toContain('Abrir Mi diario');
    unmount();

    renderApp({ storage });
    expect(titles()).toContain('Abrir Mi diario');
  });

  it('abre un acceso directo', async () => {
    const { user, open } = renderApp();
    await user.click(within(grid()).getByRole('button', { name: 'Abrir Wikipedia' }));
    expect(open).toHaveBeenCalledWith('https://es.wikipedia.org/', '_blank', 'noopener,noreferrer');
  });

  it('edita y elimina con confirmación desde el menú del acceso', async () => {
    const { user } = renderApp();
    await user.click(within(grid()).getByRole('button', { name: 'Opciones de GitHub' }));
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar acceso directo' });
    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Código');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(titles()).toContain('Abrir Código');

    await user.click(within(grid()).getByRole('button', { name: 'Opciones de Código' }));
    await user.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(titles()).toContain('Abrir Código');

    await user.click(within(grid()).getByRole('button', { name: 'Opciones de Código' }));
    await user.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));
    expect(titles()).not.toContain('Abrir Código');
  });

  it('cambia el orden y restaura los predeterminados', async () => {
    const { user } = renderApp();
    expect(titles()[0]).toBe('Abrir Google');
    await user.click(within(grid()).getByRole('button', { name: 'Opciones de Google' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mover a la derecha' }));
    expect(titles().slice(0, 2)).toEqual(['Abrir YouTube', 'Abrir Google']);

    // Desde Configuración → Navegación.
    await openSettingsFromMenu(user);
    await user.click(screen.getByRole('button', { name: 'Navegación' }));
    const list = screen.getByRole('list', { name: 'Accesos directos' });
    await user.click(within(list).getByRole('button', { name: 'Bajar: YouTube' }));
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('YouTube');

    await user.click(screen.getByRole('button', { name: 'Restaurar accesos predeterminados' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restaurar' }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Google');
  });
});
