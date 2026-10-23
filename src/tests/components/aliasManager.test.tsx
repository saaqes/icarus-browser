import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../testUtils';

type User = ReturnType<typeof renderApp>['user'];

async function openManager(user: User) {
  await user.click(screen.getByRole('button', { name: 'Configuración' }));
  await user.click(screen.getByRole('button', { name: 'Avanzado' }));
  await user.click(screen.getByRole('button', { name: 'Cambiar nombre de URL' }));
  return screen.getByRole('dialog', { name: 'Cambiar nombre de URL' });
}

async function fillRule(user: User, manager: HTMLElement, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const input = within(manager).getByLabelText(label);
    await user.clear(input);
    await user.type(input, value);
  }
}

async function visit(user: User, url: string) {
  const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
  await user.click(bar);
  await user.clear(bar);
  await user.type(bar, `${url}{Enter}`);
}

describe('Cambiar nombre de URL', () => {
  it('no aparece en la página de inicio ni en la barra principal', () => {
    renderApp();
    expect(screen.queryByRole('button', { name: 'Cambiar nombre de URL' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cambiar nombre de URL')).not.toBeInTheDocument();
  });

  it('crea una regla, la aplica a la interfaz y persiste tras reiniciar', async () => {
    const { user, storage, unmount } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Nueva regla' }));
    await user.click(within(manager).getByRole('radio', { name: 'Sitio (host)' }));
    await fillRule(user, manager, {
      'Nombre de la regla': 'Documentación',
      'URL original o patrón de coincidencia': 'developer.mozilla.org',
      'Nombre visible del sitio': 'Docs web',
      'Alias mostrado en ICARUS': 'docs.icarus',
      'URL de destino real': 'https://developer.mozilla.org/es/',
    });
    expect(within(manager).getByRole('region', { name: 'Vista previa' })).toHaveTextContent('docs.icarus');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Regla creada.')).toBeInTheDocument();
    expect(within(manager).getByRole('list', { name: 'Reglas de alias' })).toHaveTextContent('Documentación');

    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'https://developer.mozilla.org/es/docs/Web');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Docs web');
    expect(document.querySelector('.omnibox__display')).toHaveTextContent('docs.icarus');
    // La URL real no se altera.
    expect(screen.getByRole('combobox', { name: 'Barra de direcciones' })).toHaveValue('https://developer.mozilla.org/es/docs/Web');
    unmount();

    const again = renderApp({ storage });
    const reopened = await openManager(again.user);
    expect(within(reopened).getByRole('switch', { name: 'Activar o desactivar Documentación' })).toBeChecked();
  });

  it('valida los campos y no permite degradar HTTPS a HTTP', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Nueva regla' }));
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getAllByText('Este campo es obligatorio.').length).toBeGreaterThanOrEqual(4);

    await fillRule(user, manager, {
      'Nombre de la regla': 'Prueba',
      'URL original o patrón de coincidencia': 'https://seguro.example.com/',
      'Nombre visible del sitio': 'Seguro',
      'Alias mostrado en ICARUS': 'www.banco.com',
      'URL de destino real': 'http://seguro.example.com/',
    });
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText(/El alias debe terminar en .icarus/)).toBeInTheDocument();
    expect(within(manager).getByText(/una regla no puede convertir HTTPS en HTTP/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa los campos marcados.');
  });

  it('activa y desactiva reglas, y la desactivada deja de aplicarse', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('switch', { name: 'Activar o desactivar Página de búsqueda' }));
    expect(await screen.findByText('Regla «Página de búsqueda» desactivada.')).toBeInTheDocument();
    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));

    await visit(user, 'https://www.google.com/');
    expect(document.querySelector('.omnibox__display')).not.toHaveTextContent('buscar.icarus');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('google.com');
  });

  it('edita una regla, busca y pide confirmación antes de descartar o eliminar', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);

    await user.type(within(manager).getByRole('searchbox'), 'wiki');
    expect(within(manager).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(within(manager).getByRole('searchbox'));

    await user.click(within(manager).getByRole('button', { name: 'Editar Enciclopedia' }));
    await fillRule(user, manager, { 'Nombre visible del sitio': 'Enciclopedia libre' });
    expect(within(manager).getByText('Cambios sin guardar')).toBeInTheDocument();

    // Cancelar con cambios pide confirmación; «Seguir editando» los conserva.
    await user.click(within(manager).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(within(manager).getByLabelText('Nombre visible del sitio')).toHaveValue('Enciclopedia libre');

    await user.click(within(manager).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();

    await user.click(within(manager).getByRole('button', { name: 'Eliminar Enciclopedia' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Eliminar regla' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(within(manager).getByRole('list', { name: 'Reglas de alias' })).toHaveTextContent('Enciclopedia');

    await user.click(within(manager).getByRole('button', { name: 'Eliminar Enciclopedia' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Eliminar regla' })).getByRole('button', { name: 'Eliminar' }));
    expect(within(manager).getByRole('list', { name: 'Reglas de alias' })).not.toHaveTextContent('Enciclopedia');

    await user.click(within(manager).getByRole('button', { name: 'Restaurar reglas predeterminadas' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restaurar' }));
    expect(within(manager).getByRole('list', { name: 'Reglas de alias' })).toHaveTextContent('Enciclopedia');
  });

  it('informa de conflictos y de la regla que se aplica', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Nueva regla' }));
    await user.click(within(manager).getByRole('radio', { name: 'Sitio (host)' }));
    await fillRule(user, manager, {
      'Nombre de la regla': 'Todo Google',
      'URL original o patrón de coincidencia': '*.google.com',
      'Nombre visible del sitio': 'Google',
      'Alias mostrado en ICARUS': 'google.icarus',
      'URL de destino real': 'https://www.google.com/',
    });
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    const conflicts = within(manager).getByRole('region', { name: 'Conflictos detectados' });
    expect(conflicts).toHaveTextContent('«Página de búsqueda» y «Todo Google» coinciden con algunas direcciones comunes. En ellas se aplica «Página de búsqueda».');
  });
});
