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

android {
    namespace = "io.github.saaqes.icarusbrowser"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.saaqes.icarusbrowser"
        minSdk = 29
        targetSdk = 35
        versionCode = (System.getenv("ICARUS_VERSION_CODE") ?: "1").toInt()
        versionName = "0.2.0"
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
    implementation("io.github.saaqes.icarusbrowser:core:0.2.0")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
