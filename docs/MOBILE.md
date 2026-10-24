# Apps de Android, iPhone y iPad

ICARUS para móviles son dos proyectos nativos separados de la versión de escritorio (`mobile/android` y `mobile/ios`). No reutilizan el instalador ni la interfaz React: cada plataforma usa su motor web y su sistema de interfaz. Lo que sí comparten con escritorio es la **lógica** y los **datos**, para que las tres versiones se comporten igual.

## Datos compartidos (`mobile/shared`)

Los archivos de `mobile/shared` se **generan desde el código de escritorio** con `electron/shared/mobileShared.test.ts`:

| Archivo | Origen en escritorio |
| --- | --- |
| `defaults.json` | Accesos directos y reglas de alias predeterminados |
| `shield-basic.txt` | Lista básica de ICARUS Shield (`electron/shield/builtinList.ts`) |
| `public-suffix-rules.txt` | Public Suffix List (`electron/shield/publicSuffixList.ts`) |
| `themes.json` | Colores de los tres estilos, leídos de `src/styles/tokens.css` y `src/themes/*/theme.css`, y los acentos |
| `strings.json` | Textos de error y ayuda de `src/i18n/es.ts` (validación de alias y accesos, errores de listas…) |
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
| `resolve-input.json` | 45 textos de la barra de direcciones → URL, búsqueda, alias, página interna o bloqueo; y 24 búsquedas codificadas como `encodeURIComponent` |
| `alias-match.json` | 19 URL reales → regla de alias que se muestra |
| `registrable-domain.json` | 16 hosts → dominio registrable (incluye comodines y excepciones de la PSL) |
| `shield-match.json` | Una lista con todas las opciones admitidas → número de reglas, ignoradas y no válidas; y 28 solicitudes → bloqueada o no |

Las pruebas de Kotlin (`mobile/android/core`) y de Swift (`mobile/ios/Tests`) leen estos mismos archivos.

## Android (`mobile/android`)

- **`core/`**: biblioteca Kotlin/JVM sin dependencias del SDK de Android (build de Gradle independiente). Contiene el analizador de URL (equivalente a `new URL()`), la barra de direcciones, búsqueda, páginas internas, reglas de alias y su validación, Public Suffix List, el analizador y el motor de filtros de Shield (adaptación directa de `electron/shield`), `ShieldStore` (listas, descargas y excepciones, como `shieldService.ts`), perfil, historial y paletas. Se prueba con `./gradlew -p core test` sin necesitar el SDK.
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
    - la página principal nunca se bloquea (los marcos internos sí, con `load-context: child-frame`);
    - las excepciones `@@` van después de todos los bloqueos (`ignore-previous-rules`), así que siempre ganan, como en escritorio;
    - `$document` se convierte en una excepción para todo el sitio (`if-domain`);
    - las expresiones regulares se traducen al subconjunto de WebKit (`\d` → `[0-9]`…); las que usan `|`, `{n}` o `\s` no se pueden expresar y se cuentan como omitidas;
    - las excepciones por sitio del usuario no recompilan nada: antes de cada navegación se quitan o se añaden las reglas a la pestaña;
    - las reglas compiladas se guardan en WebKit y se reutilizan mientras no cambien las listas.

    **No hay contador**: WebKit no informa de lo que bloquea, e ICARUS no muestra cifras inventadas. La interfaz indica cuántos filtros están activos.
  - **TLS**: los certificados los valida WebKit; un error de certificado muestra la página de error sin opción de continuar. `NSAllowsArbitraryLoadsInWebContent` solo permite abrir sitios `http://` dentro de la web, no desactiva la validación de certificados.
  - **Descargas** con `WKDownload` en `Documentos/Descargas` (visibles en la app Archivos); completadas solo cuando WebKit llama a `downloadDidFinish`.
  - **Permisos**: cámara y micrófono por origen; la ubicación la pregunta WebKit con su propio aviso.
  - Todas las peticiones de WebKit (diálogos de JavaScript, permisos, autenticación, descargas) se responden siempre; si llega una mientras otra está abierta, recibe la respuesta segura (cancelar o denegar).
- **Datos**: `Application Support/ICARUS/` (perfil, historial, Shield, lista de descargas). Las cookies y la caché las guarda WebKit (`WKWebsiteDataStore.default()`), comunes a todas las pestañas.

## Pruebas

| Conjunto | Dónde | Qué comprueba |
| --- | --- | --- |
| `./gradlew -p core test` (25 pruebas) | Local y CI | Vectores compartidos, validación de alias y accesos, perfil, historial, listas de Shield (con un servidor HTTP local para el descargador) y deducción de tipos de recurso |
| Prueba instrumentada (`BrowserSmokeTest`) | Emulador de Android 14 en CI | La app real abre una página local con un anuncio y un rastreador: Shield cancela exactamente 2 solicitudes; alias en la barra y al escribirlo; `javascript:` y `file:` bloqueados; búsqueda; certificado no válido real (`self-signed.badssl.com`) con la barra mostrando el sitio que falló; los tres estilos sin perder pestañas. Captura cada pantalla |
| `swift test` (16 pruebas) | Linux local (Swift 6.1) y macOS en CI | Los mismos vectores; la conversión a reglas de WebKit se comprueba con un evaluador de la semántica de las reglas, que debe bloquear las mismas 28 solicitudes que escritorio |
| `ShieldWebKitTests` (4 pruebas) | Simulador de iOS en CI | Con WebKit real: las reglas compilan; un rastreador real se cancela con las reglas y carga sin ellas; EasyList real se convierte (57 182 de 57 201 filtros) y WebKit la compila; alias en la barra |

Para comprobar las conversiones con filtros reales, también se convirtieron localmente 65 098 filtros de red de los archivos fuente de EasyList y EasyPrivacy: 65 074 se pudieron expresar en WebKit (24 omitidos), en 128 133 reglas, por debajo del máximo de 150 000.

## Lo que no hacen las apps móviles

- Perfiles o pestañas aisladas, sincronización, fondos personalizados, widgets, copia de seguridad.
- Filtros cosméticos de Shield (como en escritorio).
- Firma para tiendas: el APK de CI usa una clave de depuración y el `.ipa` no está firmado (ver el README).
