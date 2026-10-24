import Foundation

/// Color RGBA (0…1) leído de mobile/shared/themes.json (`#RRGGBB` o `#RRGGBBAA`, orden CSS).
public struct RGBA: Equatable {
    public let red: Double, green: Double, blue: Double, alpha: Double

    public init?(hex: String) {
        guard hex.hasPrefix("#"), hex.count == 7 || hex.count == 9, let value = UInt64(hex.dropFirst(), radix: 16) else { return nil }
        if hex.count == 7 {
            red = Double((value >> 16) & 0xFF) / 255
            green = Double((value >> 8) & 0xFF) / 255
            blue = Double(value & 0xFF) / 255
            alpha = 1
        } else {
            red = Double((value >> 24) & 0xFF) / 255
            green = Double((value >> 16) & 0xFF) / 255
            blue = Double((value >> 8) & 0xFF) / 255
            alpha = Double(value & 0xFF) / 255
        }
    }

    /// Luminancia relativa (WCAG), para elegir texto claro u oscuro.
    public var luminance: Double {
        func channel(_ value: Double) -> Double { value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }
}

/// Colores de un estilo en un modo (los mismos tokens que el CSS de escritorio).
public struct Palette: Equatable {
    public let colors: [String: RGBA]

    public subscript(_ token: String) -> RGBA { colors[token] ?? RGBA(hex: "#FF00FF")! }

    public func withAccent(_ accent: RGBA) -> Palette {
        var copy = colors
        copy["accent"] = accent
        return Palette(colors: copy)
    }
}

public struct ThemeInfo: Equatable {
    public let id: ThemeId
    public let name: String
    public let description: String
    public let light: Palette
    public let dark: Palette
}

public struct Themes {
    public let themes: [ThemeId: ThemeInfo]
    /// id → (claro, oscuro).
    public let accents: [(id: String, light: RGBA, dark: RGBA)]

    public init(json: Data) throws {
        guard let root = try JSONSerialization.jsonObject(with: json) as? [String: Any],
              let rawThemes = root["themes"] as? [String: [String: Any]],
              let rawAccents = root["accents"] as? [String: [String: String]] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        func palette(_ value: Any?) -> Palette {
            let tokens = value as? [String: String] ?? [:]
            return Palette(colors: tokens.compactMapValues { RGBA(hex: $0) })
        }
        var themes: [ThemeId: ThemeInfo] = [:]
        for id in ThemeId.allCases {
            guard let theme = rawThemes[id.rawValue] else { throw CocoaError(.fileReadCorruptFile) }
            themes[id] = ThemeInfo(id: id, name: theme["name"] as? String ?? id.rawValue, description: theme["description"] as? String ?? "",
                                   light: palette(theme["light"]), dark: palette(theme["dark"]))
        }
        self.themes = themes
        accents = rawAccents.keys.sorted().compactMap { key in
            guard let light = rawAccents[key]?["light"].flatMap(RGBA.init(hex:)), let dark = rawAccents[key]?["dark"].flatMap(RGBA.init(hex:)) else { return nil }
            return (key, light, dark)
        }
    }

    public func palette(_ theme: ThemeId, dark: Bool, accent: String = "default") -> Palette {
        let info = themes[theme]!
        let base = dark ? info.dark : info.light
        guard let custom = accents.first(where: { $0.id == accent }) else { return base }
        return base.withAccent(dark ? custom.dark : custom.light)
    }
}
