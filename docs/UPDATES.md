# Actualizaciones de ICARUS Browser

Después de instalar ICARUS una vez, las versiones nuevas se reciben y se instalan
desde el propio navegador, sin desinstalarlo y conservando los datos, con lo que
permite cada sistema operativo. Todas las plataformas leen **el mismo manifiesto
firmado** (`icarus-update.json`), publicado junto a cada versión en GitHub Releases.

## Qué ocurre en cada plataforma

| Instalación | Qué hace ICARUS | ¿Pide confirmación? |
| --- | --- | --- |
| **Windows**, instalada con el instalador (`ICARUS-Browser-Setup-X.exe`) | Descarga el instalador nuevo, comprueba firma del manifiesto, SHA-256 y tamaño, y un proceso auxiliar copia la instalación actual, ejecuta el instalador en silencio sobre ella (`/S --updated`), comprueba que quedó la versión nueva y vuelve a abrir ICARUS con las pestañas que tenías. **Si el instalador falla o deja la instalación a medias, restaura la copia** y ICARUS vuelve a abrirse en la versión anterior. | Solo pulsar «Actualizar y reiniciar» (o nada, con «Actualizar automáticamente»). |
| **Windows**, versión portátil (`.zip`) | Descarga y verifica el `.zip` nuevo y lo muestra en su carpeta: hay que descomprimirlo en lugar de la carpeta actual. | Sí: lo colocas tú. |
| **macOS**, app en una carpeta con permiso de escritura (p. ej. *Aplicaciones*) | Descarga el `.zip` de la app, comprueba firma del manifiesto, SHA-256, identificador, versión y firma de código, y al cerrarse sustituye la app (con vuelta atrás si algo falla) y la vuelve a abrir. | Pulsar «Actualizar ahora». Sin Developer ID, además, macOS pide una vez tras cada actualización permiso para usar la clave del llavero (ver abajo). |
| **macOS**, app sin permiso de escritura, abierta desde el `.dmg` o «trasladada» por Gatekeeper | Descarga y verifica el `.dmg` y lo abre: hay que arrastrar la app a *Aplicaciones*. | Sí: la colocas tú. |
| **Linux**, AppImage (`ICARUS-Browser-X-linux-x64.AppImage`) en una carpeta con permiso de escritura | Descarga el AppImage nuevo, comprueba firma del manifiesto, SHA-256 y que es un AppImage, lo deja junto al actual y, al cerrarse ICARUS, lo pone en su lugar con un `rename` (atómico: nunca queda a medias). Lo abre y espera a que confirme que arrancó; **si no arranca en 90 s, restaura el anterior** y lo abre. | Solo pulsar «Actualizar y reiniciar». |
| **Linux**, otra instalación (carpeta suelta, AppImage sin permiso de escritura) | Avisa y abre la página de la versión. | Sí: manual. |
| **Android**, APK instalado a mano | Descarga el APK, comprueba firma del manifiesto, SHA-256, tamaño, que es ICARUS, la versión anunciada, que es posterior y que está firmado con **el mismo certificado** que la app instalada. Después lo entrega al instalador de Android. | Sí, siempre: Android pide permiso una vez para «instalar apps desde ICARUS» y confirmación en cada actualización. Nunca se instala en silencio. |
| **Android**, instalado desde Google Play | No descarga nada: las actualizaciones llegan por Google Play. | — |
| **iPhone/iPad** | Comprueba el manifiesto firmado y **avisa**. iOS no permite que una app se instale a sí misma: con App Store o TestFlight abre su ficha; en una copia instalada a mano abre la página de la versión y explica cómo volver a firmar el `.ipa`. Nunca descarga ni instala un `.ipa`. | Sí: por el canal oficial. |
| Compilación de desarrollo o sin clave pública | No busca actualizaciones (Configuración → Actualizaciones lo explica). | — |

