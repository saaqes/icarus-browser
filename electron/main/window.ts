/** Ventana principal: la interfaz de ICARUS con la barra de título integrada. */

import { BrowserWindow, screen, type Session } from 'electron';
import { JsonFile } from './jsonFile';
import { isRecord } from './validate';

interface WindowState {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = { x: null, y: null, width: 1280, height: 820, maximized: false };
export const TITLE_BAR_HEIGHT = 44;

function sanitizeWindowState(raw: unknown): WindowState {
  if (!isRecord(raw)) return { ...DEFAULT_STATE };
  const num = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null;
  return {
    x: num(raw.x, -20_000, 20_000),
    y: num(raw.y, -20_000, 20_000),
    width: num(raw.width, 480, 20_000) ?? DEFAULT_STATE.width,
    height: num(raw.height, 360, 20_000) ?? DEFAULT_STATE.height,
    maximized: raw.maximized === true,
  };
}

/** ¿Sigue visible la posición guardada en alguna pantalla? */
function isOnScreen(state: WindowState): boolean {
  if (state.x === null || state.y === null) return false;
  return screen.getAllDisplays().some(({ workArea }) =>
    state.x! < workArea.x + workArea.width - 80 &&
    state.x! + state.width > workArea.x + 80 &&
    state.y! >= workArea.y - 20 &&
    state.y! < workArea.y + workArea.height - 80,
  );
}

export function createMainWindow(options: { uiSession: Session; preloadPath: string; statePath: string; devTools: boolean }) {
  const stateFile = new JsonFile<WindowState>(options.statePath, { version: 1, defaults: () => ({ ...DEFAULT_STATE }), sanitize: sanitizeWindowState });
  const saved = stateFile.get();
  const position = isOnScreen(saved) ? { x: saved.x!, y: saved.y! } : {};

  const window = new BrowserWindow({
    ...position,
    width: saved.width,
    height: saved.height,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'ICARUS Browser',
    backgroundColor: '#0e0d12',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarOverlay: { color: '#0e0d12', symbolColor: '#f3f0fb', height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      session: options.uiSession,
      preload: options.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: options.devTools,
    },
  });

  if (saved.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  const remember = () => {
    if (window.isDestroyed() || window.isFullScreen()) return;
    const bounds = window.getNormalBounds();
    stateFile.set({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: window.isMaximized() });
  };
  window.on('resize', remember);
  window.on('move', remember);
  window.on('close', () => {
    remember();
    stateFile.flush();
  });

  // La interfaz no debe cambiar de zoom ni navegar fuera de sí misma.
  window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  return window;
}
