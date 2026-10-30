import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, openSettingsFromMenu } from '../testUtils';

type User = ReturnType<typeof renderApp>['user'];

const BUTTON = 'Personalizar direcciones URL';
const DIALOG = 'Direcciones personalizadas';

async function openManager(user: User) {
  await openSettingsFromMenu(user);
  await user.click(screen.getByRole('button', { name: 'Avanzado' }));
  await user.click(screen.getByRole('button', { name: BUTTON }));
  return screen.getByRole('dialog', { name: DIALOG });
}

async function fill(user: User, manager: HTMLElement, target: string, address: string) {
  const targetInput = within(manager).getByLabelText('1. Destino real');
  const addressInput = within(manager).getByLabelText('2. Dirección que se mostrará');
  await user.clear(targetInput);
  if (target) await user.type(targetInput, target);
  await user.clear(addressInput);
  if (address) await user.type(addressInput, address);
}

async function visit(user: User, url: string) {
  const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
  await user.click(bar);
  await user.clear(bar);
  await user.type(bar, `${url}{Enter}`);
}

const display = () => document.querySelector('.omnibox__display')?.textContent ?? '';

describe('Direcciones por sección en el editor', () => {
  it('«Duplicar» repite el destino y la dirección para otras secciones, también con otro sitio real', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Añadir dirección' }));
    await fill(user, manager, 'bot.deriv.me', 'miweb.com');
    await user.type(within(manager).getByLabelText('3. Secciones (opcional)'), '#inicio');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Dirección miweb.com guardada.');

    // Duplicar: mismo destino y misma dirección, sin secciones y con el foco en ellas.
    await user.click(within(manager).getByRole('button', { name: 'Duplicar' }));
    expect(within(manager).getByRole('form', { name: 'Nueva dirección personalizada' })).toBeInTheDocument();
    expect(within(manager).getByLabelText('1. Destino real')).toHaveValue('https://bot.deriv.me/');
    expect(within(manager).getByLabelText('2. Dirección que se mostrará')).toHaveValue('https://miweb.com/');
    const sections = within(manager).getByLabelText('3. Secciones (opcional)');
    expect(sections).toHaveValue('');
    expect(sections).toHaveFocus();
    // Repetir una sección no se permite: cada dirección escrita lleva a un solo sitio.
    await user.type(sections, '#inicio');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText(/Alguna de esas secciones ya se muestra como miweb.com/)).toBeInTheDocument();
    await user.clear(sections);
    await user.type(sections, '#catalogo');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    await screen.findAllByText('Dirección miweb.com guardada.');

    // Otra vez, ahora con otro sitio real y la misma dirección visible.
    await user.click(within(manager).getByRole('button', { name: 'Duplicar' }));
    await fill(user, manager, 'otrositio.com', 'miweb.com');
    await user.type(within(manager).getByLabelText('3. Secciones (opcional)'), '#tienda');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    const list = within(manager).getByRole('list', { name: DIALOG });
    await within(list).findByText('Solo en #tienda');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'https://bot.deriv.me/#catalogo');
    expect(display()).toBe('miweb.com/#catalogo');
    await visit(user, 'https://otrositio.com/#tienda');
    expect(display()).toBe('miweb.com/#tienda');
    await visit(user, 'miweb.com/#tienda');
    expect(display()).toBe('miweb.com/#tienda');
    // miweb.com#tienda es de otrositio.com: bot.deriv.me#tienda se muestra con su dirección real.
    await visit(user, 'https://bot.deriv.me/ofertas#tienda');
    expect(display()).toBe('bot.deriv.me/ofertas#tienda');
  });

  it('crea una dirección solo para #home y #usuario junto a la general del sitio', async () => {
    const { user } = renderApp();
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Añadir dirección' }));
    await fill(user, manager, 'bot.deriv.me', 'miweb.com');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Dirección miweb.com guardada.');

    await user.click(within(manager).getByRole('button', { name: 'Añadir dirección' }));
    await fill(user, manager, 'bot.deriv.me', 'otraweb.com');
    const sections = within(manager).getByLabelText('3. Secciones (opcional)');
    // Sin secciones choca con la general y el mensaje explica cómo usar secciones.
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText(/indica sus secciones \(por ejemplo #home\)/)).toBeInTheDocument();
    await user.type(sections, '#a/b');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText(/Escribe las secciones como #home, #usuario/)).toBeInTheDocument();
    await user.clear(sections);
    await user.type(sections, '#Home, usuario');
    const preview = within(manager).getByRole('region', { name: 'Así se verá' });
    expect(preview).toHaveTextContent('Solo en #home, #usuario: el resto del sitio conserva su dirección.');
    expect(preview).toHaveTextContent('bot.deriv.me/ruta?x=1#home se mostrará como otraweb.com/ruta?x=1#home');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Dirección otraweb.com guardada.');
    expect(within(manager).getByRole('list', { name: DIALOG })).toHaveTextContent('Solo en #home, #usuario');
    expect(sections).toHaveValue('#home, #usuario');

    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'https://bot.deriv.me/#usuario');
    expect(display()).toBe('otraweb.com/#usuario');
    await visit(user, 'https://bot.deriv.me/#inicio');
    expect(display()).toBe('miweb.com/#inicio');
  });
});