Datos que se conservan siempre (no están en la carpeta de la aplicación, así que
ninguna actualización los toca): pestañas, accesos directos, historial, direcciones
personalizadas, preferencias, cookies y datos de sitios, listas de Shield y
descargas.

- Windows: `%APPDATA%\ICARUS Browser` · macOS: `~/Library/Application Support/ICARUS Browser`
- Android: almacenamiento interno de la app (una actualización del mismo paquete lo conserva).
- iPhone/iPad: Application Support de la app.

Las actualizaciones no cambian ninguna clave ni ruta de datos existente. Solo añaden:
`updates.json` (escritorio; canal, versión pospuesta y marca de instalación), la
carpeta temporal `updates/` (se borra tras actualizar), la clave
`icarus.updateRestartSession` (pestañas guardadas para el reinicio; se usa una vez),
`icarus/updates.json` en Android y `icarus.updates.*` en las preferencias de iOS.

## En la interfaz

**Configuración → Acerca de ICARUS → Actualizaciones** (escritorio): nombre (ICARUS Browser),
versión instalada, última versión disponible, estado, fecha de la última comprobación,
«Buscar actualizaciones», «Descargar actualización», «Actualizar y reiniciar» y la opción
**«Actualizar automáticamente»** (descarga y verifica sola cada versión nueva y la instala al
cerrar ICARUS, como Chrome y Edge; sin ella, ICARUS solo avisa). Estados: «Tu navegador está
actualizado», «Nueva actualización disponible», «Descargando actualización» (con
porcentaje), «Verificando archivos», «Preparando instalación», «Actualización lista para
instalar», «Reinicio necesario», «Actualización completada» y «Error al actualizar» (con
el motivo: sin conexión, error del servidor, firma o huella incorrectas, descarga
interrumpida, sin espacio, instalación fallida…).

**Configuración → Actualizaciones** (escritorio, Android e iPhone): versión instalada,
canal (estable o vista previa), última comprobación, «Buscar actualizaciones»,
estado, versión nueva con sus notas (como texto), progreso de la descarga,
«Actualizar ahora» / «Descargar actualización», «Recordármelo más tarde», «Instalar y
reiniciar» o «Instalar al cerrar ICARUS» y mensajes de error comprensibles.

**Aviso discreto**: en escritorio, una píldora «Actualizar» en la barra (solo si hay
versión nueva que no hayas pospuesto); en Android, un mensaje breve una vez por
versión y «Actualizar ICARUS» en el menú; en iPhone, un mensaje breve una vez por
versión. «Recordármelo más tarde» se guarda por versión: no se vuelve a avisar de esa
versión, pero sí de la siguiente. Tras actualizar, ICARUS confirma la versión que se
está ejecutando.

Comprobaciones: 15 segundos después de abrir ICARUS y cada 6 horas en escritorio; al
abrir la app (como mucho cada 6 horas) en Android e iPhone. Nada se descarga hasta que
lo pides. Los fallos de red de las comprobaciones automáticas no se muestran como
error.

## Seguridad

- **Manifiesto firmado**: ECDSA P-256 con SHA-256 sobre los bytes exactos de
  `icarus-update.json`; la firma (DER en base64) está en `icarus-update.json.sig`. La
  app solo lleva la **clave pública** (`build/update-public-key.pem`, incluida en
  `app.asar`, en `BuildConfig` de Android y en los recursos de iOS). La clave privada
  solo existe en el secreto `ICARUS_UPDATE_SIGNING_KEY` de GitHub Actions.
- **Ninguna URL viene del servidor**: las direcciones se construyen en la app a partir
  del repositorio, la etiqueta y nombres de archivo validados (`ICARUS-Browser-…`, sin
  rutas). Las redirecciones solo pueden ir a `github.com`,
  `objects.githubusercontent.com` y `release-assets.githubusercontent.com` por HTTPS;
  cualquier otra se rechaza. Una respuesta manipulada no puede forzar otra descarga.
