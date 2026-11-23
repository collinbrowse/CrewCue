import Foundation

/// Android's runner-setup ops (clients/behavior/onboarding-runner-setup.md). The conversion, the
/// daylight-saving check, the GPX parse and the moves between steps happen here or on the
/// server, never in the app.
///
/// - `raceStartInput`: the start-time step. Send the typed fields `year`, `month`, `day`, `hour`,
///   `minute` and `timeZone` (an IANA id; Android sends its device zone, which the Swift runtime
///   there cannot read), or `raceStartAt` + `timeZone` to read a saved start back into fields.
///   Answers `raceStartAt` (UTC, `Z`) or null, `problem` (`unknownZone`, `invalidDate`,
///   `daylightSavingGap`) or null, `message` (the shared copy, only for `daylightSavingGap`), the
///   fields, and `dateLabel` and `timeLabel`: the picked day and time as the pickers show them.
/// - `gpxPreview`: `roomId`, `fileName`, `gpxXml` → the server's parse (`POST
///   …/course/gpx-preview`) as `line`, `checkpoints`, `elevation`, `plannedPaceSecondsPerKm`,
///   `courseFileName` and `summary` (`OnboardingCopy.courseSummary`, "31.1 mi · 4 checkpoints"),
///   the shape `loadRoom` answers. Saves nothing. A blank file answers `status: empty` without a
///   request.
/// - The teaser's `loadEstimate`, `computeEstimate` (`finishClock`, `summary`, `comparison`) and
///   `projectAidSheet` (timeline `clockLabel`) write their clocks in `timeZone` (an IANA id):
///   Android sends the race's zone, the start time step's. Left out, the device zone.
/// - `raceAccess`: `roomId` (the active race), `role`, `billing?` (`paid` or `unpaid`, the last
///   billing read for this race; left out while unknown or after a failed read) and
///   `onboarding?` (the state `readOnboarding` answered: `flow`, `phase`, `roomId`, `reason`) →
///   `RaceAccess`: `unpaid`, `loadsRace`, `samplesLocation`, `gatesActions`, `lockedReason`.
/// - `suggestedDisplayName`: `name?` and `email?` from the sign-in identity, or a saved name with
///   no email → `name`, the name the account step suggests for crew (`SuggestedDisplayName`), or
///   null when it is an email or the email's local part, so the field starts empty.
/// - `runnerSetupStep`: one `RunnerSetupSteps` decision, named by `decision`, so Android moves
///   between the steps (Back, a reviewed step's Continue, a relaunch) by the same rules as iOS.
///   Pure, no request; only `courseFingerprint` reads a whole file, so run that one off Main.
///   Steps are `OnboardingStep` raw values (`account`, `course`, `startTime`, `history`,
///   `projectionTeaser`); a missing or unknown required step, or an unknown decision, fails with
///   status 400. Booleans left out are false; instants are `raceStartAt` strings.
///   - `navigation`: `frontier`, `reviewing?`, `raceExists` → `shown` (the step on screen),
///     `reviewing` (the step on screen while it is behind the frontier, else null), `previous`
///     (the step Back opens, null on the first) and `canGoBack`.
///   - `moveOn`: `frontier`, `reviewing?`, `next` (the step a Continue opened) → the new
///     `frontier` (it never moves back) and `reviewing` (null without one before, or once it meets
///     the frontier).
///   - `newRaceName`: `typed`, `listed?` → `name`, or null: a race is never named after its file.
///   - `courseFingerprint`: `xml` → `fingerprint`.
///   - `coursePick`: `fingerprint`, `held?`, `saved?` → `pick`: `unchanged`, `savedCourse` or
///     `newCourse`.
///   - `courseContinue`: `holdsPickedFile`, `previewed`, `courseSavedOnRace` → `action`:
///     `confirm`, `preview`, `keepSavedCourse` or `chooseFile`.
///   - `startUnsaved`: `draftHasStart`, `draftStart?`, `savedStart?` → `value`.
///   - `startTimeContinue`: `reviewing`, `editedThisVisit`, `courseUnsaved`, `courseSavedOnRace`,
///     `holdsCourseFile`, `start?`, `savedStart?` → `action`: `moveOn`, `saveStart` (`PATCH
///     …/race-start`, the `updateRaceStart` op), `saveCourse` (`PUT …/course` with the start),
///     `needsCourseFile` or `invalidStart`.
///   - `raceStartAdoption`: `draftHasStart`, `draftStart?`, `savedStart?`, `courseUnsaved`, and
///     the race list's `raceStart?` and `activatedAt?` → `adoption` (`keep`, `takeSaved`, `fill`)
///     and `raceStart`, the race's start as the server's clock reads it (`raceStartAt`, else the
///     legacy `activatedAt`), or null.
///   - `historyShowsContinue`: `reviewing`, `importedThisVisit`, `raceHasEstimate` → `value`.
///   - `historyContinue`: `reviewing`, `estimateDropped`, `importedThisVisit`,
///     `attachedThisVisit`, `raceHasEstimate` → `action`: `moveOn`, `keepRaceEstimate` or `recompute`.
///     `raceHasEstimate` is the race list's `OnboardingRace.hasEstimate`; left out, false.
///   - `resumeStep`: `frontier`, `courseUnsaved`, `coursePreviewed`, `startUnsaved`,
///     `estimateDropped` → `step`, the step a relaunch reopens, or null to stay on the frontier.
/// - `updateRaceStart`: `roomId`, `raceStartAt` → `PATCH /race-rooms/:roomId/race-start`, which
///   moves the attached estimate with the start: `status: saved` and `raceStartAt`, the start the
///   race now has. Abandoned after `raceStartDeadlineSeconds`, never cancelled (`Deadline`), as
///   offline. A 429 is the course save limit (`status` 429 in the failure).
extension RuntimeCall {
    static func raceStartInput(_ object: [String: Any]) -> Any {
        let zone = text(object, "timeZone") ?? DeviceTimeZone.current.identifier
        let input: RaceStartInput?
        if let saved = text(object, "raceStartAt"), object["year"] == nil {
            input = RaceStartInput(raceStartAt: saved, timeZoneIdentifier: zone)
        } else if let year = intValue(object["year"]), let month = intValue(object["month"]),
                  let day = intValue(object["day"]), let hour = intValue(object["hour"]),
                  let minute = intValue(object["minute"]) {
            input = RaceStartInput(year: year, month: month, day: day, hour: hour, minute: minute, timeZoneIdentifier: zone)
        } else {
            input = nil
        }
        guard let input else {
            let problem: RaceStartInput.Problem = DeviceTimeZone.resolve(zone) == nil ? .unknownZone : .invalidDate
            return [
                "raceStartAt": NSNull(), "problem": problemName(problem), "message": NSNull(), "timeZone": zone,
                "dateLabel": "", "timeLabel": ""
            ] as [String: Any]
        }
        let problem = input.problem
        return [
            "raceStartAt": input.raceStartAt ?? NSNull(),
            "problem": problem.map(problemName) ?? NSNull(),
            // Only the spring-forward gap has copy; the pickers can't produce the other problems.
            "message": problem == .daylightSavingGap ? OnboardingCopy.startTimeDstGap : NSNull(),
            "year": input.year,
            "month": input.month,
            "day": input.day,
            "hour": input.hour,
            "minute": input.minute,
            "timeZone": input.timeZoneIdentifier,
            "dateLabel": input.dateLabel(),
            "timeLabel": input.timeLabel()
        ] as [String: Any]
    }

