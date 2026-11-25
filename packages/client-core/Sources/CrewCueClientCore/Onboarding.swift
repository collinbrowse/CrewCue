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
    /// The setup checklist card on Map was hidden for this race. Not a step of any flow.
    case setupChecklist
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

    /// Saved once for the account, so every race shares it.
    public var accountWide: Bool {
        self == .account || self == .history || self == .join
    }

    /// A tour step: saved once per user per role, so the runner tour seen once is done for every
    /// later race where they run, and the crew tour likewise. Every other saved step is per race.
    public var isTour: Bool {
        Self.runnerTour.contains(self) || Self.crewTour.contains(self)
    }

    /// The role whose tour holds this step, nil for `notifications`, which both tours share.
    var tourRole: OnboardingChoice? {
        let runner = Self.runnerTour.contains(self), crew = Self.crewTour.contains(self)
        return runner == crew ? nil : (runner ? .runner : .crew)
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
    /// `notifications` sits in both tours; its role comes from the call or the race.
    case roleRequired(OnboardingStep)
    /// `join` is confirmed for one invite, named by its token or code.
    case inviteRequired

    public var message: String {
        switch self {
        case .followsServer(let step): "\(step.rawValue) follows the race on the server."
        case .outcomeNotAllowed(let step, let outcome): "\(step.rawValue) can't be \(outcome.rawValue)."
        case .roomRequired(let step): "\(step.rawValue) needs a race."
        case .roleRequired(let step): "\(step.rawValue) needs a role (runner or crew)."
        case .inviteRequired: "join needs the invite's token or code."
        }
    }
}

/// One race the user belongs to, as `GET /race-rooms/mine` lists it. The progress file keeps the
/// last list the server answered, so a relaunch without it (offline, or before it answers) still
/// knows each race's role, payment, course, start and estimate.
public struct OnboardingRace: Equatable, Sendable {
    public var roomId: String
    /// This user's role in this race. Roles differ per race.
    public var role: String
    /// `unpaid`, `paid` or `expired`.
    public var entitlementStatus: String
    /// The race clock's start: `raceStartAt`, else the legacy `activatedAt` the server's clock
    /// falls back to (`resolveRaceAnchorIso`).
    public var raceStartAt: String?
    public var hasCourse: Bool
    /// The race has an estimate attached (`pacingEstimateId`), which the runner's setup history
    /// step keeps (`RunnerSetupSteps.historyContinue`). The server sends it to the runner and to
    /// a paid race's crew; any other member of an unpaid race reads false.
    public var hasEstimate: Bool

    public init(
        roomId: String,
        role: String,
        entitlementStatus: String,
        raceStartAt: String? = nil,
        hasCourse: Bool,
        hasEstimate: Bool = false
    ) {
        self.roomId = roomId
        self.role = role
        self.entitlementStatus = entitlementStatus
        self.raceStartAt = raceStartAt
        self.hasCourse = hasCourse
        self.hasEstimate = hasEstimate
    }

    public init(room: RaceRoom, userId: String) {
        let summary = RaceSummary(room: room, userId: userId)
        let fileName = room.courseFileName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(
            roomId: room.id,
            role: summary.role,
            entitlementStatus: room.entitlement.status,
            raceStartAt: Self.raceClockStart(raceStartAt: room.raceStartAt, activatedAt: room.activatedAt),
            hasCourse: room.course?.checkpoints.isEmpty == false || !fileName.isEmpty,
            hasEstimate: Self.hasEstimate(room)
        )
    }

    /// An estimate is attached: its id, or the estimate itself.
    static func hasEstimate(_ room: RaceRoom) -> Bool {
        let id = room.pacingEstimateId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !id.isEmpty || room.pacingEstimate != nil
    }

    public var isRunner: Bool { role == "athlete" }
    public var isPaid: Bool { entitlementStatus == "paid" }
    public var isExpired: Bool { entitlementStatus == "expired" }
    var hasStartTime: Bool { raceStartAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }

