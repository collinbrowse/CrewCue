import Foundation
import Observation
import CrewCueClientCore

/// What the entry shows for the onboarding state (`OnboardingStore.read`).
enum OnboardingEntry: Equatable {
    /// No race and no pick yet: "I'm running a race" or "I'm crewing for someone".
    case chooser
    /// Runner phase 1 (account, course, start time, history, teaser).
    case runnerSetup
    /// Runner phase 2 (the `preview` step): the race-day replay, then the paywall
    /// (`RacePreviewModel` keeps which one). Not now or a purchase marks the step.
    case racePreview
    /// Crew: the existing join-crew screen (the full crew flow is a later PR).
    case crewJoin
    /// Crew, signed out, invite confirmed: sign in to accept it.
    case signIn
    /// Signed in, the race list hasn't answered and nothing is saved from an earlier one.
    case loading
    /// The tab bar.
    case shell
}

@MainActor
@Observable
final class OnboardingModel {
    private let store: OnboardingStore?
    private let clock: any Clock
    private let logger: any Logger
    private(set) var state: OnboardingState = .chooser
    /// The saved progress this state was read from (the setup checklist reads whether it was hidden).
    private(set) var progress: OnboardingProgress = .empty
    /// The race list this state was read with (this read's, else the saved one).
    private(set) var races: [OnboardingRace] = []
    /// The signed-in list read failed and nothing was saved before: the shell shows its own
    /// offline or error message instead of a loader that never ends.
    private(set) var racesFailed = false
    private var signedIn = false
    private var userId: String?
    private var activeRoomId: String?
    private var lastRaces: [OnboardingRace]?

    init(store: OnboardingStore?, clock: any Clock, logger: any Logger) {
        self.store = store
        self.clock = clock
        self.logger = logger
    }

    /// Reads the state again. `races` nil keeps the list this model last read (or the saved one).
    func refresh(signedIn: Bool, userId: String?, races: [OnboardingRace]? = nil, activeRoomId: String?) {
        if signedIn != self.signedIn || userId != self.userId {
            lastRaces = nil
            racesFailed = false
            awaitingJoinedRace = false
        }
        self.signedIn = signedIn
        self.userId = userId
        self.activeRoomId = activeRoomId
        if let races {
            lastRaces = races
            racesFailed = false
            awaitingJoinedRace = false
        }
        read()
    }

    func noteRacesFailed() {
        racesFailed = true
        awaitingJoinedRace = false
    }

    /// An invite was just joined and the race list that includes it hasn't answered: the entry
    /// shows the loader, not the chooser or the join screen the list it knows would pick.
    private(set) var awaitingJoinedRace = false

    func noteJoinedAwaitingRaces() {
        awaitingJoinedRace = true
    }

    /// Saves the chooser pick.
    func choose(_ choice: OnboardingChoice) {
        guard let store else { return }
        do {
            try store.choose(choice, userId: signedIn ? userId : nil)
        } catch {
            logger.log("onboarding choice not saved")
        }
        read()
    }

    /// Back to the chooser before a race exists.
    func clearChoice() {
        guard let store else { return }
        let owner = signedIn ? userId : nil
        var progress = store.load(userId: owner)
        progress.choice = nil
        do {
            try store.save(progress, userId: owner)
        } catch {
            logger.log("onboarding choice not cleared")
        }
        read()
    }

    /// Marks a step so a relaunch resumes after it. `role` names whose tour a shared tour step
    /// (`notifications`) belongs to.
    func mark(_ step: OnboardingStep, outcome: OnboardingOutcome = .done, roomId: String?, role: OnboardingChoice = .runner) {
        guard let store else { return }
        do {
            try store.mark(step, outcome: outcome, roomId: roomId, role: role, userId: signedIn ? userId : nil)
        } catch {
            logger.log("onboarding step \(step.rawValue) not saved")
        }
        read()
    }

    // MARK: Pending invite

    /// The invite code waiting to be joined on this device for the current reader (signed out, or
    /// this user), nil when none is or it expired.
    private(set) var pendingJoin: PendingJoin?

    /// Saves a join link's or a typed code as the device's pending invite (replacing any other),
    /// so it survives sign-up and a relaunch. False when it couldn't be saved.
    @discardableResult
    func savePendingJoin(code: String, source: InviteSource) -> Bool {
        guard let store else { return false }
        do {
            try store.pendingJoins.save(code: code, source: source, userId: signedIn ? userId : nil, now: clock.now())
        } catch {
            logger.log("pending join not saved")
            read()
            return false
        }
        read()
        return true
    }

