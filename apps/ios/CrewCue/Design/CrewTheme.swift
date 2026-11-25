import SwiftUI

/// Ember palette: the app icon's slate, cream and orange. Values mirror `ember` in `packages/contracts/src/designSystems.ts`.
struct CrewPalette: Equatable {
    /// Warm page ground.
    var background: Color
    /// Raised card fill (white in light mode).
    var card: Color
    /// Tonal fill for inset wells, incoming chat bubbles, and secondary buttons.
    var well: Color
    var secondaryButton: Color
    var ink: Color
    var body: Color
    var primary: Color
    var onPrimary: Color
    /// Pale primary fill for chips and the remaining-time pill.
    var primarySoft: Color
    var onPrimarySoft: Color
    var secondary: Color
    var onSecondary: Color
    var danger: Color
    var dangerSoft: Color
    var onDangerSoft: Color
    var divider: Color
    var outline: Color
    /// Tint laid over Liquid Glass so it reads as frosted rather than clear.
    var glassTint: Color
    var shadow: Color

    static let light = CrewPalette(
        background: Color(hex: 0xF8F4EA),
        card: Color(hex: 0xFFFFFF),
        well: Color(hex: 0xF0EADD),
        secondaryButton: Color(hex: 0xE9E2D3),
        ink: Color(hex: 0x1F2730),
        body: Color(hex: 0x4A5563),
        primary: Color(hex: 0xB5441A),
        onPrimary: .white,
        primarySoft: Color(hex: 0xFBE3D6),
        onPrimarySoft: Color(hex: 0x8A3110),
        secondary: Color(hex: 0x34404F),
        onSecondary: .white,
        danger: Color(hex: 0xBA1A1A),
        dangerSoft: Color(hex: 0xFDE7E7),
        onDangerSoft: Color(hex: 0x93000A),
        divider: Color(hex: 0xD6D0C3),
        outline: Color(hex: 0x7A7F87),
        glassTint: Color(hex: 0xF8F4EA).opacity(0.22),
        shadow: Color(hex: 0x1F2730).opacity(0.08)
    )

    static let dark = CrewPalette(
        background: Color(hex: 0x161A20),
        card: Color(hex: 0x1F252D),
        well: Color(hex: 0x283039),
        secondaryButton: Color(hex: 0x323B45),
        ink: Color(hex: 0xECE6DA),
        body: Color(hex: 0xC3C7CD),
        primary: Color(hex: 0xFF8F5C),
        onPrimary: Color(hex: 0x3A1404),
        primarySoft: Color(hex: 0x5A2510),
        onPrimarySoft: Color(hex: 0xFFDBCB),
        secondary: Color(hex: 0xB7C4D4),
        onSecondary: Color(hex: 0x1F2730),
        danger: Color(hex: 0xFFB4AB),
        dangerSoft: Color(hex: 0x3B1A17),
        onDangerSoft: Color(hex: 0xFFDAD6),
        divider: Color(hex: 0x3A434E),
        outline: Color(hex: 0x8A929C),
        glassTint: Color(hex: 0x161A20).opacity(0.25),
        shadow: Color.black.opacity(0.35)
    )
}

extension CrewPalette {
    /// Slate ground behind the course-profile hero, as on the app icon. Same in light and dark.
    static let heroGradient = [Color(hex: 0x3A4658), Color(hex: 0x2A3340), Color(hex: 0x1E252F)]
    /// Role label on the hero.
    static let heroAccent = Color(hex: 0xFF9A66)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Corner radii from DESIGN.md `rounded`.
enum CrewRadius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let card: CGFloat = 32
    static let sheet: CGFloat = 40
}

/// Spacing from DESIGN.md `spacing`.
enum CrewSpace {
    static let base: CGFloat = 8
    static let stackSm: CGFloat = 12
    static let gutter: CGFloat = 16
    static let margin: CGFloat = 24
    static let stackLg: CGFloat = 32
}

/// Type scale on SF Pro. Text styles keep Dynamic Type working.
enum CrewFont {
    static let display = Font.system(.largeTitle, weight: .heavy)
    static let headline = Font.system(.title2, weight: .bold)
    static let title = Font.system(.title3, weight: .bold)
    static let bodyLarge = Font.system(.body)
    static let body = Font.system(.callout)
    static let label = Font.system(.footnote, weight: .semibold)
    static let kicker = Font.system(.caption, weight: .bold)
    static let button = Font.system(.body, weight: .semibold)
    static let metric = Font.system(.title2, weight: .heavy).monospacedDigit()
    static let metricLarge = Font.system(.title, weight: .heavy).monospacedDigit()
    static let wordmark = Font.system(.title2, weight: .heavy)
}

private struct CrewKey: EnvironmentKey {
    static let defaultValue = CrewPalette.light
}

extension EnvironmentValues {
    var crew: CrewPalette {
        get { self[CrewKey.self] }
        set { self[CrewKey.self] = newValue }
    }
}

struct CrewThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = scheme == .dark ? CrewPalette.dark : CrewPalette.light
        content
            .environment(\.crew, palette)
            .tint(palette.primary)
            .foregroundStyle(palette.ink)
            .background(palette.background)
    }
}

