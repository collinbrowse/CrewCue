import SwiftUI

extension CrewFont {
    /// The short gray line under a row title that says what the setting does.
    static let hint = Font.system(.footnote)
    static let rowTitle = Font.system(.subheadline, weight: .semibold)
}

/// A titled card of compact rows with hairlines between them (Settings, Race tools).
struct CrewSettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.base) {
            CrewSectionHeader(title: title)
                .padding(.horizontal, CrewSpace.base)
            VStack(alignment: .leading, spacing: 0) {
                Group(subviews: content) { rows in
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            CrewRowDivider()
                        }
                        row
                    }
                }
            }
            .padding(.horizontal, CrewSpace.gutter)
            .padding(.vertical, 4)
            .background(theme.card, in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
        }
    }
}

/// Hairline between rows in a `CrewSettingsGroup`, inset past the icon.
struct CrewRowDivider: View {
    @Environment(\.crew) private var theme

    var body: some View {
        Divider().overlay(theme.divider.opacity(0.6))
            .padding(.leading, 40)
    }
}

/// One setting: icon, title, a one-line gray hint, and a small control on the trailing edge.
/// `below` holds anything that needs the full width (a text field, a list). At accessibility
/// text sizes the control drops under the text so nothing clips.
struct CrewSettingRow<Trailing: View, Below: View>: View {
    let systemImage: String
    let title: String
    var hint: String?
    var tint: Color?
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var below: Below
    @Environment(\.crew) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(alignment: .top, spacing: CrewSpace.stackSm) {
            Image(systemName: systemImage)
                .font(.system(.body, weight: .medium))
                .foregroundStyle(tint ?? theme.primary)
                .frame(width: 28, height: 28)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: CrewSpace.base) {
                if typeSize.isAccessibilitySize {
                    text
                    trailing
                } else {
                    HStack(alignment: .center, spacing: CrewSpace.stackSm) {
                        text
                        Spacer(minLength: 0)
                        trailing
                    }
                }
                below
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(CrewFont.rowTitle)
                .foregroundStyle(tint ?? theme.ink)
            if let hint, hint.isEmpty == false {
                Text(verbatim: hint)
                    .font(CrewFont.hint)
                    .foregroundStyle(theme.outline)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension CrewSettingRow where Below == EmptyView {
    init(
        systemImage: String,
        title: String,
        hint: String? = nil,
        tint: Color? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.init(systemImage: systemImage, title: title, hint: hint, tint: tint, trailing: trailing, below: { EmptyView() })
    }
}

extension CrewSettingRow where Trailing == EmptyView, Below == EmptyView {
    init(systemImage: String, title: String, hint: String? = nil, tint: Color? = nil) {
        self.init(systemImage: systemImage, title: title, hint: hint, tint: tint, trailing: { EmptyView() }, below: { EmptyView() })
    }
}

/// Small capsule button for a row's trailing edge. `prominent` fills it with the primary color.
struct CrewPillButtonStyle: ButtonStyle {
    var prominent = false
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        CrewPillLabel(prominent: prominent, destructive: destructive, configuration: configuration)
    }
}

private struct CrewPillLabel: View {
    let prominent: Bool
    let destructive: Bool
    let configuration: ButtonStyleConfiguration
    @Environment(\.crew) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.crewBusy) private var isBusy

    var body: some View {
        HStack(spacing: 6) {
            if isBusy {
                ProgressView().controlSize(.mini).tint(foreground)
            }
            configuration.label
        }
        .font(.system(.subheadline, weight: .semibold))
        .lineLimit(1)
        .foregroundStyle(foreground)
        .padding(.horizontal, 14)
        .frame(minHeight: 32)
        .background(prominent ? theme.primary : theme.secondaryButton, in: Capsule())
        .contentShape(Capsule())
        .opacity(isEnabled || isBusy ? 1 : 0.45)
        .scaleEffect(configuration.isPressed ? 0.96 : 1)
        .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }

    private var foreground: Color {
        if destructive { return theme.danger }
        return prominent ? theme.onPrimary : theme.ink
    }
}

extension ButtonStyle where Self == CrewPillButtonStyle {
    static var crewPill: CrewPillButtonStyle { CrewPillButtonStyle() }
    static var crewPillProminent: CrewPillButtonStyle { CrewPillButtonStyle(prominent: true) }
}

/// Small text field for a settings row: subheadline text, 36pt tall.
struct CrewCompactTextFieldStyle: TextFieldStyle {
    @Environment(\.crew) private var theme

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(.system(.subheadline))
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(theme.well.opacity(0.6), in: RoundedRectangle(cornerRadius: CrewRadius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: CrewRadius.sm, style: .continuous)
                    .stroke(theme.divider, lineWidth: 1)
            }
    }
}

extension TextFieldStyle where Self == CrewCompactTextFieldStyle {
    static var crewCompact: CrewCompactTextFieldStyle { CrewCompactTextFieldStyle() }
}
