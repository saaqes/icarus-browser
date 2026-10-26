import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { customAddressesSchema } from '../../services/custom-addresses/store';
import { loadDocument, saveDocument } from '../../services/persistence/document';
import { createMemoryStorage } from '../../services/persistence/storage';
import type { CustomAddress } from '../../types/customAddress';
import { renderApp } from '../testUtils';

const DERIV: CustomAddress = {
  id: 'deriv',
  target: 'https://bot.deriv.me/',
  address: 'https://miweb.com/',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const addressBar = () => screen.getByRole('combobox', { name: /Barra de direcciones|Dirección base/ });
const shown = () => document.querySelector('.omnibox__display')?.textContent ?? '';
const omniboxAlert = () => within(document.querySelector<HTMLElement>('.omnibox')!).getByRole('alert');

function setup(entries: CustomAddress[] = [DERIV]) {
  const storage = createMemoryStorage();
  saveDocument(storage, customAddressesSchema, entries);
  return renderApp({ storage });
}

async function go(user: ReturnType<typeof renderApp>['user'], text: string) {
  await user.click(addressBar());
  await user.clear(addressBar());
  await user.type(addressBar(), `${text}{Enter}`);
}

async function editBase(user: ReturnType<typeof renderApp>['user'], base: string) {
  await user.click(addressBar());
  await user.click(screen.getByRole('button', { name: 'Editar base' }));
  await user.clear(addressBar());
  await user.type(addressBar(), `${base}{Enter}`);
  return screen.getByRole('listbox', { name: 'Qué hacer con la base nueva' });
}

describe('direcciones por sección: otro dominio para #home y #usuario', () => {
  it('guarda la base nueva solo para la sección y el resto del sitio conserva la suya', async () => {
    const { user, storage, open } = setup();
    await go(user, 'miweb.com/#home');
    expect(shown()).toBe('miweb.com/#home');

    const choices = await editBase(user, 'otraweb.com');
    expect(within(choices).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Guardar otraweb.com como dirección personalizada'),
      expect.stringContaining('Guardar otraweb.com solo para #home'),
      expect.stringContaining('Ir a otraweb.com/#home'),
    ]);
    expect(choices).toHaveTextContent('Las demás secciones del sitio conservan su dirección');
    // Flecha arriba desde la primera opción va a la última; flecha abajo, a la siguiente.
    await user.keyboard('{ArrowUp}');
    expect(within(choices).getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(await screen.findByText('#home se mostrará como otraweb.com')).toBeInTheDocument();
    expect(loadDocument(storage, customAddressesSchema).value).toEqual([
      expect.objectContaining({ id: 'deriv', address: 'https://miweb.com/' }),
      expect.objectContaining({ target: 'https://bot.deriv.me/', address: 'https://otraweb.com/', sections: ['home'], enabled: true }),
    ]);
    await waitFor(() => expect(shown()).toBe('otraweb.com/#home'));

    // Otra sección del mismo sitio sigue con su dirección; escribir otraweb.com abre #home.
    await go(user, 'miweb.com/#inicio');
    expect(shown()).toBe('miweb.com/#inicio');
    await go(user, 'otraweb.com');
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/#home', '_blank', 'noopener,noreferrer');
    expect(shown()).toBe('otraweb.com/#home');

    // La misma base para #usuario se añade a esa entrada, sin crear otra.
    await go(user, 'miweb.com/#usuario');
    await editBase(user, 'otraweb.com');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('#usuario se mostrará como otraweb.com')).toBeInTheDocument();
    const saved = loadDocument(storage, customAddressesSchema).value;
    expect(saved).toHaveLength(2);
    expect(saved[1]?.sections).toEqual(['home', 'usuario']);

    // En una pestaña nueva, cada sección se muestra con su dirección.
    await user.keyboard('{Control>}t{/Control}');
    await go(user, 'https://bot.deriv.me/#/usuario/10');
    expect(shown()).toBe('otraweb.com/#/usuario/10');
    await go(user, 'https://bot.deriv.me/#catalogo');
    expect(shown()).toBe('miweb.com/#catalogo');
  });

  it('«Guardar» en una sección con dirección propia cambia esa dirección, no la del sitio', async () => {
    const home: CustomAddress = { ...DERIV, id: 'home', address: 'https://otraweb.com/', sections: ['home', 'usuario'] };
    const { user, storage } = setup([DERIV, home]);
    await go(user, 'otraweb.com/#usuario');
    const choices = await editBase(user, 'tercera.com');
    expect(within(choices).getAllByRole('option')[0]).toHaveTextContent('Sustituye a otraweb.com en #home, #usuario');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(shown()).toBe('tercera.com/#usuario'));
    expect(loadDocument(storage, customAddressesSchema).value.map((item) => [item.id, item.address, item.sections ?? null])).toEqual([
      ['deriv', 'https://miweb.com/', null],
      ['home', 'https://tercera.com/', ['home', 'usuario']],
    ]);
  });
});

