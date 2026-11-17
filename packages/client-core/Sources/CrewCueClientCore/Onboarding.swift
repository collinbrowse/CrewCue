import Foundation

/// One onboarding step. Runner and crew share `account` and `notifications`; a person has one
/// role per race, so a race's progress never mixes the two flows.
public enum OnboardingStep: String, CaseIterable, Codable, Sendable {
    // Runner phase 1, setup before the tab bar.
    case account, course, startTime, history, projectionTeaser
    // Runner phase 2.
    case preview, paywall
    // Runner phase 3, the tour.
    case invites, notifications, location, mapStartLine, chat
    // Runner setup checklist. Optional: never blocks the flow.
    case etaEdits, checkpointDetails
    // Crew: join by link or code, then `account`, then the tour.
    case join
    case runnerLocation, lastUpdateAge, etaVsPlan, editCheckpointDetails, checkInWhenNoService, directionsToNextAid, chatAndAlerts

    public static let runnerSetup: [OnboardingStep] = [.account, .course, .startTime, .history, .projectionTeaser]
    public static let runnerPreview: [OnboardingStep] = [.preview, .paywall]
    public static let runnerTour: [OnboardingStep] = [.invites, .notifications, .location, .mapStartLine, .chat]
    public static let runnerChecklist: [OnboardingStep] = [.etaEdits, .checkpointDetails]
    public static let crewJoin: [OnboardingStep] = [.join, .account]
    public static let crewTour: [OnboardingStep] = [
        .runnerLocation, .lastUpdateAge, .etaVsPlan, .editCheckpointDetails,
        .checkInWhenNoService, .directionsToNextAid, .chatAndAlerts, .notifications
    ]

    /// Read from the server, never saved: a course on the race, its start time, its payment.
    public var followsServer: Bool {
        self == .course || self == .startTime || self == .paywall
    }

    /// Saved once for the account, so every race shares it. Every other saved step is per race.
    public var accountWide: Bool {
        self == .account || self == .history || self == .join
    }

    /// How a step may end: history is imported or skipped to a cold start, the location test runs
    /// now or waits for race morning, and the replay, tour and checklist items can be skipped.
    public var allowedOutcomes: Set<OnboardingOutcome> {
        switch self {
        case .location: [.done, .deferred]
        case .account, .projectionTeaser, .join: [.done]
        case .course, .startTime, .paywall: []
        default: [.done, .skipped]
        }
    }
}

public enum OnboardingOutcome: String, Codable, Sendable {
    case done
    case skipped
    /// The location test waits for race morning.
    case deferred
}

/// What the chooser offers when there is no race and no pending invite.
public enum OnboardingChoice: String, Codable, Sendable {
    case runner
    case crew
}

public enum OnboardingError: Error, Equatable, Sendable {
    case followsServer(OnboardingStep)
    case outcomeNotAllowed(OnboardingStep, OnboardingOutcome)
    case roomRequired(OnboardingStep)

    public var message: String {
        switch self {
        case .followsServer(let step): "\(step.rawValue) follows the race on the server."
        case .outcomeNotAllowed(let step, let outcome): "\(step.rawValue) can't be \(outcome.rawValue)."
        case .roomRequired(let step): "\(step.rawValue) needs a race."
        }
    }
}

/// One race the user belongs to, as `GET /race-rooms/mine` lists it.
public struct OnboardingRace: Equatable, Sendable {
    public var roomId: String
    /// This user's role in this race. Roles differ per race.
    public var role: String
    /// `unpaid`, `paid` or `expired`.
    public var entitlementStatus: String
    public var raceStartAt: String?
    public var hasCourse: Bool

    public init(roomId: String, role: String, entitlementStatus: String, raceStartAt: String? = nil, hasCourse: Bool) {
        self.roomId = roomId
        self.role = role
        self.entitlementStatus = entitlementStatus
        self.raceStartAt = raceStartAt
        self.hasCourse = hasCourse
    }

    public init(room: RaceRoom, userId: String) {
        let summary = RaceSummary(room: room, userId: userId)
        let fileName = room.courseFileName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(
            roomId: room.id,
            role: summary.role,
            entitlementStatus: room.entitlement.status,
            raceStartAt: room.raceStartAt,
            hasCourse: room.course?.checkpoints.isEmpty == false || !fileName.isEmpty
        )
    }

    public var isRunner: Bool { role == "athlete" }
    public var isPaid: Bool { entitlementStatus == "paid" }
    public var isExpired: Bool { entitlementStatus == "expired" }
    var hasStartTime: Bool { raceStartAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }
}

