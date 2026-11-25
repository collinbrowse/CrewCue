import SwiftUI
import CrewCueClientCore

/// `crewcue://dev/onboarding-runner-tour` and `crewcue://dev/onboarding-crew`: the tab-bar tour on
/// the example race, with no account and no API. The real tab bar and coach marks; every button
/// moves on and nothing is saved or sent, except that Turn on notifications shows the system
/// prompt. `?state=` shows the screen's checklist copy instead (`featureScreen`).
struct TourDevRoute: View {
    var tour: OnboardingTourModel
    var role: OnboardingChoice
    var state: FeatureState
    var onFinish: () -> Void

    private var steps: [OnboardingStep] { role == .runner ? OnboardingStep.runnerTour : OnboardingStep.crewTour }
    private var step: OnboardingStep? { tour.fixtureStep ?? steps.first }
    private var featureId: String { role == .runner ? "onboarding-runner-tour" : "onboarding-crew" }

    var body: some View {
        ZStack(alignment: .bottom) {
            FeatureScreenView(screen: CrewCueClientCore.featureScreen(id: tabFeature, state: .success))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(CrewBackground())
                .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: CrewTabBar.reservedHeight) }
            CrewTabBar(
                selection: Binding(get: { tour.fixtureTab }, set: { tour.fixtureTab = $0 }),
                chatBadge: 0
            )
            .fullWidthClearOfOcclusions()
        }
        .coachMarks { frames in
            if state == .success, let step, let card = OnboardingTour.card(step: step, role: role) {
                CoachMarkOverlay(
                    anchor: card.anchor.flatMap { frames[$0.accessibilityIdentifier] },
                    identifier: "crewcue.\(featureId)"
                ) { _ in
                    TourCardView(
                        card: card,
                        tour: tour,
                        inviteShareText: InviteLink.shareText(raceName: DemoRaceFixture.raceName, code: "123456"),
                        actions: TourCardActions(
                            primary: { primary(card) },
                            secondary: { advance(from: card.step) },
                            skipTour: { finish() },
                            shared: { tour.inviteShared = true }
                        )
                    )
                }
                .task(id: card.step) {
                    if let anchor = card.anchor, let tab = ShellTab(rawValue: anchor.rawValue) { tour.fixtureTab = tab }
                }
            }
        }
        .overlay {
            if state != .success {
                FeatureScreenView(screen: CrewCueClientCore.featureScreen(id: featureId, state: state))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(CrewBackground())
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(state == .success ? "crewcue.\(featureId).shell" : "crewcue.\(featureId).fixture")
    }

    private var tabFeature: String { tour.fixtureTab.featureId }

    private func primary(_ card: TourCard) {
        switch card.action {
        case .enableNotifications:
            Task {
                _ = await tour.requestNotificationPermissionOnly()
                advance(from: card.step)
            }
        case .testTracking:
            if tour.locationTest.phase == .sent {
                tour.resetLocationTest()
                advance(from: card.step)
            } else {
                tour.fixtureLocationTest()
            }
        default:
            advance(from: card.step)
        }
    }

    private func advance(from current: OnboardingStep) {
        tour.inviteShared = false
        tour.resetLocationTest()
        guard let index = steps.firstIndex(of: current), index + 1 < steps.count else {
            finish()
            return
        }
        tour.fixtureStep = steps[index + 1]
    }

    private func finish() {
        tour.clear()
        onFinish()
    }
}
