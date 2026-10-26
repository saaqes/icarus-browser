# Apps de Android, iPhone y iPad

ICARUS para móviles son dos proyectos nativos separados de la versión de escritorio (`mobile/android` y `mobile/ios`). No reutilizan el instalador ni la interfaz React: cada plataforma usa su motor web y su sistema de interfaz. Lo que sí comparten con escritorio es la **lógica** y los **datos**, para que las tres versiones se comporten igual.

## Datos compartidos (`mobile/shared`)

Los archivos de `mobile/shared` se **generan desde el código de escritorio** con `electron/shared/mobileShared.test.ts`:

| Archivo | Origen en escritorio |
| --- | --- |
| `defaults.json` | Accesos directos predeterminados (y la lista de direcciones personalizadas inicial, vacía) |
| `shield-basic.txt` | Lista básica de ICARUS Shield (`electron/shield/builtinList.ts`) |
| `public-suffix-rules.txt` | Public Suffix List (`electron/shield/publicSuffixList.ts`) |
| `themes.json` | Colores de los tres estilos, leídos de `src/styles/tokens.css` y `src/themes/*/theme.css`, y los acentos |
| `strings.json` | Textos de `src/i18n/es.ts`: errores de las direcciones personalizadas (con parámetros `{address}` y `{target}`), editor, información del sitio, accesos y listas |
| `test-vectors/*.json` | Entradas y resultados calculados por el código de escritorio |
| `android/app/src/main/res/drawable/icarus_*.xml` | Iconos de `src/components/common/Icon.tsx` convertidos a VectorDrawable |

```bash
UPDATE_MOBILE_SHARED=1 npx vitest run electron/shared   # regenerar tras cambiar la lógica de escritorio
npx vitest run electron/shared                           # comprobar (falla si algo está desactualizado)
```

La comprobación forma parte de `npm run test`, así que CI falla si alguien cambia la lógica de escritorio y olvida regenerar los datos.

### Vectores de prueba

| Vector | Qué fija |
| --- | --- |
| `resolve-input.json` | 56 textos de la barra de direcciones (con 6 direcciones personalizadas, una solo para `#home` y `#usuario`) → URL, dirección personalizada, búsqueda, página interna o bloqueo; y 24 búsquedas codificadas como `encodeURIComponent` |
| `custom-address-display.json` | 27 URL reales → dirección que muestra la barra, en forma corta y completa (con secciones: `#inicio` → general, `#home` → la de la sección) |
| `custom-address-validation.json` | 24 casos del editor (errores por campo, también de secciones, y entrada con la que choca) y 10 reglas de alias antiguas más una ya convertida → conversión y lista cargada (varias reglas idénticas, una por fragmento, quedan en una sola entrada) |
| `custom-address-sections.json` | 13 fragmentos → sección; 8 textos del campo «Secciones» → secciones o error; 7 «Guardar solo para #sección» seguidos → entradas resultantes o error |
| `address-rebase.json` | 14 direcciones mostradas (con o sin dirección personalizada) → base y sufijo; bases nuevas → URL o error; textos escritos → editar la base o navegar sin heredar la ruta |
| `registrable-domain.json` | 16 hosts → dominio registrable (incluye comodines y excepciones de la PSL) |
| `shield-match.json` | Una lista con todas las opciones admitidas → número de reglas, ignoradas y no válidas; y 28 solicitudes → bloqueada o no |

Las pruebas de Kotlin (`mobile/android/core`) y de Swift (`mobile/ios/Tests`) leen estos mismos archivos.

## Android (`mobile/android`)