/// Everything the flow is decided from. Races are ignored while signed out: they come from the
/// server, which only answers a signed-in user.
public struct OnboardingInput: Sendable {
    public var signedIn: Bool
    public var userId: String?
    public var hasPendingInvite: Bool
    public var races: [OnboardingRace]
    /// The race every tab follows. A race the list no longer has falls back to the first one.
    public var activeRoomId: String?
    public var progress: OnboardingProgress

    public init(
        signedIn: Bool,
        userId: String?,
        hasPendingInvite: Bool = false,
        races: [OnboardingRace] = [],
        activeRoomId: String? = nil,
        progress: OnboardingProgress = .empty
    ) {
        self.signedIn = signedIn
        self.userId = userId
        self.hasPendingInvite = hasPendingInvite
        self.races = races
        self.activeRoomId = activeRoomId
        self.progress = progress
    }
}

public struct OnboardingStepStatus: Equatable, Sendable {
    public var step: OnboardingStep
    /// Nil until the step is complete.
    public var outcome: OnboardingOutcome?

    public init(step: OnboardingStep, outcome: OnboardingOutcome?) {
        self.step = step
        self.outcome = outcome
    }

    public var isComplete: Bool { outcome != nil }
}

/// Where onboarding stands for the active race and this user's role in it.
public struct OnboardingState: Equatable, Sendable {
    public enum Flow: String, Sendable {
        case runner, crew, chooser, done
    }

    /// Runner: setup (before the tab bar), preview (replay and paywall), tour. Crew: join, tour.
    public enum Phase: String, Sendable {
        case setup, preview, tour, join
    }

    public var flow: Flow
    /// Whose flow this is, or was once `done`. Nil for the chooser.
    public var role: OnboardingChoice?
    /// The race the flow is for. Nil before the runner's race exists or the crew's join lands.
    public var roomId: String?
    public var phase: Phase?
    /// The screen to show. Nil for the chooser and when done.
    public var step: OnboardingStep?
    /// The role's required steps in order, with how each ended.
    public var steps: [OnboardingStepStatus]
    /// Runner setup checklist items, shown until done; they never block the flow.
    public var checklist: [OnboardingStepStatus]
    /// Signed out with a pending invite the person already confirmed: sign in, then accept it.
    public var inviteConfirmed: Bool
    public var showsTabBar: Bool

    public static let chooser = OnboardingState(
        flow: .chooser, role: nil, roomId: nil, phase: nil, step: nil,
        steps: [], checklist: [], inviteConfirmed: false, showsTabBar: false
    )

    public init(
        flow: Flow,
        role: OnboardingChoice?,
        roomId: String?,
        phase: Phase?,
        step: OnboardingStep?,
        steps: [OnboardingStepStatus],
        checklist: [OnboardingStepStatus],
        inviteConfirmed: Bool,
        showsTabBar: Bool
    ) {
        self.flow = flow
        self.role = role
        self.roomId = roomId
        self.phase = phase
        self.step = step
        self.steps = steps
        self.checklist = checklist
        self.inviteConfirmed = inviteConfirmed
        self.showsTabBar = showsTabBar
    }

    public func status(_ step: OnboardingStep) -> OnboardingStepStatus? {
        (steps + checklist).first { $0.step == step }
    }
}

/// Picks the flow per active race and role, not per account: one person can be the runner in one
/// race and crew in another. Completion comes from the server where it can (a race with a course,
/// a start time, a payment) and from the saved progress for the rest. Pure.
public enum Onboarding {
    public static func resolve(_ input: OnboardingInput) -> OnboardingState {
        if input.hasPendingInvite {
            return crew(race: nil, input)
        }
        if let race = activeRace(input) {
            if race.isExpired {
                return finished(role: race.isRunner ? .runner : .crew, race: race, input)
            }
            return race.isRunner ? runner(race: race, input) : crew(race: race, input)
        }
        switch input.progress.choice {
        case .runner: return runner(race: nil, input)
        case .crew: return crew(race: nil, input)
        case nil: return .chooser
        }
    }

    static func activeRace(_ input: OnboardingInput) -> OnboardingRace? {
        guard input.signedIn else { return nil }
        let preferred = input.activeRoomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return input.races.first { $0.roomId == preferred } ?? input.races.first
    }

