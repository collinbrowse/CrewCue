import Foundation

/// Android's onboarding ops. The state is decided here, so both apps follow one flow.
///
/// - `readOnboarding`: `signedIn?` (default: a `userId` is set), `pendingInvite?` (the pending
///   invite's token or code; `hasPendingInvite: true` alone is an invite that can't be confirmed
///   signed out), `races?` (rows from `myRaces`: `id`, `role`, `entitlementStatus`,
///   `raceStartAt?`, `activatedAt?`, `hasCourse`), `activeRoomId?`. Leave `races` out (or null)
///   while `myRaces` hasn't answered: the state then follows the list saved by the last read that
///   had one, or is `loading` when there is none. A signed-in read adopts the signed-out guest's
///   progress and saves a loaded list.
/// - `markOnboardingStep`: `step` + `outcome?` (done, skipped, deferred) + `roomId?` for a
///   per-race step (`invite` for `join`: the token or code confirmed), or `choice` (runner, crew)
///   for the chooser. Takes the same fields as `readOnboarding` and answers `progress` and `state`.
///   Tour steps are saved once per user per role, not per race: send `role` (runner, crew) for
///   `notifications`, which both tours share (else it follows the race's role in the list).
///   Existing accounts: with no saved progress at all, the first loaded list that has a paid
///   race marks both tours done. A crew member's unpaid race answers `flow: raceLocked` with a
///   `reason`, `showsTabBar: true` and no tour.
/// - `resetOnboarding`: forgets the user's progress, or one race's with `roomId`.
///
/// Progress lives in `onboardingDir`, else `crewcue-onboarding` beside `storageDir`, which
/// sign-out and `adoptUser` never touch. `deleteAccount` removes the user's file.
extension RuntimeCall {
    static func readOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let progress = try store.progress(
            signedIn: onboardingSignedIn(object), userId: text(object, "userId"), races: onboardingRaces(object)
        )
        return [
            "state": onboardingJSON(Onboarding.resolve(onboardingInput(object, progress: progress))),
            "progress": progress.jsonObject
        ] as [String: Any]
    }

    static func markOnboardingStep(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
        var progress: OnboardingProgress
        // A first loaded list is read before the mark, so an existing account is recognised.
        if onboardingSignedIn(object), let races = onboardingRaces(object) {
            _ = try store.progress(signedIn: true, userId: userId, races: races)
        }
        do {
            if let raw = text(object, "choice") {
                guard let choice = OnboardingChoice(rawValue: raw) else {
                    throw ClientHTTPError(status: 400, message: "Unknown onboarding choice \(raw).")
                }
                progress = try store.choose(choice, userId: userId)
            } else {
                guard let raw = text(object, "step"), let step = OnboardingStep(rawValue: raw) else {
                    throw ClientHTTPError(status: 400, message: "Unknown onboarding step.")
                }
                let outcomeName = text(object, "outcome") ?? OnboardingOutcome.done.rawValue
                guard let outcome = OnboardingOutcome(rawValue: outcomeName) else {
                    throw ClientHTTPError(status: 400, message: "Unknown onboarding outcome \(outcomeName).")
                }
                progress = try store.mark(
                    step, outcome: outcome, roomId: text(object, "roomId"), invite: text(object, "invite"),
                    role: text(object, "role").flatMap(OnboardingChoice.init(rawValue:)), userId: userId
                )
            }
        } catch let error as OnboardingError {
            throw ClientHTTPError(status: 400, message: error.message)
        }
        if let userId, let races = onboardingRaces(object) {
            progress = try store.remember(races, userId: userId)
        }
        return [
            "progress": progress.jsonObject,
            "state": onboardingJSON(Onboarding.resolve(onboardingInput(object, progress: progress)))
        ] as [String: Any]
    }

    static func resetOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
        try store.reset(userId: userId, roomId: text(object, "roomId"))
        return ["progress": store.load(userId: userId).jsonObject]
    }

    /// The real app-level directory, read from the request as sent: a demo runtime's storage
    /// redirect never applies, since onboarding progress is not replay data.
    static func onboardingStore(_ object: [String: Any]) throws -> OnboardingStore {
        if let path = text(object, "onboardingDir") {
            return OnboardingStore(directory: URL(fileURLWithPath: path, isDirectory: true))
        }
        guard let path = text(object, "storageDir") else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        return OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: path, isDirectory: true)))
    }

    private static func onboardingSignedIn(_ object: [String: Any]) -> Bool {
        boolValue(object["signedIn"]) ?? (text(object, "userId") != nil)
    }

    /// The request's race rows, or nil when it has none (`myRaces` hasn't answered).
    private static func onboardingRaces(_ object: [String: Any]) -> [OnboardingRace]? {
        guard let rows = object["races"] as? [Any] else { return nil }
        return rows.compactMap { item -> OnboardingRace? in
            guard let row = item as? [String: Any],
                  let roomId = text(row, "roomId") ?? text(row, "id") else { return nil }
            let entitlement = text(row, "entitlementStatus")
                ?? ((row["entitlement"] as? [String: Any]).flatMap { text($0, "status") })
            return OnboardingRace(
                roomId: roomId,
                role: text(row, "role") ?? "crew_member",
                entitlementStatus: entitlement ?? "unpaid",
                raceStartAt: OnboardingRace.raceClockStart(raceStartAt: text(row, "raceStartAt"), activatedAt: text(row, "activatedAt")),
                hasCourse: boolValue(row["hasCourse"]) ?? false
            )
        }
    }

    private static func onboardingInput(_ object: [String: Any], progress: OnboardingProgress) -> OnboardingInput {
        let named = text(object, "pendingInvite")
        return OnboardingInput(
            signedIn: onboardingSignedIn(object),
            userId: text(object, "userId"),
            pendingInvite: named ?? (boolValue(object["hasPendingInvite"]) == true ? "" : nil),
            races: onboardingRaces(object),
            activeRoomId: text(object, "activeRoomId") ?? text(object, "roomId"),
            progress: progress
        )
    }

    static func onboardingJSON(_ state: OnboardingState) -> [String: Any] {
        func rows(_ statuses: [OnboardingStepStatus]) -> [[String: Any]] {
            statuses.map { status in
                [
                    "step": status.step.rawValue,
                    "complete": status.isComplete,
                    "outcome": status.outcome?.rawValue ?? NSNull()
                ] as [String: Any]
            }
        }
        return [
            "flow": state.flow.rawValue,
            "role": state.role?.rawValue ?? NSNull(),
            "roomId": state.roomId ?? NSNull(),
            "phase": state.phase?.rawValue ?? NSNull(),
            "step": state.step?.rawValue ?? NSNull(),
            "steps": rows(state.steps),
            "checklist": rows(state.checklist),
            "inviteConfirmed": state.inviteConfirmed,
            "showsTabBar": state.showsTabBar,
            "reason": state.reason ?? NSNull()
        ]
    }
}
