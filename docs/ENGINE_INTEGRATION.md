# Motor de navegación

ICARUS tiene dos modos con la **misma interfaz** (`src/`):

| Modo | Motor | Cómo se elige |
| --- | --- | --- |
| Escritorio (Electron) | `createNativeEngine()` → Chromium, una `WebContentsView` por pestaña | Existe `window.icarusNative` con `apiVersion` 1 (lo expone el preload) |
| Web (prototipo, HTML autocontenido) | `ExternalBrowserEngine` → `window.open` en el navegador del sistema | No hay puente nativo |

`src/app/services.ts` (`getNativeApi()`) decide el modo al arrancar. No hay detección por agente de usuario ni por plataforma.

## Por qué Electron y no CEF o WebView2

- **Electron** incluye Chromium y Node en el proceso principal, `WebContentsView` (varias vistas en una ventana), sesiones y perfiles, `webRequest` para Shield, descargas, permisos y un empaquetador maduro (electron-builder) con instalador NSIS. Todo el código es TypeScript, igual que la interfaz.
- **CEF** exigía un host en C++ o .NET y reimplementar empaquetado, descargas y permisos.
- **WebView2** depende del runtime de Edge instalado y no permite controlar la versión de Chromium que se distribuye.

Versión actual: Electron 44.9.3 con Chromium 152.0.7977.167.

## Procesos

```
┌──────────────────────────────── BrowserWindow (proceso principal) ─────────────────────────────┐
│  Interfaz de ICARUS  ·  icarus-app://ui/index.html  ·  sesión «icarus-ui» (en memoria)        │
│  preload mínimo → window.icarusNative                                                            │
│  ┌─────────────────────────── #icarus-viewport ───────────────────────────┐                     │
│  │  WebContentsView de la pestaña activa (sesión «persist:icarus-web»)    │  una por pestaña   │
│  │  sandbox · contextIsolation · sin preload · sin Node                   │  web abierta       │
│  └────────────────────────────────────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- La interfaz informa del rectángulo de `#icarus-viewport` (`tabs.setBounds`) con un `ResizeObserver`; el proceso principal coloca ahí la vista activa.
- Cuando se abre un menú, el panel «Personalizar» o un diálogo, la interfaz pide una captura de la página (`tabs.snapshot`), la muestra como imagen y oculta la vista nativa, porque una vista nativa siempre se dibuja por encima del HTML. Al cerrarse, vuelve la vista real.
- La interfaz nunca recibe contenido de las páginas, y las páginas nunca reciben `window.icarusNative`.

## Contrato IPC

Los tipos están en `src/types/native.ts` y los compilan tanto Vite como `tsc`. Resumen:

| Grupo | Métodos | Canal |
| --- | --- | --- |
| `storage` | `snapshot`, `setItem`, `removeItem` | `icarus:bootstrap` (síncrono, al arrancar), `icarus:storage:*` |
| `tabs` | `navigate`, `goBack`, `goForward`, `reload`, `stop`, `close`, `show`, `setBounds`, `snapshot`, `find`, `stopFind` | `icarus:tabs:*` |
| `history` | `list`, `remove` | `icarus:history:*` |
| `downloads` | `list`, `cancel`, `open`, `showInFolder`, `clear`, `chooseDirectory` | `icarus:downloads:*` |
| `shield` | `getState`, `setEnabled`, `setListEnabled`, `addList`, `removeList`, `updateLists`, `setCustomRules`, `setSiteAllowed` | `icarus:shield:*` |
| `privacy`, `permissions`, `auth`, `preferences`, `favicons`, `window` | borrar datos, responder permisos, enviar o cancelar credenciales HTTP, preferencias de escritorio, iconos, colores de la barra de título | `icarus:*` |
| `onEvent` | `tab-state`, `open-in-new-tab`, `shortcut`, `permission-request`, `auth-request`, `find-result`, `downloads`, `history-changed`, `shield`… | `icarus:event` |

`electron/main/ipc.ts` comprueba en cada mensaje que el remitente es la `webContents` de la interfaz y que la URL del marco es `icarus-app://ui/`, y valida cada argumento (`electron/main/validate.ts`); un argumento inválido rechaza la llamada.

## Pestañas e historial

El estado de pestañas sigue en el reducer de la interfaz (`src/services/tabs/tabs.ts`), que guarda una lista de entradas por pestaña: páginas internas (`newtab`, `settings`, `history`, `downloads`…) y entradas `web`. Cada entrada `web` es un **tramo** de navegación dentro de Chromium:

1. Al abrir una URL desde la barra se crea una entrada `web` y se llama a `tabs.navigate(tabId, url, { newSegment: true })`. El proceso principal crea la vista si no existe y, al confirmarse la primera navegación del tramo, borra el historial anterior de Chromium.
2. Los clics en enlaces, redirecciones y navegaciones de la propia página quedan en el historial de Chromium y llegan como eventos `tab-state` (URL, título, carga, `canGoBack`, `canGoForward`, icono, error y contador de Shield). La acción `tab/update-web` actualiza la URL y el título de la entrada actual.
3. Atrás y Adelante usan primero el historial de Chromium; cuando se acaba, pasan a la entrada anterior o siguiente de ICARUS (por ejemplo, de vuelta a la página de nueva pestaña).
4. Al cerrar una pestaña se destruye su vista (`tabs.close`) y Chromium libera el proceso del renderizador. Ctrl+Mayús+T reabre las pestañas cerradas recientemente en la última página que mostraban (sin su historial de atrás y adelante).
5. Con «Restaurar las pestañas», las entradas `web` restauradas se cargan cuando se activa su pestaña, no todas al arrancar.

