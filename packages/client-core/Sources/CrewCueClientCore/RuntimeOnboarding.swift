import Foundation

/// Android's onboarding ops. The state is decided here, so both apps follow one flow.
///
/// - `readOnboarding`: `signedIn?` (default: a `userId` is set), `pendingInvite?` (the pending
///   invite's token or code; left out, the saved pending join's code; `hasPendingInvite: true`
///   with no code saved is an invite that can't be confirmed signed out), `races?` (rows from
///   `myRaces`: `id`, `role`, `entitlementStatus`,
///   `raceStartAt?`, `activatedAt?`, `hasCourse`, `hasEstimate?`), `activeRoomId?`. Leave `races` out (or null)
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
/// - `resetOnboarding`: forgets the user's progress, or one race's with `roomId`. With
///   `choiceOnly: true` it forgets only the runner or crew pick (Back from the runner's first
///   setup step), and every marked step stays.
///
/// The pending invite: one per device, expiring after 7 days, and one user's at a time. Every op
/// below reads and saves it as the request's user (`userId`, signed out when it is blank or
/// `signedIn` is false). A code saved signed in is that user's; one saved signed out becomes the
/// first signed-in reader's, so it is joined by whoever signs in next. Another account's code
/// answers as none: hidden signed out, removed by a different signed-in user. A `pendingJoin`
/// answer is `{code, source, savedAt, expiresAt}` or null.
/// - `readOnboarding` and `markOnboardingStep` take the user's saved code as the pending invite
///   unless the request sends `pendingInvite` or `hasPendingInvite` (`false`: none; `true`: the
///   saved code, else one that can't be confirmed). `readOnboarding` also answers `pendingJoin`.
/// - `parseInviteLink`: `link` (the join page's https link, `crewcue://join/<code>`, or the Play
///   install-referrer string) → `code` and `source` (link, referrer), both null for anything else.
/// - `savePendingJoin`: `code` + `source?` (link, referrer, typed; default typed). Replaces any
///   earlier code. A code that isn't 6 digits fails.
/// - `readPendingJoin`, `clearPendingJoin`: answer `pendingJoin`. Clearing is device-wide.
/// - `giveUpInvite`: Back from the join screen or the sign-in after it. Clears the pending code
///   and the request's user's confirmed invite (and the signed-out guest's), so the same link
///   opened later shows the preview again and sign-in joins nothing. Answers `pendingJoin` (null)
///   and `state` as `readOnboarding` would.
/// - `resolvePendingJoin`: joins the user's saved code as the request's user (`baseURL`, `token`,
///   `userId`) and answers `outcome` (joined, alreadyMember, raceFull, raceLocked, invalidCode,
///   offline, signedOut, failed, nothingPending), `roomId`, `message`, `clearsCode` and
///   `pendingJoin`. joined, alreadyMember and invalidCode clear the code; the rest keep it. A
///   session the server refuses fails with `sessionExpired: true`, as every op does on a 401; the
///   code stays for that user's next sign-in.
///
/// - `inviteShare`: `roomId` → `state` (ready, empty, error, offline), `status` and `details`
///   (`InviteCopy.shareDetails`: `raceName`, `code`, `link`, `shareText`, `locked`), with `copy`.
/// - `confirmedInviteForSignIn`: `pendingJoin`, confirmed and current, read signed out before a
///   sign-in. `inviteJoinLine`: `raceName`, or `code` + `message` → `line`.
/// - `inviteCopy`: `copy`, every `InviteCopy` line by name. `pastedInviteCode`: `text` → `code`
///   (`InviteCopy.pastedCode`) or null. `parseInviteLink` also answers `joinLink`: the text is a
///   join link, read or not (`InviteLink.route`).
///
/// Progress and the pending invite live in `onboardingDir`, else `crewcue-onboarding` beside
/// `storageDir`, which sign-out and `adoptUser` never touch. `deleteAccount` removes the user's file.
extension RuntimeCall {
    static func readOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let read = try store.read(
            signedIn: onboardingSignedIn(object),
            userId: text(object, "userId"),
            races: onboardingRaces(object),
            activeRoomId: onboardingActiveRoom(object),
            now: SystemClock().now()
        ) { saved in onboardingInvite(object, saved: saved) }
        return [
            "state": onboardingJSON(read.state),
            "progress": read.progress.jsonObject,
            "pendingJoin": pendingJoinJSON(read.pendingJoin)
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
        let saved = store.pendingJoins.read(userId: userId, now: SystemClock().now())
        return [
            "progress": progress.jsonObject,
            "state": onboardingJSON(Onboarding.resolve(onboardingInput(object, progress: progress, saved: saved)))
        ] as [String: Any]
    }

    static func resetOnboarding(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
        if boolValue(object["choiceOnly"]) == true {
            return ["progress": try store.clearChoice(userId: userId).jsonObject]
        }
        try store.reset(userId: userId, roomId: text(object, "roomId"))
        return ["progress": store.load(userId: userId).jsonObject]
    }