- **Sin token**: se consulta sin credenciales (`releases/latest/download/…`, sin límite
  de la API; el canal de vista previa usa la API pública de versiones).
- **Paquetes**: tamaño exacto (nunca se escribe más de lo anunciado), SHA-256 antes de
  usar el archivo (y otra vez justo antes de instalar), espacio libre comprobado,
  descarga reanudable (`Range`). Un archivo que no coincide se borra.
- **Límites de tiempo**: una comprobación que no termina en 30 s cuenta como fallo de
  red (no se muestra si era automática) y una descarga que pasa 60 s sin recibir datos
  se da por interrumpida, conservando el archivo parcial para reanudarla. Así una
  conexión colgada no deja ICARUS en «Buscando actualizaciones…».
- **Sin retrocesos**: nunca se ofrece una versión igual o anterior a la instalada, ni
  una preliminar en el canal estable (el canal va dentro del manifiesto firmado y debe
  coincidir con la versión). No hay forma de forzar un retroceso desde el servidor.
- **Comprobaciones del sistema**: en Windows, si la app instalada tiene firma
  Authenticode, el instalador nuevo debe estar firmado por el mismo titular; en macOS,
  `codesign --verify --deep --strict`, identificador `io.github.saaqes.icarusbrowser`
  y, si la app tiene Developer ID, el mismo equipo; en Android, mismo paquete y mismo
  certificado (además de la comprobación del propio Android).
- **Sin bucles**: antes de instalar se guarda una marca (`pending`). Al arrancar, si
  la versión es la nueva se confirma; si sigue siendo la anterior, se informa del fallo
  y esa versión no se vuelve a instalar sola.
- Las comprobaciones de firma de los sistemas no se desactivan en ningún caso.

## El manifiesto

```json
{
  "schema": 1,
  "product": "icarus-browser",
  "version": "0.3.0",
  "channel": "stable",
  "tag": "v0.3.0",
  "commit": "40 caracteres hexadecimales del commit compilado",
  "releasedAt": "2026-10-26T10:00:00.000Z",
  "notes": "Novedades (texto plano, como mucho 20 000 caracteres)",
  "assets": [
    { "platform": "windows", "arch": "x64", "kind": "nsis", "file": "ICARUS-Browser-Setup-0.3.0.exe", "size": 94371840, "sha256": "…" },
    { "platform": "windows", "arch": "x64", "kind": "zip", "file": "ICARUS-Browser-0.3.0-win-x64.zip", "size": 0, "sha256": "…" },
    { "platform": "macos", "arch": "arm64", "kind": "zip", "file": "ICARUS-Browser-0.3.0-mac-arm64.zip", "size": 0, "sha256": "…" },
    { "platform": "macos", "arch": "x64", "kind": "zip", "file": "ICARUS-Browser-0.3.0-mac-x64.zip", "size": 0, "sha256": "…" },
    { "platform": "macos", "arch": "arm64", "kind": "dmg", "file": "ICARUS-Browser-0.3.0-mac-arm64.dmg", "size": 0, "sha256": "…" },
    { "platform": "macos", "arch": "x64", "kind": "dmg", "file": "ICARUS-Browser-0.3.0-mac-x64.dmg", "size": 0, "sha256": "…" },
    { "platform": "linux", "arch": "x64", "kind": "appimage", "file": "ICARUS-Browser-0.3.0-linux-x64.AppImage", "size": 0, "sha256": "…" },
    { "platform": "android", "arch": "universal", "kind": "apk", "file": "ICARUS-Browser-0.3.0-android.apk", "size": 0, "sha256": "…", "versionCode": 30099 },
    { "platform": "ios", "arch": "universal", "kind": "ipa", "file": "ICARUS-Browser-0.3.0-ios-sin-firmar.ipa", "size": 0, "sha256": "…" }
  ]
}
```

Reglas (las mismas en `electron/update/manifest.ts`, el núcleo de Android y el de
iOS; los vectores de `mobile/shared/test-vectors/updates.json` comprueban que las tres
implementaciones deciden igual):

