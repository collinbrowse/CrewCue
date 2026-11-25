import SwiftUI
import CrewCueClientCore

/// Each control a tour card can point at publishes its real frame under its accessibility id
/// (`crewcue.tab.*`). The overlay reads the frames where it draws, so the highlight follows the
/// control wherever the layout puts it (a bar moved to the side, a fold, Split View).
struct CoachMarkAnchorKey: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]

    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// Publishes this view's frame as the coach-mark anchor `id`.
    func coachMarkAnchor(_ id: String) -> some View {
        anchorPreference(key: CoachMarkAnchorKey.self, value: .bounds) { [id: $0] }
    }

    /// Lays `overlay` over this view with the anchors its subviews publish, resolved to frames in
    /// this view's space.
    func coachMarks<Overlay: View>(@ViewBuilder _ overlay: @escaping ([String: CGRect]) -> Overlay) -> some View {
        overlayPreferenceValue(CoachMarkAnchorKey.self) { anchors in
            GeometryReader { proxy in
                overlay(anchors.mapValues { proxy[$0] })
            }
        }
    }
}

/// The tour's coach mark: the screen dims except a ring around the control the card points at,
/// and the card sits beside it. Presentation only: the card's content and buttons come in
/// `card`, the step and its outcome from client-core (`OnboardingTour`).
struct CoachMarkOverlay<Card: View>: View {
    /// The highlighted control's frame in this overlay's space, nil for a card on its own.
    var anchor: CGRect?
    /// The overlay root's id: `crewcue.onboarding-runner-tour` or `crewcue.onboarding-crew`.
    var identifier: String
    @ViewBuilder var card: (CGSize) -> Card
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            let bounds = proxy.frame(in: .local).inset(by: margins(proxy.safeAreaInsets))
            let ring = anchor?.insetBy(dx: -6, dy: -6)
            let side = CoachMarkLayout.side(anchor: ring, in: bounds)
            let limits = CoachMarkLayout.limits(side: side, anchor: ring, in: bounds)
            let region = CoachMarkLayout.region(side: side, anchor: ring, in: bounds)
            ZStack {
                // Drawn past the edges, so it also covers the safe areas, in the anchors' own space.
                Dim(hole: ring)
                    .accessibilityHidden(true)
                if let ring {
                    RoundedRectangle(cornerRadius: min(ring.height, ring.width) / 2, style: .continuous)
                        .strokeBorder(Color.white, lineWidth: 3)
                        .frame(width: ring.width, height: ring.height)
                        .position(x: ring.midX, y: ring.midY)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                card(limits)
                    // The fixed frame offers the region; the card takes the height it needs (it
                    // scrolls when the region is shorter) and sits against the control.
                    .frame(width: region.rect.width, height: region.rect.height, alignment: region.alignment)
                    .position(x: region.rect.midX, y: region.rect.midY)
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: anchor)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .accessibilityAddTraits(.isModal)
    }

    private func margins(_: EdgeInsets) -> UIEdgeInsets {
        UIEdgeInsets(top: CrewSpace.base, left: CrewSpace.gutter, bottom: CrewSpace.base, right: CrewSpace.gutter)
    }

    /// The dim layer, with a hole over the highlighted control. It takes every tap: the tour is
    /// answered from its card.
    private struct Dim: View {
        var hole: CGRect?

        var body: some View {
            GeometryReader { proxy in
                let frame = proxy.frame(in: .local)
                Path { path in
                    path.addRect(frame.insetBy(dx: -400, dy: -400))
                    if let hole {
                        path.addRoundedRect(in: hole, cornerSize: CGSize(width: hole.height / 2, height: hole.height / 2), style: .continuous)
                    }
                }
                .fill(Color.black.opacity(0.45), style: FillStyle(eoFill: true))
                .contentShape(Rectangle().inset(by: -400))
            }
        }
    }
}
