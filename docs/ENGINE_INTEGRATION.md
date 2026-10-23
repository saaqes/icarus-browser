# Integración de un motor de navegación real

Hoy ICARUS usa `ExternalBrowserEngine`, que entrega cada URL al navegador del sistema. Este documento describe cómo sustituirlo por un motor integrado en cada plataforma sin rehacer la interfaz.

## Contrato existente

`src/services/navigation/engine.ts` define `BrowserEngine`:

```ts
interface BrowserEngine {
  readonly info: EngineInfo;               // id, nombre, tipo y capacidades
  navigate(request): Promise<NavigationOutcome>;
  attachTab?(tabId): void;                 // crear la vista web de una pestaña
  detachTab?(tabId): void;                 // destruirla al cerrar la pestaña
  goBack?(tabId): void;
  goForward?(tabId): void;
  reload?(tabId): void;
  stop?(tabId): void;
  subscribe?(listener: (event: EngineEvent) => void): () => void;
}
```

Capacidades (`EngineCapabilities`) que un motor integrado debe declarar:

| Capacidad | Significado | Efecto en la interfaz |
| --- | --- | --- |
| `embeddedRendering` | Las páginas se dibujan dentro de ICARUS. | La pestaña deja de mostrar `ExternalPage` y reserva el área para la vista nativa. |
| `isolatedTabSessions` | Cookies y almacenamiento propios por pestaña (o perfil). | Se puede anunciar en la interfaz. |
| `nativeHistory` | El motor gestiona atrás/adelante/recargar. | Los botones llaman a `engine.goBack()` etc. en lugar del reducer. |
| `pageEvents` | El motor informa de URL, título, icono y carga. | El reducer se actualiza desde `subscribe()`. |

Eventos (`EngineEvent`): `url-changed`, `title-changed`, `favicon-changed`, `loading-changed`.

## Pasos comunes a todas las plataformas

1. **Puente de mensajes.** El host nativo expone un objeto (por ejemplo `window.icarusNative`) con `postMessage` y un canal de eventos. Un `NativeBridgeEngine` implementa `BrowserEngine` sobre ese puente; `createAppServices({ engine })` lo recibe si el puente existe y, si no, sigue usando el motor externo.
2. **Pestañas.** `BrowserContext` llamará a `attachTab` al crear una pestaña y a `detachTab` al cerrarla. Cada `Tab.id` se asocia a una instancia de navegación del motor.
3. **Eventos → estado.** Nuevas acciones del reducer (`tab/engine-url`, `tab/engine-title`, `tab/engine-favicon`) actualizan la entrada actual. `describePage()` ya admite títulos derivados; habrá que añadir campos opcionales `title` y `faviconUrl` a la entrada externa.
4. **Alias.** Las reglas se aplican igual que hoy, pero sobre la URL que informa el motor en `url-changed`. Nunca se reescribe la URL que carga el motor ni se intercepta la resolución DNS; el alias sigue siendo solo presentación en la barra nativa o web.
5. **Seguridad real.** Con un motor integrado sí podrá mostrarse el estado del certificado, pero solo a partir de la información del motor (nunca simulada). Los avisos de seguridad del motor deben tener prioridad sobre cualquier alias.
6. **Persistencia.** Implementar `KeyValueStorage` sobre el almacenamiento nativo (ver abajo) y migrar una vez los datos de LocalStorage leyendo las mismas claves `icarus.*`. Los esquemas y migraciones actuales se reutilizan sin cambios.

## Windows: CEF / Chromium

Opciones evaluadas:

- **CEF (Chromium Embedded Framework)** con C++ o mediante CefSharp (.NET). Permite una vista por pestaña, perfiles (`CefRequestContext`) para aislar sesiones y eventos de carga, título, icono y URL.
- **WebView2** (Edge/Chromium del sistema) es más sencillo de distribuir; también encaja en el contrato, aunque ata la aplicación al runtime de Microsoft.

Propuesta: una ventana nativa con dos capas: la interfaz de ICARUS (esta aplicación compilada en `dist/`, servida desde un esquema local como `icarus-app://`) para pestañas, barra y páginas internas, y una vista CEF por pestaña situada en el área `#icarus-viewport`. El host informa del rectángulo del área cada vez que cambia el tamaño.

Persistencia: archivo JSON o SQLite en `%APPDATA%\ICARUS\`.

## Android: Kotlin

- Vista nativa con `WebView` (o GeckoView si se quiere independencia del motor del sistema).
- La interfaz puede ser nativa (Jetpack Compose) reutilizando los mismos esquemas (exportados como JSON) y reglas, o una vista web con esta interfaz adaptada a móvil.
- Persistencia: Jetpack DataStore. Las reglas de alias y la validación pueden portarse a Kotlin a partir de las pruebas existentes, que sirven como especificación.

## iPhone: Swift + WKWebView

- En iOS los navegadores deben usar WebKit (`WKWebView`) salvo en las regiones donde Apple permite motores alternativos con autorización específica; hay que revisar las condiciones vigentes de la App Store antes de distribuir.
- Una `WKWebView` por pestaña; `WKWebsiteDataStore` no persistente o separado para sesiones aisladas.
- Persistencia: archivos en el contenedor de la aplicación o `UserDefaults` para preferencias pequeñas. Nunca guardar secretos fuera del Llavero (Keychain).

## Servicios: FastAPI + PostgreSQL (futuro)

Solo cuando existan cuentas o sincronización:

- API FastAPI con autenticación (OAuth 2.1 / OIDC), endpoints para preferencias, accesos directos y reglas de alias usando los mismos esquemas versionados (`version` + `data`).
- PostgreSQL con columnas JSONB por documento y control de versiones para resolver conflictos de sincronización.
- Las funciones de IA, si se añaden, deben anunciarse solo cuando estén implementadas y detallar qué datos salen del dispositivo.

## Lista de comprobación para el primer motor integrado

- [ ] `NativeBridgeEngine` implementa `BrowserEngine` con todas las capacidades a `true` que realmente soporte.
- [ ] `ExternalPage` solo se muestra cuando `embeddedRendering` es `false`.
- [ ] Atrás/adelante/recargar delegan en el motor si `nativeHistory` es `true`.
- [ ] Los eventos del motor actualizan título, icono, URL y carga de la pestaña.
- [ ] Las reglas de alias se aplican a `url-changed` sin alterar la URL cargada.
- [ ] `KeyValueStorage` nativo con migración desde LocalStorage.
- [ ] Pruebas del puente con un motor simulado, igual que hoy se simula `window.open`.