- **`core/`**: biblioteca Kotlin/JVM sin dependencias del SDK de Android (build de Gradle independiente). Contiene el analizador de URL (equivalente a `new URL()`), la barra de direcciones, búsqueda, páginas internas, direcciones personalizadas (mostrar, resolver, validar, migrar alias antiguos), Public Suffix List, el analizador y el motor de filtros de Shield (adaptación directa de `electron/shield`), `ShieldStore` (listas, descargas y excepciones, como `shieldService.ts`), perfil, historial y paletas. Se prueba con `./gradlew -p core test` sin necesitar el SDK.
- **`app/`**: interfaz construida en código con vistas de Android (sin AndroidX ni bibliotecas de terceros), `minSdk 29` (Android 10) y `targetSdk 35`.
  - Una **WebView** por pestaña, creada al mostrar la pestaña (las restauradas no cargan hasta que se abren). Todas comparten cookies y almacenamiento.
  - **Shield** en `shouldInterceptRequest`: cada subsolicitud se evalúa con el motor del núcleo y, si coincide, se responde con una respuesta vacía, así que nunca sale del dispositivo. El contador de la página y el total cuentan solo esas cancelaciones. Las solicitudes de service workers se filtran con `ServiceWorkerController`, usando el `Referer` como página de origen. WebView no indica el tipo de recurso: se deduce de `Sec-Fetch-Dest`, `Accept` y la extensión (`ResourceTypes.kt`, con pruebas).
  - **TLS**: `onReceivedSslError` siempre cancela; la página de error no ofrece continuar. Contenido mixto bloqueado (`MIXED_CONTENT_NEVER_ALLOW`), Navegación segura de Google activada, sin acceso a `file:` ni `content:`.
  - **Navegación**: `javascript:`, `file:`, `data:`, `blob:` e `icarus:` no se abren desde páginas; otras apps (`intent:`, `mailto:`, `tel:`…) solo tras un toque del usuario y confirmación, y nunca con un componente concreto. Las ventanas emergentes solo se abren tras un gesto.
  - **Descargas** con DownloadManager (con cookies y User-Agent de la página); se marcan como completadas solo cuando el sistema devuelve `STATUS_SUCCESSFUL`.
  - **Permisos**: ubicación, cámara y micrófono se preguntan por origen y se recuerdan; después Android pide su propio permiso a la app.
  - Si el proceso de una página falla (`onRenderProcessGone`), solo se pierde esa pestaña.
- **Datos**: `filesDir/icarus/` (`profile.json`, `history.json`, `shield/`), con escritura atómica. `allowBackup="false"`: no se copian a la nube.

## iPhone y iPad (`mobile/ios`)

- **`Sources/IcarusCore`**: paquete SwiftPM solo con Foundation (compila en macOS, iOS y Linux), con la misma lógica que el núcleo de Android, incluido un codificador punycode propio (Swift no tiene uno).
- **`App/`**: SwiftUI + `WKWebView`, iOS 16 o posterior, proyecto generado con XcodeGen (`project.yml`).
  - **Motor**: WebKit, el único que iOS permite a los navegadores fuera de la Unión Europea (en la UE hay requisitos adicionales que esta versión no cumple).
  - **Shield**: WebKit no permite inspeccionar las solicitudes, así que los filtros se **convierten en reglas de contenido de WebKit** (`ContentBlocker.swift`) y las aplica WebKit:
    - cada filtro es **una** regla (subrecursos y marcos internos); una última regla (`ignore-previous-rules` para `document` con `load-context: top-frame`) deja pasar siempre la página principal, como en escritorio;
    - las excepciones `@@` van después de todos los bloqueos (`ignore-previous-rules`), así que siempre ganan, como en escritorio;
    - `$document` se convierte en una excepción para todo el sitio (`if-domain`);
    - las expresiones regulares se traducen al subconjunto de WebKit (`\d` → `[0-9]`…); las que usan `|`, `{n}` o `\s` no se pueden expresar y se cuentan como omitidas;
    - las excepciones por sitio del usuario no recompilan nada: antes de cada navegación se quitan o se añaden las reglas a la pestaña;
    - las reglas compiladas se guardan en WebKit y se reutilizan mientras no cambien las listas;
    - WebKit admite como máximo 150 000 reglas por lista. Si las listas activas no caben, se quedan fuera filtros de bloqueo completos empezando por el final de la última lista (las reglas propias van primero y las excepciones entran siempre), y la interfaz dice cuántos.

    **No hay contador**: WebKit no informa de lo que bloquea, e ICARUS no muestra cifras inventadas. La interfaz indica cuántos filtros aplica WebKit, cuántos no se pueden expresar y cuántos no caben en el máximo.
  - **TLS**: los certificados los valida WebKit; un error de certificado muestra la página de error sin opción de continuar. `NSAllowsArbitraryLoadsInWebContent` solo permite abrir sitios `http://` dentro de la web, no desactiva la validación de certificados.
  - **Descargas** con `WKDownload` en `Documentos/Descargas` (visibles en la app Archivos); completadas solo cuando WebKit llama a `downloadDidFinish`.
  - **Permisos**: cámara y micrófono por origen; la ubicación la pregunta WebKit con su propio aviso.
  - Todas las peticiones de WebKit (diálogos de JavaScript, permisos, autenticación, descargas) se responden siempre; si llega una mientras otra está abierta, recibe la respuesta segura (cancelar o denegar).
