import Foundation

/// Android's onboarding ops. The state is decided here, so both apps follow one flow.
///
/// - `readOnboarding`: `signedIn?` (default: a `userId` is set), `hasPendingInvite`, `races`
///   (rows from `myRaces`: `id`, `role`, `entitlementStatus`, `raceStartAt?`, `hasCourse`),
///   `activeRoomId?`. A signed-in read first adopts the signed-out guest's progress.
/// - `markOnboardingStep`: `step` + `outcome?` (done, skipped, deferred) + `roomId?` for a
///   per-race step, or `choice` (runner, crew) for the chooser. Answers `progress`, plus `state`
///   when the request carries `races`.
/// - `resetOnboarding`: forgets the user's progress, or one race's with `roomId`.
///
/// Progress lives in `onboardingDir`, else `crewcue-onboarding` beside `storageDir`, which
/// sign-out and `adoptUser` never touch.
extension RuntimeCall {
    static func readOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let progress: OnboardingProgress
        if onboardingSignedIn(object), let userId = text(object, "userId") {
            progress = try store.adoptGuest(userId: userId)
        } else {
            progress = store.load(userId: nil)
        }
        return [
            "state": onboardingJSON(Onboarding.resolve(onboardingInput(object, progress: progress))),
            "progress": progress.jsonObject
        ] as [String: Any]
    }

    static func markOnboardingStep(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
        let progress: OnboardingProgress
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
                progress = try store.mark(step, outcome: outcome, roomId: text(object, "roomId"), userId: userId)
            }
        } catch let error as OnboardingError {
            throw ClientHTTPError(status: 400, message: error.message)
        }
        var payload: [String: Any] = ["progress": progress.jsonObject]
        if object["races"] != nil {
            payload["state"] = onboardingJSON(Onboarding.resolve(onboardingInput(object, progress: progress)))
        }
        return payload
    }

    static func resetOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
        try store.reset(userId: userId, roomId: text(object, "roomId"))
        return ["progress": store.load(userId: userId).jsonObject]
    }

    /// The real app-level directory, read from the request as sent: a demo runtime's storage
    /// redirect never applies, since onboarding progress is not replay data.
    private static func onboardingStore(_ object: [String: Any]) throws -> OnboardingStore {
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

    private static func onboardingInput(_ object: [String: Any], progress: OnboardingProgress) -> OnboardingInput {
        let rows = (object["races"] as? [Any]) ?? []
        let races = rows.compactMap { item -> OnboardingRace? in
            guard let row = item as? [String: Any],
                  let roomId = text(row, "roomId") ?? text(row, "id") else { return nil }
            let entitlement = text(row, "entitlementStatus")
                ?? ((row["entitlement"] as? [String: Any]).flatMap { text($0, "status") })
            return OnboardingRace(
                roomId: roomId,
                role: text(row, "role") ?? "crew_member",
                entitlementStatus: entitlement ?? "unpaid",
                raceStartAt: text(row, "raceStartAt"),
                hasCourse: boolValue(row["hasCourse"]) ?? false
            )
        }
        return OnboardingInput(
            signedIn: onboardingSignedIn(object),
            userId: text(object, "userId"),
            hasPendingInvite: boolValue(object["hasPendingInvite"]) ?? false,
            races: races,
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
            "showsTabBar": state.showsTabBar
        ]
    }
}