    /// The server's race clock anchor: `raceStartAt`, else `activatedAt`. Blank counts as unset.
    public static func raceClockStart(raceStartAt: String?, activatedAt: String?) -> String? {
        for value in [raceStartAt, activatedAt] {
            if let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
                return trimmed
            }
        }
        return nil
    }

    var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "roomId": roomId,
            "role": role,
            "entitlementStatus": entitlementStatus,
            "hasCourse": hasCourse,
            "hasEstimate": hasEstimate
        ]
        if let raceStartAt { object["raceStartAt"] = raceStartAt }
        return object
    }

    init?(jsonObject value: Any) {
        guard let object = value as? [String: Any],
              let roomId = (object["roomId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !roomId.isEmpty,
              let role = object["role"] as? String,
              let status = object["entitlementStatus"] as? String else { return nil }
        self.init(
            roomId: roomId,
            role: role,
            entitlementStatus: status,
            raceStartAt: object["raceStartAt"] as? String,
            hasCourse: object["hasCourse"] as? Bool ?? false,
            hasEstimate: object["hasEstimate"] as? Bool ?? false
        )
    }
}

/// Everything the flow is decided from. Races are ignored while signed out: they come from the
/// server, which only answers a signed-in user.
public struct OnboardingInput: Sendable {
    public var signedIn: Bool
    public var userId: String?
    /// The pending invite's token or code, nil when there is none. A signed-out confirmation
    /// counts only for this invite; an empty string is an invite the app can't name, which no
    /// confirmation matches.
    public var pendingInvite: String?
    /// `GET /race-rooms/mine` as it answered this time. Nil while it hasn't (loading, offline):
    /// the flow then follows the list saved with the progress (`OnboardingProgress.knownRaces`).
    public var races: [OnboardingRace]?
    /// The race every tab follows. A race the list no longer has falls back to the first one.
    public var activeRoomId: String?
    public var progress: OnboardingProgress

    public init(
        signedIn: Bool,
        userId: String?,
        pendingInvite: String? = nil,
        races: [OnboardingRace]? = nil,
        activeRoomId: String? = nil,
        progress: OnboardingProgress = .empty
    ) {
        self.signedIn = signedIn
        self.userId = userId
        self.pendingInvite = pendingInvite
        self.races = races
        self.activeRoomId = activeRoomId
        self.progress = progress
    }

    public var hasPendingInvite: Bool { pendingInvite != nil }
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
    /// `loading`: signed in, and neither this read nor the saved progress has the race list yet
    /// (a first launch before `GET /race-rooms/mine` answers). Wait for the list; the tab bar
    /// stays for a user with a stored active race.
    public enum Flow: String, Sendable {
        case runner, crew, chooser, done, loading
        /// A crew member's race isn't unlocked: its crew features answer 402 `room_unpaid` (the
        /// runner hasn't paid, or a refund took it back). No tour; `reason` says why.
        case raceLocked
    }

    /// Runner: setup (before the tab bar), preview (replay and paywall), tour. Crew: join, tour.
    public enum Phase: String, Sendable {
        case setup, preview, tour, join
    }

    public var flow: Flow
    /// Whose flow this is, or was once `done`. Nil for the chooser and while loading.
    public var role: OnboardingChoice?
    /// The race the flow is for. Nil before the runner's race exists or the crew's join lands;
    /// while loading, the stored active race.
    public var roomId: String?
    public var phase: Phase?
    /// The screen to show. Nil for the chooser and when done.
    public var step: OnboardingStep?
    /// The role's required steps in order, with how each ended. A paid runner race leaves out
    /// course and startTime, which are checklist items there.
    public var steps: [OnboardingStepStatus]
    /// Runner setup checklist items, shown until done; they never block the flow. A paid race
    /// lists its course and start time here too, so a missing one never hides the tab bar.
    public var checklist: [OnboardingStepStatus]
    /// Signed out with a pending invite the person already confirmed: sign in, then accept it.
    public var inviteConfirmed: Bool
    public var showsTabBar: Bool
    /// Why the race is locked (`raceLocked` only), for the UI to show.
    public var reason: String?

    public static let raceLockedReason = "Waiting for the runner to unlock this race."

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
        showsTabBar: Bool,
        reason: String? = nil
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
        self.reason = reason
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
        // Signed out, the server's races don't apply. Signed in: this read's list, else the one
        // saved with the progress; nil when neither exists yet.
        let races: [OnboardingRace]? = input.signedIn ? (input.races ?? input.progress.knownRaces) : []
        if input.hasPendingInvite {
            // The join comes first, presented over the tab bar of a race the user already has.
            let underway = races.map { !$0.isEmpty } ?? (room(input.activeRoomId) != nil)
            return crew(race: nil, input, showsTabBar: underway)
        }
        guard let races else { return loading(input) }
        if let race = activeRace(races, preferred: input.activeRoomId) {
            if race.isExpired {
                return finished(role: race.isRunner ? .runner : .crew, race: race, input)
            }
            if race.isRunner { return runner(race: race, input) }
            // Crew features need a paid race; the runner keeps the normal flow to pay.
            if !race.isPaid { return raceLocked(race) }
            return crew(race: race, input, showsTabBar: true)
        }
        switch input.progress.choice {
        case .runner: return runner(race: nil, input)
        case .crew: return crew(race: nil, input, showsTabBar: false)
        case nil: return .chooser
        }
    }

    static func activeRace(_ races: [OnboardingRace], preferred: String?) -> OnboardingRace? {
        let preferred = room(preferred)
        return races.first { $0.roomId == preferred } ?? races.first
    }

    private static func raceLocked(_ race: OnboardingRace) -> OnboardingState {
        OnboardingState(
            flow: .raceLocked, role: .crew, roomId: race.roomId, phase: nil, step: nil,
            steps: [], checklist: [], inviteConfirmed: false, showsTabBar: true,
            reason: OnboardingState.raceLockedReason
        )
    }

    /// The race list isn't known yet. Nothing to decide but the tab bar: a stored active race keeps it.
    private static func loading(_ input: OnboardingInput) -> OnboardingState {
        let roomId = room(input.activeRoomId)
        return OnboardingState(
            flow: .loading, role: nil, roomId: roomId, phase: nil, step: nil,
            steps: [], checklist: [], inviteConfirmed: false, showsTabBar: roomId != nil
        )
    }

    private static func room(_ roomId: String?) -> String? {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
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
        let course = OnboardingStepStatus(step: .course, outcome: done(race?.hasCourse == true))
        let startTime = OnboardingStepStatus(step: .startTime, outcome: done(race?.hasStartTime == true))
        // A paid race never goes back behind the tab bar: its course and start time move to the
        // checklist instead of blocking setup.
        let setup: [OnboardingStepStatus] = [
            OnboardingStepStatus(step: .account, outcome: input.signedIn ? (saved(.account) ?? done(race != nil)) : nil)
        ] + (paid ? [] : [course, startTime]) + [
            OnboardingStepStatus(step: .history, outcome: saved(.history) ?? done(paid)),
            OnboardingStepStatus(step: .projectionTeaser, outcome: race == nil ? nil : saved(.projectionTeaser) ?? done(paid))
        ]
        let preview: [OnboardingStepStatus] = [
            OnboardingStepStatus(step: .preview, outcome: race == nil ? nil : saved(.preview) ?? done(paid)),
            OnboardingStepStatus(step: .paywall, outcome: done(paid))
        ]
        let tour = OnboardingStep.runnerTour.map {
            OnboardingStepStatus(step: $0, outcome: race == nil ? nil : progress.tourOutcome($0, role: .runner))
        }
        let checklist = (paid ? [course, startTime] : [])
            + OnboardingStep.runnerChecklist.map { OnboardingStepStatus(step: $0, outcome: race == nil ? nil : saved($0)) }
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

    private static func crew(race: OnboardingRace?, _ input: OnboardingInput, showsTabBar: Bool) -> OnboardingState {
        // A pending invite wins over the active race: that join comes first.
        let seat = input.hasPendingInvite ? nil : race
        let confirmed = input.hasPendingInvite && input.progress.inviteConfirmed(input.pendingInvite)
        let join = [
            OnboardingStepStatus(step: .join, outcome: seat == nil ? nil : .done),
            OnboardingStepStatus(step: .account, outcome: input.signedIn ? .done : nil)
        ]
        let tour = OnboardingStep.crewTour.map { step in
            OnboardingStepStatus(step: step, outcome: seat == nil ? nil : input.progress.tourOutcome(step, role: .crew))
        }
        let steps = join + tour
        guard let seat else {
            // Signed out with a confirmed invite: sign in next. Signed in: accept the invite.
            let step: OnboardingStep = !input.signedIn && confirmed ? .account : .join
            return OnboardingState(
                flow: .crew, role: .crew, roomId: nil, phase: .join, step: step,
                steps: steps, checklist: [], inviteConfirmed: confirmed, showsTabBar: showsTabBar
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
