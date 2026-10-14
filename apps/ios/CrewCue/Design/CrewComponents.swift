import SwiftUI

/// Warm page ground with faint color washes so glass cards have something to frost.
struct CrewBackground: View {
    @Environment(\.crew) private var theme

    var body: some View {
        ZStack {
            theme.background
            RadialGradient(
                colors: [theme.primary.opacity(0.14), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 420
            )
            RadialGradient(
                colors: [theme.secondary.opacity(0.08), .clear],
                center: .bottomLeading,
                startRadius: 20,
                endRadius: 380
            )
        }
        .ignoresSafeArea()
    }
}

/// Top bar: avatar, CrewCue wordmark, and a settings button.
struct CrewTopBar: View {
    var onSettings: (() -> Void)?
    @Environment(\.crew) private var theme

    var body: some View {
        HStack(spacing: CrewSpace.stackSm) {
            Image("OnboardingRunner")
                .resizable()
                .scaledToFill()
                .frame(width: 40, height: 40)
                .background(theme.ink)
                .clipShape(Circle())
                .overlay { Circle().stroke(theme.primary, lineWidth: 2) }
                .accessibilityHidden(true)
            Text("CrewCue")
                .font(CrewFont.wordmark)
                .foregroundStyle(theme.primary)
            Spacer()
            if let onSettings {
                Button(action: onSettings) {
                    Image(systemName: "gearshape")
                        .font(.system(.title3, weight: .semibold))
                        .foregroundStyle(theme.primary)
                        .frame(width: 44, height: 44)
                }
                .crewGlass(in: Circle(), interactive: true)
                .accessibilityLabel("Settings")
            }
        }
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.vertical, CrewSpace.base)
    }
}

/// Capsule status chip, e.g. ON TRACK or LAST PING.
struct StatusChip: View {
    enum Style {
        case filled
        case soft
        case glass
        case secondary
    }

    let text: String
    var style: Style = .soft
    var dot = false
    @Environment(\.crew) private var theme

    var body: some View {
        HStack(spacing: 6) {
            if dot {
                Circle()
                    .fill(style == .filled ? theme.onPrimary : theme.primary)
                    .frame(width: 7, height: 7)
            }
            Text(verbatim: text)
                .font(CrewFont.kicker)
                .tracking(1.4)
                .lineLimit(1)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background {
            switch style {
            case .filled: Capsule().fill(theme.primary)
            case .soft: Capsule().fill(theme.primarySoft)
            case .secondary: Capsule().fill(theme.secondary)
            case .glass: Color.clear
            }
        }
        .modifier(GlassIf(enabled: style == .glass, shape: Capsule()))
    }

    private var foreground: Color {
        switch style {
        case .filled: theme.onPrimary
        case .soft: theme.onPrimarySoft
        case .secondary: theme.onSecondary
        case .glass: theme.primary
        }
    }
}

private struct GlassIf<S: Shape>: ViewModifier {
    let enabled: Bool
    let shape: S

    func body(content: Content) -> some View {
        if enabled {
            content.crewGlass(in: shape)
        } else {
            content
        }
    }
}

/// Caps caption over a large value, used in metric rows and stat cards.
struct MetricColumn: View {
    let label: String
    let value: String
    var caption: String?
    var alignment: HorizontalAlignment = .center
    var valueColor: Color?
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: alignment, spacing: 6) {
            Text(verbatim: label)
                .font(CrewFont.label)
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(theme.body)
                .multilineTextAlignment(textAlignment)
            Text(verbatim: value)
                .font(CrewFont.metric)
                .foregroundStyle(valueColor ?? theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let caption {
                Text(verbatim: caption)
                    .font(CrewFont.kicker)
                    .tracking(0.8)
                    .foregroundStyle(theme.body)
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
        .accessibilityElement(children: .combine)
    }

    private var textAlignment: TextAlignment {
        switch alignment {
        case .leading: .leading
        case .trailing: .trailing
        default: .center
        }
    }
}

struct CrewProgressBar: View {
    let fraction: Double
    var height: CGFloat = 10
    @Environment(\.crew) private var theme

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(theme.secondaryButton)
                Capsule()
                    .fill(theme.primary)
                    .frame(width: max(height, proxy.size.width * min(1, max(0, fraction))))
                    .opacity(fraction > 0 ? 1 : 0)
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel("Progress")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
    }
}

/// Round glass button for map controls and other floating actions.
struct CircleIconButton: View {
    let systemImage: String
    let label: String
    var size: CGFloat = 52
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(theme.primary)
                .frame(width: size, height: size)
        }
        .crewGlass(in: Circle(), interactive: true)
        .accessibilityLabel(label)
    }
}

/// Round icon in a soft primary disc, used beside list rows.
struct IconDisc: View {
    let systemImage: String
    var tint: Color?
    @Environment(\.crew) private var theme

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(.body, weight: .semibold))
            .foregroundStyle(tint ?? theme.primary)
            .frame(width: 40, height: 40)
            .background(theme.primarySoft.opacity(0.7), in: Circle())
            .accessibilityHidden(true)
    }
}

/// Tappable row with icon, title, optional detail, and chevron.
struct CrewListRow: View {
    let systemImage: String
    let title: String
    var detail: String?
    var tint: Color?
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: CrewSpace.stackSm) {
                IconDisc(systemImage: systemImage, tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(CrewFont.button)
                        .foregroundStyle(tint ?? theme.ink)
                    if let detail, detail.isEmpty == false {
                        Text(verbatim: detail)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.body)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(.footnote, weight: .bold))
                    .foregroundStyle(theme.outline)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Section heading in caps with wide tracking.
struct CrewSectionHeader: View {
    let title: String
    @Environment(\.crew) private var theme

    var body: some View {
        Text(title)
            .crewKicker()
            .foregroundStyle(theme.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Sheet chrome for secondary tools: title, close button, scrolling content on the page ground.
struct ToolSheet<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crew) private var theme

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                    content
                }
                .padding(.horizontal, CrewSpace.gutter)
                .padding(.bottom, CrewSpace.stackLg)
            }
            .scrollContentBackground(.hidden)
            .background(CrewBackground())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .crewTheme()
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(CrewRadius.sheet)
    }
}

/// Text field with the DESIGN.md input treatment: card fill and a hairline edge.
struct CrewTextFieldStyle: TextFieldStyle {
    @Environment(\.crew) private var theme

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(CrewFont.bodyLarge)
            .padding(.horizontal, 18)
            .frame(minHeight: 52)
            .background(theme.card, in: RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous)
                    .stroke(theme.divider, lineWidth: 1)
            }
    }
}

extension TextFieldStyle where Self == CrewTextFieldStyle {
    static var crew: CrewTextFieldStyle { CrewTextFieldStyle() }
}

/// Local wall-clock rendering for API instants.
enum CrewClock {
    static func short(_ iso: String?) -> String? {
        guard let iso, let date = parse(iso) else { return nil }
        return date.formatted(date: .omitted, time: .shortened)
    }

    static func parse(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }
}
