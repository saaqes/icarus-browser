/** Qué direcciones puede cargar una pestaña de ICARUS. */

export const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** Analiza una URL que la interfaz pide abrir: solo http(s), con host y sin credenciales. */
export function parseNavigableUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    if (!NAVIGABLE_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** ¿Puede una página navegar por sí misma a esta dirección (enlaces, redirecciones)? */
export function isAllowedPageNavigation(text: string): boolean {
  if (text === 'about:blank' || text.startsWith('about:blank#')) return true;
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(text).protocol);
  } catch {
    return false;
  }
}

export function protocolOf(text: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  return match ? `${match[1]!.toLowerCase()}:` : '';
}

/** Tipos de archivo que pueden ejecutar código: ICARUS no los abre directamente. */
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'msixbundle', 'msp', 'msc', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'ws', 'hta', 'cpl', 'jar', 'lnk', 'reg', 'dll', 'sys', 'appx', 'appxbundle', 'application',
  'gadget', 'inf', 'scf', 'url', 'sh', 'bash', 'zsh', 'command', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'run', 'apk', 'appimage',
  'xll', 'xlam', 'docm', 'xlsm', 'pptm', 'iso', 'img', 'vhd', 'vhdx', 'chm', 'library-ms', 'settingcontent-ms',
]);

export function isDangerousFile(fileName: string): boolean {
  const match = /\.([a-z0-9-]+)$/i.exec(fileName.trim());
  return match ? DANGEROUS_EXTENSIONS.has(match[1]!.toLowerCase()) : false;
}

/** Nombre de archivo seguro para Windows, macOS y Linux. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 200);
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  if (!cleaned || reserved.test(cleaned)) return `descarga${cleaned ? `-${cleaned}` : ''}`;
  return cleaned;
}
