import Foundation

/// How many views show the onboarding replay right now. A rebuilt window (a display switch) or a
/// second window can bring its view up before the old one goes away, so the old view's late
/// disappearance must not pause or end a replay that is still on screen. The replay pauses, and
/// its cleanup is scheduled, only when the last view has gone; any view coming back cancels that
/// cleanup. Pure.
public struct DemoRaceAudience: Equatable, Sendable {
    public private(set) var count = 0

    public init() {}

    /// At least one view shows the replay: it may play.
    public var isWatched: Bool { count > 0 }

    /// A view showed the replay. Cancel any pending cleanup.
    public mutating func appeared() {
        count += 1
    }

    /// A view went away. True when it was the last one: pause, and schedule the cleanup. An
    /// extra disappearance (with no view left) changes nothing and can't go below zero.
    @discardableResult
    public mutating func disappeared() -> Bool {
        guard count > 0 else { return false }
        count -= 1
        return count == 0
    }
}
