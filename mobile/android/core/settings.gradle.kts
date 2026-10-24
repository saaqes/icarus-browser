// Núcleo de ICARUS para Android: lógica sin dependencias del SDK de Android
// (URL, búsqueda, alias, Public Suffix List y filtros de ICARUS Shield).
// Es un build independiente para poder compilarlo y probarlo sin el SDK:
//   ../gradlew -p core test
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "core"
