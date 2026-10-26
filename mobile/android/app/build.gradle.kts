import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firma de la versión release: solo si CI recibe un almacén de claves por
// secretos (ICARUS_KEYSTORE_*). Nunca se incluye una clave en el repositorio.
// Sin ellos, el APK release se firma con la clave de depuración local, que sirve
// para instalarlo a mano pero no para publicarlo en una tienda.
val keystorePath: String? = System.getenv("ICARUS_KEYSTORE_PATH")?.takeIf { file(it).isFile }

// Versión única: la de package.json, la misma que escritorio e iPhone. El
// versionCode se calcula como en electron/update/version.ts para que cada versión
// tenga uno mayor que la anterior (una preliminar, menor que su estable):
// ((mayor × 100 + menor) × 100 + parche) × 100 + (número de preliminar o 99).
val icarusVersion: String = run {
    @Suppress("UNCHECKED_CAST")
    val json = groovy.json.JsonSlurper().parse(rootDir.resolve("../../package.json")) as Map<String, Any?>
    json["version"] as? String ?: error("package.json no tiene versión")
}
val icarusVersionCode: Int = run {
    val match = Regex("^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)(?:-preview\\.([1-9]\\d?))?$").matchEntire(icarusVersion)
        ?: error("Versión no válida en package.json: $icarusVersion (formato X.Y.Z o X.Y.Z-preview.N)")
    val (major, minor, patch, preview) = match.destructured
    require(major.toInt() <= 2000) { "La versión mayor no puede pasar de 2000 (límite de versionCode de Android)" }
    ((major.toInt() * 100 + minor.toInt()) * 100 + patch.toInt()) * 100 + (preview.toIntOrNull() ?: 99)
}

android {
    namespace = "io.github.saaqes.icarusbrowser"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.saaqes.icarusbrowser"
        minSdk = 29
        targetSdk = 35
        versionCode = icarusVersionCode
        versionName = icarusVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ICARUS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ICARUS_KEY_ALIAS")
                keyPassword = System.getenv("ICARUS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Reglas compartidas con escritorio e iPhone (mobile/shared). Los vectores de
    // prueba no se empaquetan.
    sourceSets["main"].assets.srcDir("../../shared")
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~:!test-vectors"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("io.github.saaqes.icarusbrowser:core:$icarusVersion")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