    static func suggestedDisplayName(_ object: [String: Any]) -> Any {
        let name = SuggestedDisplayName.from(name: object["name"] as? String, email: object["email"] as? String)
        return ["name": name ?? NSNull()] as [String: Any]
    }

    static func raceAccess(_ object: [String: Any]) -> Any {
        let access = RaceAccess.resolve(
            roomId: text(object, "roomId"),
            role: text(object, "role"),
            billing: text(object, "billing").flatMap(RaceAccess.Billing.init(rawValue:)),
            onboarding: (object["onboarding"] as? [String: Any]).flatMap(accessOnboardingState)
        )
        return [
            "unpaid": access.unpaid,
            "loadsRace": access.loadsRace,
            "samplesLocation": access.samplesLocation,
            "gatesActions": access.gatesActions,
            "lockedReason": access.lockedReason ?? NSNull()
        ] as [String: Any]
    }

    /// The parts of a `readOnboarding` state that `RaceAccess` reads.
    private static func accessOnboardingState(_ object: [String: Any]) -> OnboardingState? {
        guard let flow = text(object, "flow").flatMap(OnboardingState.Flow.init(rawValue:)) else { return nil }
        return OnboardingState(
            flow: flow,
            role: text(object, "role").flatMap(OnboardingChoice.init(rawValue:)),
            roomId: text(object, "roomId"),
            phase: text(object, "phase").flatMap(OnboardingState.Phase.init(rawValue:)),
            step: text(object, "step").flatMap(OnboardingStep.init(rawValue:)),
            steps: [],
            checklist: [],
            inviteConfirmed: false,
            showsTabBar: boolValue(object["showsTabBar"]) ?? false,
            reason: text(object, "reason")
        )
    }

