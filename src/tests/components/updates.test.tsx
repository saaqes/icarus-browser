import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdatesView } from '../../components/Settings/sections/UpdatesSection';
import { shouldShowUpdateButton, type UpdateActions } from '../../components/Updates/UpdateControls';
import { saveDocument } from '../../services/persistence/document';
import { STORAGE_KEYS } from '../../services/persistence/keys';
import { createMemoryStorage } from '../../services/persistence/storage';
import { updateRestartSessionSchema } from '../../services/tabs/session';
import { createHistoryEntry, createSession, createTab, sessionReducer } from '../../services/tabs/tabs';
import type { UpdateInfo, UpdateState } from '../../types/native';
import { renderApp } from '../testUtils';

const NEXT: UpdateInfo = {
  version: '0.3.0',
  releasedAt: '2026-10-20T12:00:00.000Z',
  notes: 'Novedades:\n- Mejoras de rendimiento\n<script>alert(1)</script>',
  file: 'ICARUS-Browser-0.3.0-Setup-x64.exe',
  size: 94_371_840,
  releasePage: 'https://github.com/saaqes/icarus-browser/releases/tag/v0.3.0',
};

function state(patch: Partial<UpdateState> = {}): UpdateState {
  return {
    currentVersion: '0.2.0',
    channel: 'stable',
    mode: 'automatic',
    unsupportedReason: null,
    status: 'idle',
    lastCheckedAt: null,
    available: null,
    progress: null,
    error: null,
    postponedVersion: null,
    installOnQuit: false,
    manualFile: null,
    justUpdated: null,
    failedVersion: null,
    ...patch,
  };
}

function actions() {
  return {
    check: vi.fn<UpdateActions['check']>(),
    download: vi.fn<UpdateActions['download']>(),
    cancel: vi.fn<UpdateActions['cancel']>(),
    install: vi.fn<UpdateActions['install']>(),
    postpone: vi.fn<UpdateActions['postpone']>(),
    setChannel: vi.fn<UpdateActions['setChannel']>(),
    acknowledge: vi.fn<UpdateActions['acknowledge']>(),
    reveal: vi.fn<UpdateActions['reveal']>(),
    openRelease: vi.fn<UpdateActions['openRelease']>(),
  } satisfies UpdateActions;
}

function show(value: UpdateState, platform = 'win32') {
  const spies = actions();
  const user = userEvent.setup();
  render(<UpdatesView state={value} platform={platform} actions={spies} />);
  return { spies, user };
}

