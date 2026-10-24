# Seguridad de ICARUS Browser (escritorio)

Resumen de las medidas de la aplicación de Electron y de sus límites conocidos. Las referencias apuntan al código que las aplica.

## Separación de privilegios

| Componente | Origen | Privilegios |
| --- | --- | --- |
| Interfaz de ICARUS | `icarus-app://ui/` servido desde `dist/` dentro del paquete (`uiProtocol.ts`) | Preload con `window.icarusNative`; sesión `icarus-ui` en memoria; no recibe contenido de las páginas |
| Páginas web | `WebContentsView` por pestaña (`tabs.ts`) | `sandbox`, `contextIsolation`, sin Node, sin preload, `webSecurity`, sin contenido mixto, sin `<webview>`; sesión `persist:icarus-web` |
| Proceso principal | `dist-electron/` dentro de `app.asar` | Node completo; solo escucha IPC de la interfaz |

- `app.enableSandbox()` activa el sandbox de Chromium en todos los renderizadores.
- La interfaz tiene una CSP estricta enviada como cabecera: `default-src 'self'`, `script-src 'self'`, `img-src 'self' data: blob:`, sin `object-src` ni marcos. No se cargan scripts ni estilos remotos en la interfaz.
- El preload es CommonJS sandboxed: solo usa `require('electron')` (`contextBridge` e `ipcRenderer`) y expone funciones concretas, nunca `ipcRenderer` completo.
- Cada mensaje IPC comprueba que procede de la `webContents` de la interfaz y de un marco `icarus-app://ui/`, y valida tipos, longitudes, identificadores, rectángulos y colores (`validate.ts`). Un argumento inválido rechaza la llamada.
- Las herramientas de desarrollo de la interfaz están desactivadas en el ejecutable empaquetado (`ICARUS_ENABLE_UI_DEVTOOLS=1` las habilita para depurar). Las de las páginas web (F12) funcionan como en cualquier navegador.

## Navegación

- La barra de direcciones y el proceso principal solo aceptan `http:` y `https:` (más `about:blank` dentro de las pestañas). `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `chrome:`, `devtools:`, `view-source:` y cualquier otro esquema se bloquean, también en enlaces y redirecciones (`will-navigate`, `will-redirect`). Un enlace `mailto:` o `tel:` no abre aplicaciones externas: ICARUS muestra un aviso y no hace nada más.
- `window.open` y `target="_blank"` se convierten en pestañas de ICARUS; nunca se crean ventanas de Electron nuevas (`setWindowOpenHandler`).
- La barra de direcciones no acepta URL con credenciales (`https://usuario:clave@…`).
- **TLS**: no hay manejador de `certificate-error`, así que Chromium rechaza los certificados no válidos y la pestaña muestra el error real. No existe forma de omitirlo desde ICARUS.
- Las páginas no pueden navegar la ventana de la interfaz (`will-navigate` cancelado).
- El agente de usuario es el de Chromium sin la marca «Electron».

## Permisos

| Permiso | Comportamiento |
| --- | --- |
| Pantalla completa, escritura sanitizada en el portapapeles, bloqueo del puntero | Permitidos (son acciones iniciadas por el usuario) |
| Cámara, micrófono, ubicación, notificaciones, lectura del portapapeles, MIDI | Se pregunta en una barra bajo la barra de herramientas, con el origen real; la decisión dura hasta cerrar ICARUS |
| Captura de pantalla (`getDisplayMedia`) | Denegada |
| USB, HID, puertos serie, Bluetooth | Denegados: se cancela la selección de dispositivo y `setDevicePermissionHandler` rechaza el acceso (`permissions.ts`, `main.ts`) |
| Cualquier otro | Denegado |

Las solicitudes pendientes se cancelan al cerrar o navegar la pestaña.

## Descargas

- Se guardan en la carpeta Descargas del sistema o en la elegida, con nombres saneados y sin sobrescribir archivos (`(1)`, `(2)`…).
- Una descarga solo figura como completada cuando Chromium informa `completed` y el archivo existe.
- ICARUS **nunca abre** desde la lista archivos que pueden ejecutar código (`.exe`, `.msi`, `.bat`, `.ps1`, `.js`, `.lnk`…): solo ofrece mostrarlos en la carpeta.

## Ejecutable

electron-builder aplica los fusibles de Electron (`electron-builder.yml`):

- `runAsNode: false` — `ELECTRON_RUN_AS_NODE` no convierte el ejecutable en un intérprete de Node.
- `enableNodeOptionsEnvironmentVariable: false` y `enableNodeCliInspectArguments: false` — no se puede inyectar código con `NODE_OPTIONS` ni `--inspect`.
- `enableEmbeddedAsarIntegrityValidation: true` y `onlyLoadAppFromAsar: true` — el código se carga solo desde `app.asar` y se comprueba su integridad.
- `enableCookieEncryption: true` — las cookies se cifran con la clave del sistema (DPAPI en Windows).
- `grantFileProtocolExtraPrivileges: false`.

El ejecutable no contiene claves, tokens ni credenciales de ningún servicio. **El instalador no está firmado**: Windows SmartScreen mostrará un aviso hasta que se firme con un certificado de firma de código.

## Datos

- Se guardan en `%APPDATA%\ICARUS Browser` con escritura atómica. No se guardan contraseñas (ICARUS no tiene gestor de contraseñas).
- Configuración → Privacidad borra historial, cookies y datos de sitios, caché y descargas por intervalo de tiempo, y puede borrar datos al salir.
- Todas las pestañas comparten un perfil: no hay aislamiento de cookies entre pestañas (ver [ENGINE_INTEGRATION.md](ENGINE_INTEGRATION.md#perfiles-y-sesiones)).

## Límites conocidos

- Sin actualizaciones automáticas: las correcciones de seguridad de Chromium llegan al publicar una versión nueva de ICARUS con un Electron más reciente.
- Sin Navegación segura (Safe Browsing) ni comprobación de reputación de descargas.
- Sin autenticación HTTP básica o NTLM (el diálogo de inicio de sesión no está implementado; esas páginas fallan).
- Sin Widevine: los servicios con DRM (Netflix, Disney+…) no reproducen vídeo.
- Algunos proveedores (p. ej. el inicio de sesión de Google) pueden rechazar navegadores integrados que no reconocen.