- `version`: `X.Y.Z` (estable) o `X.Y.Z-preview.N` (preliminar, N de 1 a 98); `channel`
  coincide con ella y `tag` es `v` + versión.
- Los paquetes de una plataforma, arquitectura o tipo que la versión instalada no conoce se
  ignoran (el manifiesto sigue firmado entero): así, añadir un tipo de paquete nuevo no deja
  sin actualizaciones a las instalaciones existentes.
- Cada paquete: plataforma, arquitectura y tipo conocidos, nombre `ICARUS-Browser-…`
  con la versión y la extensión de su tipo, tamaño entre 1 B y 1 GB, SHA-256 en
  minúsculas y, solo en Android, `versionCode`. No se repite plataforma/arquitectura/tipo.
- `versionCode` (Android y `CFBundleVersion` de iOS) =
  `((mayor × 100 + menor) × 100 + parche) × 100 + (N de la preliminar, o 99)`.

CI lo genera con `scripts/release/make-manifest.mjs` a partir de los paquetes
compilados, lo firma con `sign-manifest.mjs` y lo comprueba con `verify-release.mjs`,
que usan la misma validación compilada que la app.

**Otro servidor**: el origen está aislado en `electron/update/source.ts`
(`UpdateSource`) y en sus equivalentes de Android (`UpdateSource`) e iOS
(`UpdateChecker`). Para servir las versiones desde un servidor propio basta con
implementar las mismas rutas (`…/latest/download/icarus-update.json`,
`…/download/<etiqueta>/<archivo>`) y añadir su host a la lista de permitidos; el
manifiesto y su firma no cambian.

## Versión única

`package.json` es la única fuente de la versión:

- Escritorio la toma al empaquetar (y la guarda, con el commit, en
  `dist-electron/build-info.json`).
- Android la lee en Gradle (`versionName` y `versionCode`).
- iPhone la recibe en `mobile/ios/App/project.yml` con
  `node scripts/release/version.mjs sync` (que también ejecuta `npm version`).
  `MARKETING_VERSION` es `X.Y.Z` (Apple solo admite números) y
  `CURRENT_PROJECT_VERSION`, el `versionCode`.

`node scripts/release/version.mjs check` (en CI) y una prueba fallan si algo se
desincroniza. CI comprueba además dentro de cada paquete la versión, el commit y la
clave (`scripts/release/check-build.mjs`), el `versionCode` del APK (`aapt`) y el
`Info.plist` de iOS.

## Publicación automática

Cada commit subido pasa por los cinco flujos (CI con Linux y el AppImage, Windows, macOS,
Android e iPhone). Cuando terminan **todos** bien, `.github/workflows/draft.yml` reúne sus
paquetes ya probados (sin volver a compilar) y decide con `scripts/release/auto-plan.mjs`:

- **Se publica** la versión si el commit es de la rama principal, la versión de
  `package.json` es nueva (no existe su etiqueta y es posterior a todas las publicadas) y
  están la clave pública y el secreto de firma. Se genera, firma y verifica el manifiesto,
  se crea la versión como borrador, se comprueban todos los archivos y se publica (estable
  `X.Y.Z` → «latest»; `X.Y.Z-preview.N` → preliminar). Por último se descargan sin
  credenciales el manifiesto y cada paquete y se comparan con lo firmado; si algo no
  coincide, la versión vuelve a ser un borrador. Las instalaciones la ven en la siguiente
  comprobación.
- **Si no**, se crea un borrador privado `vX.Y.Z-auto.<commit>` sin manifiesto.
- **Si falla cualquier prueba, no se publica ni se crea nada.**

Así, publicar es subir la versión en el mismo commit (o en uno posterior) y empujarlo:

```bash
npm version patch --no-git-tag-version   # 0.2.1 → 0.2.2 (o minor, o 0.3.0-preview.1)
node scripts/release/version.mjs sync    # misma versión en iPhone
git commit -am "Versión 0.2.2" && git push
```

