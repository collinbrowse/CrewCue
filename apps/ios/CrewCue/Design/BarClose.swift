import SwiftUI
import CrewCueClientCore

extension View {
    /// Close for a page opened over the flow (Race Pass, Join your crew, Full Crew): an X as the
    /// navigation bar's trailing item, and VoiceOver's escape (the two-finger Z). It returns to
    /// wherever the page was opened from, so the page is never a dead end. The system places the
    /// bar, on iPhone Duo too. `action` nil draws nothing; `enabled` false dims the X.
    func barClose(identifier: String, enabled: Bool = true, action: (() -> Void)?) -> some View {
        modifier(BarClose(identifier: identifier, enabled: enabled, action: action))
    }
}

private struct BarClose: ViewModifier {
    let identifier: String
    let enabled: Bool
    let action: (() -> Void)?

    func body(content: Content) -> some View {
        if let action {
            content
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: action) {
                            Label(OnboardingCopy.close, systemImage: "xmark")
                                .labelStyle(.iconOnly)
                                .fontWeight(.semibold)
                                // The whole 44 pt square takes the tap, not only the glyph.
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .disabled(!enabled)
                        .accessibilityLabel(OnboardingCopy.close)
                        .accessibilityIdentifier(identifier)
                    }
                }
                .accessibilityAction(.escape) {
                    if enabled { action() }
                }
        } else {
            content
        }
    }
}