    static func parseInviteLink(_ object: [String: Any]) -> Any {
        switch InviteLink.route(object["link"] as? String ?? "") {
        case .invite(let match):
            return ["code": match.code, "source": match.source.rawValue, "joinLink": true] as [String: Any]
        case .withoutCode:
            return ["code": NSNull(), "source": NSNull(), "joinLink": true] as [String: Any]
        case nil:
            // A referrer string isn't a URL, so `route` never reads it.
            guard let match = InviteLink.match(object["link"] as? String ?? "") else {
                return ["code": NSNull(), "source": NSNull(), "joinLink": false] as [String: Any]
            }
            return ["code": match.code, "source": match.source.rawValue, "joinLink": false] as [String: Any]
        }
    }

    static func savePendingJoin(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object).pendingJoins
        let name = text(object, "source") ?? InviteSource.typed.rawValue
        guard let source = InviteSource(rawValue: name) else {
            throw ClientHTTPError(status: 400, message: "Unknown invite source \(name).")
        }
        do {
            let saved = try store.save(
                code: object["code"] as? String ?? "", source: source, userId: pendingJoinUser(object), now: SystemClock().now()
            )
            return ["pendingJoin": pendingJoinJSON(saved)]
        } catch let error as PendingJoinError {
            throw ClientHTTPError(status: 400, message: error.message)
        }
    }

    static func readPendingJoin(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object).pendingJoins
        return ["pendingJoin": pendingJoinJSON(store.read(userId: pendingJoinUser(object), now: SystemClock().now()))]
    }

    static func giveUpInvite(_ object: [String: Any]) throws -> Any {
        let store = try onboardingStore(object)
        try store.giveUpInvite(userId: onboardingSignedIn(object) ? text(object, "userId") : nil)
        guard var answer = try readOnboarding(object) as? [String: Any] else { return ["pendingJoin": NSNull()] }
        answer["pendingJoin"] = NSNull()
        return answer
    }

    static func clearPendingJoin(_ object: [String: Any]) throws -> Any {
        try onboardingStore(object).pendingJoins.clear()
        return ["pendingJoin": NSNull()]
    }

    /// `resolve` runs each request under `Deadline`, so a dead connection never holds the bridge
    /// thread for long and no URLSession task is cancelled.
    static func resolvePendingJoin(_ object: [String: Any]) async throws -> Any {
        // A replay's host answers for its scripted race, never for the invite's.
        guard demoURL(object) == nil else { throw DemoRaceError.readOnly("the replay never joins a race") }
        let store = try onboardingStore(object).pendingJoins
        let userId = pendingJoinUser(object)
        let outcome = await store.resolve(graph: try graph(object), userId: userId)
        // With a user and a token sent, `signedOut` is the server's 401: fail the way every op
        // does on one, so the app ends the session. The code stays, still this user's: another
        // account signing in next never gets it.
        if outcome == .signedOut, userId != nil, text(object, "token") != nil {
            throw ClientHTTPError(status: 401, message: PendingJoinOutcome.signedOutMessage)
        }
        return [
            "outcome": outcome.name,
            "roomId": outcome.roomId ?? NSNull(),
            "message": outcome.message ?? NSNull(),
            "clearsCode": outcome.clearsCode,
            "pendingJoin": pendingJoinJSON(store.read(userId: userId, now: SystemClock().now()))
        ] as [String: Any]
    }

    /// The runner's invite for `roomId` (`GET /race-rooms/:roomId`, `InviteCopy.shareDetails`):
    /// `state` ready, empty (no join code yet), error or offline, with `details` when ready.
    static func inviteShare(_ object: [String: Any]) async throws -> Any {
        let roomId = text(object, "roomId") ?? ""
        let details: InviteShareDetails?
        do {
            let graph = try graph(object)
            // Never cancelled on a dead connection: cancelling a URLSession task deadlocks on Android.
            let room = try await Deadline.run(seconds: PendingJoinStore.deadlineSeconds) {
                try await RaceDayAPI.loadRoom(graph: graph, roomId: roomId).room
            }
            details = InviteCopy.shareDetails(for: room)
        } catch {
            let offline = PendingJoinOutcome.outcome(for: error) == .offline
            return [
                "state": offline ? "offline" : "error",
                "status": offline ? InviteCopy.shareOffline : InviteCopy.shareError,
                "details": NSNull(),
                "copy": inviteCopyJSON()
            ] as [String: Any]
        }
        guard let details else {
            return ["state": "empty", "status": InviteCopy.shareEmpty, "details": NSNull(), "copy": inviteCopyJSON()] as [String: Any]
        }
        return [
            "state": "ready",
            "status": details.status,
            "details": [
                "raceName": details.raceName,
                "code": details.code,
                "link": details.link.absoluteString,
                "shareText": details.shareText,
                "locked": details.locked
            ] as [String: Any],
            "copy": inviteCopyJSON()
        ] as [String: Any]
    }

    /// Read before a sign-in's first onboarding read: the guest's pending code, confirmed (Sign up
    /// to join) within `OnboardingProgress.confirmedInviteLifetime`, else null.
    static func confirmedInviteForSignIn(_ object: [String: Any]) throws -> Any {
        ["pendingJoin": pendingJoinJSON(try onboardingStore(object).confirmedInviteForSignIn(now: SystemClock().now()))]
    }

    /// A join that answered after the screen moved on to another code: `InviteCopy.joinedRace`
    /// with `raceName`, or `InviteCopy.joinFailed` with `code` and `message`.
    static func inviteJoinLine(_ object: [String: Any]) -> Any {
        if let message = text(object, "message") {
            return ["line": InviteCopy.joinFailed(code: text(object, "code") ?? "", message: message)]
        }
        return ["line": InviteCopy.joinedRace(object["raceName"] as? String ?? "")]
    }

    /// Every `InviteCopy` line Android shows, by name.
    static func inviteCopyJSON() -> [String: String] {
        [
            "shareTitle": InviteCopy.shareTitle,
            "shareDetail": InviteCopy.shareDetail,
            "shareReady": InviteCopy.shareReady,
            "shareEmpty": InviteCopy.shareEmpty,
            "shareError": InviteCopy.shareError,
            "shareOffline": InviteCopy.shareOffline,
            "shareLocked": InviteCopy.shareLocked,
            "shareButton": InviteCopy.shareButton,
            "copyCode": InviteCopy.copyCode,
            "codeCopied": InviteCopy.codeCopied,
            "codeLabel": InviteCopy.codeLabel,
            "linkLabel": InviteCopy.linkLabel,
            "joinLinkTitle": InviteCopy.joinLinkTitle,
            "linkWithoutCode": InviteCopy.linkWithoutCode,
            "pasteLabel": InviteCopy.pasteLabel,
            "pasteNoCode": InviteCopy.pasteNoCode,
            "signUpToJoin": InviteCopy.signUpToJoin,
            "signUpToJoinDetail": InviteCopy.signUpToJoinDetail,
            "joining": InviteCopy.joining,
            "joinTitle": InviteCopy.joinTitle,
            "joinPrompt": InviteCopy.joinPrompt,
            "joinEmpty": InviteCopy.joinEmpty,
            "joinReady": InviteCopy.joinReady,
            "joinPreviewOffline": InviteCopy.joinPreviewOffline,
            "joinNotFound": InviteCopy.joinNotFound,
            "joinButton": InviteCopy.joinButton,
            "previewPlaceholder": InviteCopy.previewPlaceholder,
            "inviteCrewButton": InviteCopy.inviteCrewButton,
            "backToMembers": InviteCopy.backToMembers
        ]
    }

    static func pendingJoinJSON(_ pending: PendingJoin?) -> Any {
        guard let pending else { return NSNull() }
        return [
            "code": pending.code,
            "source": pending.source.rawValue,
            "savedAt": RaceDayReadouts.iso8601(pending.savedAt),
            "expiresAt": RaceDayReadouts.iso8601(pending.expiresAt)
        ]
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

    /// Whose pending join the request reads and saves: its `userId`, nil when signed out.
    private static func pendingJoinUser(_ object: [String: Any]) -> String? {
        onboardingSignedIn(object) ? text(object, "userId") : nil
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
                hasCourse: boolValue(row["hasCourse"]) ?? false,
                hasEstimate: boolValue(row["hasEstimate"]) ?? false
            )
        }
    }

    private static func onboardingInput(_ object: [String: Any], progress: OnboardingProgress, saved: PendingJoin?) -> OnboardingInput {
        OnboardingInput(
            signedIn: onboardingSignedIn(object),
            userId: text(object, "userId"),
            pendingInvite: onboardingInvite(object, saved: saved),
            races: onboardingRaces(object),
            activeRoomId: onboardingActiveRoom(object),
            progress: progress
        )
    }

    private static func onboardingActiveRoom(_ object: [String: Any]) -> String? {
        text(object, "activeRoomId") ?? text(object, "roomId")
    }

    /// The request's `pendingInvite` as named. Else `hasPendingInvite`: `false` is none, `true` the
    /// saved code or, with none saved, an invite that can't be confirmed (""). Neither sent: the
    /// saved code.
    private static func onboardingInvite(_ object: [String: Any], saved: PendingJoin?) -> String? {
        if let named = text(object, "pendingInvite") { return named }
        switch boolValue(object["hasPendingInvite"]) {
        case .some(true): return saved?.code ?? ""
        case .some(false): return nil
        case nil: return saved?.code
        }
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