Las notas de la versión salen de `docs/release-notes/X.Y.Z.md` o, si no existe, del mensaje
del commit. Un commit que no cambia la versión nunca publica nada. Para aprobar cada
publicación a mano: Settings → Environments → `release` → *Required reviewers*.

## Primera versión actualizable

Las copias instaladas hasta ahora se compilaron sin clave pública, así que no buscan
actualizaciones. Una sola vez:

1. **Crear la clave** de firma: con la página «Clave de actualizaciones de ICARUS» (la
   genera WebCrypto en tu navegador y no la envía a ningún sitio) o con
   `node scripts/release/generate-update-key.mjs`.
2. **Guardar la privada** como secreto `ICARUS_UPDATE_SIGNING_KEY` (Settings → Secrets and
   variables → Actions).
3. **Añadir la pública** al repositorio (`build/update-public-key.pem` y
   `mobile/ios/App/Resources/update-public-key.pem`) y subir la versión (por ejemplo, a
   0.2.1) en el mismo commit. Cuando pasen los cinco flujos, se publica v0.2.1.
4. **Instalar v0.2.1 una vez** sobre la versión actual con
   `ICARUS-Browser-Setup-0.2.1.exe` (Windows: no hace falta desinstalar; el instalador
   sustituye la aplicación y conserva %APPDATA%\ICARUS Browser), el `.dmg` (macOS) o el
   AppImage (Linux).
5. Desde ahí, cada versión publicada se instala desde Configuración → Acerca de ICARUS →
   Actualizaciones, sin descargar nada a mano.

## Publicar una versión con una etiqueta

También se puede publicar con una etiqueta (vuelve a compilar y probar todo):

```bash
npm version 0.3.0              # cambia package.json, sincroniza iPhone, hace commit y etiqueta v0.3.0
# Notas: mensaje de la etiqueta anotada o docs/release-notes/0.3.0.md
git push && git push origin v0.3.0
```

- `vX.Y.Z` → versión **estable** (la reciben todas las instalaciones del canal estable).
- `vX.Y.Z-preview.N` → versión **preliminar** (solo el canal «Vista previa»):
  `npm version 0.3.0-preview.1`.
- Lanzar **Publicación** a mano en Actions → **borrador** privado sin manifiesto, para
  revisar los paquetes; nunca llega a nadie.
- Cada commit subido cuyas compilaciones terminan bien → versión publicada si sube la
  versión (ver «Publicación automática»); si no, **borrador automático**
  `vX.Y.Z-auto.<commit>` sin manifiesto (se conservan los 5 más recientes).

`.github/workflows/release.yml`:

1. **Plan** (antes de compilar): la etiqueta coincide con `package.json`, la versión no
   está publicada ni es anterior o igual a otra publicada, existen la clave pública y
   los secretos de firma. Si algo falla, no se compila ni se publica nada.
2. **Pruebas y paquetes** (los flujos existentes, reutilizados): CI (tipos, 190+
   pruebas, E2E en Linux), Windows (instalador, instalación, E2E y actualización real),
   macOS (`.dmg`/`.zip`, E2E y actualización real), Android (núcleo, APK, lint,
   emulador) e iPhone (núcleo, simulador, `.ipa`).
3. **Publicación** (entorno `release`): comprueba las sumas de cada plataforma, genera,
   firma y verifica el manifiesto, crea la versión **como borrador** con todos los
   archivos, comprueba que están todos con su tamaño, la publica y, por último, descarga
   sin credenciales el manifiesto y cada paquete desde las direcciones públicas y
   compara los SHA-256. Si algo no coincide, la vuelve a convertir en borrador.

Para exigir una aprobación manual antes de cada publicación: Settings → Environments
→ `release` → *Required reviewers*. Para que solo los administradores puedan crear
etiquetas `v*`: Settings → Rules → Rulesets (etiquetas).

