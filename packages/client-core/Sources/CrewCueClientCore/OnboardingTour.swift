import Foundation

/// The tab a tour card points at, named by the tab's accessibility id (`crewcue.tab.*`). The app
/// finds that control's real frame on screen; nothing here assumes where the tab bar sits.
public enum TourAnchor: String, CaseIterable, Sendable {
    case map, pace, chat, profile

    public var accessibilityIdentifier: String { "crewcue.tab.\(rawValue)" }
}

/// What a tour card's main button does. The app performs it, then saves the step with the outcome
/// the result calls for (`OnboardingTour.notificationsOutcome`, `LocationTest.outcome`).
public enum TourAction: String, Sendable {
    /// Share the race's invite link and code (runner `invites`).
    case shareInvite
    /// Ask for notification permission and register this phone for push.
    case enableNotifications
    /// Run the location test (`LocationTest`): one ping from this phone, then stop.
    case testTracking
    /// Move the map to the start line (runner `mapStartLine`).
    case showStartLine
    /// The card explains; the button goes on.
    case next
}

/// One line of the crew tour's example race: a label and its value ("Last update", "4 min ago").
public struct TourExampleLine: Equatable, Sendable {
    public var label: String
    public var value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// The tour card for the current step: where it points, what it says, and its buttons.
public struct TourCard: Equatable, Sendable {
    public var step: OnboardingStep
    public var role: OnboardingChoice
    /// The tab the highlight rings. Nil: the card stands alone (notifications).
    public var anchor: TourAnchor?
    public var title: String
    public var body: String
    public var action: TourAction
    public var primaryLabel: String
    /// The second button, nil when the card has none, and the outcome it saves.
    public var secondaryLabel: String?
    public var secondaryOutcome: OnboardingOutcome?
    /// Crew tour: lines from the demo race (`CrewTourDemo`), shown under "Example race". Never
    /// the real race's progress, which only the runner's pings drive.
    public var example: [TourExampleLine]
    /// 1-based position in the role's tour, and the tour's length.
    public var position: Int
    public var count: Int

    /// "2 of 5".
    public var progressLabel: String { "\(position) of \(count)" }

    /// The accessibility id of the card's root: `crewcue.onboarding.tour.<step>`.
    public var accessibilityIdentifier: String { "crewcue.onboarding.tour.\(step.rawValue)" }
}

/// A card as the phone shows it now (`OnboardingTour.view`): its buttons and the line under its text.
public struct TourCardView: Equatable, Sendable {
    /// Nil while the location test runs: no main button then.
    public var primaryLabel: String?
    public var primaryAction: TourAction
    public var secondaryLabel: String?
    public var secondaryOutcome: OnboardingOutcome?
    public var status: String?
}

/// The tab-bar tour after setup (runner, once the race is unlocked) or after the join (crew). Which
/// card shows comes from `OnboardingState`; the copy is `OnboardingTourCopy`. Pure.
public enum OnboardingTour {
    /// The card for the state's tour step, nil outside the tour phase.
    public static func card(for state: OnboardingState, demo: CrewTourDemo = .fixture()) -> TourCard? {
        guard state.phase == .tour, let step = state.step, let role = state.role else { return nil }
        let steps = role == .runner ? OnboardingStep.runnerTour : OnboardingStep.crewTour
        guard let index = steps.firstIndex(of: step) else { return nil }
        return card(step: step, role: role, position: index + 1, count: steps.count, demo: demo)
    }

    /// The card for one step of a role's tour (the dev route plays the tour without a race).
    public static func card(step: OnboardingStep, role: OnboardingChoice, demo: CrewTourDemo = .fixture()) -> TourCard? {
        let steps = role == .runner ? OnboardingStep.runnerTour : OnboardingStep.crewTour
        guard let index = steps.firstIndex(of: step) else { return nil }
        return card(step: step, role: role, position: index + 1, count: steps.count, demo: demo)
    }

