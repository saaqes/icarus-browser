# ICARUS Browser

Navegador web con identidad propia, interfaz personalizable y un editor avanzado de alias de URL.

Esta primera fase es un **prototipo web de la interfaz de escritorio**: la ventana del navegador, las pestañas, la barra de direcciones, los tres estilos visuales, la configuración y el editor «Cambiar nombre de URL» funcionan de verdad y guardan sus datos. Lo que **todavía no existe** es un motor de navegación integrado: cuando abres una página web, ICARUS la entrega al navegador del sistema y lo indica claramente en la pestaña. La arquitectura está preparada para conectar después Chromium (CEF) u otro motor por plataforma.

> ICARUS no está afiliado a Google ni a Microsoft. Los estilos «Esencial» y «Panorama» son diseños originales inspirados en patrones de navegadores conocidos; no usan logotipos ni recursos de esas marcas.

| ICARUS (estilo propio) | Esencial (inspirado en Chrome) | Panorama (inspirado en Edge) |
| --- | --- | --- |
| ![Estilo ICARUS](docs/screenshots/icarus.webp) | ![Estilo Esencial](docs/screenshots/esencial.webp) | ![Estilo Panorama](docs/screenshots/panorama.webp) |

| Alias en la barra con la URL real verificable | Editor «Cambiar nombre de URL» |
| --- | --- |
| ![Alias de URL](docs/screenshots/alias-barra.webp) | ![Cambiar nombre de URL](docs/screenshots/cambiar-nombre-url.webp) |

<sub>Capturas del prototipo en Chromium. Los iconos de sitios aparecen como iniciales cuando no hay acceso a la red.</sub>

---

## Índice