## Secretos, certificados y cuentas

Ninguna clave privada, contraseña ni token está en el repositorio. CI usa
`GITHUB_TOKEN` con permisos mínimos (`contents: read`; `contents: write` solo en el
trabajo de publicación).

| Secreto (Settings → Secrets and variables → Actions) | Para qué | ¿Obligatorio para publicar? |
| --- | --- | --- |
| `ICARUS_UPDATE_SIGNING_KEY` | Clave privada ECDSA P-256 (PEM) que firma el manifiesto | **Sí** |
| `ICARUS_KEYSTORE_BASE64`, `ICARUS_KEYSTORE_PASSWORD`, `ICARUS_KEY_ALIAS`, `ICARUS_KEY_PASSWORD` | Almacén de claves del APK. Android solo instala una actualización firmada con el mismo certificado, así que debe ser siempre el mismo | No: sin ellos se publica igualmente, pero el APK se adjunta sin entrar en el manifiesto (no se ofrece como actualización) |

Crear la clave de actualizaciones (una sola vez; guarda una copia de la privada fuera
de línea: si se pierde, las instalaciones existentes no aceptarán otra clave y habría
que reinstalar):

```bash
npm run build:electron
node scripts/release/generate-update-key.mjs            # privada en ~/icarus-update-signing-key.pem (permisos 600)
gh secret set ICARUS_UPDATE_SIGNING_KEY --repo saaqes/icarus-browser < ~/icarus-update-signing-key.pem
git add build/update-public-key.pem mobile/ios/App/Resources/update-public-key.pem
git commit -m "Clave pública de actualizaciones" && git push
```

Crear el almacén de claves de Android (una sola vez):

```bash
keytool -genkeypair -v -keystore icarus.keystore -alias icarus -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 icarus.keystore | gh secret set ICARUS_KEYSTORE_BASE64 --repo saaqes/icarus-browser
gh secret set ICARUS_KEYSTORE_PASSWORD --repo saaqes/icarus-browser
gh secret set ICARUS_KEY_ALIAS --repo saaqes/icarus-browser
gh secret set ICARUS_KEY_PASSWORD --repo saaqes/icarus-browser
```

Las instalaciones de Android hechas con APK de CI anteriores (firmados con una clave
de depuración temporal) tienen otro certificado: hay que desinstalarlas una vez e
instalar un APK firmado con este almacén; a partir de ahí, se actualizan solas.

**Opcional (no necesario para las actualizaciones, porque la autenticidad la da el
manifiesto firmado):**

- **Windows, firma Authenticode** (quita el aviso de SmartScreen al instalar por
  primera vez): certificado de firma de código (OV/EV) de una autoridad reconocida.
  electron-builder lo usa con `WIN_CSC_LINK` (certificado .pfx en base64) y
  `WIN_CSC_KEY_PASSWORD`, quitando `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` de
  `windows.yml`. En cuanto la app instalada esté firmada, ICARUS exigirá que cada
  instalador nuevo lo esté por el mismo titular.
- **macOS, Developer ID y notarización** (quita el aviso de Gatekeeper; requiere el
  Apple Developer Program): certificado *Developer ID Application* (`CSC_LINK`,
  `CSC_KEY_PASSWORD`) y notarización (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`), cambiando `identity: "-"` por la identidad y activando
  `hardenedRuntime` y `notarize` en `electron-builder.yml`. Con Developer ID, ICARUS
  exigirá el mismo equipo (`TeamIdentifier`) en cada versión nueva.
- **iPhone, App Store o TestFlight** (cuenta del Apple Developer Program): con la app
  publicada, cambia en `mobile/ios/App/project.yml` `ICARUSDistribution` a `app-store`
  o `testflight` e `ICARUSStoreURL` a la ficha (`https://apps.apple.com/app/id…` o
  `itms-beta://…`). Sin ellos, la app avisa y explica cómo volver a firmar el `.ipa`.
