import SwiftUI
import UIKit
import CrewCueClientCore

extension View {
    /// Back for a screen that is the root of the app's `NavigationStack` but sits under another
    /// one in the flow (the stack has nothing to pop, so the system draws no back button): the
    /// navigation bar's leading chevron and "Back", the swipe from the leading edge, and
    /// VoiceOver's escape (the two-finger Z), as a pushed screen has. The system places the bar,
    /// on iPhone Duo too. `action` nil draws nothing; `enabled` false dims the item and ignores
    /// the swipe and escape.
    func barBack(identifier: String, enabled: Bool = true, action: (() -> Void)?) -> some View {
        modifier(BarBack(identifier: identifier, enabled: enabled, action: action))
    }
}

private struct BarBack: ViewModifier {
    let identifier: String
    let enabled: Bool
    let action: (() -> Void)?
    @Environment(\.layoutDirection) private var layoutDirection

    func body(content: Content) -> some View {
        if let action {
            content
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: action) {
                            // The chevron and the word "Back", like a pushed screen's back button.
                            // Not `Label(...).labelStyle(.titleAndIcon)`: the bar draws a Label
                            // item as its icon alone.
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left")
                                    .fontWeight(.semibold)
                                Text(OnboardingCopy.back)
                            }
                            // Tinted like the bar's other items (an image-only item takes the tint).
                            .foregroundStyle(enabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        }
                        .disabled(!enabled)
                        .accessibilityLabel(OnboardingCopy.back)
                        .accessibilityIdentifier(identifier)
                    }
                }
                .gesture(LeadingEdgeSwipe(enabled: enabled, rightToLeft: layoutDirection == .rightToLeft, onSwipe: action))
                .accessibilityAction(.escape) {
                    if enabled { action() }
                }
        } else {
            content
        }
    }
}

/// The swipe from the leading edge (the right edge in a right-to-left layout), read as a
/// pushed screen's swipe back would be. A screen-edge recognizer only starts at the display's
/// edge, so it leaves scrolling and the screen's controls alone.
private struct LeadingEdgeSwipe: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var rightToLeft: Bool
    var onSwipe: () -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let recognizer = UIScreenEdgePanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        recognizer.edges = rightToLeft ? .right : .left
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        guard recognizer.state == .ended, enabled, let view = recognizer.view else { return }
        let direction: CGFloat = recognizer.edges == .right ? -1 : 1
        let travelled = recognizer.translation(in: view).x * direction
        let speed = recognizer.velocity(in: view).x * direction
        // Past a third of the width, or flicked: the same feel as the system's swipe back.
        if travelled > view.bounds.width / 3 || (travelled > 24 && speed > 500) {
            onSwipe()
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        // Anything that scrolls keeps scrolling while the edge swipe is read.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
