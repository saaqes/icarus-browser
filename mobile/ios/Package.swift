// swift-tools-version:5.9
// Núcleo de ICARUS para iPhone y iPad: lógica sin dependencias de UIKit/WebKit
// (URL, búsqueda, alias, Public Suffix List, filtros de ICARUS Shield y su
// conversión a reglas de contenido de WebKit, perfil e historial).
// Las pruebas leen los mismos vectores que escritorio y Android (mobile/shared):
//   swift test
import PackageDescription

let package = Package(
    name: "IcarusCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "IcarusCore", targets: ["IcarusCore"])],
    targets: [
        .target(name: "IcarusCore", path: "Sources/IcarusCore"),
        .testTarget(name: "IcarusCoreTests", dependencies: ["IcarusCore"], path: "Tests/IcarusCoreTests"),
    ]
)