- **Google Play**: si se publicara allí, la app lo detecta y deja las actualizaciones a
  Google Play. Play no permite `REQUEST_INSTALL_PACKAGES` sin justificación, así que
  convendría una variante sin ese permiso.

## Probar una actualización en local

Prueba completa automática (la misma que CI), en Windows o macOS, con una versión
instalada y la siguiente compilada:

```bash
npm ci && npm run build
npx electron-builder --win nsis --x64 --publish never      # o: --mac zip --arm64
# Instala release/ICARUS-Browser-Setup-0.2.0.exe (o descomprime el .zip en una carpeta tuya)
npm pkg set version=0.2.1 && npm run build
npx electron-builder --win nsis --x64 --publish never
node -e "const c=require('crypto'),f=require('fs');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});f.writeFileSync('prueba.key',k.privateKey.export({type:'pkcs8',format:'pem'}));f.writeFileSync('prueba.pub',k.publicKey.export({type:'spki',format:'pem'}))"
node scripts/release/make-manifest.mjs --dir release --version 0.2.1 --commit $(git rev-parse HEAD) --select windows/x64/nsis
node scripts/release/sign-manifest.mjs --dir release --key-file prueba.key --public-key prueba.pub
node tests/e2e/update-packaged.mjs --app "%LOCALAPPDATA%\Programs\ICARUS Browser\ICARUS Browser.exe" \
  --feed release --public-key prueba.pub --from 0.2.0 --to 0.2.1
git checkout package.json package-lock.json
```

La prueba sirve la versión nueva en `127.0.0.1` con la estructura de GitHub, abre dos
pestañas y guarda datos, pulsa «Actualizar» → «Actualizar ahora» y comprueba que
ICARUS se cierra, que el paquete sustituye a la versión instalada, que ICARUS se vuelve
a abrir, que la versión es la nueva, que los datos siguen ahí y que no se vuelve a
ofrecer.

Para explorarlo a mano, sirve una carpeta con
`releases/latest/download/icarus-update.json(.sig)` y
`releases/download/v0.2.1/<paquete>` (por ejemplo, `python3 -m http.server 8080`) y
abre ICARUS con:

```bash
ICARUS_UPDATE_FEED=http://127.0.0.1:8080 ICARUS_UPDATE_PUBLIC_KEY_FILE=prueba.pub ICARUS_UPDATE_CHECK_DELAY_MS=0 ICARUS_USER_DATA_DIR=/tmp/icarus-prueba "ruta/al/ICARUS"
```

`ICARUS_UPDATE_FEED` solo admite `http://127.0.0.1`, `localhost` o `[::1]`, y
`ICARUS_UPDATE_PUBLIC_KEY_FILE` solo se tiene en cuenta con él: no sirven para apuntar
una instalación a otro servidor de Internet.

En Linux, con el AppImage de la versión actual y el de la siguiente (en una carpeta con su
manifiesto firmado con una clave de prueba), la prueba completa con los casos de fallo:

```bash
npx electron-builder --linux AppImage --x64 --publish never        # versión actual y, tras npm pkg set version=…, la siguiente
node scripts/release/make-manifest.mjs --dir feed --version 0.2.1 --commit $(git rev-parse HEAD) --select linux/x64/appimage
node scripts/release/sign-manifest.mjs --dir feed --key-file prueba.key --public-key prueba.pub
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a node tests/e2e/update-linux.mjs --app ICARUS-Browser-0.2.0-linux-x64.AppImage \
  --feed feed --public-key prueba.pub --private-key prueba.key --from 0.2.0 --to 0.2.1
```

Pruebas automáticas:

```bash
npm run typecheck && npm run test                            # escritorio, interfaz, vectores compartidos y versión única
cd mobile/android && ./gradlew -p core test                  # núcleo de Android (manifiesto, firma, descarga)
cd mobile/ios && swift test                                  # núcleo de iPhone (en un Mac)
```

