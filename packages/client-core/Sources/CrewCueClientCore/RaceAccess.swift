import Foundation

/// How the race tabs treat the active race's payment, for both apps
/// (clients/behavior/onboarding-runner-setup.md, "Race not unlocked"). An unpaid race shows its
/// runner only the course and the finish ETA and takes no location pings; its crew features answer
/// 402 `room_unpaid`. Pure: the apps keep only which screen draws it.
public struct RaceAccess: Equatable, Sendable {
    /// The last billing read for the race. Nil while unknown or when the read failed: a failed
    /// read never gates a race.
    public enum Billing: String, Sendable {
        case paid, unpaid
    }

    /// The race isn't unlocked.
    public var unpaid: Bool
    /// Load the race-day model (course, schedule, feed). Not for a crew member's unpaid race,
    /// whose reads answer 402.
    public var loadsRace: Bool
    /// The phone sends location samples. Never for an unpaid race, which takes no pings.
    public var samplesLocation: Bool
    /// The runner's Unlock race banner on Map, Pace and Chat. Start tracking, invites and chat
    /// send open the paywall instead.
    public var gatesActions: Bool
    /// Why a crew member's race is locked (the `raceLocked` state's `reason`), shown in place of
    /// the race tabs. Nil otherwise.
    public var lockedReason: String?

    /// No active race: nothing loads and nothing is gated.
    public static let noRace = RaceAccess(unpaid: false, loadsRace: false, samplesLocation: false, gatesActions: false, lockedReason: nil)

    public init(unpaid: Bool, loadsRace: Bool, samplesLocation: Bool, gatesActions: Bool, lockedReason: String?) {
        self.unpaid = unpaid
        self.loadsRace = loadsRace
        self.samplesLocation = samplesLocation
        self.gatesActions = gatesActions
        self.lockedReason = lockedReason
    }

    /// `roomId`: the active race. `role`: the user's role in it (`athlete` runs it). `billing`:
    /// the last billing read for this race. `onboarding`: the onboarding state, used only when it
    /// is for this race; its runner `preview` phase and `raceLocked` say unpaid.
    ///
    /// A billing read wins over the onboarding state, which follows the race list: after a
    /// purchase the list can stay old (a read that failed on race morning), and a paid race must
    /// not keep its banner or stop sending pings.
    public static func resolve(roomId: String?, role: String?, billing: Billing?, onboarding: OnboardingState?) -> RaceAccess {
        guard let room = trimmed(roomId) else { return .noRace }
        let state = onboarding.flatMap { trimmed($0.roomId) == room ? $0 : nil }
        let locked = state?.flow == .raceLocked
        let unpaid: Bool
        switch billing {
        case .paid: unpaid = false
        case .unpaid: unpaid = true
        case nil: unpaid = locked || (state?.flow == .runner && state?.phase == .preview)
        }
        let runner = role == "athlete"
        return RaceAccess(
            unpaid: unpaid,
            // The runner reads an unpaid race's teaser (course and finish), but never pings it.
            loadsRace: runner || !unpaid,
            samplesLocation: !unpaid,
            gatesActions: unpaid && runner,
            lockedReason: unpaid && !runner && locked ? trimmed(state?.reason) : nil
        )
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
