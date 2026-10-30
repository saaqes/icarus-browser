import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { saveDocument } from '../../services/persistence/document';
import { createMemoryStorage } from '../../services/persistence/storage';
import { settingsSchema, updateProfile } from '../../services/settings/settings';
import { renderApp } from '../testUtils';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

describe('perfil personalizable', () => {
  it('sin nombre ni foto muestra la silueta; el panel lleva a Configuración → Perfil', async () => {
    const { user } = renderApp();
    const button = screen.getByRole('button', { name: 'Perfil: Perfil' });
    expect(button.querySelector('.profile-avatar--initial svg')).not.toBeNull();
    await user.click(button);
    const panel = screen.getByRole('dialog', { name: 'Perfil de ICARUS' });
    await user.click(within(panel).getByRole('button', { name: 'Personalizar perfil' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Perfil' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Barra de direcciones' })).toHaveValue('icarus://configuracion/perfil');
  });

  it('el nombre y el color cambian el círculo de la barra al momento y se guardan', async () => {
    const { user, services } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Perfil: Perfil' }));
    await user.click(screen.getByRole('button', { name: 'Personalizar perfil' }));
    await user.type(screen.getByRole('textbox', { name: 'Nombre del perfil' }), 'Ícaro');
    const button = await screen.findByRole('button', { name: 'Perfil: Ícaro' });
    expect(button).toHaveTextContent('Í');
    await user.click(screen.getByRole('radio', { name: 'Color 3' }));
    await waitFor(() => expect(services.settings.getSnapshot().profile).toMatchObject({ name: 'Ícaro', color: '#c2185b' }));
    expect(button.querySelector<HTMLElement>('.profile-avatar')!.style.background).toBe('rgb(194, 24, 91)');
  });

  it('muestra la foto guardada y permite quitarla', async () => {
    const storage = createMemoryStorage();
    saveDocument(storage, settingsSchema, updateProfile(settingsSchema.defaults(), { name: 'Ana', photo: PHOTO }));
    const { user, services } = renderApp({ storage });
    const button = screen.getByRole('button', { name: 'Perfil: Ana' });
    expect(button.querySelector('img')).toHaveAttribute('src', PHOTO);
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Personalizar perfil' }));
    await user.click(screen.getByRole('button', { name: 'Quitar foto' }));
    expect(services.settings.getSnapshot().profile.photo).toBeNull();
    expect(screen.getByRole('button', { name: 'Perfil: Ana' })).toHaveTextContent('A');
  });
});
