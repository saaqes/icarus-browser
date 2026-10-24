# ICARUS Shield

ICARUS Shield es el bloqueador de anuncios y rastreadores de la versión de escritorio. Funciona en el proceso principal de Electron, sobre la sesión de las pestañas (`persist:icarus-web`), y **cancela solicitudes de red reales** antes de que salgan del equipo. El contador que muestra la interfaz es el número de solicitudes que Chromium canceló de verdad; no hay cifras estimadas ni simuladas.

En la versión web (el HTML autocontenido) Shield no existe: no hay forma de interceptar solicitudes desde una página, y la interfaz no lo muestra.

## Qué bloquea y qué no

| Sí | No |
| --- | --- |
| Scripts, imágenes, hojas de estilo, fuentes, XHR/fetch, iframes, medios, WebSocket, pings y otras subsolicitudes que coinciden con una regla. | **La página principal** (`mainFrame`): nunca se bloquea una navegación, para no dejar pestañas en blanco sin explicación. |
| | Elementos cosméticos (`##.anuncio`): no se ocultan elementos del DOM. Un hueco donde iba un anuncio bloqueado puede seguir viéndose. |
| | Anuncios servidos desde el mismo dominio y la misma ruta que el contenido (p. ej. los de YouTube). |
| | Filtros que modifican solicitudes (`$redirect`, `$csp`, `$removeparam`, `$popup`…): se ignoran y se cuentan como «ignorados». |

## Listas

| Lista | Origen | Activada por defecto |
| --- | --- | --- |
| ICARUS básica | Incluida en el ejecutable (`electron/shield/builtinList.ts`): unos 65 dominios de anuncios y analítica, solo como terceros. | Sí |
| EasyList | `https://easylist.to/easylist/easylist.txt` | Sí |
| EasyPrivacy | `https://easylist.to/easylist/easyprivacy.txt` | Sí |
| Peter Lowe | `https://pgl.yoyo.org/adservers/…` (formato Adblock Plus) | No |
| Propias | Cualquier URL `https://` añadida en Configuración → ICARUS Shield | Sí, al añadirlas |

- Las listas descargadas se guardan en `<userData>/shield/lists/<id>.txt` y se cargan desde disco al arrancar, así que Shield funciona sin conexión con la última copia.
- Se actualizan en segundo plano cada **4 días** (o con «Actualizar listas»). Si una descarga falla, se conserva la copia anterior y la lista muestra el error.
- Hasta que EasyList y EasyPrivacy se descargan por primera vez, solo está activa la lista básica. Si no hay red, la configuración lo indica con el error de cada lista.
- `ICARUS_SHIELD_AUTO_UPDATE=0` desactiva la actualización automática (se usa en las pruebas).

### Validación de listas

Una lista descargada se rechaza, sin sustituir la copia anterior, si:

| Error | Causa |
| --- | --- |
| `invalid-url` | La URL no es `https://` o incluye usuario y contraseña. |
| `network` | No se pudo conectar o se superaron 30 s. |
| `http` | El servidor respondió con un código distinto de 2xx. |
| `too-large` | Más de 15 MB. |
| `not-a-list` | El contenido parece HTML (p. ej. una página de error o de inicio de sesión). |
| `empty` | No contiene ninguna regla de red aplicable. |

Las líneas que no se entienden cuentan como `invalid` y no impiden usar el resto de la lista.

## Sintaxis admitida

Subconjunto de Adblock Plus / EasyList centrado en el bloqueo de red, más el formato hosts:

```
||ads.ejemplo.com^            dominio y subdominios
|https://ejemplo.com/ad.js|   inicio y final exactos
/banner/*/ad.                 comodín *
/^https?:\/\/[^/]+\/track/    expresión regular
@@||cdn.ejemplo.com^$script   excepción (siempre gana a los bloqueos)
@@||ejemplo.com^$document     desactiva el bloqueo en toda esa página
0.0.0.0 tracker.ejemplo.com   formato hosts
```

Opciones: `$third-party`, `$first-party`, `$domain=a.com|~b.com`, `$match-case`, `$important`, `$all`, tipos de recurso (`script`, `image`, `stylesheet`, `xmlhttprequest`, `subdocument`, `media`, `font`, `object`, `ping`, `websocket`, `other`) y su negación con `~`.

### Rendimiento

El motor (`electron/shield/engine.ts`) indexa las reglas por host (para `||dominio^`) y por un fragmento de texto distintivo de cada patrón; las reglas sin fragmento útil van a una lista genérica pequeña. Para cada solicitud solo se evalúan las reglas de los cubos que coinciden. Los fragmentos demasiado comunes (`http`, `www`, `com`, `js`…) no se usan como índice.

### Dominio registrable

`$third-party` y las excepciones por sitio comparan el **dominio registrable** (eTLD+1). ICARUS no incluye la Public Suffix List completa: usa una lista corta de sufijos de dos niveles frecuentes (`co.uk`, `com.mx`, `com.ar`, `github.io`…) en `electron/shield/domains.ts`. Con sufijos poco comunes, dos sitios distintos bajo el mismo sufijo pueden considerarse el mismo «sitio». Es un límite conocido; la siguiente mejora es incluir la PSL.

## Excepciones por sitio y contador

- El botón del escudo de la barra de herramientas muestra cuántas solicitudes se bloquearon **en la página actual** (se reinicia al navegar a otra página) y permite desactivar Shield para ese sitio. La excepción se guarda por dominio registrable y la pestaña se recarga para aplicarla.
- Configuración → ICARUS Shield muestra el total acumulado, el número de reglas activas, el estado de cada lista, las reglas propias y la lista de excepciones.
- Desactivar Shield por completo deja de cancelar solicitudes de inmediato en todas las pestañas.

## Archivos

| Archivo | Contenido |
| --- | --- |
| `<userData>/shield/shield.json` | Activado, listas, reglas propias, excepciones, total bloqueado y metadatos de cada lista |
| `<userData>/shield/lists/*.txt` | Última copia válida de cada lista descargada |

`shield.json` se sanea al leerlo: las listas predefinidas siempre existen, las URL de listas propias deben ser `https://` y las reglas propias se limitan a 200 000 caracteres.

## Pruebas

- `electron/shield/shield.test.ts`: análisis de filtros, opciones, excepciones, `$document`, formato hosts, HTML rechazado, dominio registrable y terceros.
- `tests/e2e/run.mjs`, paso 13: una página local carga `/ads/banner.js`; con una regla propia, Chromium cancela esa solicitud, el script no se ejecuta y el contador de la página muestra 1.
