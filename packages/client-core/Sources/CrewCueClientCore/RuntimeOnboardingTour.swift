import Foundation

/// Android's tour ops (clients/behavior/onboarding-runner-tour.md, onboarding-crew.md). The card,
/// the outcomes, the location test and the setup checklist are decided here (`OnboardingTour`,
/// `LocationTest`, `SetupChecklistPolicy`); the app shows what the ops answer.
///
/// Every tour op reads one of two sources:
/// - the saved progress: the same fields as `readOnboarding` (`userId`, `races`, `activeRoomId`, …);
/// - `dev`: `{role: runner | crew, answers: {step: outcome}}`, the dev route's tour on the example
///   race. Nothing is saved: the answers live in the request and come back as `dev`, which the app
///   keeps and sends again.
///
/// Each answers `state` (as `readOnboarding`), `card` (the tour card, or null outside the tour),
/// `checklist` (the setup checklist card, or null) and `progress` (saved source) or `dev`.
/// `notificationsOn` and `locationAlways` are what the phone knows for the checklist.
///
/// - `onboardingTour`: reads.
/// - `onboardingTourAnswer`: `step` (the card answered: a stale step changes nothing) and one of
///   `outcome` (done, skipped, deferred), `notificationsAllowed` (`OnboardingTour.notificationsOutcome`)
///   or `locationTest` (a `locationTest` object: its outcome). None of them is done.
/// - `onboardingTourSkip`: Skip tour (`OnboardingTour.skipAll`).
/// - `setupChecklistOpen`: `item` (a `SetupChecklistItemKind`): saves the step the item names, if any.
/// - `setupChecklistHide`: Hide, for this race.
/// - `tourNotificationsOutcome`: `allowed` → `outcome`.
/// - `locationTest`: `test` (the last answer's `test`, or null), `event` (start, permission, pingSent,
///   pingQueuedOffline, tick, read), `alreadyTracking` (start), `permission` (notDetermined, denied,
///   whenInUse, always), `now?` (ISO, tests) → `test` plus `phase`, `message`, `primaryLabel`,
///   `secondaryLabel`, `isRunning`, `stopsTracking`, `waitsForAlways`, `outcome`.
/// - `onboardingTourCopy`: `tour`, `locationTest` and `checklist` copy by name.
extension RuntimeCall {
    /// The dev route's race: the example race, paid, with a course.
    static let tourDevRoomId = "dev-tour"

    static func onboardingTour(_ object: [String: Any]) throws -> Any {
        try tourAnswer(object, source: tourSource(object)) { _, _ in }
    }

    static func onboardingTourAnswer(_ object: [String: Any]) throws -> Any {
        let source = try tourSource(object)
        return try tourAnswer(object, source: source) { state, mark in
            guard let raw = text(object, "step"), let step = OnboardingStep(rawValue: raw) else {
                throw ClientHTTPError(status: 400, message: "Unknown tour step.")
            }
            // A second tap on a card already answered: the tour has moved on.
            guard state.phase == .tour, state.step == step else { return }
            try mark(step, tourOutcome(object))
        }
    }

    static func onboardingTourSkip(_ object: [String: Any]) throws -> Any {
        try tourAnswer(object, source: tourSource(object)) { state, mark in
            for item in OnboardingTour.skipAll(state) { try mark(item.step, item.outcome) }
        }
    }

    static func setupChecklistOpen(_ object: [String: Any]) throws -> Any {
        try tourAnswer(object, source: tourSource(object)) { state, mark in
            guard let raw = text(object, "item"), let kind = SetupChecklistItemKind(rawValue: raw) else {
                throw ClientHTTPError(status: 400, message: "Unknown checklist item.")
            }
            guard let step = kind.step, state.status(step)?.outcome != .done else { return }
            try mark(step, .done)
        }
    }

    static func setupChecklistHide(_ object: [String: Any]) throws -> Any {
        try tourAnswer(object, source: tourSource(object)) { state, mark in
            guard state.roomId != nil else { return }
            try mark(.setupChecklist, .skipped)
        }
    }

    static func tourNotificationsOutcome(_ object: [String: Any]) -> Any {
        ["outcome": OnboardingTour.notificationsOutcome(allowed: boolValue(object["allowed"]) ?? false).rawValue]
    }

