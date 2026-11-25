import Foundation

/// The runner tour's "Test tracking now" (clients/behavior/onboarding-runner-tour.md): tracking
/// starts, the OS asks for When In Use and then Always, one ping from this phone reaches the
/// server, and tracking stops again. The app feeds it what the location manager and the outbox
/// report; this decides the phase, the copy, and when to stop. Pure.
public struct LocationTest: Equatable, Sendable {
    public enum Phase: String, Equatable, Sendable {
        /// Not started: the card offers Test tracking now and On race morning.
        case idle
        /// Tracking started; the OS permission prompts are up.
        case asking
        /// Location is allowed; waiting for the first ping to reach the server.
        case waitingForPing
        /// One ping reached the server. The step is done.
        case sent
        /// Location is off for CrewCue.
        case denied
        /// The ping is queued on this phone: there's no network. It goes when the phone is back.
        case offline
        /// No ping after `timeoutSeconds` (no GPS fix, or the server refused it).
        case failed
    }

    public enum Permission: String, Equatable, Sendable {
        case notDetermined, denied, whenInUse, always
    }

    /// How long the test waits for its ping before it gives up.
    public static let timeoutSeconds: TimeInterval = 45

    public private(set) var phase: Phase = .idle
    /// The runner allowed When In Use only: tracking works with the app open, and the copy asks for Always.
    public private(set) var whenInUseOnly = false
    /// Tracking was already on before the test (race morning): the test leaves it on.
    public private(set) var wasTracking = false
    public private(set) var startedAt: Date?

    public init() {}

    /// Test tracking now. `alreadyTracking`: race-day tracking is on, so the test must not stop it.
    public mutating func start(alreadyTracking: Bool, at now: Date) {
        phase = .asking
        whenInUseOnly = false
        wasTracking = alreadyTracking
        startedAt = now
    }

    public mutating func permission(_ permission: Permission) {
        guard phase == .asking || phase == .waitingForPing else { return }
        switch permission {
        case .notDetermined:
            break
        case .denied:
            phase = .denied
        case .whenInUse:
            whenInUseOnly = true
            phase = .waitingForPing
        case .always:
            whenInUseOnly = false
            phase = .waitingForPing
        }
    }

    /// A ping from this phone reached the server.
    public mutating func pingSent() {
        guard phase == .asking || phase == .waitingForPing || phase == .offline else { return }
        phase = .sent
    }

    /// The ping was queued with no network.
    public mutating func pingQueuedOffline() {
        guard phase == .asking || phase == .waitingForPing else { return }
        phase = .offline
    }

    /// The clock ticked: past the timeout with no ping, the test fails.
    public mutating func tick(now: Date) {
        guard phase == .asking || phase == .waitingForPing, let startedAt,
              now.timeIntervalSince(startedAt) >= Self.timeoutSeconds else { return }
        phase = .failed
    }

    public var isRunning: Bool { phase == .asking || phase == .waitingForPing }

    /// Tracking should stop now: the test ended, and tracking wasn't on before it.
    public var stopsTracking: Bool {
        !wasTracking && [.sent, .denied, .offline, .failed].contains(phase)
    }

    /// The outcome to save once the runner goes on from the card: done after a ping, otherwise
    /// the test waits for race morning. Nil while it runs.
    public var outcome: OnboardingOutcome? {
        switch phase {
        case .sent: .done
        case .denied, .offline, .failed, .idle: .deferred
        case .asking, .waitingForPing: nil
        }
    }

    /// The line under the card's text, nil before the test starts.
    public var message: String? {
        switch phase {
        case .idle: nil
        case .asking: LocationTestCopy.asking
        case .waitingForPing: whenInUseOnly ? LocationTestCopy.waitingWhenInUse : LocationTestCopy.waiting
        case .sent: wasTracking ? LocationTestCopy.sentStillTracking : (whenInUseOnly ? LocationTestCopy.sentWhenInUse : LocationTestCopy.sent)
        case .denied: LocationTestCopy.denied
        case .offline: LocationTestCopy.offline
        case .failed: LocationTestCopy.failed
        }
    }

    /// The card's main button for this phase: Test tracking now, nothing while it runs, Next once
    /// sent, Try again after a failure.
    public var primaryLabel: String? {
        switch phase {
        case .idle: OnboardingTourCopy.testTrackingNow
        case .asking, .waitingForPing: nil
        case .sent: OnboardingTourCopy.next
        case .denied, .offline, .failed: OnboardingTourCopy.tryAgain
        }
    }
}

public enum LocationTestCopy {
    public static let asking = "Allow location, then choose Always."
    public static let waiting = "Sending a test ping…"
    public static let waitingWhenInUse = "Sending a test ping… Choose Always so tracking keeps going while your phone is locked."
    public static let sent = "Test ping sent. Your crew will see your dot. Tracking is off until you start it on race day."
    public static let sentWhenInUse = "Test ping sent. Tracking is off again. Choose Always in Settings so tracking keeps going while your phone is locked."
    public static let sentStillTracking = "Test ping sent. Tracking stays on."
    public static let denied = "Location is off for CrewCue. Turn it on in Settings, or test on race morning."
    public static let offline = "Offline. The test ping is saved on this phone and goes when you're back online."
    public static let failed = "No test ping yet. Try again outside, or test on race morning."
}