describe('Direcciones personalizadas (Configuración → Avanzado)', () => {
  it('no aparece en la página de inicio ni en la barra principal', () => {
    renderApp();
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
  });

  it('crea una dirección sin .icarus, la barra muestra solo esa y persiste tras reiniciar', async () => {
    const { user, storage, unmount, open } = renderApp();
    const manager = await openManager(user);
    expect(within(manager).getByText(/Aún no hay direcciones personalizadas/)).toBeInTheDocument();
    await user.click(within(manager).getByRole('button', { name: 'Añadir dirección' }));
    await fill(user, manager, 'bot.deriv.me', 'miweb.com');
    const preview = within(manager).getByRole('region', { name: 'Así se verá' });
    expect(within(preview).getByTestId('address-preview')).toHaveTextContent('miweb.com');
    expect(preview).toHaveTextContent('Escribir miweb.com en ICARUS abrirá bot.deriv.me.');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Dirección miweb.com guardada.')).toBeInTheDocument();
    const list = within(manager).getByRole('list', { name: DIALOG });
    expect(list).toHaveTextContent('miweb.com');
    expect(list).toHaveTextContent('Destino: bot.deriv.me');
    expect(manager).not.toHaveTextContent('.icarus');

    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'https://bot.deriv.me/panel?x=1');
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/panel?x=1', '_blank', 'noopener,noreferrer');
    expect(display()).toBe('miweb.com/panel?x=1');
    expect(screen.getByRole('combobox', { name: 'Barra de direcciones' })).toHaveValue('https://miweb.com/panel?x=1');
    unmount();

    const again = renderApp({ storage });
    const reopened = await openManager(again.user);
    expect(within(reopened).getByRole('switch', { name: 'Activar o desactivar miweb.com' })).toBeChecked();
  });

  it('edita la dirección (sin sufijos) y al eliminarla vuelve la dirección real', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([
      { id: 'd', target: 'https://bot.deriv.me/', address: 'https://miweb.com/', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Editar miweb.com' }));
    await fill(user, manager, 'bot.deriv.me', 'otraweb.com');
    expect(within(manager).getByText('Cambios sin guardar')).toBeInTheDocument();
    // Cancelar con cambios pide confirmación; «Seguir editando» los conserva.
    await user.click(within(manager).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Seguir editando' }));
    await user.click(within(manager).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(services.customAddresses.getSnapshot()[0]?.address).toBe('https://otraweb.com/');

    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'bot.deriv.me');
    expect(display()).toBe('otraweb.com');

    const reopened = await openManager(user);
    await user.click(within(reopened).getByRole('button', { name: 'Eliminar otraweb.com' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Eliminar dirección personalizada' })).getByRole('button', { name: 'Eliminar' }));
    expect(services.customAddresses.getSnapshot()).toEqual([]);
    await user.click(within(reopened).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'bot.deriv.me');
    expect(display()).toBe('bot.deriv.me');
  });

  it('valida los campos, el protocolo y los conflictos sin sobrescribir otras entradas', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([
      { id: 'd', target: 'https://bot.deriv.me/', address: 'https://miweb.com/', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('button', { name: 'Añadir dirección' }));
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getAllByText('Este campo es obligatorio.')).toHaveLength(2);

    await fill(user, manager, 'http://intranet.ejemplo.com', 'https://segura.com');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText(/debe usar el mismo protocolo que el destino/)).toBeInTheDocument();

    await fill(user, manager, 'otro.com', 'miweb.com');
    await user.click(within(manager).getByRole('button', { name: 'Guardar' }));
    expect(within(manager).getByText('miweb.com ya se usa para bot.deriv.me. Elige otra dirección, edita esa entrada o, para compartirla, indica las secciones de cada una (por ejemplo #home).')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa los campos marcados.');
    expect(services.customAddresses.getSnapshot()).toHaveLength(1);
  });

  it('desactivar una dirección hace que la barra vuelva a la real', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([
      { id: 'd', target: 'https://bot.deriv.me/', address: 'https://miweb.com/', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const manager = await openManager(user);
    await user.click(within(manager).getByRole('switch', { name: 'Activar o desactivar miweb.com' }));
    expect(await screen.findByText('miweb.com desactivada: se mostrará la dirección real.')).toBeInTheDocument();
    await user.click(within(manager).getByRole('button', { name: 'Cerrar' }));
    await visit(user, 'https://bot.deriv.me/');
    expect(display()).toBe('bot.deriv.me');
  });

  it('se abre desde la información del sitio con el destino actual ya elegido', async () => {
    const { user } = renderApp();
    await visit(user, 'https://bot.deriv.me/panel');
    await user.click(screen.getByRole('button', { name: 'Ver información del sitio' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Información del sitio' })).getByRole('button', { name: 'Personalizar dirección' }));
    const manager = await screen.findByRole('dialog', { name: DIALOG });
    expect(within(manager).getByLabelText('1. Destino real')).toHaveValue('https://bot.deriv.me/');
  });
});