    static func locationTestStep(_ object: [String: Any]) throws -> Any {
        let now = text(object, "now").flatMap(ScheduleFormat.parseISO8601) ?? SystemClock().now()
        var (test, sentAt) = locationTest(object["test"] as? [String: Any])
        let before = test.phase
        switch text(object, "event") ?? "read" {
        case "start":
            test.start(alreadyTracking: boolValue(object["alreadyTracking"]) ?? false, at: now)
            sentAt = nil
        case "permission":
            guard let raw = text(object, "permission"), let permission = LocationTest.Permission(rawValue: raw) else {
                throw ClientHTTPError(status: 400, message: "Unknown location permission.")
            }
            test.permission(permission)
        case "pingSent": test.pingSent()
        case "pingQueuedOffline": test.pingQueuedOffline()
        case "tick": test.tick(now: now)
        case "read": break
        case let other: throw ClientHTTPError(status: 400, message: "Unknown location test event \(other).")
        }
        if test.phase == .sent, before != .sent { sentAt = now }
        return locationTestJSON(test, sentAt: sentAt, now: now)
    }

    static func onboardingTourCopy(_ object: [String: Any]) -> Any {
        let tour = OnboardingTourCopy.self
        let location = LocationTestCopy.self
        return [
            "tour": [
                "next": tour.next, "done": tour.done, "later": tour.later, "notNow": tour.notNow,
                "skipTour": tour.skipTour, "shareInvite": tour.shareInvite,
                "turnOnNotifications": tour.turnOnNotifications, "testTrackingNow": tour.testTrackingNow,
                "onRaceMorning": tour.onRaceMorning, "tryAgain": tour.tryAgain,
                "exampleHeading": tour.exampleHeading, "notificationsOn": tour.notificationsOn,
                "notificationsOff": tour.notificationsOffAndroid, "inviteLoading": tour.inviteLoading
            ],
            "locationTest": [
                "asking": location.asking, "waiting": location.waiting, "waitingWhenInUse": location.waitingWhenInUse,
                "sent": location.sent, "sentWhenInUse": location.sentWhenInUse,
                "sentStillTracking": location.sentStillTracking, "denied": location.denied,
                "offline": location.offline, "failed": location.failed
            ],
            "checklist": [
                "title": SetupChecklist.title, "hide": SetupChecklist.hide,
                "show": SetupChecklist.show, "showLess": SetupChecklist.showLess
            ]
        ] as [String: Any]
    }

    // MARK: Source

    /// Where a tour op reads and saves: the user's saved progress, or the dev route's answers.
    enum TourSource {
        case saved(OnboardingStore)
        case dev(OnboardingChoice, [OnboardingStep: OnboardingOutcome])
    }

    static func tourSource(_ object: [String: Any]) throws -> TourSource {
        if let dev = object["dev"] as? [String: Any] {
            guard let role = text(dev, "role").flatMap(OnboardingChoice.init(rawValue:)) else {
                throw ClientHTTPError(status: 400, message: "The dev tour needs a role (runner or crew).")
            }
            var answers: [OnboardingStep: OnboardingOutcome] = [:]
            for (key, value) in dev["answers"] as? [String: Any] ?? [:] {
                guard let step = OnboardingStep(rawValue: key),
                      let outcome = (value as? String).flatMap(OnboardingOutcome.init(rawValue:)) else { continue }
                answers[step] = outcome
            }
            return .dev(role, answers)
        }
        return .saved(try onboardingStore(object))
    }

