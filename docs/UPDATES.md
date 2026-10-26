# Actualizaciones de ICARUS Browser

Después de instalar ICARUS una vez, las versiones nuevas se reciben y se instalan
desde el propio navegador, sin desinstalarlo y conservando los datos, con lo que
permite cada sistema operativo. Todas las plataformas leen **el mismo manifiesto
firmado** (`icarus-update.json`), publicado junto a cada versión en GitHub Releases.

## Qué ocurre en cada plataforma

| Instalación | Qué hace ICARUS | ¿Pide confirmación? |
| --- | --- | --- |
| **Windows**, instalada con el instalador (`ICARUS-Browser-Setup-X.exe`) | Descarga el instalador nuevo, comprueba firma del manifiesto, SHA-256 y tamaño, y lo ejecuta en silencio sobre la versión actual (`/S --updated`). Un proceso auxiliar espera al instalador y vuelve a abrir ICARUS con las pestañas que tenías. | Solo pulsar «Actualizar ahora» (o «Instalar al cerrar ICARUS»). |
| **Windows**, versión portátil (`.zip`) | Descarga y verifica el `.zip` nuevo y lo muestra en su carpeta: hay que descomprimirlo en lugar de la carpeta actual. | Sí: lo colocas tú. |
| **macOS**, app en una carpeta con permiso de escritura (p. ej. *Aplicaciones*) | Descarga el `.zip` de la app, comprueba firma del manifiesto, SHA-256, identificador, versión y firma de código, y al cerrarse sustituye la app (con vuelta atrás si algo falla) y la vuelve a abrir. | Solo pulsar «Actualizar ahora». |
| **macOS**, app sin permiso de escritura, abierta desde el `.dmg` o «trasladada» por Gatekeeper | Descarga y verifica el `.dmg` y lo abre: hay que arrastrar la app a *Aplicaciones*. | Sí: la colocas tú. |
| **Linux** (carpeta `linux-unpacked`, no se publica paquete) | Avisa y abre la página de la versión. | Sí: manual. |
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

## Publicar una versión

Subir commits a una rama **nunca** publica nada. Solo publica una etiqueta de versión:

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
| `ICARUS_KEYSTORE_BASE64`, `ICARUS_KEYSTORE_PASSWORD`, `ICARUS_KEY_ALIAS`, `ICARUS_KEY_PASSWORD` | Almacén de claves del APK. Android solo instala una actualización firmada con el mismo certificado, así que debe ser siempre el mismo | **Sí** |

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

Pruebas automáticas:

```bash
npm run typecheck && npm run test                            # escritorio, interfaz, vectores compartidos y versión única
cd mobile/android && ./gradlew -p core test                  # núcleo de Android (manifiesto, firma, descarga)
cd mobile/ios && swift test                                  # núcleo de iPhone (en un Mac)
```

## Limitaciones conocidas

- Linux: no se publica paquete, así que solo se avisa.
- Android: la instalación final siempre requiere la confirmación del usuario en el
  instalador de Android (es una protección del sistema). La prueba de CI comprueba el
  aviso, la descarga verificada y el rechazo de un APK que no corresponde, pero no pulsa
  «Actualizar» en el instalador del sistema.
- iPhone/iPad: solo aviso; la instalación depende del canal oficial (App Store o
  TestFlight) o de volver a firmar el `.ipa`.
- Sin firma de código (Windows y macOS), el primer instalador sigue mostrando los avisos
  de SmartScreen y Gatekeeper; las actualizaciones posteriores no los muestran, porque
  ICARUS las descarga y verifica él mismo.