describe('barra inteligente: editar la base conservando la ruta', () => {
  it('cambia la base de la dirección personalizada conservando /#inicio y la guarda al confirmar', async () => {
    const { user, storage, open } = setup();
    await go(user, 'miweb.com/#inicio');
    // ICARUS abre la URL real y la barra muestra la personalizada, sin la original.
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/#inicio', '_blank', 'noopener,noreferrer');
    expect(shown()).toBe('miweb.com/#inicio');
    expect(screen.getByRole('toolbar', { name: 'Barra de herramientas' })).not.toHaveTextContent('bot.deriv.me');
    expect(screen.getByRole('tab', { selected: true })).not.toHaveTextContent('bot.deriv.me');

    await user.click(addressBar());
    await user.click(screen.getByRole('button', { name: 'Editar base' }));
    expect(addressBar()).toHaveValue('https://miweb.com');
    expect(screen.getByTestId('rebase-suffix')).toHaveTextContent('/#inicio');
    await user.clear(addressBar());
    await user.type(addressBar(), 'otrapagina.com{Enter}');

    const choices = screen.getByRole('listbox', { name: 'Qué hacer con la base nueva' });
    expect(within(choices).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Guardar otrapagina.com como dirección personalizada'),
      expect.stringContaining('Guardar otrapagina.com solo para #inicio'),
      expect.stringContaining('Ir a otrapagina.com/#inicio'),
    ]);
    await user.keyboard('{Enter}');

    // Se guarda (persistente) y la misma página se muestra con la base nueva y la misma ruta.
    expect(loadDocument(storage, customAddressesSchema).value).toEqual([
      expect.objectContaining({ id: 'deriv', target: 'https://bot.deriv.me/', address: 'https://otrapagina.com/', enabled: true }),
    ]);
    await waitFor(() => expect(shown()).toBe('otrapagina.com/#inicio'));
    expect(await screen.findByText('Dirección personalizada guardada: otrapagina.com')).toBeInTheDocument();
    // Navegar a otras secciones de la aplicación mantiene la misma configuración.
    await go(user, 'otrapagina.com/#dashboard');
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/#dashboard', '_blank', 'noopener,noreferrer');
    expect(loadDocument(storage, customAddressesSchema).value).toHaveLength(1);
  });

  it('«Ir a» abre la base nueva con la misma ruta sin cambiar la configuración', async () => {
    const { user, storage, open } = setup();
    await go(user, 'miweb.com/panel/usuarios?id=10');
    await user.click(addressBar());
    await user.click(screen.getByRole('button', { name: 'Editar base' }));
    await user.clear(addressBar());
    await user.type(addressBar(), 'https://otrapagina.com/{ArrowDown}');
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(open).toHaveBeenLastCalledWith('https://otrapagina.com/panel/usuarios?id=10', '_blank', 'noopener,noreferrer');
    expect(loadDocument(storage, customAddressesSchema).value[0]?.address).toBe('https://miweb.com/');
  });

  it('cambiar a mano solo la base también ofrece guardarla; una dirección nueva no hereda la ruta', async () => {
    const { user, open } = setup();
    await go(user, 'miweb.com/#chart');
    await go(user, 'https://otrapagina.com/#chart');
    expect(screen.getByRole('listbox', { name: 'Qué hacer con la base nueva' })).toBeInTheDocument();
    await user.keyboard('{Escape}{Escape}');

    await go(user, 'otrapagina.com');
    expect(open).toHaveBeenLastCalledWith('https://otrapagina.com/', '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('listbox', { name: 'Qué hacer con la base nueva' })).toBeNull();
  });

  it('sin dirección personalizada, la base es el origen y se navega directamente', async () => {
    const { user, open } = setup([]);
    await go(user, 'http://localhost:3000/app/#/ajustes?tab=2');
    await user.click(addressBar());
    await user.click(screen.getByRole('button', { name: 'Editar base' }));
    expect(addressBar()).toHaveValue('http://localhost:3000');
    await user.clear(addressBar());
    await user.type(addressBar(), 'localhost:4000{Enter}');
    expect(open).toHaveBeenLastCalledWith('http://localhost:4000/app/#/ajustes?tab=2', '_blank', 'noopener,noreferrer');
  });

  it('la base no admite «?» ni «#» y se puede renunciar a conservar la ruta', async () => {
    const { user, open } = setup([]);
    await go(user, 'ejemplo.com/a?b=1#c');
    await user.click(addressBar());
    await user.click(screen.getByRole('button', { name: 'Editar base' }));
    await user.clear(addressBar());
    await user.type(addressBar(), 'otra.com/#x{Enter}');
    expect(omniboxAlert()).toHaveTextContent('La base no puede incluir «?» ni «#»');
    await user.clear(addressBar());
    await user.type(addressBar(), 'otra.com');
    await user.click(screen.getByRole('button', { name: 'No conservar la ruta' }));
    expect(screen.queryByTestId('rebase-suffix')).toBeNull();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenLastCalledWith('https://otra.com/', '_blank', 'noopener,noreferrer');
  });

  it('un conflicto con otra dirección personalizada no sobrescribe nada', async () => {
    const other: CustomAddress = { ...DERIV, id: 'otra', target: 'https://otro-sitio.com/', address: 'https://otrapagina.com/' };
    const { user, storage } = setup([DERIV, other]);
    await go(user, 'miweb.com/#inicio');
    await user.click(addressBar());
    await user.click(screen.getByRole('button', { name: 'Editar base' }));
    await user.clear(addressBar());
    await user.type(addressBar(), 'otrapagina.com{Enter}');
    await user.keyboard('{Enter}');
    expect(omniboxAlert()).toHaveTextContent('Otra dirección personalizada ya usa esa base.');
    expect(loadDocument(storage, customAddressesSchema).value.map((entry) => entry.address)).toEqual(['https://miweb.com/', 'https://otrapagina.com/']);
  });
});