extension View {
    func crewTheme() -> some View {
        modifier(CrewThemeModifier())
    }

    func crewCard(padding: CGFloat = CrewSpace.margin) -> some View {
        modifier(CrewCardModifier(padding: padding, glass: false))
    }

    /// Card that lets the page background show through as frosted glass.
    func crewGlassCard(padding: CGFloat = CrewSpace.margin) -> some View {
        modifier(CrewCardModifier(padding: padding, glass: true))
    }

    /// Toned-down Liquid Glass: tinted toward the page color, with a hairline edge.
    func crewGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        modifier(CrewGlassModifier(shape: shape, interactive: interactive))
    }

    /// Caps label with the wide tracking the mockups use for section kickers.
    func crewKicker() -> some View {
        modifier(CrewKickerModifier())
    }
}

struct CrewGlassModifier<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool
    @Environment(\.crew) private var theme

    func body(content: Content) -> some View {
        content
            .glassEffect(interactive ? .regular.tint(theme.glassTint).interactive() : .regular.tint(theme.glassTint), in: shape)
            .overlay {
                shape.stroke(Color.white.opacity(0.35), lineWidth: 0.5)
            }
    }
}

struct CrewCardModifier: ViewModifier {
    let padding: CGFloat
    let glass: Bool
    @Environment(\.crew) private var theme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous)
        let padded = content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
        if glass {
            padded
                .crewGlass(in: shape)
                .shadow(color: theme.shadow, radius: 16, y: 6)
        } else {
            padded
                .background(theme.card, in: shape)
                .overlay { shape.stroke(theme.divider.opacity(0.7), lineWidth: 1) }
                .shadow(color: theme.shadow, radius: 12, y: 4)
        }
    }
}

struct CrewKickerModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(CrewFont.kicker)
            .tracking(1.8)
            .textCase(.uppercase)
    }
}

struct ProductTitle: View {
    let title: String
    var subtitle: String = ""
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(CrewFont.display)
                .foregroundStyle(theme.ink)
            if subtitle.isEmpty == false {
                Text(subtitle)
                    .font(CrewFont.bodyLarge)
                    .foregroundStyle(theme.body)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum CrewButtonKind {
    case primary
    case secondary
    case danger
    case ghost
}

/// Capsule buttons from DESIGN.md: primary ember, tonal secondary, danger, and outline ghost.
struct CrewButtonStyle: ButtonStyle {
    var kind: CrewButtonKind = .primary

    func makeBody(configuration: Configuration) -> some View {
        CrewButtonLabel(kind: kind, configuration: configuration)
    }
}

private struct CrewButtonLabel: View {
    let kind: CrewButtonKind
    let configuration: ButtonStyleConfiguration
    @Environment(\.crew) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.crewBusy) private var isBusy
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: CrewSpace.base) {
            if isBusy {
                CairnShakeLoader(onLight: onLightFill)
                    .frame(width: 20, height: 20)
            }
            configuration.label
        }
            .font(CrewFont.button)
            // At accessibility sizes a long label wraps instead of being cut off.
            .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.8)
            .foregroundStyle(foreground)
            .padding(.horizontal, 20)
            .padding(.vertical, typeSize.isAccessibilitySize ? 10 : 0)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(fill, in: Capsule())
            .overlay {
                if kind == .ghost {
                    Capsule().stroke(theme.ink, lineWidth: 2)
                }
            }
            // The whole capsule takes the tap, edge to edge and top to bottom: without this a
            // ghost button's clear fill, and the padding around a short label, missed touches.
            .contentShape(Capsule())
            .opacity(isEnabled || isBusy ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }

    /// Slate stones on a light fill, cream on a dark one. Filled kinds are dark in light mode and light in dark mode.
    private var onLightFill: Bool {
        switch kind {
        case .primary, .danger: scheme == .dark
        case .secondary, .ghost: scheme == .light
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary: theme.onPrimary
        case .secondary, .ghost: theme.ink
        case .danger: theme.dangerSoft
        }
    }

    private var fill: Color {
        switch kind {
        case .primary: theme.primary
        case .secondary: theme.secondaryButton
        case .danger: theme.danger
        case .ghost: .clear
        }
    }
}

extension EnvironmentValues {
    /// A crew button below is working: it shows the shake loader before its label.
    @Entry var crewBusy = false
}

extension View {
    /// Disables the button and shows the shake loader in it, without dimming it, while `isBusy`.
    func crewBusy(_ isBusy: Bool) -> some View {
        environment(\.crewBusy, isBusy)
            .disabled(isBusy)
    }
}

extension ButtonStyle where Self == CrewButtonStyle {
    static var crewPrimary: CrewButtonStyle { CrewButtonStyle(kind: .primary) }
    static var crewSecondary: CrewButtonStyle { CrewButtonStyle(kind: .secondary) }
    static var crewDanger: CrewButtonStyle { CrewButtonStyle(kind: .danger) }
    static var crewGhost: CrewButtonStyle { CrewButtonStyle(kind: .ghost) }
}