    /// Reads the source, lets `change` save steps (`mark`), then answers what the app shows.
    private static func tourAnswer(
        _ object: [String: Any],
        source: TourSource,
        change: (OnboardingState, (OnboardingStep, OnboardingOutcome) throws -> Void) throws -> Void
    ) throws -> Any {
        let facts = SetupChecklistFacts(
            notificationsOn: boolValue(object["notificationsOn"]) ?? false,
            locationAlways: boolValue(object["locationAlways"]) ?? false
        )
        let zone = requestTimeZone(object)
        switch source {
        case .saved(let store):
            let userId = onboardingSignedIn(object) ? text(object, "userId") : nil
            let first = try savedRead(object, store: store)
            var marked = false
            do {
                try change(first.state) { step, outcome in
                    try store.mark(step, outcome: outcome, roomId: first.state.roomId, role: first.state.role, userId: userId)
                    marked = true
                }
            } catch let error as OnboardingError {
                throw ClientHTTPError(status: 400, message: error.message)
            }
            let read = marked ? try savedRead(object, store: store) : first
            var answer = tourJSON(state: read.state, progress: read.progress, facts: facts, zone: zone)
            answer["progress"] = read.progress.jsonObject
            return answer
        case .dev(let role, var answers):
            let first = devTour(role, answers)
            do {
                try change(first.state) { step, outcome in
                    var check = first.progress
                    try check.record(step, outcome: outcome, roomId: tourDevRoomId, role: role)
                    answers[step] = outcome
                }
            } catch let error as OnboardingError {
                throw ClientHTTPError(status: 400, message: error.message)
            }
            let read = devTour(role, answers)
            var answer = tourJSON(state: read.state, progress: read.progress, facts: facts, zone: zone)
            answer["dev"] = [
                "role": role.rawValue,
                "answers": Dictionary(uniqueKeysWithValues: answers.map { ($0.key.rawValue, $0.value.rawValue) })
            ] as [String: Any]
            return answer
        }
    }

    private static func savedRead(_ object: [String: Any], store: OnboardingStore) throws -> OnboardingRead {
        try store.read(
            signedIn: onboardingSignedIn(object),
            userId: text(object, "userId"),
            races: onboardingRaces(object),
            activeRoomId: onboardingActiveRoom(object),
            now: SystemClock().now()
        ) { saved in onboardingInvite(object, saved: saved) }
    }

