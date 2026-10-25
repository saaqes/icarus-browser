# Arquitectura de ICARUS Browser

Este documento describe cómo está organizada la interfaz de ICARUS, que es la misma en la aplicación de escritorio (Electron + Chromium) y en el prototipo web. La parte específica del motor de escritorio (procesos, IPC, pestañas reales, persistencia en disco) está en [ENGINE_INTEGRATION.md](ENGINE_INTEGRATION.md); la seguridad, en [SECURITY.md](SECURITY.md); el bloqueador, en [SHIELD.md](SHIELD.md). Las apps de Android, iPhone y iPad tienen su propia interfaz nativa y reutilizan la lógica de `src/services` y `electron/shield` a través de los datos generados en `mobile/shared`: ver [MOBILE.md](MOBILE.md).

## Principios

1. **Lógica pura separada de la interfaz.** Todo lo que se puede probar sin React (validación, resolución de URL, direcciones personalizadas, reducer de pestañas, persistencia) vive en `src/services` y no importa componentes.
2. **Componentes compartidos, estilos específicos.** Los estilos visuales no duplican componentes: cada uno organiza de forma distinta las mismas piezas (`SearchBox`, `ShortcutGrid`, `WidgetPanel`) y redefine los tokens CSS.
3. **Servicios inyectables.** `createAppServices()` compone almacenamiento, stores y motor de navegación. En escritorio recibe el puente `window.icarusNative` y usa `createNativeEngine()` y `createNativeStorage()`; en la web, LocalStorage y `ExternalBrowserEngine`. Las pruebas inyectan memoria, un `window.open` simulado y un reloj fijo.
4. **Honestidad.** Ninguna parte de la interfaz simula navegación, seguridad, bloqueo o servicios que no existen: el contador de Shield, el estado de carga, el título y el icono proceden de Chromium. Las capacidades del motor se leen de `engine.info.capabilities` y se muestran en Configuración → Avanzado.

## Capas

```
┌────────────────────────────────────────────────────────────────────┐
│ Componentes React (src/components, src/themes/*/…Home.tsx)         │
│   BrowserShell · TabBar · AddressBar · NewTabPage · Settings · …   │
├────────────────────────────────────────────────────────────────────┤
│ Controlador del navegador (BrowserShell/BrowserContext.tsx)        │
│   sesión de pestañas (useReducer) · navegación · atajos            │
├────────────────────────────────────────────────────────────────────┤
│ Hooks (src/hooks)                                                  │
│   useSettings · useShortcuts · useCustomAddresses · useAppearance …│
├────────────────────────────────────────────────────────────────────┤
│ Servicios puros (src/services)                                     │
│   url-resolution · custom-addresses · shortcuts · settings · tabs …│
├────────────────────────────────────────────────────────────────────┤
│ Persistencia (services/persistence)    │ Motor (services/navigation)│
│   KeyValueStorage → documentos         │   BrowserEngine            │
│   versionados → PersistentStore        │   nativeEngine (Chromium)  │
│   (nativeStorage o LocalStorage)       │   ExternalBrowserEngine    │
├────────────────────────────────────────┴───────────────────────────┤
│ Escritorio: window.icarusNative (preload) ⇄ IPC ⇄ proceso principal │
│   TabManager · ShieldService · descargas · historial · permisos     │
└────────────────────────────────────────────────────────────────────┘
```

## Flujo de una navegación

1. El usuario escribe en la barra de direcciones o en el buscador y pulsa Enter.
2. `resolveInput()` clasifica el texto: `url`, `custom` (dirección personalizada: lleva la URL real del destino y la dirección escrita), `search`, `internal`, `internal-unknown`, `blocked` o `empty`. Las direcciones se aceptan tal como se escriben (`google.com`, `localhost:3000`); solo se añade el protocolo si falta.
3. `BrowserContext.navigateInput()`:
   - muestra un aviso para los casos bloqueados o sin resolver;
   - para páginas internas, añade una entrada al historial de la pestaña;
   - para páginas web (también `custom`, con la URL real), añade una entrada `{ kind: 'web', url }` y llama a `engine.navigate()`.
4. **Escritorio**: `nativeEngine` pide al proceso principal que cargue la URL en la `WebContentsView` de la pestaña (`newSegment: true`). Chromium informa después de la URL, el título, el icono, la carga y los errores con eventos `tab-state`, que actualizan la entrada (`tab/update-web`). `WebArea` reserva el área de la vista o muestra la página de error.
5. **Web**: `ExternalBrowserEngine` vuelve a validar el protocolo y llama a `window.open(url, '_blank', 'noopener,noreferrer')` de forma síncrona; la pestaña muestra `ExternalPage`, que explica que la página se abrió fuera de ICARUS.

## Pestañas e historial