    /// Signed out, the person confirmed the invite: sign-in comes next, and joins once it lands.
    func confirmInvite(_ code: String) {
        guard let store else { return }
        do {
            try store.mark(.join, invite: code, userId: signedIn ? userId : nil, now: clock.now())
        } catch {
            logger.log("invite not confirmed")
        }
        read()
    }

    /// A join for `code` landed: forgets the pending invite only while it is still that code.
    /// Answers the invite still pending after that (one that arrived while the join was out).
    @discardableResult
    func clearPendingJoin(ifCode code: String) -> PendingJoin? {
        guard let store else { return nil }
        let reader = signedIn ? userId : nil
        if let pending = store.pendingJoins.read(userId: reader, now: clock.now()), pending.code == code {
            do {
                try store.pendingJoins.clear(ifStill: pending)
            } catch {
                logger.log("pending join not cleared")
            }
        }
        read()
        return pendingJoin
    }

    /// The person gave up on the invite (Back): the code and the confirmation both go.
    func giveUpInvite() {
        guard let store else { return }
        do {
            try store.giveUpInvite(userId: signedIn ? userId : nil)
        } catch {
            logger.log("invite not given up")
        }
        read()
    }

    /// The code to show after the auto-join answered `outcome` (`PendingJoinStore.nextCode`).
    func nextCode(after outcome: PendingJoinOutcome) -> PendingJoin? {
        guard let store else { return nil }
        return store.pendingJoins.nextCode(after: outcome, userId: signedIn ? userId : nil, now: clock.now())
    }

    /// The signed-out invite a sign-in landing now should join (`OnboardingStore.confirmedInviteForSignIn`).
    func confirmedInviteForSignIn() -> PendingJoin? {
        store?.confirmedInviteForSignIn(now: clock.now())
    }

    /// Joins the pending invite as the signed-in user (`PendingJoinStore.resolve`), which clears it
    /// once joined or when the code can't work. Nothing pending answers `nothingPending`.
    func resolvePendingJoin(graph: ClientGraph) async -> PendingJoinOutcome {
        guard let store, signedIn, let userId else { return .nothingPending }
        let outcome = await store.pendingJoins.resolve(graph: graph, userId: userId)
        read()
        return outcome
    }

    /// The saved race this state knows, if any.
    func race(_ roomId: String?) -> OnboardingRace? {
        guard let roomId else { return nil }
        return races.first { $0.roomId == roomId }
    }

    /// The active race is the runner's own and not unlocked yet.
    func isUnpaidRunnerRace(_ roomId: String?) -> Bool {
        guard let race = race(roomId) else { return false }
        return race.isRunner && race.entitlementStatus == "unpaid"
    }

    var entry: OnboardingEntry {
        let entry = Self.entry(for: state, signedIn: signedIn, racesFailed: racesFailed)
        // Only in place of the onboarding screens a stale list would pick, never over the shell.
        if awaitingJoinedRace, signedIn, [.chooser, .crewJoin, .loading].contains(entry) { return .loading }
        return entry
    }

    static func entry(for state: OnboardingState, signedIn: Bool, racesFailed: Bool) -> OnboardingEntry {
        switch state.flow {
        case .chooser:
            return .chooser
        case .loading:
            // A stored active race keeps the tab bar; a failed first read shows the shell's message.
            return state.showsTabBar || racesFailed ? .shell : .loading
        case .runner:
            switch state.phase {
            case .setup: return .runnerSetup
            // The step is marked when the paywall ends; until then a relaunch replays from the start.
            case .preview: return state.step == .preview ? .racePreview : .shell
            default: return .shell
            }
        case .crew:
            guard state.phase == .join else { return .shell }
            // A signed-out person who confirmed an invite signs in next; otherwise the join screen.
            return !signedIn && state.step == .account ? .signIn : .crewJoin
        case .raceLocked, .done:
            return .shell
        }
    }

    private func read() {
        guard let store else {
            state = signedIn ? OnboardingState(flow: .done, role: nil, roomId: activeRoomId, phase: nil, step: nil, steps: [], checklist: [], inviteConfirmed: false, showsTabBar: true) : .chooser
            return
        }
        do {
            let result = try store.read(
                signedIn: signedIn,
                userId: userId,
                races: signedIn ? lastRaces : nil,
                activeRoomId: activeRoomId,
                now: clock.now()
            )
            races = signedIn ? (lastRaces ?? result.progress.knownRaces ?? []) : []
            pendingJoin = result.pendingJoin
            progress = result.progress
            state = result.state
        } catch {
            logger.log("onboarding read failed")
        }
    }
}
