import Foundation
import Observation
import CrewCueClientCore

/// What the entry shows for the onboarding state (`OnboardingStore.read`).
enum OnboardingEntry: Equatable {
    /// No race and no pick yet: "I'm running a race" or "I'm crewing for someone".
    case chooser
    /// Runner phase 1 (account, course, start time, history, teaser).
    case runnerSetup
    /// Runner phase 2. The replay is PR 9b; until then the Race Pass paywall follows the teaser.
    case paywall
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
        }
        self.signedIn = signedIn
        self.userId = userId
        self.activeRoomId = activeRoomId
        if let races {
            lastRaces = races
            racesFailed = false
        }
        read()
    }

    func noteRacesFailed() {
        racesFailed = true
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

    /// Marks a step so a relaunch resumes after it.
    func mark(_ step: OnboardingStep, outcome: OnboardingOutcome = .done, roomId: String?) {
        guard let store else { return }
        do {
            try store.mark(step, outcome: outcome, roomId: roomId, role: .runner, userId: signedIn ? userId : nil)
        } catch {
            logger.log("onboarding step \(step.rawValue) not saved")
        }
        read()
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
        Self.entry(for: state, signedIn: signedIn, racesFailed: racesFailed)
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
            case .preview: return state.step == .preview ? .paywall : .shell
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
            state = result.state
        } catch {
            logger.log("onboarding read failed")
        }
    }
}
