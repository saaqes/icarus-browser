/**
 * Menú de aplicación de macOS. Sin él, Electron usa uno predeterminado en el que
 * ⌘W cierra la ventana entera y ⌘R recarga la interfaz de ICARUS en lugar de la
 * pestaña. Este menú solo incluye lo que macOS espera (Acerca de, Ocultar, Salir,
 * Edición para copiar y pegar en los campos, y Ventana); los atajos del navegador
 * (⌘T, ⌘W, ⌘R, ⌘L…) los gestiona tabs.ts igual que en Windows y Linux.
 */

import type { MenuItemConstructorOptions } from 'electron';

export function macMenuTemplate(appName: string): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `Acerca de ${appName}` },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${appName}` },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: `Salir de ${appName}` },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' },
      ],
    },
  ];
}
