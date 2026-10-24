# Arquitectura de ICARUS Browser

Este documento describe cómo está organizada la interfaz de ICARUS, que es la misma en la aplicación de escritorio (Electron + Chromium) y en el prototipo web. La parte específica del motor de escritorio (procesos, IPC, pestañas reales, persistencia en disco) está en [ENGINE_INTEGRATION.md](ENGINE_INTEGRATION.md); la seguridad, en [SECURITY.md](SECURITY.md); el bloqueador, en [SHIELD.md](SHIELD.md).

## Principios

1. **Lógica pura separada de la interfaz.** Todo lo que se puede probar sin React (validación, resolución de URL, reglas de alias, reducer de pestañas, persistencia) vive en `src/services` y no importa componentes.
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
│   useSettings · useShortcuts · useAliasRules · useAppearance · …   │
├────────────────────────────────────────────────────────────────────┤
│ Servicios puros (src/services)                                     │
│   url-resolution · alias-rules · shortcuts · settings · tabs · …   │
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
2. `resolveInput()` clasifica el texto: `url`, `search`, `alias`, `internal`, `alias-unresolved`, `internal-unknown`, `blocked` o `empty`.
3. `BrowserContext.navigateInput()`:
   - muestra un aviso para los casos bloqueados o sin resolver;
   - para páginas internas, añade una entrada al historial de la pestaña;
   - para páginas web, añade una entrada `{ kind: 'web', url }` y llama a `engine.navigate()`.
4. **Escritorio**: `nativeEngine` pide al proceso principal que cargue la URL en la `WebContentsView` de la pestaña (`newSegment: true`). Chromium informa después de la URL, el título, el icono, la carga y los errores con eventos `tab-state`, que actualizan la entrada (`tab/update-web`). `WebArea` reserva el área de la vista o muestra la página de error.
5. **Web**: `ExternalBrowserEngine` vuelve a validar el protocolo y llama a `window.open(url, '_blank', 'noopener,noreferrer')` de forma síncrona; la pestaña muestra `ExternalPage`, que explica que la página se abrió fuera de ICARUS.

## Pestañas e historial

- `services/tabs/tabs.ts` es un reducer puro (`sessionReducer`). Los identificadores y marcas de tiempo llegan en las acciones, por lo que el reducer es determinista.
- Cada `Tab` tiene `entries` e `index` (historial propio), `loading` y `reloadToken`. En escritorio, una entrada `web` agrupa todas las navegaciones de Chromium dentro de ese tramo; atrás y adelante usan primero el historial de Chromium (ver ENGINE_INTEGRATION.md).
- `describePage()` calcula título, icono y texto de la barra para una entrada, aplicando las reglas de alias solo como presentación (`realUrl` nunca cambia).
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

## Reglas de alias

Archivos en `src/services/alias-rules/`:

| Archivo | Responsabilidad |
| --- | --- |
| `validation.ts` | Valida y normaliza una regla; devuelve códigos de error por campo. |
| `patterns.ts` | Forma canónica de URL, coincidencia exacta/prefijo/host, prioridad y orden. |
| `resolution.ts` | URL real → alias (presentación), alias escrito → destino (navegación) y detección de conflictos. |
| `rules.ts` | CRUD puro, reglas predeterminadas, saneamiento al cargar e importación/exportación. |

Garantías:

- El alias pertenece al espacio reservado `.icarus` (no es un dominio de Internet).
- Patrones y destinos son URL reales: un alias no puede apuntar a otro alias, por lo que la resolución es de un solo paso y no hay ciclos.
- El destino no puede degradar HTTPS a HTTP.
- Las reglas desactivadas no participan en la presentación ni en la navegación.
- La prioridad es determinista: exacta > prefijo (más largo) > host concreto > host comodín; en empate, la más antigua.

## Internacionalización

Los textos están en `src/i18n/es.ts` (tipo `Messages`). `useMessages()` devuelve el catálogo del idioma configurado. Para añadir un idioma basta con crear otro archivo con el mismo tipo, registrarlo en `src/i18n/index.tsx` y añadir su código a `LANGUAGE_CODES`.

## Accesibilidad

- Roles ARIA: `tablist`/`tab`, `combobox` + `listbox` en la barra de direcciones, `menu`/`menuitem`, `switch`, `dialog`/`alertdialog`.
- Diálogos con foco inicial, ciclo de tabulación, Escape y devolución del foco.
- Avisos en regiones `status` (éxito, información) y `alert` (errores).
- Respeto de `prefers-reduced-motion` y opción propia «Reducir animaciones».