- `services/tabs/tabs.ts` es un reducer puro (`sessionReducer`). Los identificadores y marcas de tiempo llegan en las acciones, por lo que el reducer es determinista.
- Cada `Tab` tiene `entries` e `index` (historial propio), `loading` y `reloadToken`. En escritorio, una entrada `web` agrupa todas las navegaciones de Chromium dentro de ese tramo; atrás y adelante usan primero el historial de Chromium (ver ENGINE_INTEGRATION.md).
- `describePage()` calcula título, icono y la dirección de la barra (`addressUrl`) para una entrada, aplicando las direcciones personalizadas solo como presentación (la URL real de la entrada nunca cambia).
- La sesión se guarda en `icarus.session` solo si el usuario elige «Restaurar las pestañas». En escritorio, cada pestaña restaurada carga su página al activarse; en la web quedan pendientes de abrir.

## Persistencia

- `KeyValueStorage` abstrae el almacenamiento. En escritorio, `createNativeStorage()` parte de la copia de `ui-storage.json` que el preload entrega al arrancar y envía cada cambio al proceso principal (migrando una vez lo que hubiera en LocalStorage). En la web, `createBrowserStorage()` comprueba LocalStorage y, si falla, usa memoria (`storage.kind === 'memory'`).
- `DocumentSchema<T>` define clave, versión, valores predeterminados, saneamiento y migraciones (`migrations[n]` lleva de la versión `n` a `n + 1`; los datos sin sobre se tratan como versión 0).
- `loadDocument()` devuelve `{ value, status, issues }` con estado `empty`, `ok`, `migrated`, `repaired`, `corrupt` o `newer-version`. Los campos simplemente ausentes se completan en silencio para no alarmar al añadir preferencias nuevas.
- `PersistentStore<T>` es un store observable (para `useSyncExternalStore`) que guarda en cada cambio y notifica los errores (cuota llena, almacenamiento no disponible) para mostrarlos en la interfaz.
- En la web, las ventanas del mismo navegador se sincronizan con el evento `storage`.

## Preferencias y estilos

- `Settings.appearance.theme` indica el estilo activo; `Settings.appearance.themes[id]` guarda por estilo el modo de color, el acento, el fondo y la distribución. **Cambiar de estilo solo modifica `appearance.theme`**; la prueba `settings.test.ts` lo verifica.
- `AppearanceRoot` publica `data-theme`, `data-mode` y las variables `--accent` / `--accent-contrast` en la raíz. Los temas definen sus tokens con selectores sobre esos atributos, así que el cambio es inmediato.
- Para añadir un estilo: carpeta en `src/themes/<id>/` con su `HomeLayout` y CSS, id en `THEME_IDS`, configuración en `themeDefaults.ts`, acento en `accents.ts` y registro en `registry.ts`.

## Direcciones personalizadas

Archivos en `src/services/custom-addresses/` (tipos en `src/types/customAddress.ts`):

| Archivo | Responsabilidad |
| --- | --- |
| `locations.ts` | Ubicación = protocolo + host[:puerto] + ruta base (sin consulta ni fragmento; vacía = todo el sitio). Normaliza lo escrito (`miweb.com`, `localhost:3000`, `https://ejemplo.com/ruta`), calcula el resto de una URL dentro de una ubicación y si dos ubicaciones se solapan. |
| `mapping.ts` | URL real → dirección visible (`displayUrlFor`) y dirección escrita → URL real (`resolveCustomAddress`), conservando ruta, consulta y fragmento. |
| `validation.ts` | Códigos de error por campo y la entrada con la que choca cada uno. |
| `store.ts` | Crear, editar, activar, eliminar, saneamiento al cargar, conversión de las reglas de alias antiguas, importación y exportación. |
| `display.ts` | Formato de la barra como Chrome: corto sin foco (sin protocolo ni `www.`), completo al editar. |

Garantías:

- Una entrada abarca su ruta base y todo lo que cuelga de ella (en límite de segmento: `/docs` abarca `/docs/x`, no `/docsx`).
- La dirección usa el protocolo del destino (`protocol-mismatch` si no): HTTP nunca se presenta como HTTPS.
- Entre entradas activas no se solapan ni los destinos ni las direcciones, y una dirección no puede ser el destino de otra: la resolución es de un solo paso, sin cadenas ni ciclos. Si datos importados o antiguos chocan, la entrada se guarda desactivada en lugar de perderse.
- Las entradas desactivadas no participan en la presentación ni en la navegación.
- La lógica es la misma en Android (`CustomAddresses.kt`) e iPhone (`CustomAddresses.swift`), probada con los vectores `custom-address-display.json`, `custom-address-validation.json` y `resolve-input.json` generados desde estas funciones.

## Internacionalización

Los textos están en `src/i18n/es.ts` (tipo `Messages`). `useMessages()` devuelve el catálogo del idioma configurado. Para añadir un idioma basta con crear otro archivo con el mismo tipo, registrarlo en `src/i18n/index.tsx` y añadir su código a `LANGUAGE_CODES`.

## Accesibilidad

- Roles ARIA: `tablist`/`tab`, `combobox` + `listbox` en la barra de direcciones, `menu`/`menuitem`, `switch`, `dialog`/`alertdialog`.
- Diálogos con foco inicial, ciclo de tabulación, Escape y devolución del foco.
- Avisos en regiones `status` (éxito, información) y `alert` (errores).
- Respeto de `prefers-reduced-motion` y opción propia «Reducir animaciones».