    private static func card(step: OnboardingStep, role: OnboardingChoice, position: Int, count: Int, demo: CrewTourDemo) -> TourCard {
        let copy = OnboardingTourCopy.self
        func make(
            _ anchor: TourAnchor?,
            _ action: TourAction,
            primary: String = copy.next,
            secondary: String? = nil,
            outcome: OnboardingOutcome? = nil,
            example: [TourExampleLine] = []
        ) -> TourCard {
            TourCard(
                step: step, role: role, anchor: anchor,
                title: copy.title(step, role: role), body: copy.body(step, role: role, demo: demo),
                action: action, primaryLabel: primary,
                secondaryLabel: secondary, secondaryOutcome: secondary == nil ? nil : outcome,
                example: example, position: position, count: count
            )
        }
        let isLast = position == count
        let next = isLast ? copy.done : copy.next
        switch step {
        case .invites:
            return make(.profile, .shareInvite, primary: copy.shareInvite, secondary: copy.later, outcome: .skipped)
        case .notifications:
            return make(nil, .enableNotifications, primary: copy.turnOnNotifications, secondary: copy.notNow, outcome: .skipped)
        case .location:
            return make(.map, .testTracking, primary: copy.testTrackingNow, secondary: copy.onRaceMorning, outcome: .deferred)
        case .mapStartLine:
            return make(.map, .showStartLine, primary: next)
        case .chat:
            return make(.chat, .next, primary: next)
        case .runnerLocation:
            return make(.map, .next, primary: next, example: [
                TourExampleLine(label: copy.exampleRunner, value: "\(demo.runnerName) · \(demo.mileText)")
            ])
        case .lastUpdateAge:
            return make(.map, .next, primary: next, example: [
                TourExampleLine(label: copy.exampleLastUpdate, value: demo.lastUpdateAge)
            ])
        case .etaVsPlan:
            return make(.pace, .next, primary: next, example: [
                TourExampleLine(label: "\(demo.nextAid) \(copy.exampleEta)", value: demo.etaClock),
                TourExampleLine(label: copy.examplePlan, value: demo.planClock)
            ])
        case .directionsToNextAid:
            return make(.map, .next, primary: next, example: [
                TourExampleLine(label: copy.exampleNextAid, value: "\(demo.nextAid) · \(demo.nextAidAheadText)")
            ])
        case .editCheckpointDetails, .checkInWhenNoService:
            return make(.pace, .next, primary: next)
        case .chatAndAlerts:
            return make(.chat, .next, primary: next)
        default:
            return make(nil, .next, primary: next)
        }
    }

    /// Skip tour: every tour step not yet ended, with the outcome each saves. The location test
    /// waits for race morning (it can't be skipped); the rest are skipped.
    public static func skipAll(_ state: OnboardingState) -> [(step: OnboardingStep, outcome: OnboardingOutcome)] {
        guard state.phase == .tour, let role = state.role else { return [] }
        let steps = role == .runner ? OnboardingStep.runnerTour : OnboardingStep.crewTour
        return steps.compactMap { step in
            guard state.status(step)?.isComplete != true else { return nil }
            return (step, step == .location ? .deferred : .skipped)
        }
    }

    /// The card's buttons and status line for what the phone knows now: notifications already
    /// allowed (Next only, "Notifications are on."), the invite shared (the second button reads
    /// Next and saves done), and the location test (its main button and line; On race morning
    /// goes once the ping is sent, and the test that couldn't start for another race's tracking
    /// leaves only On race morning).
    public static func view(
        _ card: TourCard,
        notificationsOn: Bool,
        inviteShared: Bool,
        test: LocationTest?,
        testBlocked: Bool = false
    ) -> TourCardView {
        let copy = OnboardingTourCopy.self
        var view = TourCardView(
            primaryLabel: card.primaryLabel, primaryAction: card.action,
            secondaryLabel: card.secondaryLabel, secondaryOutcome: card.secondaryOutcome, status: nil
        )
        switch card.action {
        case .enableNotifications where notificationsOn:
            // The prompt answers at once when already allowed; Next registers this phone again.
            view.primaryLabel = copy.next
            view.secondaryLabel = nil
            view.secondaryOutcome = nil
            view.status = copy.notificationsOn
        case .shareInvite where inviteShared:
            view.secondaryLabel = copy.next
            view.secondaryOutcome = .done
        case .testTracking:
            if testBlocked {
                view.primaryLabel = nil
                view.status = LocationTestCopy.otherRaceTracking
            } else if let test, test.phase != .idle {
                view.primaryLabel = test.primaryLabel
                view.status = test.message
                if test.phase == .sent {
                    // Done: Next saves it; race morning no longer applies.
                    view.primaryAction = .next
                    view.secondaryLabel = nil
                    view.secondaryOutcome = nil
                }
            }
        default:
            break
        }
        return view
    }

