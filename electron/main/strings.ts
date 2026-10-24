/** Textos del proceso principal (menús nativos y diálogos). */
export const STRINGS = {
  contextMenu: {
    back: 'Atrás',
    forward: 'Adelante',
    reload: 'Volver a cargar',
    openLinkInNewTab: 'Abrir enlace en una pestaña nueva',
    copyLinkAddress: 'Copiar dirección del enlace',
    openImageInNewTab: 'Abrir imagen en una pestaña nueva',
    saveImageAs: 'Guardar imagen como…',
    copyImage: 'Copiar imagen',
    copyImageAddress: 'Copiar dirección de la imagen',
    searchFor: (text: string) => `Buscar «${text.length > 24 ? `${text.slice(0, 24)}…` : text}»`,
    undo: 'Deshacer',
    redo: 'Rehacer',
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar',
    selectAll: 'Seleccionar todo',
    inspect: 'Inspeccionar',
  },
  dialogs: {
    saveAs: 'Guardar como',
    chooseDownloadFolder: 'Elegir carpeta de descargas',
  },
};