    private static func problemName(_ problem: RaceStartInput.Problem) -> String {
        switch problem {
        case .unknownZone: "unknownZone"
        case .invalidDate: "invalidDate"
        case .daylightSavingGap: "daylightSavingGap"
        }
    }

    /// How long a preview may take before the app is told it is offline. The request is
    /// abandoned, never cancelled (`Deadline`).
    static let gpxPreviewDeadlineSeconds = 45.0

    static func gpxPreview(_ object: [String: Any]) async throws -> Any {
        let gpxXml = object["gpxXml"] as? String ?? ""
        guard !gpxXml.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return ["status": "empty"]
        }
        guard let roomId = text(object, "roomId") else {
            throw ClientHTTPError(status: 400, message: "roomId is required.")
        }
        let graph = try graph(object)
        let fileName = text(object, "fileName") ?? "route.gpx"
        let data = try await Deadline.run(seconds: gpxPreviewDeadlineSeconds) {
            try await RaceDayAPI.previewCourse(graph: graph, roomId: roomId, fileName: fileName, gpxXml: gpxXml)
        }
        var payload = CoursePayload.preview(from: data)
        payload["status"] = "previewed"
        return payload
    }

    /// How long a start-only save may take before the app is told it is offline. The request is
    /// abandoned, never cancelled (`Deadline`).
    static let raceStartDeadlineSeconds = 45.0

    static func updateRaceStart(_ object: [String: Any]) async throws -> Any {
        guard let roomId = text(object, "roomId") else {
            throw ClientHTTPError(status: 400, message: "roomId is required.")
        }
        guard let raceStartAt = text(object, "raceStartAt") else {
            throw ClientHTTPError(status: 400, message: "raceStartAt is required.")
        }
        let graph = try graph(object)
        let room = try await Deadline.run(seconds: raceStartDeadlineSeconds) {
            try await RaceDayAPI.updateRaceStart(graph: graph, roomId: roomId, raceStartAt: raceStartAt)
        }
        return ["status": "saved", "raceStartAt": room.raceStartAt ?? raceStartAt]
    }

    static func runnerSetupStep(_ object: [String: Any]) throws -> Any {
        func flag(_ key: String) -> Bool { boolValue(object[key]) ?? false }
        func step(_ key: String) throws -> OnboardingStep {
            guard let value = optionalStep(key) else {
                throw ClientHTTPError(status: 400, message: "\(key) must be a runner setup step.")
            }
            return value
        }
        func optionalStep(_ key: String) -> OnboardingStep? {
            text(object, key).flatMap(OnboardingStep.init(rawValue:))
        }
        func name(_ value: OnboardingStep?) -> Any { value?.rawValue ?? NSNull() }
        switch text(object, "decision") {
        case "navigation":
            let frontier = try step("frontier")
            let shown = RunnerSetupSteps.shown(frontier: frontier, reviewing: optionalStep("reviewing"))
            return [
                "shown": shown.rawValue,
                "reviewing": name(shown == frontier ? nil : shown),
                "previous": name(RunnerSetupSteps.previous(shown)),
                "canGoBack": RunnerSetupSteps.canGoBack(from: shown, raceExists: flag("raceExists"))
            ] as [String: Any]
        case "moveOn":
            let next = try step("next")
            let frontier = RunnerSetupSteps.frontier(try step("frontier"), movingTo: next)
            let reviewing = optionalStep("reviewing") == nil ? nil : RunnerSetupSteps.reviewing(after: next, frontier: frontier)
            return ["frontier": frontier.rawValue, "reviewing": name(reviewing)] as [String: Any]
        case "newRaceName":
            let typed = object["typed"] as? String ?? ""
            return ["name": RunnerSetupSteps.newRaceName(typed: typed, listed: object["listed"] as? String) ?? NSNull()] as [String: Any]
        case "courseFingerprint":
            return ["fingerprint": RunnerSetupSteps.courseFingerprint(object["xml"] as? String ?? "")]
        case "coursePick":
            let pick = RunnerSetupSteps.coursePick(
                fingerprint: object["fingerprint"] as? String ?? "",
                held: text(object, "held"),
                saved: text(object, "saved")
            )
            return ["pick": coursePickName(pick)]
        case "courseContinue":
            let action = RunnerSetupSteps.courseContinue(
                holdsPickedFile: flag("holdsPickedFile"),
                previewed: flag("previewed"),
                courseSavedOnRace: flag("courseSavedOnRace")
            )
            return ["action": courseContinueName(action)]
        case "startUnsaved":
            return ["value": RunnerSetupSteps.startUnsaved(
                draftHasStart: flag("draftHasStart"),
                draftStart: text(object, "draftStart"),
                savedStart: text(object, "savedStart")
            )]
        case "startTimeContinue":
            let action = RunnerSetupSteps.startTimeContinue(
                reviewing: flag("reviewing"),
                editedThisVisit: flag("editedThisVisit"),
                courseUnsaved: flag("courseUnsaved"),
                courseSavedOnRace: flag("courseSavedOnRace"),
                holdsCourseFile: flag("holdsCourseFile"),
                start: text(object, "start"),
                savedStart: text(object, "savedStart")
            )
            return ["action": startTimeContinueName(action)]
        case "raceStartAdoption":
            let raceStart = OnboardingRace.raceClockStart(raceStartAt: text(object, "raceStart"), activatedAt: text(object, "activatedAt"))
            let adoption = RunnerSetupSteps.raceStartAdoption(
                draftHasStart: flag("draftHasStart"),
                draftStart: text(object, "draftStart"),
                savedStart: text(object, "savedStart"),
                raceStart: raceStart,
                courseUnsaved: flag("courseUnsaved")
            )
            return ["adoption": raceStartAdoptionName(adoption), "raceStart": raceStart ?? NSNull()] as [String: Any]
        case "historyShowsContinue":
            return ["value": RunnerSetupSteps.historyShowsContinue(
                reviewing: flag("reviewing"),
                importedThisVisit: flag("importedThisVisit"),
                raceHasEstimate: flag("raceHasEstimate")
            )]
        case "historyContinue":
            let action = RunnerSetupSteps.historyContinue(
                reviewing: flag("reviewing"),
                estimateDropped: flag("estimateDropped"),
                importedThisVisit: flag("importedThisVisit"),
                attachedThisVisit: flag("attachedThisVisit"),
                raceHasEstimate: flag("raceHasEstimate")
            )
            return ["action": action.rawValue]
        case "resumeStep":
            let open = RunnerSetupSteps.resumeStep(
                frontier: try step("frontier"),
                courseUnsaved: flag("courseUnsaved"),
                coursePreviewed: flag("coursePreviewed"),
                startUnsaved: flag("startUnsaved"),
                estimateDropped: flag("estimateDropped")
            )
            return ["step": name(open)] as [String: Any]
        default:
            throw ClientHTTPError(status: 400, message: "Unknown runner setup decision \(text(object, "decision") ?? "").")
        }
    }

    private static func coursePickName(_ pick: RunnerSetupSteps.CoursePick) -> String {
        switch pick {
        case .unchanged: "unchanged"
        case .savedCourse: "savedCourse"
        case .newCourse: "newCourse"
        }
    }

    private static func courseContinueName(_ action: RunnerSetupSteps.CourseContinue) -> String {
        switch action {
        case .confirm: "confirm"
        case .preview: "preview"
        case .keepSavedCourse: "keepSavedCourse"
        case .chooseFile: "chooseFile"
        }
    }

    private static func startTimeContinueName(_ action: RunnerSetupSteps.StartTimeContinue) -> String {
        switch action {
        case .moveOn: "moveOn"
        case .saveStart: "saveStart"
        case .saveCourse: "saveCourse"
        case .needsCourseFile: "needsCourseFile"
        case .invalidStart: "invalidStart"
        }
    }

    private static func raceStartAdoptionName(_ adoption: RunnerSetupSteps.RaceStartAdoption) -> String {
        switch adoption {
        case .keep: "keep"
        case .takeSaved: "takeSaved"
        case .fill: "fill"
        }
    }
}