    /// The notifications card after the permission prompt: allowed is done, anything else skipped
    /// (the checklist card offers it again).
    public static func notificationsOutcome(allowed: Bool) -> OnboardingOutcome {
        allowed ? .done : .skipped
    }
}

/// Tour copy shared by iOS and Android. Plain wording, second person, no exclamation marks.
public enum OnboardingTourCopy {
    public static let next = "Next"
    public static let done = "Done"
    public static let later = "Later"
    public static let notNow = "Not now"
    public static let skipTour = "Skip tour"
    public static let shareInvite = "Share invite"
    public static let turnOnNotifications = "Turn on notifications"
    public static let testTrackingNow = "Test tracking now"
    public static let onRaceMorning = "On race morning"
    public static let tryAgain = "Try again"
    public static let exampleHeading = "Example race"
    public static let exampleRunner = "Runner"
    public static let exampleLastUpdate = "Last update"
    public static let exampleEta = "ETA"
    public static let examplePlan = "PLAN"
    public static let exampleNextAid = "Next aid"
    public static let notificationsOn = "Notifications are on."
    public static let notificationsOff = "Notifications are off for CrewCue. You can turn them on later in iOS Settings."
    public static let notificationsOffAndroid = "Notifications are off for CrewCue. You can turn them on later in Android Settings."
    /// Shown on the invites card while the race's invite loads, or when it can't.
    public static let inviteLoading = "Loading your invite…"

    public static func title(_ step: OnboardingStep, role: OnboardingChoice) -> String {
        switch step {
        case .invites: "Invite your crew"
        case .notifications: "Turn on notifications"
        case .location: "Test tracking"
        case .mapStartLine: "Your start line"
        case .chat: "Race chat"
        case .runnerLocation: "Your runner's dot"
        case .lastUpdateAge: "Last update"
        case .etaVsPlan: "ETA and PLAN"
        case .editCheckpointDetails: "Planned stops"
        case .checkInWhenNoService: "Check in without service"
        case .directionsToNextAid: "Directions to the next aid"
        case .chatAndAlerts: "Chat and alerts"
        default: OnboardingCopy.title(for: step) ?? ""
        }
    }

    public static func body(_ step: OnboardingStep, role: OnboardingChoice, demo: CrewTourDemo) -> String {
        switch step {
        case .invites:
            "Send your crew the link. They join your race and follow you on their own phones."
        case .notifications:
            role == .runner
                ? "We'll remind you to start tracking on race morning, and your crew's messages reach you."
                : "Get your crew's messages and race alerts on this phone, even when CrewCue is closed."
        case .location:
            "Your crew follows the pings your phone sends. Test it now: allow location, choose Always, and CrewCue sends one ping and stops."
        case .mapStartLine:
            "This is your start line. On race day the map follows your phone's pings from here."
        case .chat:
            "Your crew's messages land here. Open Chat any time during the race."
        case .runnerLocation:
            "The dot is where \(demo.runnerName)'s phone last sent a ping. Every crew phone sees the same dot."
        case .lastUpdateAge:
            "Trails lose signal. The age says how old the dot is. Saved pings arrive together when the runner is back in service."
        case .etaVsPlan:
            "ETA is when the runner should reach the aid station at their pace so far. PLAN is the time they planned."
        case .editCheckpointDetails:
            "Edit planned stops on Pace to change how long the runner stops at an aid station. Every crew phone gets the new times."
        case .checkInWhenNoService:
            "When the runner's phone has no service, check them in at the aid station on Pace. Your check-in fills the gap until their pings arrive."
        case .directionsToNextAid:
            "Navigate on the Map gives you a route to the next aid station, so you get there before your runner."
        case .chatAndAlerts:
            "Message the runner and the crew here. Settings, the gear at the top, chooses which chat alerts reach this phone."
        default:
            OnboardingCopy.explanation(for: step) ?? ""
        }
    }
}
