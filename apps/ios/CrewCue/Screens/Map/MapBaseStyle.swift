import Foundation

/// The map's base layer. Every style is OpenFreeMap's (free, keyless OpenStreetMap vector tiles),
/// so changing it adds no vendor. Kept per phone, not per race.
enum MapBaseStyle: String, CaseIterable, Identifiable, Sendable {
    /// Streets by day, dark at night: follows the phone's appearance.
    case automatic
    case streets
    case bright
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .automatic: "Automatic"
        case .streets: "Streets"
        case .bright: "Bright"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var systemImage: String {
        switch self {
        case .automatic: "circle.lefthalf.filled"
        case .streets: "map"
        case .bright: "sun.max"
        case .light: "square.dashed"
        case .dark: "moon"
        }
    }

    /// The OpenFreeMap style this base layer loads, in the phone's current appearance.
    func styleName(dark: Bool) -> String {
        switch self {
        case .automatic: dark ? "dark" : "liberty"
        case .streets: "liberty"
        case .bright: "bright"
        case .light: "positron"
        case .dark: "dark"
        }
    }

    /// A style drawn on a dark ground (the blank fallback matches it).
    func isDark(dark: Bool) -> Bool {
        styleName(dark: dark) == "dark"
    }

    private static let key = "crewcue.map.base-style"

    static func saved(_ defaults: UserDefaults = .standard) -> MapBaseStyle {
        defaults.string(forKey: key).flatMap(MapBaseStyle.init(rawValue:)) ?? .automatic
    }

    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.key)
    }
}