## Pruebas reales de actualización

| Prueba | Qué hace | Dónde |
| --- | --- | --- |
| `tests/e2e/update-linux.mjs` | AppImage real de la versión actual → la siguiente, servida en 127.0.0.1 con la estructura de GitHub y un manifiesto firmado con una clave de prueba. Casos: sin versiones nuevas (404), ya actualizado, sin conexión, error de descarga (HTTP 500), SHA-256 distinto del firmado (se borra y no se instala), paquete dañado que no arranca (se restaura el anterior y no se reintenta solo), descarga interrumpida a la mitad (se reanuda con `Range`), actualización real con reinicio, datos intactos (almacenamiento, preferencias, historial) y sin bucles | Linux, en local y en cada commit (CI) |
| `tests/e2e/update-packaged.mjs` | Instalador NSIS real (Windows) o app en una carpeta escribible (macOS) de la versión actual → la siguiente: aviso, «Actualizar y reiniciar», cierre, sustitución, reapertura con las pestañas, versión nueva, datos intactos, sin bucles | Windows y macOS (CI) |
| `… --expect-failure` | Windows: un instalador de prueba borra `app.asar` y termina con error; el proceso auxiliar restaura la copia, ICARUS se reabre en la versión anterior con los datos intactos y no reintenta esa versión solo | Windows (CI) |

## Limitaciones conocidas

- Linux: se actualiza solo el AppImage en una carpeta con permiso de escritura (por
  ejemplo, `~/Aplicaciones`); en `/opt` u otras carpetas de root, ICARUS solo avisa. En
  Ubuntu 24.04 o posterior, AppArmor restringe los espacios de nombres sin privilegios que
  usa el sandbox de Chromium dentro de un AppImage: hace falta un perfil de AppArmor para
  ICARUS (o `sysctl kernel.apparmor_restrict_unprivileged_userns=0`). Nunca se arranca con
  `--no-sandbox`.
- macOS: si la app nueva no arranca, no se restaura sola (sí se restaura si falla la
  sustitución de la app); se puede volver a instalar desde el `.dmg`.
- Android: la instalación final siempre requiere la confirmación del usuario en el
  instalador de Android (es una protección del sistema). La prueba de CI comprueba el
  aviso, la descarga verificada y el rechazo de un APK que no corresponde, pero no pulsa
  «Actualizar» en el instalador del sistema.
- iPhone/iPad: solo aviso; la instalación depende del canal oficial (App Store o
  TestFlight) o de volver a firmar el `.ipa`.
- Sin firma de código (Windows y macOS), el primer instalador sigue mostrando los avisos
  de SmartScreen y Gatekeeper; las actualizaciones posteriores no los muestran, porque
  ICARUS las descarga y verifica él mismo.
- **macOS sin Developer ID: aviso del llavero tras actualizar.** Chromium cifra las
  cookies con una clave guardada en el llavero («ICARUS Browser Safe Storage»), que
  solo puede leer sin preguntar la app que la creó. Con firma ad hoc cada compilación
  tiene otra identidad, así que la primera vez que se abre la versión nueva macOS
  pregunta si ICARUS puede usar esa clave; mientras no se responde, las páginas no
  cargan. Hay que pulsar «Permitir siempre» (con la contraseña del Mac); si se
  deniega, se pierden las cookies (se cierran las sesiones iniciadas en las webs), no
  el resto de datos. ICARUS lo explica junto a «Actualizar ahora» cuando la app
  instalada no tiene Developer ID. La prueba real de CI lo confirmó: la instancia
  reabierta no hizo ninguna petición y el aviso del sistema (SecurityAgent) estaba
  abierto. Como en CI nadie puede responderlo, la instancia con la que la prueba
  comprueba la versión nueva usa `--use-mock-keychain` (solo en la prueba). Con
  Developer ID la identidad se mantiene entre versiones y el aviso no aparece. No se
  elude: es una protección del sistema.