describe('favoritos', () => {
  it('guarda, renombra y quita la página; la estrella refleja el estado y se conserva al reiniciar', async () => {
    const { user, storage, unmount } = setup();
    await go(user, 'miweb.com/#dashboard');
    const star = screen.getByTestId('bookmark-star');
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    const editor = screen.getByRole('dialog', { name: 'Favorito añadido' });
    // Muestra la dirección personalizada, nunca la original.
    expect(editor).toHaveTextContent('miweb.com/#dashboard');
    expect(editor).not.toHaveTextContent('bot.deriv.me');
    const name = within(editor).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Mi panel');
    await user.selectOptions(within(editor).getByLabelText('Carpeta'), 'Nueva carpeta…');
    await user.type(within(editor).getByLabelText('Nombre de la carpeta nueva'), 'Trabajo');
    await user.click(within(editor).getByRole('button', { name: 'Hecho' }));
    expect(screen.getByTestId('bookmark-star')).toHaveAttribute('aria-pressed', 'true');

    // Otra sección de la aplicación es otra página: su estrella está vacía.
    await go(user, 'miweb.com/#chart');
    expect(screen.getByTestId('bookmark-star')).toHaveAttribute('aria-pressed', 'false');

    // Se abre con un clic desde el botón de favoritos.
    await user.click(screen.getByTestId('bookmarks-button'));
    const hub = screen.getByRole('dialog', { name: 'Favoritos' });
    expect(within(hub).getByText('Trabajo')).toBeInTheDocument();
    expect(within(hub).getByText('miweb.com/#dashboard')).toBeInTheDocument();
    await user.click(within(hub).getByRole('button', { name: /Mi panel/ }));
    expect(shown()).toBe('miweb.com/#dashboard');

    // Al reiniciar sigue guardado.
    unmount();
    const again = renderApp({ storage });
    expect(again.services.bookmarks.getSnapshot().items).toEqual([expect.objectContaining({ title: 'Mi panel', url: 'https://bot.deriv.me/#dashboard' })]);
    await go(again.user, 'miweb.com/#dashboard');
    await again.user.click(screen.getByTestId('bookmark-star'));
    await again.user.click(within(screen.getByRole('dialog', { name: 'Editar favorito' })).getByRole('button', { name: 'Quitar' }));
    expect(again.services.bookmarks.getSnapshot().items).toEqual([]);
    expect(screen.getByTestId('bookmark-star')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Ctrl+D añade la página actual y no la duplica', async () => {
    const { user, services } = setup([]);
    await go(user, 'ejemplo.com/a');
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Favorito añadido' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Editar favorito' })).toBeInTheDocument();
    expect(services.bookmarks.getSnapshot().items).toHaveLength(1);
  });

  it('la página de favoritos permite renombrar, mover, crear carpetas y eliminar', async () => {
    const { user, services } = setup([]);
    await go(user, 'ejemplo.com/a');
    await user.click(screen.getByTestId('bookmark-star'));
    await user.click(screen.getByRole('button', { name: 'Hecho' }));
    await go(user, 'icarus://favoritos');
    expect(screen.getByRole('heading', { level: 1, name: 'Favoritos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Nueva carpeta/ }));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de la carpeta nueva' }), 'Lectura{Enter}');
    expect(services.bookmarks.getSnapshot().folders.map((folder) => folder.name)).toEqual(['Favoritos', 'Lectura']);
    const folders = () => screen.getByRole('navigation', { name: 'Carpeta' });
    await user.click(within(folders()).getByRole('button', { name: /^Favoritos/ }));
    const row = screen.getByTestId('bookmark-row');
    await user.selectOptions(within(row).getByLabelText('Mover a'), 'Lectura');
    expect(services.bookmarks.getSnapshot().items[0]?.folderId).not.toBe('favoritos');
    await user.click(within(folders()).getByRole('button', { name: /^Lectura/ }));
    await user.click(within(screen.getByTestId('bookmark-row')).getByRole('button', { name: /Cambiar nombre/ }));
    const input = screen.getByRole('textbox', { name: 'Cambiar nombre' });
    await user.clear(input);
    await user.type(input, 'Artículo{Enter}');
    expect(services.bookmarks.getSnapshot().items[0]?.title).toBe('Artículo');
    await user.click(within(screen.getByTestId('bookmark-row')).getByRole('button', { name: /Eliminar/ }));
    expect(services.bookmarks.getSnapshot().items).toEqual([]);
  });
});

describe('barra de herramientas como Chrome y Edge', () => {
  it('orden: navegación, barra de direcciones, herramientas y menú; sin icono de alias', async () => {
    const { user } = setup();
    const toolbar = screen.getByRole('toolbar', { name: 'Barra de herramientas' });
    const children = [...toolbar.children].map((child) => child.className);
    expect(children[0]).toContain('nav-controls');
    expect(children[1]).toContain('omnibox');
    expect(children[2]).toContain('toolbar__actions');
    expect(within(toolbar).getByRole('button', { name: 'Favoritos' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Configuración' })).toBeNull();
    // El menú lleva a Favoritos, Configuración y el resto.
    await user.click(within(toolbar).getByRole('button', { name: 'Menú de ICARUS' }));
    for (const name of ['Nueva pestaña', 'Favoritos', 'Configuración', 'Acerca de ICARUS']) expect(screen.getByRole('menuitem', { name: new RegExp(name) })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await go(user, 'miweb.com/');
    expect(document.body.innerHTML).not.toMatch(/\.icarus\b/);
  });
});
