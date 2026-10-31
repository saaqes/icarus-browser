import UIKit

/// Icono de la app según el estilo: iconos alternativos de Assets.xcassets (AppIcon-Esencial y
/// AppIcon-Panorama), diseños propios de ICARUS, no logotipos de otros navegadores.
/// iOS lo confirma con un aviso del sistema cada vez que cambia y no permite cambiar el
/// nombre que aparece bajo el icono.
@MainActor
enum AppIcon {
    static func name(for theme: ThemeId) -> String? {
        switch theme {
        case .icarus: return nil
        case .essential: return "AppIcon-Esencial"
        case .panorama: return "AppIcon-Panorama"
        }
    }

    /// Solo con la app en primer plano: iOS rechaza el cambio en segundo plano.
    static func apply(_ theme: ThemeId) {
        let app = UIApplication.shared
        let wanted = name(for: theme)
        guard app.supportsAlternateIcons, app.applicationState == .active, app.alternateIconName != wanted else { return }
        app.setAlternateIconName(wanted) { error in
            if let error { print("[icono] No se pudo cambiar el icono: \(error.localizedDescription)") }
        }
    }
}