    /// The dev route's state: a signed-in member of the paid example race who finished setup.
    static func devTour(_ role: OnboardingChoice, _ answers: [OnboardingStep: OnboardingOutcome]) -> (state: OnboardingState, progress: OnboardingProgress) {
        var progress = OnboardingProgress.empty
        progress.account[.account] = .done
        for (step, outcome) in answers.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            try? progress.record(step, outcome: outcome, roomId: tourDevRoomId, role: role)
        }
        let race = OnboardingRace(
            roomId: tourDevRoomId,
            role: role == .runner ? "athlete" : "crew_member",
            entitlementStatus: "paid",
            raceStartAt: DemoRaceFixture.raceStartAt,
            hasCourse: true,
            hasEstimate: true
        )
        let state = Onboarding.resolve(OnboardingInput(
            signedIn: true, userId: "dev", races: [race], activeRoomId: tourDevRoomId, progress: progress
        ))
        return (state, progress)
    }

    private static func tourOutcome(_ object: [String: Any]) throws -> OnboardingOutcome {
        if let raw = text(object, "outcome") {
            guard let outcome = OnboardingOutcome(rawValue: raw) else {
                throw ClientHTTPError(status: 400, message: "Unknown onboarding outcome \(raw).")
            }
            return outcome
        }
        if let allowed = boolValue(object["notificationsAllowed"]) {
            return OnboardingTour.notificationsOutcome(allowed: allowed)
        }
        if let saved = object["locationTest"] as? [String: Any] {
            guard let outcome = locationTest(saved).test.outcome else {
                throw ClientHTTPError(status: 400, message: "The location test is still running.")
            }
            return outcome
        }
        return .done
    }

    // MARK: JSON

    private static func tourJSON(state: OnboardingState, progress: OnboardingProgress, facts: SetupChecklistFacts, zone: TimeZone) -> [String: Any] {
        let checklist = SetupChecklistPolicy.make(state: state, progress: progress, facts: facts)
        // Only the crew tour shows the example race; its clock times are formatted on demand.
        let demo = state.phase == .tour && state.role == .crew
            ? CrewTourDemo.fixture(timeZone: zone)
            : CrewTourDemo(runnerName: "", mileText: "", lastUpdateAge: "", nextAid: "", nextAidAheadText: "", etaClock: "", planClock: "")
        return [
            "state": onboardingJSON(state),
            "card": OnboardingTour.card(for: state, demo: demo).map(cardJSON) ?? NSNull(),
            "checklist": checklist.map(checklistJSON) ?? NSNull()
        ]
    }

    static func cardJSON(_ card: TourCard) -> [String: Any] {
        [
            "step": card.step.rawValue,
            "role": card.role.rawValue,
            "anchor": card.anchor?.rawValue ?? NSNull(),
            "anchorIdentifier": card.anchor?.accessibilityIdentifier ?? NSNull(),
            "title": card.title,
            "body": card.body,
            "action": card.action.rawValue,
            "primaryLabel": card.primaryLabel,
            "secondaryLabel": card.secondaryLabel ?? NSNull(),
            "secondaryOutcome": card.secondaryOutcome?.rawValue ?? NSNull(),
            "exampleHeading": card.example.isEmpty ? NSNull() : OnboardingTourCopy.exampleHeading,
            "example": card.example.map { ["label": $0.label, "value": $0.value] },
            "position": card.position,
            "count": card.count,
            "progressLabel": card.progressLabel,
            // Skip tour is on every card but the last.
            "skipLabel": card.position < card.count ? OnboardingTourCopy.skipTour : NSNull(),
            "accessibilityIdentifier": card.accessibilityIdentifier
        ]
    }

    static func checklistJSON(_ checklist: SetupChecklist) -> [String: Any] {
        [
            "title": SetupChecklist.title,
            "summary": checklist.summary,
            "doneCount": checklist.doneCount,
            "count": checklist.items.count,
            "next": checklist.next?.rawValue ?? NSNull(),
            "show": SetupChecklist.show,
            "showLess": SetupChecklist.showLess,
            "hide": SetupChecklist.hide,
            "items": checklist.items.map { item in
                [
                    "kind": item.kind.rawValue,
                    "title": item.kind.title,
                    "detail": item.kind.detail,
                    "done": item.done,
                    "opens": checklistDestination(item.kind),
                    "accessibilityIdentifier": item.kind.accessibilityIdentifier
                ] as [String: Any]
            }
        ]
    }

    /// What opening an item shows: the invite share, Edit planned stops on Pace, Place checkpoint
    /// on Map, the notification prompt, or Map's Tracking tool.
    private static func checklistDestination(_ kind: SetupChecklistItemKind) -> String {
        switch kind {
        case .invites: "inviteShare"
        case .etaEdits: "paceStopEdit"
        case .checkpointDetails: "mapCheckpointPick"
        case .notifications: "notifications"
        case .location: "mapTracking"
        }
    }

    /// A `test` object back into the test, and when its ping was sent.
    private static func locationTest(_ object: [String: Any]?) -> (test: LocationTest, sentAt: Date?) {
        guard let object, let phase = text(object, "phase").flatMap(LocationTest.Phase.init(rawValue:)) else {
            return (LocationTest(), nil)
        }
        let test = LocationTest(
            phase: phase,
            whenInUseOnly: boolValue(object["whenInUseOnly"]) ?? false,
            wasTracking: boolValue(object["wasTracking"]) ?? false,
            startedAt: text(object, "startedAt").flatMap(ScheduleFormat.parseISO8601)
        )
        return (test, text(object, "sentAt").flatMap(ScheduleFormat.parseISO8601))
    }

    private static func locationTestJSON(_ test: LocationTest, sentAt: Date?, now: Date) -> [String: Any] {
        func iso(_ date: Date?) -> Any { date.map(RaceDayReadouts.iso8601) ?? NSNull() }
        return [
            "test": [
                "phase": test.phase.rawValue,
                "whenInUseOnly": test.whenInUseOnly,
                "wasTracking": test.wasTracking,
                "startedAt": iso(test.startedAt),
                "sentAt": iso(sentAt)
            ] as [String: Any],
            "phase": test.phase.rawValue,
            "message": test.message ?? NSNull(),
            "primaryLabel": test.primaryLabel ?? NSNull(),
            "secondaryLabel": OnboardingTourCopy.onRaceMorning,
            "isRunning": test.isRunning,
            "stopsTracking": test.stopsTracking,
            "waitsForAlways": sentAt.map { test.waitsForAlways(sentAt: $0, now: now) } ?? false,
            "outcome": test.outcome?.rawValue ?? NSNull(),
            "timeoutSeconds": LocationTest.timeoutSeconds,
            "alwaysPromptSeconds": LocationTest.alwaysPromptSeconds
        ]
    }
}
