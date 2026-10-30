import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { saveDocument } from '../../services/persistence/document';
import { createMemoryStorage } from '../../services/persistence/storage';
import { settingsSchema, setTheme } from '../../services/settings/settings';
import { renderApp } from '../testUtils';

/** Arranca la app en el estilo Panorama (Edge). */
function renderEdge() {
  const storage = createMemoryStorage();
  saveDocument(storage, settingsSchema, setTheme(settingsSchema.defaults(), 'edge-inspired'));
  return renderApp({ storage });
}

const display = () => document.querySelector('.omnibox__display')?.textContent ?? '';

describe('Modo Edge (Panorama)', () => {
  it('no muestra la marca ICARUS en la esquina y pone un botón de pestañas', () => {
    renderEdge();
    const strip = document.querySelector('.tabstrip')!;
    // La esquina superior izquierda ya no lleva la marca de la aplicación.
    expect(strip.querySelector('.tabstrip__brand')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pestañas abiertas' })).toBeInTheDocument();
  });

  it('el botón de la esquina abre la lista de pestañas y permite crear una nueva', async () => {
    const { user } = renderEdge();
    await user.click(screen.getByRole('button', { name: 'Pestañas abiertas' }));
    const menu = screen.getByRole('menu', { name: 'Pestañas abiertas' });
    // Una pestaña inicial + la acción de nueva pestaña (que lleva el atajo Ctrl+T).
    const items = within(menu).getAllByRole('menuitem');
    expect(items.length).toBeGreaterThanOrEqual(2);
    const nueva = items.find((item) => item.textContent?.includes('Ctrl+T'))!;
    expect(nueva).toBeTruthy();
    await user.click(nueva);
    expect(screen.getAllByRole('tab').length).toBe(2);
  });

  it('la barra muestra siempre el protocolo real delante de la dirección, como Edge', async () => {
    const { user } = renderEdge();
    const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
    await user.click(bar);
    await user.type(bar, 'home.deriv.me/dashboard/login{Enter}');
    await waitFor(() => expect(display()).toBe('https://home.deriv.me/dashboard/login'));
    await user.click(bar);
    await user.clear(bar);
    await user.type(bar, 'http://intranet.ejemplo.com/{Enter}');
    // Una página HTTP nunca se presenta como https://.
    await waitFor(() => expect(display()).toBe('http://intranet.ejemplo.com/'));
  });

  it('en Esencial (Chrome) la dirección sigue en forma corta', async () => {
    const storage = createMemoryStorage();
    saveDocument(storage, settingsSchema, setTheme(settingsSchema.defaults(), 'google-inspired'));
    const { user } = renderApp({ storage });
    const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
    await user.click(bar);
    await user.type(bar, 'home.deriv.me/dashboard/login{Enter}');
    await waitFor(() => expect(display()).toBe('home.deriv.me/dashboard/login'));
    expect(screen.queryByTestId('app-shortcut-button')).toBeNull();
  });

  it('el botón de aplicaciones de la barra añade y quita la página de Nueva pestaña', async () => {
    const { user, services } = renderEdge();
    const bar = screen.getByRole('combobox', { name: 'Barra de direcciones' });
    await user.click(bar);
    await user.type(bar, 'tienda.ejemplo.com/ofertas{Enter}');
    const button = await screen.findByRole('button', { name: 'Añadir a la página Nueva pestaña' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(services.shortcuts.getSnapshot().some((item) => item.url === 'https://tienda.ejemplo.com/ofertas')).toBe(true);
    const remove = screen.getByRole('button', { name: 'Quitar de la página Nueva pestaña' });
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    await user.click(remove);
    expect(services.shortcuts.getSnapshot().some((item) => item.url === 'https://tienda.ejemplo.com/ofertas')).toBe(false);
  });

  it('a la derecha: favoritos, perfil y el menú «…»', () => {
    renderEdge();
    const actions = document.querySelector('.toolbar__actions')!;
    const labels = [...actions.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Favoritos', 'Perfil: Perfil', 'Menú de ICARUS']);
  });

  it('el estilo clásico de ICARUS conserva su marca y no tiene ese botón', () => {
    renderApp();
    expect(document.querySelector('.tabstrip__brand')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Pestañas abiertas' })).toBeNull();
  });
});
