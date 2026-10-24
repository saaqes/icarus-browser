// ICARUS para Android. Compilar el APK (requiere el SDK de Android):
//   ./gradlew :app:assembleRelease
// El núcleo sin dependencias de Android se compila aparte (core/) y se incluye
// como build compuesto, así que sus pruebas también funcionan sin el SDK:
//   ./gradlew -p core test
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "icarus-android"
includeBuild("core")
include(":app")
