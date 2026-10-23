import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../testUtils';

const addressBar = () => screen.getByRole('combobox', { name: 'Barra de direcciones' });

/** Escribe en la barra de direcciones como un usuario: clic, borrar y escribir. */
async function typeAddress(user: ReturnType<typeof renderApp>['user'], text: string) {
  await user.click(addressBar());
  await user.clear(addressBar());
  await user.type(addressBar(), text);
}

describe('barra de direcciones y navegación', () => {
  it('busca texto con el proveedor elegido y deja claro que se abre fuera', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'vuelo de ícaro');
    expect(screen.getByRole('option', { name: /Buscar en Google · se abre en el navegador externo/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(open).toHaveBeenCalledWith('https://www.google.com/search?q=vuelo%20de%20%C3%ADcaro', '_blank', 'noopener,noreferrer');
    expect(await screen.findByRole('heading', { name: 'Página abierta fuera de ICARUS' })).toBeInTheDocument();
    expect(screen.getByText(/no dentro de esta pestaña/)).toBeInTheDocument();
  });

  it('reconoce direcciones web', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'example.com/ruta{Enter}');
    expect(open).toHaveBeenCalledWith('https://example.com/ruta', '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('example.com');
  });

  it('cambia el proveedor desde el buscador de inicio y lo conserva', async () => {
    const { user, open, storage, unmount } = renderApp();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Proveedor de búsqueda' }), 'bing');
    await user.type(screen.getByRole('textbox', { name: 'Buscar en la web' }), 'ícaro{Enter}');
    expect(open).toHaveBeenCalledWith('https://www.bing.com/search?q=%C3%ADcaro', '_blank', 'noopener,noreferrer');
    unmount();

    renderApp({ storage });
    expect(screen.getByRole('combobox', { name: 'Proveedor de búsqueda' })).toHaveValue('bing');
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
    const forward = screen.getByRole('button', { name: 'Adelante' });
    expect(back).toBeDisabled();

    await typeAddress(user, 'example.com{Enter}');
    expect(back).toBeEnabled();
    await user.click(back);
    expect(screen.getByRole('region', { name: 'Nueva pestaña' })).toBeInTheDocument();
    expect(forward).toBeEnabled();
    await user.click(forward);
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

  it('muestra el alias sin ocultar la URL real', async () => {
    const { user } = renderApp();
    await typeAddress(user, 'https://www.google.com/{Enter}');

    // Pestaña con el nombre visible de la regla y barra con el alias + host real.
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Buscar');
    const display = document.querySelector('.omnibox__display')!;
    expect(display).toHaveTextContent('Alias');
    expect(display).toHaveTextContent('buscar.icarus');
    expect(display).toHaveTextContent('www.google.com');
    // El valor del campo sigue siendo la URL real.
    expect(addressBar()).toHaveValue('https://www.google.com/');

    // El control de información permite verificar la URL real.
    await user.click(screen.getByRole('button', { name: 'Ver información y URL real' }));
    const info = screen.getByRole('dialog', { name: 'Información de la página' });
    expect(within(info).getByTestId('real-url')).toHaveTextContent('https://www.google.com/');
    expect(within(info).getByText(/No cambia el dominio, el DNS/)).toBeInTheDocument();

    // Al editar, el campo muestra la URL real y lo indica.
    await user.click(within(info).getByRole('button', { name: 'Editar URL real' }));
    expect(addressBar()).toHaveFocus();
    expect(addressBar()).toHaveValue('https://www.google.com/');
    expect(screen.getByText(/se muestra la URL real para que la consultes o la edites/)).toBeInTheDocument();
  });

  it('resuelve un alias escrito solo si su regla está activa', async () => {
    const { user, open } = renderApp();
    await typeAddress(user, 'buscar.icarus{Enter}');
    expect(open).toHaveBeenLastCalledWith('https://www.google.com/', '_blank', 'noopener,noreferrer');

    await typeAddress(user, 'wiki.icarus{Enter}');
    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('La regla del alias «wiki.icarus» está desactivada.')).toBeInTheDocument();
  });

  it('abre la configuración como página interna', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Configuración' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(addressBar()).toHaveValue('icarus://configuracion/general');
    await user.click(screen.getByRole('button', { name: 'Avanzado' }));
    expect(addressBar()).toHaveValue('icarus://configuracion/avanzado');
  });
});