describe('Configuración → Actualizaciones', () => {
  it('muestra la versión instalada, el canal y que no hay novedades', async () => {
    const { spies, user } = show(state({ status: 'up-to-date', lastCheckedAt: '2026-10-25T08:00:00.000Z' }));
    expect(screen.getByText('ICARUS Browser 0.2.0')).toBeInTheDocument();
    expect(screen.getByText(/Canal estable · Última comprobación:/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('ICARUS está actualizado.');
    expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buscar actualizaciones' }));
    expect(spies.check).toHaveBeenCalledOnce();
  });

  it('ofrece la versión nueva con sus notas como texto y permite posponerla', async () => {
    const { spies, user } = show(state({ status: 'available', available: NEXT }));
    expect(screen.getByRole('status')).toHaveTextContent('Hay una versión nueva: 0.3.0.');
    const card = screen.getByRole('heading', { name: 'Novedades de la versión 0.3.0' }).closest('section')!;
    // Las notas no se interpretan como HTML.
    expect(within(card).getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(card.querySelector('script')).toBeNull();
    expect(within(card).getByText(/Tamaño de la descarga: 90 MB/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    expect(spies.download).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Recordármelo más tarde' }));
    expect(spies.postpone).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Página de la versión' }));
    expect(spies.openRelease).toHaveBeenCalledWith(NEXT.releasePage);
  });

  it('no vuelve a ofrecer posponer una versión ya pospuesta', () => {
    show(state({ status: 'available', available: NEXT, postponedVersion: '0.3.0' }));
    expect(screen.queryByRole('button', { name: 'Recordármelo más tarde' })).not.toBeInTheDocument();
    expect(screen.getByText(/No se volverá a avisar de esta versión/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled();
  });

  it('muestra el progreso de la descarga y bloquea la búsqueda y el cambio de canal', async () => {
    const { spies, user } = show(state({ status: 'downloading', available: NEXT, progress: { received: 47_185_920, total: 94_371_840 } }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('50 % · 45 MB de 90 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar actualizaciones' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Vista previa/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    expect(spies.cancel).toHaveBeenCalledOnce();
  });

  it('con el paquete verificado permite instalar y reiniciar o hacerlo al cerrar', async () => {
    const { spies, user } = show(state({ status: 'ready', available: NEXT }));
    expect(screen.getByRole('status')).toHaveTextContent('La versión 0.3.0 está descargada y verificada.');
    await user.click(screen.getByRole('button', { name: 'Instalar y reiniciar' }));
    expect(spies.install).toHaveBeenLastCalledWith('now');
    await user.click(screen.getByRole('button', { name: 'Instalar al cerrar ICARUS' }));
    expect(spies.install).toHaveBeenLastCalledWith('on-quit');
  });

  it('confirma que se instalará al cerrar', () => {
    show(state({ status: 'ready', available: NEXT, installOnQuit: true }));
    expect(screen.getByRole('status')).toHaveTextContent('La versión 0.3.0 se instalará al cerrar ICARUS.');
    expect(screen.queryByRole('button', { name: 'Instalar al cerrar ICARUS' })).not.toBeInTheDocument();
  });

  it('versión portátil: descarga y verifica, pero el usuario coloca el paquete', async () => {
    const zip = { ...NEXT, file: 'ICARUS-Browser-0.3.0-win-x64.zip' };
    const first = show(state({ mode: 'manual-portable', status: 'available', available: zip }));
    expect(screen.getByText(/Versión portátil/)).toBeInTheDocument();
    await first.user.click(screen.getByRole('button', { name: 'Descargar actualización' }));
    expect(first.spies.download).toHaveBeenCalledWith(false);
  });

  it('modo manual: muestra el paquete verificado', async () => {
    const { spies, user } = show(
      state({ mode: 'manual-dmg', status: 'ready', available: NEXT, manualFile: '/Users/ana/Library/ICARUS/updates/0.3.0/ICARUS-Browser-0.3.0-arm64.dmg' }),
      'darwin',
    );
    expect(screen.getByText(/arrastra ICARUS Browser a Aplicaciones/)).toBeInTheDocument();
    expect(screen.getByText(/updates\/0\.3\.0\/ICARUS-Browser-0\.3\.0-arm64\.dmg/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instalar y reiniciar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar el paquete' }));
    expect(spies.reveal).toHaveBeenCalledOnce();
  });

  it('Linux: solo avisa y abre la página de la versión', async () => {
    const { spies, user } = show(state({ mode: 'manual-release', status: 'available', available: { ...NEXT, file: null, size: null } }), 'linux');
    expect(screen.queryByRole('button', { name: 'Actualizar ahora' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver la versión' }));
    expect(spies.openRelease).toHaveBeenCalledWith(NEXT.releasePage);
  });

  it('explica los errores de red y permite reintentar la búsqueda', async () => {
    const { spies, user } = show(state({ status: 'error', error: { code: 'network', detail: 'ENOTFOUND' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor de actualizaciones.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(spies.check).toHaveBeenCalledOnce();
  });

  it('un paquete con otra huella se descarta y se puede volver a descargar', async () => {
    const { spies, user } = show(state({ status: 'error', available: NEXT, error: { code: 'hash-mismatch', detail: null } }));
    expect(screen.getByRole('alert')).toHaveTextContent('no coincide con el publicado (SHA-256)');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(spies.download).toHaveBeenCalledWith(true);
  });

  it('informa de una instalación fallida sin reintentarla sola', () => {
    show(state({ status: 'error', failedVersion: '0.3.0', error: { code: 'install-failed', detail: '0.3.0' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('La instalación de la versión 0.3.0 no se completó; no se volverá a intentar sola.');
  });

  it('confirma la versión instalada después de actualizar', async () => {
    const { spies, user } = show(state({ currentVersion: '0.3.0', status: 'idle', justUpdated: { from: '0.2.0', to: '0.3.0' } }));
    expect(screen.getByText('ICARUS se ha actualizado de la versión 0.2.0 a la 0.3.0.')).toBeInTheDocument();
    expect(screen.getByText('ICARUS Browser 0.3.0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(spies.acknowledge).toHaveBeenCalledOnce();
  });

  it('permite elegir el canal de vista previa', async () => {
    const { spies, user } = show(state({ status: 'up-to-date' }));
    expect(screen.getByRole('radio', { name: /Estable/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Vista previa/ }));
    expect(spies.setChannel).toHaveBeenCalledWith('preview');
  });

  it('en una compilación de desarrollo no busca actualizaciones', () => {
    show(state({ mode: 'unsupported', unsupportedReason: 'development' }));
    expect(screen.queryByRole('button', { name: 'Buscar actualizaciones' })).not.toBeInTheDocument();
    expect(screen.getByText(/compilación de desarrollo/)).toBeInTheDocument();
  });

  it('sin clave pública explica por qué no hay actualizaciones integradas', () => {
    show(state({ mode: 'unsupported', unsupportedReason: 'no-key' }));
    expect(screen.getByText(/no incluye la clave pública/)).toBeInTheDocument();
  });
});

describe('aviso de la barra', () => {
  it('aparece con una versión nueva y no para una versión pospuesta', () => {
    expect(shouldShowUpdateButton(null)).toBe(false);
    expect(shouldShowUpdateButton(state({ status: 'up-to-date' }))).toBe(false);
    expect(shouldShowUpdateButton(state({ status: 'available', available: NEXT }))).toBe(true);
    expect(shouldShowUpdateButton(state({ status: 'available', available: NEXT, postponedVersion: '0.3.0' }))).toBe(false);
    // Si el usuario la descarga desde Configuración, el aviso muestra el progreso.
    expect(shouldShowUpdateButton(state({ status: 'downloading', available: NEXT, postponedVersion: '0.3.0' }))).toBe(true);
    // Una versión más nueva que la pospuesta vuelve a avisarse.
    expect(shouldShowUpdateButton(state({ status: 'available', available: { ...NEXT, version: '0.3.1' }, postponedVersion: '0.3.0' }))).toBe(true);
    expect(shouldShowUpdateButton(state({ mode: 'unsupported', status: 'available', available: NEXT }))).toBe(false);
  });
});

describe('reinicio para actualizar', () => {
  it('reabre las pestañas guardadas antes del reinicio una sola vez, aunque no se restaure la sesión', () => {
    const storage = createMemoryStorage();
    let session = createSession(createTab('a', createHistoryEntry({ kind: 'web', url: 'https://example.com/', title: 'Example', openedExternally: false }, 'a1', 1)));
    session = sessionReducer(session, { type: 'tab/create', tab: createTab('b', createHistoryEntry({ kind: 'settings', section: 'updates' }, 'b1', 2)) });
    saveDocument(storage, updateRestartSessionSchema, session);

    const first = renderApp({ storage });
    expect(first.services.settings.getSnapshot().general.startup).toBe('new-tab');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Example');
    expect(storage.getItem(STORAGE_KEYS.updateRestartSession)).toBeNull();
    first.unmount();

    // El siguiente arranque normal vuelve a respetar «Abrir una pestaña nueva».
    renderApp({ storage });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Nueva pestaña');
  });
});
