import { screen, within } from '@testing-library/react';
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

  it('el estilo clásico de ICARUS conserva su marca y no tiene ese botón', () => {
    renderApp();
    expect(document.querySelector('.tabstrip__brand')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Pestañas abiertas' })).toBeNull();
  });
});