Errores de navegación: `did-fail-load` se clasifica en `network`, `certificate` (códigos −200 a −299), `blocked` o `crashed` y se muestra una página de error de ICARUS con el código real de Chromium. No hay botón para omitir errores de certificado.

### Perfiles y sesiones

**Todas las pestañas comparten un único perfil** (`persist:icarus-web`): las mismas cookies, `localStorage`, IndexedDB y caché. Iniciar sesión en un sitio en una pestaña te deja con la sesión iniciada en las demás, como en una ventana normal de Chrome. Cada pestaña sí tiene su propio proceso de renderizador con sandbox (aislamiento de procesos de Chromium), pero eso no aísla los datos. Por eso `isolatedTabSessions` es `false` y la interfaz no anuncia sesiones independientes.

La interfaz usa otra sesión (`icarus-ui`, en memoria) que no comparte nada con las páginas.

## Alias de URL

Los alias se aplican en la interfaz sobre la URL que informa Chromium en cada evento `tab-state`:

- La vista carga siempre la URL real; Chromium valida su certificado como en cualquier otra página.
- Escribir `buscar.icarus` solo navega a la URL de destino de una regla activa; nunca se crea un dominio, un registro DNS ni un certificado falso.
- Cuando la URL real deja de coincidir con la regla (la página redirige o el usuario sigue un enlace), la barra muestra la URL real nueva sin alias.
- El panel de información de la página muestra la URL real, el alias y la regla por separado.

## Persistencia en escritorio

Todo se guarda en la carpeta de datos de usuario de Electron (`%APPDATA%\ICARUS Browser` en Windows; `ICARUS_USER_DATA_DIR` la cambia, lo usan las pruebas):

| Archivo | Contenido |
| --- | --- |
| `ui-storage.json` | Las claves `icarus.*` de la interfaz (preferencias, accesos directos, alias, widgets, fondo, sesión) |
| `preferences.json` | Descargas (preguntar dónde guardar, carpeta) y privacidad (borrar al salir) |
| `history.json` | Historial (máximo 10 000 visitas) |
| `downloads.json` | Lista de descargas |
| `shield/` | Configuración y listas de ICARUS Shield ([SHIELD.md](SHIELD.md)) |
| `window-state.json` | Tamaño, posición y estado maximizado de la ventana |
| `Partitions/icarus-web/` | Cookies, caché y almacenamiento de los sitios (gestionado por Chromium) |

- Cada archivo tiene el sobre `{ version, savedAt, data }`, se escribe en un archivo temporal y se renombra (no queda a medias si se corta la luz), y se sanea al leerlo. Un archivo dañado se conserva como `<archivo>.corrupt-<fecha>` y se usan los valores predeterminados.
- **Migración desde LocalStorage**: al primer arranque, si `ui-storage.json` está vacío, la interfaz copia las claves `icarus.*` que hubiera en el LocalStorage de su origen (versión preliminar anterior) y a partir de ahí solo usa el archivo. Los esquemas y migraciones de versión de cada documento son los mismos que en la versión web.
- Al actualizar ICARUS con un instalador nuevo, la carpeta de datos no se toca. El desinstalador tampoco la borra (`deleteAppDataOnUninstall: false`).

## Preparado, pero no implementado

Estas piezas **no existen** en esta versión y la interfaz no las muestra como disponibles:

| Función | Qué hay preparado | Qué falta |
| --- | --- | --- |
| Perfiles aislados | Las vistas reciben la sesión desde `TabManager`; añadir perfiles es crear más particiones `persist:<perfil>`. | Interfaz de perfiles, ventana por perfil y migración de datos. |
| Sincronización y cuentas | Todos los datos están en documentos versionados `{ version, data }`, aptos para enviarse a un servicio. | Servicio (p. ej. FastAPI + PostgreSQL con JSONB), autenticación OAuth 2.1/OIDC y cifrado de extremo a extremo. Ninguna credencial se incluye en el ejecutable. |
| Funciones de IA | Nada en el ejecutable. | Antes de añadirlas: qué datos salen del equipo, consentimiento explícito y claves gestionadas por un servicio, nunca dentro de la aplicación. |
| Actualizaciones automáticas | El instalador NSIS genera `.blockmap`, que usa electron-updater. | Firma de código y un canal de publicación. Hoy se actualiza instalando la versión nueva encima. |
| Android | — | Aplicación propia (Kotlin + WebView o GeckoView). El instalador de Windows no sirve en Android. |
| iPhone | — | Aplicación propia con WKWebView según las normas de la App Store. El instalador de Windows no sirve en iOS. |
| macOS y Linux | El código es multiplataforma y `electron-builder.yml` tiene objetivos `dir`; las pruebas E2E se ejecutan en Linux. | Instaladores (dmg/AppImage), firma y notarización. |
