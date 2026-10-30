import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, openSettingsFromMenu } from '../testUtils';

const addressBar = () => screen.getByRole('combobox', { name: 'Barra de direcciones' });

/** Escribe en la barra de direcciones como un usuario: clic, borrar y escribir. */
async function typeAddress(user: ReturnType<typeof renderApp>['user'], text: string) {
  await user.click(addressBar());
  await user.clear(addressBar());
  await user.type(addressBar(), text);
}

describe('barra de direcciones y navegación', () => {
  it('sin buscador: el texto que no es dirección se intenta como dominio, no se busca', async () => {
    const { user, open } = renderApp();
    // Una sola palabra se trata como dominio (el motor mostraría su error si no existe),
    // nunca como una búsqueda de Google/Bing.
    await typeAddress(user, 'icaruslandia{Enter}');
    expect(open).toHaveBeenLastCalledWith('https://icaruslandia/', '_blank', 'noopener,noreferrer');
    const url = String(open.mock.calls.at(-1)?.[0] ?? '');
    expect(url).not.toContain('/search?q=');
  });

  it('reconoce direcciones web', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'example.com/ruta{Enter}');
    expect(open).toHaveBeenCalledWith('https://example.com/ruta', '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('example.com');
  });

  it('el buscador de la página de inicio abre direcciones y no ofrece proveedor de búsqueda', async () => {
    const { user, open } = renderApp();
    await user.type(screen.getByRole('textbox', { name: 'Introducir una dirección web' }), 'ejemplo.com{Enter}');
    expect(open).toHaveBeenCalledWith('https://ejemplo.com/', '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('combobox', { name: 'Proveedor de búsqueda' })).toBeNull();
  });

  it('bloquea protocolos peligrosos', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'javascript:alert(1){Enter}');
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('ICARUS no abre direcciones «javascript:» por seguridad.');
  });

  it('gestiona pestañas: crear, cambiar y cerrar', async () => {
    const { user } = renderApp();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Nueva pestaña' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    // La pestaña nueva muestra la página de inicio.
    expect(screen.getByRole('region', { name: 'Nueva pestaña' })).toBeInTheDocument();

    await typeAddress(user, 'example.com{Enter}');
    await user.click(screen.getAllByRole('tab')[0]!);
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: 'Cerrar example.com' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('navega atrás y adelante en el historial de la pestaña', async () => {
    const { user } = renderApp();
    const back = screen.getByRole('button', { name: 'Atrás' });
    expect(back).toBeDisabled();
    // Como en Edge, «Adelante» solo aparece cuando hay a dónde ir.
    expect(screen.queryByRole('button', { name: 'Adelante' })).toBeNull();

    await typeAddress(user, 'example.com{Enter}');
    expect(back).toBeEnabled();
    await user.click(back);
    expect(screen.getByRole('region', { name: 'Nueva pestaña' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(screen.getByRole('heading', { name: 'Página abierta fuera de ICARUS' })).toBeInTheDocument();
  });

  it('recarga una página web volviendo a entregarla al navegador externo', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'example.com{Enter}');
    await user.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('pide confirmación antes de abrir si así se configura', async () => {
    const { user, open, services } = renderApp();
    services.settings.set((s) => ({ ...s, navigation: { ...s.navigation, externalOpening: 'confirm' } }));
    await typeAddress(user, 'example.com{Enter}');
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Abrir en el navegador del sistema' })).toBeInTheDocument();

    // Recargar no abre nada en este modo.
    await user.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(open).not.toHaveBeenCalled();

    // La acción es un enlace real (funciona aunque se bloqueen las ventanas emergentes).
    const link = screen.getByRole('link', { name: 'Abrir en el navegador externo' });
    expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Página abierta fuera de ICARUS' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Abrir de nuevo' })).toBeInTheDocument();
  });

  const miweb = {
    id: 'deriv',
    target: 'https://bot.deriv.me/',
    address: 'https://miweb.com/',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const display = () => document.querySelector('.omnibox__display')?.textContent ?? '';

  it('muestra solo la dirección personalizada: sin etiqueta, sin icono de alias y sin la URL original', async () => {
    const { user, services, open } = renderApp();
    services.customAddresses.set([miweb]);
    await typeAddress(user, 'https://bot.deriv.me/panel?x=1#a{Enter}');
    // El motor recibe la URL real…
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/panel?x=1#a', '_blank', 'noopener,noreferrer');
    // …y la barra y la pestaña solo muestran la dirección personalizada.
    expect(display()).toBe('miweb.com/panel?x=1#a');
    expect(document.querySelector('.omnibox')).not.toHaveTextContent(/deriv|Alias/);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('miweb.com/panel?x=1#a');
    expect(document.querySelector('.tab')?.getAttribute('title')).not.toContain('deriv');
    // Al hacer clic se edita la dirección completa (con protocolo), seleccionada.
    await user.click(addressBar());
    expect(addressBar()).toHaveValue('https://miweb.com/panel?x=1#a');
    const input = addressBar() as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('Escape cancela la edición y recupera la dirección de la página', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([miweb]);
    await typeAddress(user, 'bot.deriv.me{Enter}');
    // Como en Chrome, el clic selecciona toda la dirección y lo que se escribe la sustituye.
    await user.click(addressBar());
    await user.keyboard('algo distinto');
    expect(addressBar()).toHaveValue('algo distinto');
    await user.keyboard('{Escape}');
    expect(addressBar()).toHaveValue('https://miweb.com/');
    expect(addressBar()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(addressBar()).not.toHaveFocus();
    expect(display()).toBe('miweb.com');
  });

  it('escribir la dirección personalizada navega al destino real equivalente', async () => {
    const { user, services, open } = renderApp();
    services.customAddresses.set([miweb]);
    await typeAddress(user, 'miw');
    expect(screen.getByRole('option', { name: /miweb\.com\s*Dirección personalizada/ })).toBeInTheDocument();
    await user.clear(addressBar());
    await user.type(addressBar(), 'miweb.com/otra?y=2{Enter}');
    expect(open).toHaveBeenLastCalledWith('https://bot.deriv.me/otra?y=2', '_blank', 'noopener,noreferrer');
    expect(display()).toBe('miweb.com/otra?y=2');
  });

  it('la información del sitio indica la conexión real y a qué sitio van las solicitudes', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([miweb]);
    await typeAddress(user, 'bot.deriv.me{Enter}');
    await user.click(screen.getByRole('button', { name: 'Ver información del sitio' }));
    const info = screen.getByRole('dialog', { name: 'Información del sitio' });
    expect(within(info).getByRole('heading', { name: 'miweb.com' })).toBeInTheDocument();
    expect(within(info).getByTestId('site-custom-address')).toHaveTextContent('Las solicitudes van al sitio real, bot.deriv.me');
  });

  it('las páginas HTTP muestran «No seguro», también con una dirección personalizada', async () => {
    const { user, services } = renderApp();
    services.customAddresses.set([{ ...miweb, target: 'http://intranet.ejemplo.com/', address: 'http://miweb.com/' }]);
    await typeAddress(user, 'http://intranet.ejemplo.com/{Enter}');
    expect(screen.getByRole('button', { name: 'No seguro · Ver información del sitio' })).toBeInTheDocument();
    expect(display()).toBe('miweb.com');
    await typeAddress(user, 'https://example.com/{Enter}');
    expect(screen.queryByRole('button', { name: /No seguro/ })).not.toBeInTheDocument();
  });

  it('como Chrome, oculta https:// y www. sin foco salvo si se pide la URL completa', async () => {
    const { user, services } = renderApp();
    await typeAddress(user, 'https://www.example.com/ruta{Enter}');
    expect(display()).toBe('example.com/ruta');
    services.settings.set((s) => ({ ...s, navigation: { ...s.navigation, showFullUrls: true } }));
    await waitFor(() => expect(display()).toBe('https://www.example.com/ruta'));
  });

  it('abre la configuración como página interna', async () => {
    const { user } = renderApp();
    await openSettingsFromMenu(user);
    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(addressBar()).toHaveValue('icarus://configuracion/general');
    await user.click(screen.getByRole('button', { name: 'Avanzado' }));
    expect(addressBar()).toHaveValue('icarus://configuracion/avanzado');
  });
});
