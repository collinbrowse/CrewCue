import SwiftUI
import CrewCueClientCore

/// What a tour card's buttons do. The shell (or the dev route) fills it in.
struct TourCardActions {
    var primary: () -> Void
    var secondary: () -> Void
    var skipTour: () -> Void
    /// The invites card's Share invite was tapped (the share sheet opens over the card).
    var shared: () -> Void = {}
}

/// One tour card: its step count, title, text, the example race (crew), the location test's line,
/// and its buttons. Labels and outcomes are client-core's `TourCard` and `LocationTest`.
struct TourCardView: View {
    var card: TourCard
    var tour: OnboardingTourModel
    /// The invites card: the race's share text once it loads.
    var inviteShareText: String?
    var actions: TourCardActions
    @Environment(\.crew) private var theme

    var body: some View {
        ViewThatFits(in: .vertical) {
            content
            ScrollView { content }
                .scrollBounceBehavior(.basedOnSize)
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
        .shadow(color: theme.shadow, radius: 18, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(card.accessibilityIdentifier)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            HStack {
                Text(card.progressLabel)
                    .crewKicker()
                    .accessibilityLabel("Step \(card.position) of \(card.count)")
                Spacer(minLength: 0)
                if card.position < card.count {
                    Button(OnboardingTourCopy.skipTour, action: actions.skipTour)
                        .font(CrewFont.label)
                        .foregroundStyle(theme.primary)
                        .accessibilityIdentifier("crewcue.onboarding.tour.skip")
                }
            }
            Text(card.title)
                .font(CrewFont.title)
                .foregroundStyle(theme.ink)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            Text(card.body)
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
            if !card.example.isEmpty {
                example
            }
            if card.action == .testTracking, let message = tour.locationTest.message {
                Text(message)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.tour.location-status")
            }
            buttons
        }
        .padding(CrewSpace.gutter)
    }

    private var example: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(OnboardingTourCopy.exampleHeading)
                .crewKicker()
            ForEach(card.example, id: \.label) { line in
                HStack(alignment: .firstTextBaseline) {
                    Text(line.label)
                        .font(CrewFont.label)
                        .foregroundStyle(theme.body)
                    Spacer(minLength: CrewSpace.base)
                    Text(line.value)
                        .font(CrewFont.button)
                        .foregroundStyle(theme.ink)
                        .multilineTextAlignment(.trailing)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(CrewSpace.stackSm)
        .background(theme.well, in: RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.tour.example")
    }

    @ViewBuilder
    private var buttons: some View {
        VStack(spacing: CrewSpace.base) {
            switch card.action {
            case .shareInvite:
                if let inviteShareText {
                    ShareLink(item: inviteShareText, subject: Text(InviteCopy.shareTitle)) {
                        Label(card.primaryLabel, systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.crewPrimary)
                    .simultaneousGesture(TapGesture().onEnded { actions.shared() })
                    .accessibilityIdentifier("crewcue.onboarding.tour.primary")
                } else {
                    Button(OnboardingTourCopy.inviteLoading) {}
                        .buttonStyle(.crewPrimary)
                        .disabled(true)
                        .accessibilityIdentifier("crewcue.onboarding.tour.primary")
                }
                // After sharing, Next saves the step done; before, Later skips it.
                Button(tour.inviteShared ? OnboardingTourCopy.next : (card.secondaryLabel ?? OnboardingTourCopy.later)) {
                    tour.inviteShared ? actions.primary() : actions.secondary()
                }
                .buttonStyle(.crewSecondary)
                .accessibilityIdentifier("crewcue.onboarding.tour.secondary")
            case .testTracking:
                if let label = tour.locationTest.primaryLabel {
                    Button(label, action: actions.primary)
                        .buttonStyle(.crewPrimary)
                        .accessibilityIdentifier("crewcue.onboarding.tour.primary")
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityLabel(LocationTestCopy.waiting)
                }
                if tour.locationTest.phase != .sent, let secondary = card.secondaryLabel {
                    Button(secondary, action: actions.secondary)
                        .buttonStyle(.crewSecondary)
                        .accessibilityIdentifier("crewcue.onboarding.tour.secondary")
                }
            case .enableNotifications:
                if tour.notificationsOn {
                    // Already allowed: Next registers this phone with no prompt.
                    Text(OnboardingTourCopy.notificationsOn)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("crewcue.onboarding.tour.notifications-status")
                }
                Button(tour.notificationsOn ? (card.position == card.count ? OnboardingTourCopy.done : OnboardingTourCopy.next) : card.primaryLabel, action: actions.primary)
                    .buttonStyle(.crewPrimary)
                    .crewBusy(tour.notificationsWorking)
                    .disabled(tour.notificationsWorking)
                    .accessibilityIdentifier("crewcue.onboarding.tour.primary")
                if !tour.notificationsOn, let secondary = card.secondaryLabel {
                    Button(secondary, action: actions.secondary)
                        .buttonStyle(.crewSecondary)
                        .disabled(tour.notificationsWorking)
                        .accessibilityIdentifier("crewcue.onboarding.tour.secondary")
                }
            case .showStartLine, .next:
                Button(card.primaryLabel, action: actions.primary)
                    .buttonStyle(.crewPrimary)
                    .accessibilityIdentifier("crewcue.onboarding.tour.primary")
                if let secondary = card.secondaryLabel {
                    Button(secondary, action: actions.secondary)
                        .buttonStyle(.crewSecondary)
                        .accessibilityIdentifier("crewcue.onboarding.tour.secondary")
                }
            }
        }
    }
}
