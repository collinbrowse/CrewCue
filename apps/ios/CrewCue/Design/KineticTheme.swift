import SwiftUI

struct KineticPalette: Equatable {
    var background: Color
    var card: Color
    var secondaryButton: Color
    var ink: Color
    var body: Color
    var primary: Color
    var onPrimary: Color
    var lime: Color
    var onLime: Color
    var danger: Color
    var divider: Color
    var outline: Color

    static let light = KineticPalette(
        background: Color(red: 0.988, green: 0.976, blue: 0.973),
        card: Color(red: 0.941, green: 0.929, blue: 0.925),
        secondaryButton: Color(red: 0.922, green: 0.906, blue: 0.906),
        ink: Color(red: 0.110, green: 0.106, blue: 0.106),
        body: Color(red: 0.267, green: 0.286, blue: 0.200),
        primary: Color(red: 0.314, green: 0.400, blue: 0),
        onPrimary: .white,
        lime: Color(red: 0.800, green: 1, blue: 0),
        onLime: Color(red: 0.357, green: 0.451, blue: 0),
        danger: Color(red: 0.729, green: 0.102, blue: 0.102),
        divider: Color(red: 0.769, green: 0.788, blue: 0.675),
        outline: Color(red: 0.455, green: 0.478, blue: 0.376)
    )

    static let dark = KineticPalette(
        background: Color(red: 0.075, green: 0.075, blue: 0.075),
        card: Color(red: 0.125, green: 0.122, blue: 0.122),
        secondaryButton: Color(red: 0.165, green: 0.165, blue: 0.165),
        ink: Color(red: 0.898, green: 0.886, blue: 0.882),
        body: Color(red: 0.769, green: 0.788, blue: 0.675),
        primary: Color(red: 0.765, green: 0.957, blue: 0),
        onPrimary: Color(red: 0.157, green: 0.208, blue: 0),
        lime: Color(red: 0.765, green: 0.957, blue: 0),
        onLime: Color(red: 0.333, green: 0.427, blue: 0),
        danger: Color(red: 1, green: 0.706, blue: 0.671),
        divider: Color(red: 0.267, green: 0.286, blue: 0.200),
        outline: Color(red: 0.557, green: 0.576, blue: 0.475)
    )
}

private struct KineticKey: EnvironmentKey {
    static let defaultValue = KineticPalette.light
}

extension EnvironmentValues {
    var kinetic: KineticPalette {
        get { self[KineticKey.self] }
        set { self[KineticKey.self] = newValue }
    }
}

struct KineticThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = scheme == .dark ? KineticPalette.dark : KineticPalette.light
        content
            .environment(\.kinetic, palette)
            .tint(palette.primary)
            .foregroundStyle(palette.ink)
            .background(palette.background)
    }
}

extension View {
    func kineticTheme() -> some View {
        modifier(KineticThemeModifier())
    }

    func kineticCard() -> some View {
        modifier(KineticCardModifier())
    }
}

struct ProductTitle: View {
    let title: String
    var subtitle: String = ""
    @Environment(\.kinetic) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 28, weight: .heavy))
                .foregroundStyle(theme.ink)
            if subtitle.isEmpty == false {
                Text(subtitle)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(theme.body)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct KineticCardModifier: ViewModifier {
    @Environment(\.kinetic) private var theme

    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(theme.divider, lineWidth: 1)
            }
    }
}

struct KineticProductButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        KineticProductButtonLabel(configuration: configuration)
    }
}

private struct KineticProductButtonLabel: View {
    @Environment(\.kinetic) private var theme
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(theme.primary, in: RoundedRectangle(cornerRadius: 6))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct KineticSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        KineticSecondaryButtonLabel(configuration: configuration)
    }
}

private struct KineticSecondaryButtonLabel: View {
    @Environment(\.kinetic) private var theme
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(theme.secondaryButton, in: RoundedRectangle(cornerRadius: 6))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct KineticDangerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        KineticDangerButtonLabel(configuration: configuration)
    }
}

private struct KineticDangerButtonLabel: View {
    @Environment(\.kinetic) private var theme
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.background)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(theme.danger, in: RoundedRectangle(cornerRadius: 6))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct KineticAuthButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        KineticAuthButtonLabel(configuration: configuration)
    }
}

private struct KineticAuthButtonLabel: View {
    @Environment(\.kinetic) private var theme
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(theme.onLime)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(theme.lime, in: Capsule())
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct KineticAuthOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        KineticAuthOutlineButtonLabel(configuration: configuration)
    }
}

private struct KineticAuthOutlineButtonLabel: View {
    @Environment(\.kinetic) private var theme
    let configuration: ButtonStyleConfiguration

    var body: some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(theme.background, in: Capsule())
            .overlay {
                Capsule().stroke(Color(red: 0.392, green: 0.455, blue: 0.545), lineWidth: 2)
            }
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}