- [Tecnologías](#tecnologías)
- [Requisitos](#requisitos)
- [Instalación y comandos](#instalación-y-comandos)
- [Funciones implementadas](#funciones-implementadas)
- [Funciones que siguen siendo prototipo](#funciones-que-siguen-siendo-prototipo)
- [Limitaciones actuales](#limitaciones-actuales)
- [Estructura del código](#estructura-del-código)
- [Seguridad](#seguridad)
- [Pruebas](#pruebas)
- [Próximos pasos: motor de navegación real](#próximos-pasos-motor-de-navegación-real)

## Tecnologías

| Capa | Herramienta |
| --- | --- |
| Interfaz | React 19 |
| Lógica | TypeScript 5.9 en modo estricto |
| Desarrollo y compilación | Vite 8 |
| Estilos | CSS moderno (variables, `color-mix`, `:has`, `backdrop-filter`) sin frameworks |
| Persistencia (prototipo) | LocalStorage con esquemas versionados |
| Pruebas | Vitest 5, Testing Library y jsdom |

No hay dependencias de ejecución aparte de `react` y `react-dom`.

## Requisitos

- Node.js **20.19 o superior** (o 22.12+), según exige Vite 8.
- npm 10 o superior.
- Un navegador moderno (Chrome, Edge, Firefox o Safari recientes) para abrir el prototipo.

## Instalación y comandos

```bash
npm install        # instala las dependencias
npm run dev        # servidor de desarrollo en http://localhost:5173
npm run test       # ejecuta todas las pruebas una vez
npm run build      # comprueba los tipos (tsc -b) y genera dist/
npm run preview    # sirve la compilación de dist/ para revisarla
```

Otros comandos: `npm run test:watch` (pruebas en modo observación) y `npm run typecheck` (solo tipos).

La compilación de producción usa rutas relativas (`base: './'`), por lo que `dist/` puede servirse desde cualquier carpeta o cargarse más adelante dentro de un contenedor de escritorio. Además añade una política de seguridad de contenido (CSP) a `index.html`.

## Funciones implementadas

Todo lo siguiente funciona y se guarda en el almacenamiento local del navegador.

### Ventana del navegador
- **Pestañas**: crear (botón `+` o Ctrl+T), cambiar, cerrar (botón, clic central o Ctrl+W), título e icono de cada página, pestaña activa resaltada. Al cerrar la última se abre una nueva.
- **Historial por pestaña**: atrás, adelante y recargar con estados deshabilitados reales; indicador de carga.
- **Botón de página principal** (configurable: página de nueva pestaña o una URL).
- **Menú de ICARUS** (⋮) y acceso directo a Configuración.
- **Atajos de teclado**: Ctrl+L / Alt+D / F6, Ctrl+T, Ctrl+W, Ctrl+Tab, Alt+← / Alt+→ (en la versión web el navegador anfitrión puede reservar algunos).

### Barra de direcciones y buscador
- Distingue **direcciones web** (`ejemplo.com`, `https://…`, `localhost:3000`, IP) de **búsquedas**.
- Proveedores **Google, Bing y DuckDuckGo**; el elegido se guarda.
- Sugerencias que explican qué ocurrirá al pulsar Enter (abrir URL, buscar, alias, página interna o bloqueo) y coincidencias con accesos directos y alias.
- Botón para limpiar, Escape para restaurar, icono de información con la **URL real verificable**.
- Bloquea `javascript:`, `data:`, `file:`, `vbscript:` y `blob:`; rechaza protocolos no compatibles.
- Páginas internas: `icarus://nueva-pestana`, `icarus://configuracion/<sección>` e `icarus://en-blanco`.

### Tres estilos con distribución propia
| Estilo | Inspiración | Distribución |
| --- | --- | --- |
| **Esencial** | Google Chrome | Columna centrada con logotipo minimalista, buscador en píldora, accesos circulares, mucho espacio en blanco; pestañas con esquinas curvas. |
| **Panorama** | Microsoft Edge | Imagen a pantalla completa, cabecera con marca y hora, buscador ancho, accesos en mosaico y zona de tarjetas configurable; pestañas rectangulares flotantes. |
| **ICARUS** | Propio | Carbón con resplandor morado animado, saludo y hora grandes, buscador de cristal, dock de accesos y columna lateral de tarjetas; variante clara «Marfil». |

El cambio es instantáneo y no recarga la aplicación. Cada estilo **guarda por separado** su modo de color, acento, fondo y distribución; cambiar de estilo no borra nada más.

### Personalización (botón «Personalizar» y Configuración → Apariencia)
- Modo **claro, oscuro o automático** (sigue al sistema si el entorno lo informa).
- Color de acento (8 colores o el del estilo).
- Fondo: el del estilo, 8 colores, selector de color libre, 4 imágenes originales incluidas o **una imagen propia** (se redimensiona y se guarda en el dispositivo). Botón para restaurar el fondo predeterminado.
- Distribución: posición del buscador, estilo de los accesos (círculos, mosaicos, dock), accesos por fila, densidad y posición de las tarjetas.
- Mostrar u ocultar accesos directos, tarjetas y cada widget por separado.
- Restablecer el estilo actual y opción «Reducir animaciones».

### Accesos directos
Añadir, editar, eliminar (con confirmación), reordenar (arrastrando, desde el menú del acceso o desde Configuración → Navegación), abrir en la pestaña actual o en una nueva, icono del sitio cuando existe y restaurar los predeterminados. La URL se valida y no se inventan destinos.

### Widgets locales
Reloj y fecha, calendario, notas rápidas y tareas, guardados solo en el dispositivo. La tarjeta «Fuentes de contenido» está **vacía a propósito**: ICARUS no incluye un servicio de noticias; su modo de demostración está marcado como «no es información real».

### Configuración por secciones (`icarus://configuracion`)
- **General**: buscador predeterminado, comportamiento al iniciar (pestaña nueva o restaurar sesión), página principal, estilo, idioma (español; textos centralizados para traducir) y restaurar valores predeterminados de forma selectiva.
- **Apariencia**: todos los controles de personalización.
- **Navegación**: contenido de la nueva pestaña, apertura de páginas web (automática o con confirmación), dónde abrir los accesos, iconos de sitios y gestor de accesos directos.
- **Avanzado**: aplicar alias en la interfaz, botón discreto **«Cambiar nombre de URL»**, exportar/importar toda la configuración en JSON, estado real del motor y sus capacidades, y uso del almacenamiento local.
- **Acerca de ICARUS**: versión, plataformas previstas y atajos de teclado.

### «Cambiar nombre de URL» (Configuración → Avanzado)
No aparece en la página de inicio ni en la barra principal. Abre un panel completo para administrar reglas de alias visual:

- Campos separados: nombre de la regla, **tipo de coincidencia** (URL exacta, prefijo o host con comodín `*.dominio`), **URL original/patrón**, **nombre visible**, **alias** y **URL de destino real**, estado y fechas de creación/modificación.
- Crear, editar, guardar, cancelar (con aviso si hay cambios sin guardar), eliminar con confirmación, activar/desactivar, buscar, vista previa, probador de URL, restaurar reglas de ejemplo, exportar e importar.
- Notificaciones de guardado y mensajes de validación por campo.
- Detección de **conflictos** (alias repetidos, patrones duplicados, solapamientos) indicando qué regla se aplica.
- **Prioridad**: exacta > prefijo más largo > host concreto > host con comodín; en empate, la regla más antigua.

Cómo se muestra un alias:
- **Pestaña**: nombre visible de la regla, con un punto de acento.
- **Barra de direcciones**: etiqueta «Alias», el alias (`buscar.icarus`) y, al lado, el **host real**. Al editar, el campo muestra siempre la **URL real**.
- **Información de la página**: URL real (con botón para copiarla), alias, regla aplicada y destino de la regla, por separado.
- Escribir un alias en la barra solo navega si existe una **regla activa** para él.

## Funciones que siguen siendo prototipo

| Función | Estado actual | Qué falta |
| --- | --- | --- |
| Navegación web | Las páginas se abren **en el navegador del sistema** (`window.open` con `noopener,noreferrer`). La pestaña muestra «Página abierta fuera de ICARUS» con la URL real. | Motor integrado (CEF/WebView/WKWebView). |
| Pestañas | Organizan el historial de ICARUS. | **No** mantienen sesiones web independientes (cookies, almacenamiento, procesos). |
| Indicador de carga | Representa la entrega de la URL al motor. | Progreso real de carga de la página. |
| Título e icono de la pestaña | Derivados de la URL o del alias; el icono es `/favicon.ico` del propio sitio. | Título e icono reales informados por el motor. |
| Alias de URL | Se aplican a los componentes de ICARUS. | Aplicarlos a los eventos de navegación del motor nativo. |
| Idioma | Español; textos centralizados en `src/i18n/es.ts`. | Traducciones adicionales. |

No existen todavía (y la interfaz no afirma que existan): sincronización, cuentas, bloqueo de anuncios, inteligencia artificial, descargas, marcadores ni historial global.

## Limitaciones actuales

- **Ventanas emergentes**: con `noopener` el navegador no informa si bloqueó la ventana. La página de la pestaña ofrece un enlace alternativo («¿No se abrió?»).
- **Atajos**: en la versión web, Ctrl+T, Ctrl+W y similares los captura el navegador anfitrión.
- **Almacenamiento**: LocalStorage es por navegador y perfil (unos 5 MB). Si no está disponible, ICARUS funciona en memoria y lo avisa. La imagen de fondo propia puede no caber; se informa del error.
- **Iconos de sitios**: se piden a cada sitio; sin red o sin icono se muestra la inicial. Pueden desactivarse en Configuración → Navegación.
- **Restaurar sesión**: las páginas web restauradas no se vuelven a abrir automáticamente (para no abrir ventanas sin permiso).
- **Seguridad del origen**: ICARUS no verifica certificados en esta fase; lo hace el navegador externo. Por eso la interfaz no muestra candados ni indicadores de seguridad simulados.

## Estructura del código

```
icarus-browser/
├── index.html                 Punto de entrada HTML (CSP añadida al compilar)
├── vite.config.ts             Vite + Vitest + CSP de producción
├── public/icarus.svg          Icono de la aplicación
├── docs/
│   ├── ARCHITECTURE.md        Capas, flujo de datos y decisiones
│   └── ENGINE_INTEGRATION.md  Plan para Windows (CEF), Android, iOS y servicios
└── src/
    ├── main.tsx               Arranque de React
    ├── app/                   App, composición de servicios inyectables y raíz temática
    ├── components/
    │   ├── BrowserShell/      Ventana y controlador de pestañas y navegación
    │   ├── TabBar/            Barra de pestañas
    │   ├── NavigationControls/Atrás, adelante, recargar, inicio
    │   ├── AddressBar/        Omnibox, sugerencias e información de la URL real
    │   ├── SearchBox/         Buscador de la página de inicio
    │   ├── ShortcutGrid/      Accesos directos, diálogo y gestor
    │   ├── WidgetPanel/       Tarjetas y widgets locales
    │   ├── NewTabPage/        Página de inicio (delegada en el estilo activo)
    │   ├── Customize/         Panel «Personalizar» y controles de apariencia
    │   ├── Settings/          Página de configuración y sus secciones
    │   ├── UrlAliasManager/   Editor «Cambiar nombre de URL»
    │   ├── InternalPages/     Página externa y página en blanco
    │   └── common/            Iconos, logotipo, diálogos, menús, avisos, controles
    ├── themes/
    │   ├── google-inspired/   «Esencial»: tokens, ventana y distribución
    │   ├── edge-inspired/     «Panorama»
    │   ├── icarus/            Estilo propio
    │   ├── backgrounds/       Imágenes de fondo originales (SVG)
    │   ├── registry.ts        Registro de estilos
    │   ├── themeDefaults.ts   Configuración inicial de cada estilo
    │   └── accents.ts         Paleta de acentos
    ├── services/              Lógica pura, sin React
    │   ├── persistence/       Almacenamiento, documentos versionados, migraciones, stores
    │   ├── settings/          Esquema, saneamiento y operaciones de preferencias
    │   ├── url-resolution/    URL vs búsqueda, protocolos, páginas internas
    │   ├── search/            Proveedores de búsqueda
    │   ├── alias-rules/       Validación, coincidencia, prioridad, conflictos, import/export
    │   ├── shortcuts/         Accesos directos
    │   ├── tabs/              Reducer de pestañas, sesión y presentación de páginas
    │   ├── navigation/        Contrato del motor y motor externo provisional
    │   ├── widgets/           Notas y tareas
    │   ├── background/        Imagen de fondo propia
    │   └── backup/            Copia de seguridad JSON
    ├── hooks/                 Acceso a stores, apariencia, reloj, modo del sistema
    ├── i18n/                  Textos de la interfaz
    ├── types/                 Tipos del dominio
    ├── styles/                Tokens de diseño y estilos globales
    └── tests/                 Pruebas de servicios y de componentes
```

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Persistencia

Cada documento se guarda en LocalStorage con un sobre `{ version, savedAt, data }`:

| Clave | Contenido |
| --- | --- |
| `icarus.settings` | Preferencias (estilo, configuración por estilo, buscador, navegación, avanzado) |
| `icarus.shortcuts` | Accesos directos |
| `icarus.aliasRules` | Reglas de «Cambiar nombre de URL» |
| `icarus.widgets` | Notas y tareas |
| `icarus.backgroundImage` | Imagen de fondo propia (redimensionada) |
| `icarus.session` | Pestañas abiertas, solo si se elige «Restaurar las pestañas» |

Al leer se aplican migraciones de versión y se sanea **campo a campo**: un valor inválido se sustituye por su predeterminado sin perder el resto. Un JSON dañado se copia en `<clave>.backup` antes de usar los valores predeterminados, y la interfaz lo avisa. Nunca se guardan contraseñas ni secretos.

## Seguridad

- Solo se navega a `http:` y `https:`; los protocolos peligrosos se bloquean en la interfaz y otra vez en el motor.
- `window.open(url, '_blank', 'noopener,noreferrer')` y `<meta name="referrer" content="no-referrer">`.
- No se usa `dangerouslySetInnerHTML` ni se ejecuta código procedente de URL o reglas.
- CSP de producción sin scripts externos, objetos ni marcos.
- Los alias viven en el espacio reservado **`.icarus`**, que no es un dominio de Internet; por eso no pueden hacerse pasar por un dominio legítimo. Además:
  - el patrón y el destino deben ser URL reales (un alias no puede apuntar a otro alias, así que no hay ciclos);
  - una regla no puede convertir HTTPS en HTTP (el destino HTTP solo se admite si el patrón ya es HTTP o es `localhost`);
  - el host real se muestra siempre junto al alias y la URL real está disponible al editar y en el panel de información;
  - las reglas desactivadas no se aplican y un alias escrito solo navega si hay una regla activa explícita.

## Pruebas

```bash
npm run test
```

91 pruebas en 11 archivos:

- **Servicios** (`src/tests/services`): persistencia y migraciones, recuperación de datos dañados, errores de cuota, resolución de URL y búsqueda, reglas de alias (validación, coincidencias, prioridad, conflictos, ciclos, HTTPS→HTTP, import/export), accesos directos, reducer de pestañas, sesión y motor externo.
- **Componentes** (`src/tests/components`): cambio de estilo y modo, distribución, fondos, persistencia tras reiniciar, barra de direcciones, proveedores, protocolos bloqueados, pestañas e historial, accesos directos, editor de alias completo y recuperación de preferencias.

## Próximos pasos: motor de navegación real

El plan detallado está en [docs/ENGINE_INTEGRATION.md](docs/ENGINE_INTEGRATION.md). Resumen:

1. **Windows (recomendado como siguiente paso)**: crear un host de escritorio con CEF (Chromium Embedded Framework) que cargue esta interfaz como capa de «chrome» y una vista CEF por pestaña. Implementar `BrowserEngine` (`src/services/navigation/engine.ts`) sobre un puente de mensajes, con `embeddedRendering`, `isolatedTabSessions`, `nativeHistory` y `pageEvents` activos.
2. Conectar los eventos del motor (`url-changed`, `title-changed`, `favicon-changed`, `loading-changed`) al reducer de pestañas y aplicar las reglas de alias en esos eventos sin tocar el origen real.
3. Migrar la persistencia a un adaptador nativo (`KeyValueStorage`), conservando los esquemas y migraciones actuales.
4. **Android** (Kotlin + WebView o GeckoView) e **iPhone** (Swift + WKWebView, respetando las políticas de Apple) reutilizando el mismo contrato.
5. Servicios opcionales con **FastAPI + PostgreSQL** para cuentas y sincronización, solo cuando existan esas funciones.