- **Datos**: `Application Support/ICARUS/` (perfil, historial, Shield, lista de descargas). Las cookies y la caché las guarda WebKit (`WKWebsiteDataStore.default()`), comunes a todas las pestañas.

## Barra de direcciones y direcciones personalizadas

Las dos apps reproducen la barra de escritorio con la misma lógica (`CustomAddresses.kt` / `CustomAddresses.swift`, equivalentes a `src/services/custom-addresses`):

- Sin foco, forma corta (`miweb.com/ruta`); al tocarla, la dirección completa seleccionada. En Android, «Atrás», salir sin pulsar Ir o Escape con un teclado físico recupera la dirección; en iPhone, salir de la barra sin pulsar Ir.
- Direcciones sin sufijos (`google.com`, `localhost:3000`); el protocolo solo se añade si falta.
- La dirección personalizada se muestra mientras la página está dentro de su destino; escribirla abre el destino real. El motor (WebView o WebKit) carga siempre la URL real, con su certificado; los enlaces de las páginas no se resuelven.
- Icono de seguridad real («No seguro» para HTTP, rojo con la dirección real completa si el certificado no es válido) e información del sitio con el sitio que recibe las solicitudes y los botones para copiar la dirección o personalizarla.
- Configuración → Avanzado → «Personalizar direcciones URL»: lista, edición con vista previa, activar y eliminar; los conflictos se muestran en el campo nombrando la otra entrada. Configuración → Navegación → «Mostrar siempre las URL completas».
- El perfil (`profile.json`, versión 2) guarda la lista en `customAddresses` y convierte al leerlas las reglas `aliasRules` de versiones anteriores.
- **Editar la base** (`AddressRebase.kt` / `AddressRebase.swift`, equivalentes a `rebase.ts`): en Android, la primera sugerencia al tocar la barra es «Editar base»; el campo pasa a tener solo la base y el sufijo (`/#inicio`) queda fijo con una «×». En una página personalizada se elige entre guardar la base nueva en la entrada (persistente), guardarla solo para la sección de la página (`#home`) o ir a la nueva dirección. En iPhone está el núcleo (y sus pruebas), sin botón en la app.
- **Direcciones por sección**: el editor de las dos apps tiene el campo «Secciones» (`#home, #usuario`) y la lista lo muestra («Solo en #home, #usuario»); la barra usa la entrada de la sección de la página antes que la general, como en escritorio (`custom-address-sections.json`).

## Barra de Android (como Chrome para Android)

- Siempre arriba y fija en los tres estilos: atrás, recargar/detener, barra de direcciones con la estrella de favoritos, contador de pestañas y menú. En pantallas de 600 dp o más, también Adelante y Shield; en teléfonos están en el menú (fila superior: Adelante, Favorito, Compartir, Información del sitio).
- La ventana se dibuja de borde a borde y la columna aplica los márgenes de la barra de estado, los recortes de pantalla, la barra de navegación y el teclado (`safeArea()`), así que la barra no se solapa con la barra de estado y el teclado encoge el contenido en lugar de taparlo.
- Favoritos: `BookmarksStore` (núcleo, `bookmarks.json`) con las reglas de escritorio; pantalla «Favoritos» por carpetas con búsqueda, abrir, editar (nombre, carpeta o carpeta nueva) y eliminar.

## Pruebas

| Conjunto | Dónde | Qué comprueba |
| --- | --- | --- |
| `./gradlew -p core test` (44 pruebas) | Local y CI | Vectores compartidos (incluida la edición de la base), direcciones personalizadas (sin sufijos, nunca HTTP como HTTPS, ida y vuelta, conflictos) y accesos, favoritos (sin duplicados, carpetas, persistencia), perfil, historial, listas de Shield (con un servidor HTTP local para el descargador), deducción de tipos de recurso y actualizaciones |
| Prueba instrumentada (`ChromeLayoutTest`, 3 pruebas) | Emulador de Android 14 en CI | En los tres estilos, la barra queda justo bajo la barra de estado y no se mueve al desplazar una página larga, al abrir el menú ni con el teclado (que encoge el contenido); favoritos guardados en disco; cambiar solo la base de `miweb.com/app.html#inicio` ofrece guardarla, se guarda y `#dashboard` sigue en la misma entrada; «Editar base» sin dirección personalizada conserva ruta y consulta; una dirección nueva no hereda la ruta; «Guardar solo para #home» muestra `otraweb.com` en `#home` y `miweb.com` en `#inicio`, escribir `otraweb.com` abre `#home` y queda guardado en `profile.json`. Captura cada estilo y la barra con el teclado |
| Prueba instrumentada (`BrowserSmokeTest`) | Emulador de Android 14 en CI | La app real abre una página local con un anuncio y un rastreador: Shield cancela exactamente 2 solicitudes; la barra muestra solo `miweb.com/pagina.html` para la página local y escribir esa dirección abre la real; `javascript:` y `file:` bloqueados; búsqueda; certificado no válido real (`self-signed.badssl.com`) con la barra mostrando la dirección real completa que falló; los tres estilos sin perder pestañas; y que Configuración, Shield, Direcciones personalizadas, Historial y Descargas abren sin cerrarse. Captura cada pantalla |
| `swift test` (25 pruebas) | Linux local (Swift 6.1) y macOS en CI | Los mismos vectores (incluidas la dirección visible, la edición de la base, la validación y la migración de alias); la conversión a reglas de WebKit se comprueba con un evaluador de la semántica de las reglas, que debe bloquear las mismas 28 solicitudes que escritorio, no bloquear nunca la página principal (sí los marcos internos) y, si no cabe todo, dejar fuera filtros completos del final |
| `ShieldWebKitTests` (5 pruebas) | Simulador de iOS en CI | Con WebKit real: las reglas compilan; un rastreador real se cancela con las reglas y carga sin ellas; una página principal que coincide con un filtro se abre igualmente; EasyList y EasyPrivacy reales se descargan, caben juntas en una lista sin superar el máximo y WebKit la compila; la dirección personalizada `bot.deriv.me` → `miweb.com` en la barra y al escribirla |

Con las listas completas de EasyList (57 251 filtros de red) y EasyPrivacy (56 333), montadas el 24 de octubre de 2026 desde sus archivos fuente, más la lista básica: WebKit aplica 113 624 filtros, 26 no se pueden expresar (expresiones regulares con `|`, `{n}` o `\s`) y todo cabe en 113 625 reglas, por debajo del máximo de 150 000. La primera versión de la conversión usaba dos reglas por filtro: con estas listas necesitaba unas 224 000, superaba el máximo y dejaba fuera parte de EasyPrivacy y las reglas propias.

## Lo que no hacen las apps móviles

- Perfiles o pestañas aisladas, sincronización, fondos personalizados, widgets, copia de seguridad.
- Filtros cosméticos de Shield (como en escritorio).
- Firma para tiendas: el APK de CI usa una clave de depuración y el `.ipa` no está firmado (ver el README).