    private static func runner(race: OnboardingRace?, _ input: OnboardingInput) -> OnboardingState {
        let progress = input.progress
        let roomId = race?.roomId
        // Paying is past the paywall, so the steps before it no longer apply.
        let paid = race?.isPaid == true
        func saved(_ step: OnboardingStep) -> OnboardingOutcome? {
            progress.outcome(step, roomId: roomId)
        }
        func done(_ complete: Bool) -> OnboardingOutcome? { complete ? .done : nil }
        let setup: [OnboardingStepStatus] = [
            OnboardingStepStatus(step: .account, outcome: input.signedIn ? (saved(.account) ?? done(race != nil)) : nil),
            OnboardingStepStatus(step: .course, outcome: done(race?.hasCourse == true)),
            OnboardingStepStatus(step: .startTime, outcome: done(race?.hasStartTime == true)),
            OnboardingStepStatus(step: .history, outcome: saved(.history) ?? done(paid)),
            OnboardingStepStatus(step: .projectionTeaser, outcome: race == nil ? nil : saved(.projectionTeaser) ?? done(paid))
        ]
        let preview: [OnboardingStepStatus] = [
            OnboardingStepStatus(step: .preview, outcome: race == nil ? nil : saved(.preview) ?? done(paid)),
            OnboardingStepStatus(step: .paywall, outcome: done(paid))
        ]
        let tour = OnboardingStep.runnerTour.map { OnboardingStepStatus(step: $0, outcome: race == nil ? nil : saved($0)) }
        let checklist = OnboardingStep.runnerChecklist.map { OnboardingStepStatus(step: $0, outcome: race == nil ? nil : saved($0)) }
        let phases: [(OnboardingState.Phase, [OnboardingStepStatus])] = [(.setup, setup), (.preview, preview), (.tour, tour)]
        let steps = setup + preview + tour
        guard let next = firstIncomplete(phases) else {
            return finished(role: .runner, race: race, input, steps: steps, checklist: checklist)
        }
        return OnboardingState(
            flow: .runner,
            role: .runner,
            roomId: roomId,
            phase: next.phase,
            step: next.step,
            steps: steps,
            checklist: checklist,
            inviteConfirmed: false,
            showsTabBar: next.phase != .setup
        )
    }

    private static func crew(race: OnboardingRace?, _ input: OnboardingInput) -> OnboardingState {
        // A pending invite wins over the active race: that join comes first.
        let seat = input.hasPendingInvite ? nil : race
        let confirmed = input.hasPendingInvite && input.progress.outcome(.join, roomId: nil) != nil
        let join = [
            OnboardingStepStatus(step: .join, outcome: seat == nil ? nil : .done),
            OnboardingStepStatus(step: .account, outcome: input.signedIn ? .done : nil)
        ]
        let tour = OnboardingStep.crewTour.map { step in
            OnboardingStepStatus(step: step, outcome: seat.flatMap { input.progress.outcome(step, roomId: $0.roomId) })
        }
        let steps = join + tour
        guard let seat else {
            // Signed out with a confirmed invite: sign in next. Signed in: accept the invite.
            let step: OnboardingStep = !input.signedIn && confirmed ? .account : .join
            return OnboardingState(
                flow: .crew, role: .crew, roomId: nil, phase: .join, step: step,
                steps: steps, checklist: [], inviteConfirmed: confirmed, showsTabBar: false
            )
        }
        guard let next = firstIncomplete([(.tour, tour)]) else {
            return finished(role: .crew, race: seat, input, steps: steps, checklist: [])
        }
        return OnboardingState(
            flow: .crew, role: .crew, roomId: seat.roomId, phase: next.phase, step: next.step,
            steps: steps, checklist: [], inviteConfirmed: false, showsTabBar: true
        )
    }

    /// Nothing left to do. An expired race (its access ended) has nothing to set up either.
    private static func finished(
        role: OnboardingChoice,
        race: OnboardingRace?,
        _ input: OnboardingInput,
        steps: [OnboardingStepStatus] = [],
        checklist: [OnboardingStepStatus]? = nil
    ) -> OnboardingState {
        let items = checklist ?? (role == .runner
            ? OnboardingStep.runnerChecklist.map { OnboardingStepStatus(step: $0, outcome: input.progress.outcome($0, roomId: race?.roomId)) }
            : [])
        return OnboardingState(
            flow: .done, role: role, roomId: race?.roomId, phase: nil, step: nil,
            steps: steps, checklist: items, inviteConfirmed: false, showsTabBar: true
        )
    }

    private static func firstIncomplete(
        _ phases: [(OnboardingState.Phase, [OnboardingStepStatus])]
    ) -> (phase: OnboardingState.Phase, step: OnboardingStep)? {
        for (phase, statuses) in phases {
            if let open = statuses.first(where: { !$0.isComplete }) {
                return (phase, open.step)
            }
        }
        return nil
    }
}
