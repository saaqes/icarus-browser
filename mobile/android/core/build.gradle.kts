import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.1.21"
    `java-library`
}

group = "io.github.saaqes.icarusbrowser"
// La misma versión que la app (package.json del proyecto).
@Suppress("UNCHECKED_CAST")
version = (groovy.json.JsonSlurper().parse(rootDir.resolve("../../../package.json")) as Map<String, Any?>)["version"] as String

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Android ya incluye org.json; en la JVM solo hace falta para las pruebas.
    compileOnly("org.json:json:20240303")
    testImplementation(kotlin("test"))
    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.json:json:20240303")
}

tasks.test {
    useJUnitPlatform()
    // Los vectores de prueba se generan desde la versión de escritorio (mobile/shared).
    systemProperty("icarus.shared", rootDir.resolve("../../shared").canonicalPath)
}
