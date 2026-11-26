import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#elseif canImport(Android)
import Android
#endif
#if canImport(Dispatch)
import Dispatch
#endif

/// JSON RPC used by Android. iOS calls `RaceDayAPI` directly.
/// `op` is one of openSession, loadSchedule, loadEstimate, decideEstimate, computeEstimate,
/// importGpx, enqueueGpx, enqueueCheckIn, flushOutbox, listOutbox, exportCrewSheet,
/// projectAidSheet, stopPlanDraft, updatePlannedStops,
/// courseReadout, featureScreen, previewJoin, join,
/// myRaces, loadRoom, latestPing, placeCheckpoint, route, enqueuePing, parseMentions,
/// notificationPreference, saveNotificationPreference, enqueuePush, enqueueChat,
/// chatPoll, chatSend, chatUploadPhoto, chatOlder, chatDiscard,
/// completeOutbox, wipeUserData, adoptUser, updateDisplayName, removeMember,
/// incidents, createIncident, stravaStart, stravaConnection, stravaDisconnect, deleteAccount, accountDeletionCopy, deleteRace, raceDeletionCopy, renameRace, raceRenameCopy, onboardingCopy, onboardingHistoryComparison, pingTrack,
/// liveProjection, trackingSettings, setTrackingSettings, trackingSession, startTrackingSession,
/// stopTrackingSession, featureFlags, activityHistoryItems, importActivityFile,
/// previewActivityUpload, importActivityUpload, deleteActivity, activityDeleteCopy,
/// readOnboarding, markOnboardingStep, resetOnboarding, parseInviteLink, savePendingJoin,
/// readPendingJoin, clearPendingJoin, giveUpInvite, resolvePendingJoin, inviteShare, inviteCopy,
/// pastedInviteCode, confirmedInviteForSignIn, inviteJoinLine (`RuntimeOnboarding.swift`),
/// demoRaceCreate, demoRacePlay, demoRacePause, demoRaceTick, demoRaceSkip, demoRaceSeek, demoRaceRunner, demoRaceCleanup
/// (`RuntimeDemoRace.swift`),
/// raceStartInput, gpxPreview, raceAccess, suggestedDisplayName, runnerSetupStep, updateRaceStart
/// (`RuntimeRunnerSetup.swift`),
/// pushTapReceive, pushTapTake, unpaidExpiry (`RuntimePushTap.swift`),
/// onboardingTour, onboardingTourAnswer, onboardingTourSkip, setupChecklistOpen, setupChecklistHide,
/// tourNotificationsOutcome, locationTest, tourCardView, onboardingTourCopy (`RuntimeOnboardingTour.swift`).
///
/// `storageDir` is the app's storage root. Per-user files live under `UserStorage(root:)` keyed
/// by `userId`. A failure on a 401 carries `sessionExpired: true` so the app wipes the session.
/// A `baseURL` from `demoRaceCreate` runs the same ops against that race-day replay instead.
enum RuntimeCall {
    private final class TransportBox: @unchecked Sendable {
        private let lock = NSLock()
        private var transport: (any HTTPTransport)?
        private var byBaseURL: [String: any HTTPTransport] = [:]

        func get(baseURL: String) -> (any HTTPTransport)? {
            lock.lock()
            defer { lock.unlock() }
            return byBaseURL[baseURL] ?? transport
        }

        func set(_ transport: (any HTTPTransport)?, baseURL: String?) {
            lock.lock()
            defer { lock.unlock() }
            if let baseURL {
                byBaseURL[baseURL] = transport
            } else {
                self.transport = transport
            }
        }
    }

    /// Tests inject a transport, for every request or only for one `baseURL` (so parallel tests
    /// don't see each other's fake server). Production calls leave this nil and use `URLSessionTransport`.
    private static let transportForTests = TransportBox()

    static func setTransportForTests(_ transport: (any HTTPTransport)?, baseURL: String? = nil) {
        transportForTests.set(transport, baseURL: baseURL)
    }

    static func perform(_ json: String) async -> String {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let op = object["op"] as? String else {
            return #"{"ok":false,"message":"Invalid runtime request."}"#
        }
        // A replay op that began before the replay ended can write after it: sweep once it returns.
        let demo = demoRace(object)
        defer { sweepDemo(demo) }
        do {
            let value = try await dispatch(op, object)
            let encoded = try JSONSerialization.data(withJSONObject: ["ok": true, "result": value])
            return String(decoding: encoded, as: UTF8.self)
        } catch {
            // A replay that can't start names the checklist state it shows instead.
            return failureJSON(error, replayState: op == "demoRaceCreate")
        }
    }

    /// `replayState`: add `state`, the checklist state (`empty`, `error` or `offline`) a replay
    /// that can't start shows (`DemoRace.unavailableState`), so Android never maps errors itself.
    static func failureJSON(_ error: any Error, replayState: Bool = false) -> String {
        let message: String
        if let authority = error as? PlanAuthorityError {
            message = authority.message
        } else if let demo = error as? DemoRaceError {
            message = demo.message
        } else {
            message = (error as? ClientHTTPError)?.message ?? "\(error)"
        }
        let http = error as? ClientHTTPError
        let expired = http?.status == 401
        var object: [String: Any] = [
            "ok": false,
            "message": message,
            "sessionExpired": expired,
            "crewLimit": BillingErrors.isCrewLimit(error),
            "offline": TransportFailure.isOffline(error),
            // The HTTP status, 0 when the failure isn't an HTTP answer. With `code`, the body's
            // code (402 `room_unpaid`, 400 `course_mismatch`), Android branches on these instead
            // of on server wording.
            "status": http?.status ?? 0
        ]
        if let code = http?.reason ?? http?.decision, !code.isEmpty {
            object["code"] = code
        }
        if replayState {
            object["state"] = DemoRace.unavailableState(error).rawValue
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
            return #"{"ok":false,"message":"Request failed."}"#
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func dispatch(_ op: String, _ object: [String: Any]) async throws -> Any {
        switch op {
        case "billing":
            let state = try await RaceDayAPI.billing(graph: try graph(object), roomId: text(object, "roomId") ?? "")
            return BillingBridge.json(state)
        case "completePurchase":
            return try await BillingBridge.completePurchase(graph: try graph(object), object)
        case "fakePurchase":
            return try await BillingBridge.fakePurchase(graph: try graph(object), object)
        case "featureScreen":
            let url = object["url"] as? String ?? ""
            return CrewCueClientCore.featureScreenJSON(forCrewCueURL: url)
        case "openSession":
            return "opened"
        case "loadSchedule":
            return try await loadSchedule(object)
        case "projectAidSheet":
            return projectAidSheet(object)
        case "stopPlanDraft":
            return stopPlanDraft(object)
        case "updatePlannedStops":
            return try await updatePlannedStops(object)
        case "loadEstimate":
            return try await loadEstimate(object)
        case "decideEstimate":
            return decideEstimate(object)
        case "computeEstimate":
            return try await computeEstimate(object)
        case "importGpx":
            return try await importGpx(object)
        case "enqueueGpx":
            return try await enqueueGpx(object)
        case "enqueueCheckIn":
            let store = try store(object)
            let result = try await store.enqueueCheckIn(
                roomId: object["roomId"] as? String ?? "",
                checkpointId: object["checkpointId"] as? String ?? "",
                arrivalAt: object["arrivalAt"] as? String ?? "",
                departureAt: object["departureAt"] as? String ?? "",
                role: object["role"] as? String ?? "crew_member"
            )
            switch result {
            case .queued(let operation):
                return operation.id
            case .rejected(let message):
                throw ClientHTTPError(status: 400, message: message)
            }
        case "flushOutbox":
            let graph = try graph(object)
            let interval = userDirectory(object).map { TrackingSettings.load(userDirectory: $0).intervalSeconds }
            let report = try await RaceDayAPI.flushOutbox(graph: graph, uploadIntervalSeconds: interval)
            return [
                "accepted": report.accepted,
                "dropped": report.dropped,
                "rejected": report.rejected,
                "pending": report.pending,
                "sessionExpired": report.sessionExpired
            ]
        case "listOutbox":
            return try await listOutbox(object)
        case "exportCrewSheet":
            return try exportCrewSheet(object)
        case "courseReadout":
            return try courseReadout(object)
        case "previewJoin":
            let graph = try graph(object)
            let code = object["code"] as? String ?? ""
            let preview = try await RaceDayAPI.previewJoin(graph: graph, code: code)
            // The crew's "You're joining Sam's race" line rides along (`InviteCopy.joiningRace`).
            guard var body = try jsonValue(preview) as? [String: Any] else { return try jsonValue(preview) }
            body["joiningLine"] = InviteCopy.joiningRace(runner: InviteCopy.runnerName(preview))
            body["previewLine"] = InviteCopy.previewLine(preview)
            return body
        case "createRoom":
            return try await createRoom(object)
        case "join":
            let graph = try graph(object)
            let code = object["code"] as? String ?? ""
            let room = try await RaceDayAPI.join(graph: graph, code: code)
            return try jsonValue(room)
        case "myRaces":
            return try await myRaces(object)
        case "loadRoom":
            return try await loadRoom(object)
        case "latestPing":
            return try await latestPing(object)
        case "placeCheckpoint":
            return try await placeCheckpoint(object)
        case "route":
            return try await route(object)
        case "enqueuePing":
            return try await enqueuePing(object)
        case "parseMentions":
            return try await parseMentions(object)
        case "notificationPreference":
            return try await notificationPreference(object)
        case "saveNotificationPreference":
            return try await saveNotificationPreference(object)
        case "enqueuePush":
            return try await enqueuePush(object)
        case "enqueueChat":
            return try await enqueueChat(object)
        case "chatPoll":
            return try await chatPoll(object)
        case "chatSend":
            return try await chatSend(object)
        case "chatUploadPhoto":
            return try await chatUploadPhoto(object)
        case "chatOlder":
            return try await chatOlder(object)
        case "chatDiscard":
            return try await chatDiscard(object)
        case "completeOutbox":
            return try await completeOutbox(object)
        case "wipeUserData":
            return try wipeUserData(object)
        case "adoptUser":
            return try adoptUser(object)
        case "updateDisplayName":
            return try await updateDisplayName(object)
        case "removeMember":
            return try await removeMember(object)
        case "incidents":
            return try await incidents(object)
        case "createIncident":
            return try await createIncident(object)
        case "featureFlags":
            return ["strava": ClientFeatureFlags.stravaEnabled]
        case "activityHistoryItems":
            return try await activityHistoryItems(object)
        case "importActivityFile":
            return try await importActivityFile(object)
        case "previewActivityUpload":
            return await previewActivityUpload(object)
        case "importActivityUpload":
            return await importActivityUpload(object)
        case "deleteActivity":
            return try await deleteActivity(object)
        case "activityDeleteCopy":
            return ActivityHistoryDelete.copy
        case "stravaStart":
            return try await stravaStart(object)
        case "stravaConnection":
            return try await stravaConnection(object)
        case "stravaDisconnect":
            return try await stravaDisconnect(object)
        case "deleteAccount":
            return try await deleteAccount(object)
        case "accountDeletionCopy":
            return AccountDeletion.copy
        case "deleteRace":
            return try await deleteRace(graph: try graph(object), roomId: text(object, "roomId") ?? "")
        case "raceDeletionCopy":
            return raceDeletionCopy(raceName: text(object, "raceName") ?? "", paid: boolValue(object["paid"]) ?? false)
        case "renameRace":
            return try await renameRace(graph: try graph(object), roomId: text(object, "roomId") ?? "", name: object["name"] as? String ?? "")
        case "raceRenameCopy":
            return raceRenameCopy(role: text(object, "role") ?? "")
        case "onboardingCopy":
            return OnboardingCopy.runtimeCopy
        case "onboardingHistoryComparison":
            return try onboardingHistoryComparison(object)
        case "pingTrack":
            return try await pingTrack(object)
        case "liveProjection":
            return try await liveProjection(object)
        case "trackingSettings":
            let directory = try requiredUserDirectory(object)
            return ["intervalSeconds": TrackingSettings.load(userDirectory: directory).intervalSeconds,
                    "allowedIntervalSeconds": TrackingSettings.allowedIntervalSeconds]
        case "setTrackingSettings":
            let directory = try requiredUserDirectory(object)
            let settings = TrackingSettings(intervalSeconds: Int(doubleValue(object["intervalSeconds"]) ?? 0))
            try settings.save(userDirectory: directory)
            return ["intervalSeconds": settings.intervalSeconds]
        case "trackingSession":
            let directory = try requiredUserDirectory(object)
            guard let session = TrackingSession.load(userDirectory: directory) else { return ["active": false] }
            return ["active": true, "roomId": session.roomId, "startedAt": session.startedAt]
        case "startTrackingSession":
            guard demoURL(object) == nil else {
                throw DemoRaceError.readOnly("the replay never tracks location")
            }
            let directory = try requiredUserDirectory(object)
            guard PingPolicy.mayUpload(role: object["role"] as? String ?? "") else {
                throw ClientHTTPError(status: 400, message: "Only the athlete shares location.")
            }
            let session = TrackingSession(
                roomId: object["roomId"] as? String ?? "",
                startedAt: object["startedAt"] as? String ?? RaceDayReadouts.iso8601(clock(object).now())
            )
            try session.save(userDirectory: directory)
            return ["active": true, "roomId": session.roomId, "startedAt": session.startedAt]
        case "stopTrackingSession":
            try TrackingSession.clear(userDirectory: try requiredUserDirectory(object))
            return ["active": false]
        case "readOnboarding":
            return try readOnboarding(object)
        case "markOnboardingStep":
            return try markOnboardingStep(object)
        case "resetOnboarding":
            return try resetOnboarding(object)
        case "parseInviteLink":
            return parseInviteLink(object)
        case "savePendingJoin":
            return try savePendingJoin(object)
        case "readPendingJoin":
            return try readPendingJoin(object)
        case "clearPendingJoin":
            return try clearPendingJoin(object)
        case "giveUpInvite":
            return try giveUpInvite(object)
        case "resolvePendingJoin":
            return try await resolvePendingJoin(object)
        case "inviteShare":
            return try await inviteShare(object)
        case "confirmedInviteForSignIn":
            return try confirmedInviteForSignIn(object)
        case "inviteJoinLine":
            return inviteJoinLine(object)
        case "inviteCopy":
            return ["copy": inviteCopyJSON()]
        case "pastedInviteCode":
            return ["code": InviteCopy.pastedCode(object["text"] as? String ?? "") ?? NSNull()] as [String: Any]
        case "demoRaceCreate":
            return try await demoRaceCreate(object)
        case "demoRacePlay", "demoRacePause", "demoRaceTick", "demoRaceSkip":
            return try demoRaceControl(op, object)
        case "demoRaceSeek":
            return try demoRaceSeek(object)
        case "demoRaceRunner":
            return try demoRaceRunner(object)
        case "demoRaceCleanup":
            return try demoRaceCleanup(object)
        case "raceStartInput":
            return raceStartInput(object)
        case "gpxPreview":
            return try await gpxPreview(object)
        case "raceAccess":
            return raceAccess(object)
        case "suggestedDisplayName":
            return suggestedDisplayName(object)
        case "runnerSetupStep":
            return try runnerSetupStep(object)
        case "updateRaceStart":
            return try await updateRaceStart(object)
        case "pushTapReceive":
            return pushTapReceive(object)
        case "pushTapTake":
            return pushTapTake(object)
        case "unpaidExpiry":
            return unpaidExpiry(object)
        case "onboardingTour":
            return try onboardingTour(object)
        case "onboardingTourAnswer":
            return try onboardingTourAnswer(object)
        case "onboardingTourSkip":
            return try onboardingTourSkip(object)
        case "setupChecklistOpen":
            return try setupChecklistOpen(object)
        case "setupChecklistHide":
            return try setupChecklistHide(object)
        case "tourNotificationsOutcome":
            return tourNotificationsOutcome(object)
        case "locationTest":
            return try await locationTestStep(object)
        case "tourCardView":
            return try tourCardView(object)
        case "onboardingTourCopy":
            return onboardingTourCopy(object)
        default:
            throw ClientHTTPError(status: 400, message: "Unknown runtime op \(op).")
        }
    }

    private static func loadSchedule(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = object["roomId"] as? String ?? ""
        let directory = directory(object)
        do {
            let loaded = try await RaceDayAPI.loadScheduleResult(graph: graph, roomId: roomId, cacheDirectory: directory)
            return try schedulePayload(loaded.sheet, offline: loaded.offline, request: object)
        } catch {
            if TransportFailure.isOffline(error) {
                return try schedulePayload(nil, offline: true, request: object)
            }
            throw error
        }
    }

    private static func projectAidSheet(_ object: [String: Any]) -> [String: Any] {
        let sheet = decodeSheet(object["sheet"])
        var payload = AidStationSheet.payload(aidProjection(sheet: sheet, request: object))
        payload["readout"] = readoutPayload(sheet: sheet, request: object)
        payload["timeline"] = timelinePayload(sheet: sheet, request: object)
        return payload
    }

    /// Pace edit draft for Android: rebuilds the draft from the course, replays the typed minutes
    /// (`minutes`: checkpointId → text), applies an optional stepper tap (`step`: checkpointId +
    /// deltaMinutes), and returns rows, projected stops, and the timeline.
    private static func stopPlanDraft(_ object: [String: Any]) -> [String: Any] {
        let checkpoints = aidCheckpoints(object["checkpoints"])
        // Progress comes from the runner, never this device: Android sends `progressMeters` derived from
        // the checkpoints the athlete-ping timeline marks passed; otherwise use the `runner` object.
        let progress = requestNumber(object["progressMeters"]) ?? requestProgress(object, checkpoints)
        var draft = StopPlanDraft(checkpoints: checkpoints, progressMeters: progress)
        let typed = object["minutes"] as? [String: Any] ?? [:]
        for row in draft.rows where row.editable {
            if let text = typed[row.checkpointId] as? String {
                draft.setMinutes(text, for: row.checkpointId)
            }
        }
        if let step = object["step"] as? [String: Any], let id = step["checkpointId"] as? String,
           let delta = intValue(step["deltaMinutes"]) {
            draft.step(id, deltaMinutes: delta)
        }
        let sheet = decodeSheet(object["sheet"])
        let projected = sheet.map { CrewScheduleSheet(roomId: $0.roomId, raceStartAt: $0.raceStartAt, stops: draft.projectedStops($0.stops)) }
        let rows: [[String: Any]] = draft.rows.map { row in
            var item: [String: Any] = [
                "checkpointId": row.checkpointId,
                "title": row.title,
                "savedSeconds": row.savedSeconds,
                "draftSeconds": row.draftSeconds,
                "minutesText": row.minutesText,
                "editable": row.editable,
                "changed": row.isChanged,
                "stopLabel": StopPlanDraft.stopLabel(seconds: Double(row.draftSeconds)),
                "savedLabel": StopPlanDraft.stopLabel(seconds: Double(row.savedSeconds))
            ]
            if let error = row.error { item["error"] = error }
            return item
        }
        var payload: [String: Any] = [
            "rows": rows,
            "hasChanges": draft.hasChanges,
            "hasErrors": draft.hasErrors,
            "canSave": draft.canSave,
            "mayEdit": PlanAuthority.mayEditCourse(role: object["role"] as? String ?? ""),
            "edits": draft.edits.map { ["checkpointId": $0.checkpointId, "plannedStopSeconds": $0.plannedStopSeconds] },
            "timeline": timelinePayload(sheet: projected, request: object, progressMeters: progress)
        ]
        if let projected, let stops = try? jsonValue(projected.stops) {
            payload["stops"] = stops
        }
        return payload
    }

    private static func updatePlannedStops(_ object: [String: Any]) async throws -> Any {
        let edits = (object["stops"] as? [Any] ?? []).compactMap { item -> PlannedStopEdit? in
            guard let row = item as? [String: Any], let id = row["checkpointId"] as? String, !id.isEmpty,
                  let seconds = intValue(row["plannedStopSeconds"]) else { return nil }
            return PlannedStopEdit(checkpointId: id, plannedStopSeconds: seconds)
        }
        guard edits.isEmpty == false else {
            throw ClientHTTPError(status: 400, message: "No stop changes to save.")
        }
        let graph = try graph(object)
        do {
            let room = try await RaceDayAPI.updatePlannedStops(graph: graph, roomId: object["roomId"] as? String ?? "", edits: edits)
            return ["saved": true, "offline": false, "message": StopPlanCopy.saved, "room": try jsonValue(room)]
        } catch {
            return ["saved": false, "offline": TransportFailure.isOffline(error), "message": StopPlanCopy.failure(error)]
        }
    }

    /// `runner` is the `latest` object from a `latestPing` result, passed back unchanged.
    /// Progress never comes from the calling device's location.
    private static func requestRunner(_ request: [String: Any]) -> RunnerProgress {
        guard let value = request["runner"], !(value is NSNull),
              JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let response = try? JSONDecoder().decode(RaceRoomLatestPingResponse.self, from: data) else {
            return .none
        }
        return RunnerProgress(response: response)
    }

    private static func requestProgress(_ request: [String: Any], _ checkpoints: [AidStationCheckpoint]) -> Double {
        requestRunner(request).progressMeters(checkpoints: checkpoints)
    }

    /// The caller's `nowMs`, else the request's graph clock (a replay's scripted time).
    private static func requestNow(_ request: [String: Any]) -> Date {
        requestNumber(request["nowMs"]).map { Date(timeIntervalSince1970: $0 / 1000) } ?? clock(request).now()
    }

    private static func elevationProfile(_ value: Any?) -> ElevationProfile? {
        let rows = (value as? [Any] ?? []).compactMap { item -> (distanceMeters: Double, elevationMeters: Double)? in
            guard let pair = item as? [Any], pair.count >= 2,
                  let distance = requestNumber(pair[0]), let elevation = requestNumber(pair[1]) else { return nil }
            return (distance, elevation)
        }
        return rows.isEmpty ? nil : ElevationProfile(samples: rows)
    }

    private static func readoutPayload(sheet: CrewScheduleSheet?, request: [String: Any]) -> [String: Any] {
        let checkpoints = aidCheckpoints(request["checkpoints"])
        let readout = RaceDayReadouts.withLive(
            RaceDayReadouts.make(
                sheet: sheet,
                checkpoints: checkpoints,
                runner: requestRunner(request),
                now: requestNow(request)
            ),
            live: requestLive(request)
        )
        var row: [String: Any] = [
            "status": readout.status.rawValue,
            "statusLabel": readout.statusLabel,
            "progressFraction": readout.progressFraction,
            "progressLabel": readout.progressLabel,
            "percentLabel": readout.percentLabel,
            "totalMilesLabel": readout.totalMilesLabel,
            "currentMileLabel": readout.currentMileLabel,
            "elapsedLabel": readout.elapsedLabel,
            "averagePaceLabel": readout.averagePaceLabel,
            "pingState": readout.pingState.rawValue,
            "pingLabel": readout.pingLabel
        ]
        if let ping = readout.lastPingLabel {
            row["lastPingLabel"] = ping
        }
        if let strip = readout.courseStripLabel { row["courseStripLabel"] = strip }
        if let spoken = readout.courseStripSpoken { row["courseStripSpoken"] = spoken }
        if let eta = readout.finishEtaAt { row["finishEtaAt"] = eta }
        if let start = readout.finishWindowStartAt { row["finishWindowStartAt"] = start }
        if let end = readout.finishWindowEndAt { row["finishWindowEndAt"] = end }
        row["liveEtaStale"] = readout.liveEtaStale
        return row
    }

    /// `progressMeters` overrides the request's runner when the caller already resolved it (stop-plan draft).
    private static func timelinePayload(sheet: CrewScheduleSheet?, request: [String: Any], progressMeters: Double? = nil) -> [[String: Any]] {
        let checkpoints = aidCheckpoints(request["checkpoints"])
        let zone = requestTimeZone(request)
        return RaceDayReadouts.timeline(
            sheet: sheet,
            checkpoints: checkpoints,
            progressMeters: progressMeters ?? requestProgress(request, checkpoints),
            live: requestLive(request)
        ).map { item in
            var row: [String: Any] = [
                "checkpointId": item.checkpointId,
                "state": item.state.rawValue,
                "kicker": item.kicker,
                "title": item.title,
                "distanceToLabel": item.distanceToLabel,
                "isFinish": item.isFinish
            ]
            if let arrival = item.clockArrivalAt {
                row["clockArrivalAt"] = arrival
                // The plan clock in the viewer's zone, written the way every other client-core clock is.
                row["clockLabel"] = ScheduleFormat.formatScheduleClock(arrival, timeZone: zone)
            }
            if let cutoff = item.cutoffAt { row["cutoffAt"] = cutoff }
            if let status = item.cutoffStatus { row["cutoffStatus"] = status }
            if let live = item.liveArrivalAt { row["liveArrivalAt"] = live }
            if let start = item.arrivalWindowStartAt { row["arrivalWindowStartAt"] = start }
            if let end = item.arrivalWindowEndAt { row["arrivalWindowEndAt"] = end }
            return row
        }
    }

    /// The viewer's zone: an IANA `timeZone` the client sends (Android passes its device zone, since the
    /// Swift runtime there cannot resolve `TimeZone.current` to an IANA region), else the device zone.
    static func requestTimeZone(_ object: [String: Any]) -> TimeZone {
        if let id = object["timeZone"] as? String, let zone = DeviceTimeZone.resolve(id) {
            return zone
        }
        return DeviceTimeZone.current
    }

    private static func aidProjection(sheet: CrewScheduleSheet?, request: [String: Any]) -> AidStationProjection {
        let checkpoints = aidCheckpoints(request["checkpoints"])
        let progress = requestProgress(request, checkpoints)
        let now = requestNow(request)
        let selected = Int(requestNumber(request["selectedIndex"]) ?? 0)
        let follow = (request["follow"] as? Bool) ?? true
        return AidStationSheet.project(
            sheet: sheet,
            checkpoints: checkpoints,
            progressMeters: progress,
            now: now,
            paceSecondsPerKm: requestNumber(request["paceSecondsPerKm"]),
            selectedIndex: selected,
            follow: follow,
            elevation: elevationProfile(request["elevation"]),
            timeZone: requestTimeZone(request),
            liveArrivals: aidLiveArrivals(request["liveArrivals"]),
            track: aidTrack(request["track"])
        )
    }

    /// `{ checkpointId: ISO-8601 }` from the server's live projection.
    private static func aidLiveArrivals(_ value: Any?) -> [String: Date] {
        guard let rows = value as? [String: Any] else { return [:] }
        var out: [String: Date] = [:]
        for (id, raw) in rows {
            if let iso = raw as? String, let date = ScheduleFormat.parseISO8601(iso) { out[id] = date }
        }
        return out
    }

    /// `[{ recordedAt, latitude, longitude }]`, the runner's track oldest first.
    private static func aidTrack(_ value: Any?) -> [RunnerTrackPoint] {
        let rows = value as? [Any] ?? []
        return rows.compactMap { item in
            guard let row = item as? [String: Any],
                  let iso = row["recordedAt"] as? String, let at = ScheduleFormat.parseISO8601(iso),
                  let lat = requestNumber(row["latitude"]), let lon = requestNumber(row["longitude"]) else { return nil }
            return RunnerTrackPoint(recordedAt: at, latitude: lat, longitude: lon)
        }
    }

    private static func decodeSheet(_ value: Any?) -> CrewScheduleSheet? {
        guard let value, !(value is NSNull) else { return nil }
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value) else {
            return nil
        }
        return try? JSONDecoder().decode(CrewScheduleSheet.self, from: data)
    }

    private static func aidCheckpoints(_ value: Any?) -> [AidStationCheckpoint] {
        let rows = value as? [Any] ?? []
        return rows.compactMap { item in
            guard let row = item as? [String: Any], let id = row["id"] as? String, !id.isEmpty else { return nil }
            return AidStationCheckpoint(
                id: id,
                title: row["title"] as? String,
                latitude: requestNumber(row["latitude"]),
                longitude: requestNumber(row["longitude"]),
                distanceMetersFromStart: requestNumber(row["distanceMetersFromStart"]),
                plannedStopSeconds: requestNumber(row["plannedStopSeconds"])
            )
        }
    }

    private static func requestNumber(_ value: Any?) -> Double? {
        JSONNumber.double(value)
    }

    private static func schedulePayload(_ sheet: CrewScheduleSheet?, offline: Bool, request: [String: Any] = [:]) throws -> [String: Any] {
        guard let sheet else {
            return [
                "offline": offline,
                "raceStartAt": "",
                "lines": [] as [String],
                "checkpointIds": [] as [String],
                "aidSheet": AidStationSheet.payload(aidProjection(sheet: nil, request: request)),
                "readout": readoutPayload(sheet: nil, request: request),
                "timeline": timelinePayload(sheet: nil, request: request)
            ]
        }
        let zone = requestTimeZone(request)
        let lines = sheet.stops.map {
            ScheduleFormat.scheduleLine(
                checkpointId: $0.checkpointId,
                elapsedSeconds: $0.elapsedSeconds,
                clockArrivalAt: $0.clockArrivalAt,
                timeZone: zone
            )
        }
        return [
            "offline": offline,
            "raceStartAt": sheet.raceStartAt,
            "lines": lines,
            "checkpointIds": sheet.stops.map(\.checkpointId),
            "sheet": try jsonValue(sheet),
            "mayEditCourse": PlanAuthority.mayEditCourse(role: request["role"] as? String ?? ""),
            "plannedStopLabels": Dictionary(
                sheet.stops.map { ($0.checkpointId, StopPlanDraft.stopLabel(seconds: $0.plannedStoppageSeconds)) },
                uniquingKeysWith: { first, _ in first }
            ),
            "aidSheet": AidStationSheet.payload(aidProjection(sheet: sheet, request: request)),
            "readout": readoutPayload(sheet: sheet, request: request),
            "timeline": timelinePayload(sheet: sheet, request: request)
        ]
    }

    private static func loadEstimate(_ object: [String: Any]) async throws -> Any {
        let role = object["role"] as? String ?? ""
        let directory = directory(object)
        let record = EstimateRecordFile.load(directory)
        let roomId = object["roomId"] as? String ?? ""
        do {
            let graph = try graph(object)
            let envelope = try await RaceDayAPI.loadRoom(graph: graph, roomId: roomId)
            let estimate = envelope.room.pacingEstimate
            if let estimate, let directory {
                try? EstimateCache.save(estimate, directory: directory)
            }
            let input = recomputeInput(
                await withActivityHistory(object, role: role, graph: graph),
                estimate: estimate,
                record: record
            )
            let decision = RaceDayAPI.decideAutoRecompute(role: role, input: input)
            if !decision.recompute {
                EstimateRecordFile.save(decision.nextRecord, directory)
            }
            let planFinish: ScheduleStop? = if let estimate {
                await PlanFinish.scheduled(graph: graph, roomId: roomId, for: estimate, cacheDirectory: directory)
            } else {
                nil
            }
            var payload = estimatePayload(
                estimate,
                role: role,
                offline: false,
                recompute: decision.recompute,
                reason: decision.reason.rawValue,
                usableHistoryCount: input.usableHistoryCount,
                historyFingerprint: input.historyFingerprint,
                timeZone: requestTimeZone(object),
                planFinish: planFinish
            )
            payload["raceStartAt"] = envelope.room.raceStartAt ?? ""
            payload["plannedPaceSecondsPerKm"] = envelope.room.plannedPaceSecondsPerKm ?? 0
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                let cached = directory.flatMap { try? EstimateCache.load(directory: $0) }
                return estimatePayload(
                    cached,
                    role: role,
                    offline: true,
                    recompute: false,
                    reason: EstimateRecomputeReason.none.rawValue,
                    usableHistoryCount: 0,
                    historyFingerprint: nil,
                    timeZone: requestTimeZone(object),
                    planFinish: cachedFinish(roomId: roomId, directory: directory, estimate: cached)
                )
            }
            throw error
        }
    }

    /// The finish row of the race's sheet on this device for `estimate`, the cached plan an offline
    /// payload shows (`PlanFinish`): nil when that sheet was planned from another estimate.
    private static func cachedFinish(roomId: String, directory: URL?, estimate: PacingEstimate?) -> ScheduleStop? {
        guard let estimate, let directory, let sheet = try? ScheduleCache.load(directory: directory),
              sheet.roomId == roomId else { return nil }
        return PlanFinish.row(in: sheet, for: estimate)
    }

    private static func decideEstimate(_ object: [String: Any]) -> [String: Any] {
        let role = object["role"] as? String ?? ""
        let record = EstimateRecordFile.load(directory(object))
        let input = recomputeInput(object, estimate: nil, record: record)
        let decision = RaceDayAPI.decideAutoRecompute(role: role, input: input)
        if !decision.recompute {
            EstimateRecordFile.save(decision.nextRecord, directory(object))
        }
        return [
            "recompute": decision.recompute,
            "reason": decision.reason.rawValue,
            "mayRecalculate": PlanAuthority.mayExplicitRecalculate(role: role),
            "mayAutoRecompute": PlanAuthority.mayAutoRecompute(role: role),
            "usableHistoryCount": input.usableHistoryCount,
            "historyFingerprint": input.historyFingerprint ?? ""
        ]
    }

    /// `computeEstimate`: roomId, role, trigger?, hasPlanOfRecord?, historyFingerprint?,
    /// usableHistoryCount?, historyMode? (`none`: Skip's cold start; `compare`: also answers
    /// `comparison`, the history step's line). Answers the estimate payload of the attached plan.
    private static func computeEstimate(_ object: [String: Any]) async throws -> Any {
        let role = object["role"] as? String ?? ""
        // Without a trigger the request is an automatic recompute, which only the athlete may make.
        let trigger = text(object, "trigger").flatMap(PlanTrigger.init(rawValue:)) ?? .auto
        let hasPlanOfRecord = (object["hasPlanOfRecord"] as? Bool) ?? true
        guard PlanAuthority.allows(role: role, trigger: trigger, hasPlanOfRecord: hasPlanOfRecord) else {
            throw PlanAuthorityError.notAllowed
        }
        let directory = directory(object)
        let roomId = object["roomId"] as? String ?? ""
        do {
            let graph = try graph(object)
            // The history step's two paths, the ones iOS takes (`PlanOfRecord`): `none` (Skip, a
            // cold start even after an import) and `compare` (after an import: the comparison line).
            let attached: PacingEstimate
            var comparison: HistoryComparison?
            switch text(object, "historyMode") {
            case "none":
                attached = try await PlanOfRecord.recomputeWithoutHistory(graph: graph, roomId: roomId, role: role)
            case "compare":
                let compared = try await PlanOfRecord.recomputeComparingHistory(
                    graph: graph,
                    roomId: roomId,
                    role: role,
                    cacheDirectory: directory
                )
                attached = compared.attached
                comparison = compared
            default:
                attached = try await PlanOfRecord.recompute(
                    graph: graph,
                    roomId: roomId,
                    role: role,
                    trigger: trigger,
                    hasPlanOfRecord: hasPlanOfRecord
                )
            }
            if let directory {
                try? EstimateCache.save(attached, directory: directory)
            }
            let fingerprint = text(object, "historyFingerprint")
            if let fingerprint {
                EstimateRecordFile.save(
                    EstimateHistoryRecord(estimateId: attached.id, fingerprint: fingerprint),
                    directory
                )
            }
            let count = intValue(object["usableHistoryCount"]) ?? 0
            let zone = requestTimeZone(object)
            // The schedule now plans from the estimate just attached; a sheet planned from another is not read.
            let planFinish = if let comparison { comparison.planFinish } else {
                await PlanFinish.scheduled(graph: graph, roomId: roomId, for: attached, cacheDirectory: directory)
            }
            var payload = estimatePayload(
                attached,
                role: role,
                offline: false,
                recompute: false,
                reason: EstimateRecomputeReason.none.rawValue,
                usableHistoryCount: count,
                historyFingerprint: fingerprint,
                timeZone: zone,
                planFinish: planFinish
            )
            // `compare`: "Finish 9:42 AM instead of 10:15 AM" on the plan's clock, or null when
            // history changed nothing the runner can see.
            if let comparison { payload["comparison"] = comparison.line(timeZone: zone) ?? NSNull() }
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                let cached = directory.flatMap { try? EstimateCache.load(directory: $0) }
                return estimatePayload(
                    cached,
                    role: role,
                    offline: true,
                    recompute: false,
                    reason: EstimateRecomputeReason.none.rawValue,
                    usableHistoryCount: intValue(object["usableHistoryCount"]) ?? 0,
                    historyFingerprint: text(object, "historyFingerprint"),
                    timeZone: requestTimeZone(object),
                    planFinish: cachedFinish(roomId: roomId, directory: directory, estimate: cached)
                )
            }
            throw error
        }
    }

    private static func importGpx(_ object: [String: Any]) async throws -> Any {
        let gpxXml = object["gpxXml"] as? String ?? ""
        if gpxXml.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ["status": "empty"]
        }
        let fileName = text(object, "fileName") ?? "route.gpx"
        let roomId = object["roomId"] as? String ?? ""
        let role = object["role"] as? String ?? "crew_member"
        var start = text(object, "raceStartAt") ?? ""
        var pace = doubleValue(object["plannedPaceSecondsPerKm"]) ?? 0
        do {
            let graph = try graph(object)
            if start.isEmpty || pace <= 0 {
                let room = try await RaceDayAPI.loadRoom(graph: graph, roomId: roomId)
                if start.isEmpty { start = room.room.raceStartAt ?? "" }
                if pace <= 0 { pace = room.room.plannedPaceSecondsPerKm ?? 0 }
            }
            // A new room has neither clock nor pace until this upload sets them. Do not fail
            // here: RaceDayAPI.importGpx keeps a stored clock and otherwise uses the device
            // clock and the 360 s/km default, same as the iOS import path.
            _ = try await RaceDayAPI.importGpx(
                graph: graph,
                roomId: roomId,
                fileName: fileName,
                gpxXml: gpxXml,
                raceStartAt: start,
                plannedPaceSecondsPerKm: pace
            )
            return ["status": "saved"]
        } catch {
            if TransportFailure.isOffline(error) {
                if start.isEmpty, let directory = directory(object), let cached = try? ScheduleCache.load(directory: directory) {
                    start = cached.raceStartAt
                }
                let store = try store(object)
                let operation = try await store.enqueueGpx(
                    roomId: roomId,
                    fileName: fileName,
                    gpxXml: gpxXml,
                    raceStartAt: start,
                    plannedPaceSecondsPerKm: pace,
                    role: role
                )
                return ["status": "queued", "id": operation.id]
            }
            throw error
        }
    }

    private static func enqueueGpx(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let operation = try await store.enqueueGpx(
            roomId: object["roomId"] as? String ?? "",
            fileName: text(object, "fileName") ?? "route.gpx",
            gpxXml: object["gpxXml"] as? String ?? "",
            raceStartAt: text(object, "raceStartAt") ?? "",
            plannedPaceSecondsPerKm: doubleValue(object["plannedPaceSecondsPerKm"]) ?? 0,
            role: object["role"] as? String ?? "crew_member"
        )
        return ["status": "queued", "id": operation.id]
    }

    private static func listOutbox(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let operations = try await store.operations()
        let rows: [[String: Any]] = operations.map { operation in
            let policy = OutboxOperation(
                id: operation.id,
                type: operation.type,
                status: operation.status,
                conflictKey: operation.conflictKey
            )
            return [
                "id": operation.id,
                "type": operation.type,
                "status": operation.status,
                "label": RaceToolsCopy.outboxLabel(type: operation.type),
                "safeRetry": OutboxPolicy.isSafeRetry(policy)
            ]
        }
        let pending = OutboxPolicy.countPending(operations.map {
            OutboxOperation(id: $0.id, type: $0.type, status: $0.status, conflictKey: $0.conflictKey)
        })
        let rejected = operations.contains { $0.status == "rejected" || $0.status == "conflict" }
        return ["pending": pending, "rejected": rejected, "operations": rows]
    }

    private static func exportCrewSheet(_ object: [String: Any]) throws -> Any {
        guard let directory = directory(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        guard let sheet = try ScheduleCache.load(directory: directory), !sheet.stops.isEmpty else {
            return ["empty": true]
        }
        let zone = requestTimeZone(object)
        // `titles` maps checkpoint ids to course titles, as for `courseReadout`; missing ones fall back to the id.
        let titles = object["titles"] as? [String: String] ?? [:]
        let rows = RaceToolsCopy.crewSheetRows(sheet.stops, titles: titles, timeZone: zone)
        let text = RaceToolsCopy.crewSheetText(
            raceName: object["raceName"] as? String ?? "",
            capturedAtIso: isoNow(object),
            rows: rows,
            timeZone: zone
        )
        return [
            "empty": false,
            "text": text,
            "rows": rows.map { ["title": $0.title, "arrival": $0.arrival, "elapsed": $0.elapsed] }
        ]
    }

    /// Aid station stops and cutoffs from the cached schedule (Race tools). `titles` maps
    /// checkpoint ids to course titles; missing ones fall back to the id.
    private static func courseReadout(_ object: [String: Any]) throws -> Any {
        guard let directory = directory(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        guard let sheet = try ScheduleCache.load(directory: directory), !sheet.stops.isEmpty else {
            return ["empty": true]
        }
        let titles = object["titles"] as? [String: String] ?? [:]
        let readout = RaceToolsCopy.courseReadout(sheet.stops, titles: titles)
        return [
            "empty": false,
            "summary": readout.summary,
            "rows": readout.rows.map { ["title": $0.title, "duration": $0.duration] },
            "cutoffs": readout.cutoffs
        ]
    }

    private static func estimatePayload(
        _ estimate: PacingEstimate?,
        role: String,
        offline: Bool,
        recompute: Bool,
        reason: String,
        usableHistoryCount: Int,
        historyFingerprint: String?,
        timeZone: TimeZone = DeviceTimeZone.current,
        planFinish: ScheduleStop? = nil
    ) -> [String: Any] {
        let finishAt = planFinish?.clockArrivalAt ?? estimate?.expectedFinishAt
        return [
            "hasEstimate": estimate != nil,
            "coldStart": estimate?.coldStart ?? false,
            "estimateId": estimate?.id ?? "",
            // The estimate's own finish (API ISO-8601): moving time only, no planned stops. Never
            // shown as the finish. "" without one.
            "expectedFinishAt": estimate?.expectedFinishAt ?? "",
            // The race's finish (API ISO-8601), the one every screen shows: the schedule's finish row
            // (`PlanFinish`), else the estimate's own. "" without an estimate.
            "finishAt": estimate == nil ? "" : finishAt ?? "",
            "summary": estimate.map { PlanFinish.estimateSummary($0, plan: planFinish, timeZone: timeZone) } ?? "",
            // The finish clock as the summary writes it, so a big finish readout matches it; "" without one.
            "finishClock": estimate == nil ? "" : finishAt.map { ScheduleFormat.formatScheduleClock($0, timeZone: timeZone) } ?? "",
            "offline": offline,
            "recompute": recompute,
            "reason": reason,
            "usableHistoryCount": usableHistoryCount,
            "historyFingerprint": historyFingerprint ?? "",
            "mayRecalculate": PlanAuthority.mayExplicitRecalculate(role: role),
            "mayAutoRecompute": PlanAuthority.mayAutoRecompute(role: role)
        ]
    }

    private static func recomputeInput(
        _ object: [String: Any],
        estimate: PacingEstimate?,
        record: EstimateHistoryRecord
    ) -> EstimateRecomputeInput {
        let history = activityHistory(object)
        let usable = EstimateRecompute.usableActivityHistory(history)
        let derived = EstimateRecompute.usableHistoryFingerprint(history)
        let fingerprint = text(object, "historyFingerprint") ?? (derived.isEmpty ? nil : derived)
        return EstimateRecomputeInput(
            canEdit: boolValue(object["canEdit"]) ?? true,
            busy: boolValue(object["busy"]) ?? false,
            estimateId: text(object, "estimateId") ?? estimate?.id,
            coldStart: boolValue(object["coldStart"]) ?? estimate?.coldStart,
            usableHistoryCount: intValue(object["usableHistoryCount"]) ?? usable.count,
            historyFingerprint: fingerprint,
            record: record
        )
    }

    /// Adds the athlete's history when the caller did not send one, so every platform decides
    /// the auto recompute from the same server history. Only roles that may auto-recompute fetch it.
    /// A history failure leaves the estimate readable and simply skips the recompute.
    static func withActivityHistory(_ object: [String: Any], role: String, graph: ClientGraph) async -> [String: Any] {
        guard object["history"] == nil, PlanAuthority.mayAutoRecompute(role: role) else { return object }
        guard let history = try? await RaceDayAPI.activityHistory(graph: graph) else { return object }
        var filled = object
        filled["history"] = history.map { row -> [String: Any] in
            var fields: [String: Any] = ["id": row.id]
            if let value = row.distanceMeters { fields["distanceMeters"] = value }
            if let value = row.elapsedSeconds { fields["elapsedSeconds"] = value }
            if let value = row.elevationGainMeters { fields["elevationGainMeters"] = value }
            return fields
        }
        return filled
    }

    private static func activityHistory(_ object: [String: Any]) -> [ActivityHistoryRef] {
        guard let rows = object["history"] as? [[String: Any]] else { return [] }
        return rows.compactMap { row in
            guard let id = row["id"] as? String, !id.isEmpty else { return nil }
            return ActivityHistoryRef(
                id: id,
                distanceMeters: doubleValue(row["distanceMeters"]),
                elapsedSeconds: doubleValue(row["elapsedSeconds"]),
                elevationGainMeters: doubleValue(row["elevationGainMeters"])
            )
        }
    }

    private static func createRoom(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let name = (object["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let athleteId = (object["athleteId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let teamId = (object["teamId"] as? String ?? athleteId).trimmingCharacters(in: .whitespacesAndNewlines)
        let creatorName = object["creatorName"] as? String
        guard !name.isEmpty, !athleteId.isEmpty, !teamId.isEmpty else {
            throw ClientHTTPError(status: 400, message: "Invalid race room payload")
        }
        let room = try await RaceDayAPI.createRoom(
            graph: graph,
            name: name,
            athleteId: athleteId,
            teamId: teamId,
            creatorName: creatorName
        )
        return try jsonValue(room)
    }

    /// The user's races plus the one every tab follows. `roomId` is the preferred active room.
    /// Each row also carries `entitlementStatus`, `hasCourse`, `hasEstimate` (an estimate is
    /// attached) and the legacy `activatedAt` (the race clock's start when `raceStartAt` is unset),
    /// so it can go back to `readOnboarding`.
    private static func myRaces(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let userId = object["userId"] as? String ?? ""
        let rooms = try await RaceDayAPI.myRaceRooms(graph: graph)
        let races = rooms.map { RaceSummary(room: $0, userId: userId) }
        let roster = RaceRoster.reconciled(races: races, preferred: text(object, "roomId"))
        return [
            "races": try zip(races, rooms).map { race, room -> Any in
                var row = try jsonValue(race) as? [String: Any] ?? [:]
                let onboarding = OnboardingRace(room: room, userId: userId)
                row["roleLabel"] = race.roleLabel
                // Only the owner is offered Delete race (`RaceSummary.isOwned`).
                row["owner"] = race.isOwned(by: userId)
                row["entitlementStatus"] = onboarding.entitlementStatus
                row["hasCourse"] = onboarding.hasCourse
                row["hasEstimate"] = onboarding.hasEstimate
                if let activatedAt = room.activatedAt?.trimmingCharacters(in: .whitespacesAndNewlines), !activatedAt.isEmpty {
                    row["activatedAt"] = activatedAt
                }
                return row
            },
            "activeRoomId": roster.activeRoomId ?? NSNull()
        ] as [String: Any]
    }

    private static func loadRoom(_ object: [String: Any]) async throws -> Any {
        let base = try graph(object)
        let capture = CapturingTransport(base.transport)
        let reading = ClientGraph(
            transport: capture,
            clock: base.clock,
            logger: base.logger,
            baseURL: base.baseURL,
            tokenProvider: base.tokenProvider,
            outbox: base.outbox
        )
        do {
            _ = try await RaceDayAPI.loadRoom(graph: reading, roomId: object["roomId"] as? String ?? "")
            if let data = capture.lastBody {
                return CoursePayload.make(from: data)
            }
            return CoursePayload.empty(offline: false)
        } catch {
            if TransportFailure.isOffline(error) {
                return CoursePayload.empty(offline: true)
            }
            throw error
        }
    }

    /// `latest` is the wire response; hand it back as `runner` to `projectAidSheet`.
    /// Offline keeps no ping here, so the app keeps the last one it had and lets it go stale.
    private static func latestPing(_ object: [String: Any]) async throws -> Any {
        let base = try graph(object)
        let capture = CapturingTransport(base.transport)
        let reading = ClientGraph(
            transport: capture,
            clock: base.clock,
            logger: base.logger,
            baseURL: base.baseURL,
            tokenProvider: base.tokenProvider,
            outbox: base.outbox
        )
        let refresh = RunnerProgress.refreshIntervalSeconds
        do {
            _ = try await RaceDayAPI.latestPing(graph: reading, roomId: object["roomId"] as? String ?? "")
            guard let data = capture.lastBody, let latest = try? JSONSerialization.jsonObject(with: data) else {
                return ["offline": false, "refreshSeconds": refresh]
            }
            return ["offline": false, "latest": latest, "refreshSeconds": refresh]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "refreshSeconds": refresh]
            }
            throw error
        }
    }

    /// New path points after `after` (the previous call's `cursor`). Offline returns no points.
    private static func pingTrack(_ object: [String: Any]) async throws -> Any {
        let after = text(object, "after")
        do {
            let track = try await RaceDayAPI.refreshTrack(
                graph: try graph(object),
                roomId: object["roomId"] as? String ?? "",
                track: RunnerTrack(points: [], cursor: after)
            )
            let points: [[String: Any]] = track.points.map {
                ["recordedAt": RaceDayReadouts.iso8601($0.recordedAt), "latitude": $0.latitude, "longitude": $0.longitude]
            }
            var payload: [String: Any] = ["offline": false, "points": points]
            if let cursor = track.cursor { payload["cursor"] = cursor }
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                var payload: [String: Any] = ["offline": true, "points": [Any]()]
                if let after { payload["cursor"] = after }
                return payload
            }
            throw error
        }
    }

    /// `live` is the wire projection; pass it back as `live` to `projectAidSheet` and the readouts.
    private static func liveProjection(_ object: [String: Any]) async throws -> Any {
        let base = try graph(object)
        let capture = CapturingTransport(base.transport)
        let reading = ClientGraph(
            transport: capture,
            clock: base.clock,
            logger: base.logger,
            baseURL: base.baseURL,
            tokenProvider: base.tokenProvider,
            outbox: base.outbox
        )
        do {
            let live = try await RaceDayAPI.liveProjection(graph: reading, roomId: object["roomId"] as? String ?? "")
            guard live != nil, let data = capture.lastBody, let wire = try? JSONSerialization.jsonObject(with: data) else {
                return ["offline": false]
            }
            return ["offline": false, "live": wire, "finishCrossed": TrackingSession.shouldAutoStop(live)]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true]
            }
            throw error
        }
    }

    private static func requestLive(_ request: [String: Any]) -> LiveProjection? {
        guard let value = request["live"], !(value is NSNull),
              JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let core = try? JSONDecoder().decode(RaceRoomProjectionCore.self, from: data) else {
            return nil
        }
        return LiveProjection(core: core, timeliness: try? JSONDecoder().decode(ProjectionTimeliness.self, from: data))
    }

    private static func requiredUserDirectory(_ object: [String: Any]) throws -> URL {
        guard let directory = userDirectory(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        return directory
    }

    /// `line`: the course line the map draws (`[[longitude, latitude]]`). A pin too far off it is
    /// not sent: `{ rejected: true, message }`.
    private static func placeCheckpoint(_ object: [String: Any]) async throws -> Any {
        let route = (object["line"] as? [Any] ?? []).compactMap { item -> CourseRoutePoint? in
            guard let pair = item as? [Any], pair.count >= 2,
                  let lon = doubleValue(pair[0]), let lat = doubleValue(pair[1]) else { return nil }
            return CourseRoutePoint(latitude: lat, longitude: lon)
        }
        if let message = CheckpointPlacement.rejection(
            latitude: doubleValue(object["latitude"]) ?? .nan,
            longitude: doubleValue(object["longitude"]) ?? .nan,
            route: route
        ) {
            return ["offline": false, "rejected": true, "message": message]
        }
        do {
            let graph = try graph(object)
            let data = try await RaceDayAPI.placeCheckpoint(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                id: object["id"] as? String ?? "",
                title: object["title"] as? String ?? "",
                latitude: doubleValue(object["latitude"]) ?? 0,
                longitude: doubleValue(object["longitude"]) ?? 0
            )
            var payload: [String: Any] = ["offline": false]
            if let parsed = try? JSONSerialization.jsonObject(with: data) {
                payload["checkpoint"] = parsed
            }
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true]
            }
            throw error
        }
    }

    private static func route(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let data = try await RaceDayAPI.route(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                mode: text(object, "mode") ?? "hike",
                checkpointIds: stringList(object["checkpointIds"])
            )
            var payload: [String: Any] = ["offline": false]
            if let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let route = (parsed["route"] as? [String: Any]) ?? parsed
                payload["route"] = route
                if let distance = doubleValue(route["distanceMeters"]) {
                    payload["distanceMeters"] = distance
                }
            }
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true]
            }
            throw error
        }
    }

    private static func enqueuePing(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let result = try await store.enqueuePing(
            roomId: object["roomId"] as? String ?? "",
            role: object["role"] as? String ?? "",
            latitude: doubleValue(object["latitude"]) ?? 0,
            longitude: doubleValue(object["longitude"]) ?? 0,
            recordedAt: object["recordedAt"] as? String ?? "",
            horizontalAccuracyMeters: doubleValue(object["horizontalAccuracyMeters"])
        )
        switch result {
        case .queued(let operation):
            return [
                "status": "queued",
                "id": operation.id,
                "recordedAt": operation.recordedAt ?? ""
            ]
        case .rejected(let message):
            throw ClientHTTPError(status: 400, message: message)
        }
    }

    private static func parseMentions(_ object: [String: Any]) async throws -> Any {
        let body = object["body"] as? String ?? object["text"] as? String ?? ""
        do {
            let graph = try graph(object)
            let envelope = try await RaceDayAPI.loadRoom(graph: graph, roomId: object["roomId"] as? String ?? "")
            let members = envelope.room.memberships.compactMap { membership -> MentionMember? in
                guard let displayName = membership.displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !displayName.isEmpty else {
                    return nil
                }
                return MentionMember(userId: membership.userId, displayName: displayName)
            }
            return [
                "offline": false,
                "tokens": Mentions.parse(body, members: members).map(mentionTokenJSON)
            ]
        } catch {
            if TransportFailure.isOffline(error) {
                return [
                    "offline": true,
                    "tokens": Mentions.parse(body, members: []).map(mentionTokenJSON)
                ]
            }
            throw error
        }
    }

    private static func mentionTokenJSON(_ token: MentionToken) -> [String: Any] {
        switch token {
        case .text(let text):
            return ["type": "text", "text": text]
        case .mention(let displayName, let userId):
            return ["type": "mention", "displayName": displayName, "userId": userId]
        }
    }

    private static func notificationPreference(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let pref = try await RaceDayAPI.notificationPreference(graph: graph, roomId: object["roomId"] as? String ?? "")
            return preferencePayload(pref.preference, offline: false, saved: false)
        } catch {
            if TransportFailure.isOffline(error) {
                return preferencePayload("", offline: true, saved: false)
            }
            throw error
        }
    }

    private static func saveNotificationPreference(_ object: [String: Any]) async throws -> Any {
        let preference = object["preference"] as? String ?? ""
        guard ["all", "mentions", "none"].contains(preference) else {
            throw ClientHTTPError(status: 400, message: "Couldn't save alert settings.")
        }
        do {
            let graph = try graph(object)
            let saved = try await RaceDayAPI.saveNotificationPreference(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                preference: preference
            )
            return preferencePayload(saved.preference, offline: false, saved: true)
        } catch {
            if TransportFailure.isOffline(error) {
                return preferencePayload(preference, offline: true, saved: false)
            }
            throw error
        }
    }

    private static func preferencePayload(_ preference: String, offline: Bool, saved: Bool) -> [String: Any] {
        ["preference": preference, "offline": offline, "saved": saved]
    }

    private static func enqueuePush(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let deviceId = (object["deviceId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let token = (object["token"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if deviceId.isEmpty || token.isEmpty {
            throw ClientHTTPError(status: 400, message: "No push token.")
        }
        let platform = text(object, "platform") ?? "android"
        let operation = try await store.enqueuePush(
            deviceId: deviceId,
            platform: platform,
            token: token,
            role: object["role"] as? String ?? "crew_member"
        )
        return ["status": "queued", "id": operation.id, "platform": platform]
    }

    private static func enqueueChat(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let clientMessageId = text(object, "clientMessageId") ?? "chat-\(UUID().uuidString)"
        let operation = try await store.enqueueChat(
            roomId: object["roomId"] as? String ?? "",
            text: object["text"] as? String ?? "",
            clientMessageId: clientMessageId,
            role: object["role"] as? String ?? "crew_member"
        )
        return ["status": "pending", "id": operation.id, "clientMessageId": clientMessageId]
    }

    /// Sign-out and session expiry: every user's files under the storage root. Open outboxes are
    /// closed even when the app already deleted their directory, so a late write can't recreate them.
    private static func wipeUserData(_ object: [String: Any]) throws -> Any {
        guard let root = storageRoot(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        try OutboxStore.wipeShared(inside: root)
        try UserStorage(root: root).wipeAll()
        return ["status": "wiped"]
    }

    /// Sign-in: the storage root belongs to the runtime, so everything but this user's directory
    /// goes, including other accounts and the unscoped layout from before #538.
    private static func adoptUser(_ object: [String: Any]) throws -> Any {
        guard let root = storageRoot(object), let userId = text(object, "userId") else {
            throw ClientHTTPError(status: 0, message: "storageDir and userId are required.")
        }
        let storage = UserStorage(root: root)
        try storage.wipeAll(except: userId)
        let keep = storage.usersDirectory.lastPathComponent
        if FileManager.default.fileExists(atPath: root.path) {
            for name in try FileManager.default.contentsOfDirectory(atPath: root.path) where name != keep {
                try FileManager.default.removeItem(at: root.appendingPathComponent(name))
            }
        }
        _ = try storage.directory(userId: userId)
        return ["status": "adopted"]
    }

    private static func completeOutbox(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let id = object["id"] as? String ?? ""
        try await store.complete(id: id)
        return ["status": "completed", "id": id]
    }

    private static func updateDisplayName(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let envelope = try await RaceDayAPI.updateDisplayName(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                userId: memberUserId(object),
                displayName: object["displayName"] as? String ?? ""
            )
            return [
                "offline": false,
                "userId": memberUserId(object),
                "displayName": object["displayName"] as? String ?? "",
                "memberships": membershipPayload(envelope.room.memberships)
            ]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "memberships": [] as [[String: Any]]]
            }
            throw error
        }
    }

    private static func removeMember(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            try await RaceDayAPI.removeMember(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                userId: memberUserId(object)
            )
            return ["offline": false, "removed": true]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "removed": false]
            }
            throw error
        }
    }

    private static func incidents(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let events = try await RaceDayAPI.incidents(graph: graph, roomId: object["roomId"] as? String ?? "")
            return ["offline": false, "incidents": events.map { incidentPayload($0) }]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "incidents": [] as [[String: Any]]]
            }
            throw error
        }
    }

    private static func createIncident(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let created = try await RaceDayAPI.createIncident(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                category: object["category"] as? String ?? "",
                severity: object["severity"] as? String ?? "",
                summary: object["summary"] as? String ?? "",
                checkpointId: text(object, "checkpointId")
            )
            return ["offline": false, "incident": incidentPayload(created)]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true]
            }
            throw error
        }
    }

    static func activityItemJSON(_ item: ActivityHistoryItem) -> [String: Any] {
        var json: [String: Any] = [
            "id": item.id,
            "source": item.source,
            "recordedAt": item.recordedAt,
            "summary": item.summary,
            "sourceLabel": item.sourceLabel,
            "dateLabel": item.dateLabel,
            "titleLabel": item.titleLabel
        ]
        if let name = item.name { json["name"] = name }
        if let label = item.subtitleDateLabel { json["subtitleDateLabel"] = label }
        if let label = item.distanceLabel { json["distanceLabel"] = label }
        if let label = item.durationLabel { json["durationLabel"] = label }
        if let label = item.paceLabel { json["paceLabel"] = label }
        if let distance = item.distanceMeters { json["distanceMeters"] = distance }
        if let elapsed = item.elapsedSeconds { json["elapsedSeconds"] = elapsed }
        return json
    }

    private static func activityHistoryItems(_ object: [String: Any]) async throws -> Any {
        do {
            let items = try await RaceDayAPI.activityHistoryItems(graph: try graph(object))
            return ["offline": false, "items": items.map(activityItemJSON), "countLabel": ActivityImport.countLabel(items.count)]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "items": [[String: Any]]()]
            }
            throw error
        }
    }

    /// `id` is the history row. Returns removed true, or removed false with offline and a user-facing `message`.
    private static func deleteActivity(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        switch await ActivityHistoryDelete.run(graph: graph, id: text(object, "id") ?? "") {
        case .removed:
            return ["removed": true, "offline": false]
        case .failed(let message, let offline):
            return ["removed": false, "offline": offline, "message": message]
        }
    }

    /// `contentBase64` is the file. Returns status saved, duplicate, empty, invalid or offline with
    /// a user-facing `message`; a server 400/413 comes back as `invalid` with the server's message.
    private static func importActivityFile(_ object: [String: Any]) async throws -> Any {
        let fileName = text(object, "fileName") ?? "activity"
        let data = Data(base64Encoded: object["contentBase64"] as? String ?? "") ?? Data()
        if let problem = ActivityImport.localProblem(fileName: fileName, byteCount: data.count) {
            return ["status": data.isEmpty ? "empty" : "invalid", "message": problem]
        }
        do {
            let result = try await RaceDayAPI.importActivityFile(graph: try graph(object), fileName: fileName, data: data)
            let message = result.status == .saved ? ActivityImport.successMessage : ActivityImport.duplicateMessage
            return ["status": result.status.rawValue, "message": message, "item": activityItemJSON(result.item)]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["status": "offline", "message": ActivityImport.offlineMessage]
            }
            if let http = error as? ClientHTTPError, http.status == 400 || http.status == 413 {
                return ["status": "invalid", "message": ActivityImport.message(for: error)]
            }
            throw error
        }
    }

    /// Share-sheet import (run-share-import): `signedIn`, `fileName`, `contentBase64`. Returns the
    /// next state: `state` signedOut, failed (with `message`) or preview (with title, confirm label,
    /// canImport, unreadable line and runs[] with summary, alreadyImported and track).
    /// The shared file: `filePath` (Android writes large shares to its cache) or `contentBase64`.
    private static func uploadData(_ object: [String: Any]) -> Data {
        if let path = text(object, "filePath"), let data = FileManager.default.contents(atPath: path) {
            return data
        }
        return Data(base64Encoded: object["contentBase64"] as? String ?? "") ?? Data()
    }

    private static func previewActivityUpload(_ object: [String: Any]) async -> Any {
        let fileName = text(object, "fileName") ?? "activity"
        let data = uploadData(object)
        let signedIn = object["signedIn"] as? Bool ?? true
        let start = SharedRunImport.start(signedIn: signedIn, fileName: fileName, byteCount: data.count)
        guard case .reading = start else { return sharedRunImportJSON(start) }
        let result: Result<ActivityUploadPreview, any Error>
        do {
            result = .success(try await RaceDayAPI.previewActivityUpload(graph: try graph(object), fileName: fileName, data: data))
        } catch {
            result = .failure(error)
        }
        return sharedRunImportJSON(SharedRunImport.afterPreview(result))
    }

    /// The runner confirmed: import every run in the file. Returns `state` done or failed with `message`.
    private static func importActivityUpload(_ object: [String: Any]) async -> Any {
        let fileName = text(object, "fileName") ?? "activity"
        let data = uploadData(object)
        let result: Result<ActivityUploadResult, any Error>
        do {
            result = .success(try await RaceDayAPI.importActivityUpload(graph: try graph(object), fileName: fileName, data: data))
        } catch {
            result = .failure(error)
        }
        return sharedRunImportJSON(SharedRunImport.afterImport(result))
    }

    /// Each length the list reaches as Show more is tapped, with the button's label at that point:
    /// `[{listed: 10, label: "Show 10 more"}, {listed: 20, label: "Show 20 more"}, …, {listed: 174}]`.
    static func showMoreSteps(_ preview: ActivityUploadPreview) -> [[String: Any]] {
        var steps: [[String: Any]] = []
        var taps = 0
        while true {
            var step: [String: Any] = ["listed": preview.listedCount(afterTaps: taps)]
            guard let label = preview.showMoreLabel(afterTaps: taps) else {
                steps.append(step)
                return steps
            }
            step["label"] = label
            steps.append(step)
            taps += 1
        }
    }

    private static func sharedRunImportJSON(_ state: SharedRunImportState) -> [String: Any] {
        switch state {
        case .signedOut:
            return ["state": "signedOut", "message": SharedRunImport.signedOutMessage]
        case .reading:
            return ["state": "reading", "message": SharedRunImport.readingMessage]
        case .importing:
            return ["state": "importing", "message": SharedRunImport.importingMessage]
        case .done(let message):
            return ["state": "done", "message": message]
        case .failed(let message):
            return ["state": "failed", "message": message]
        case .preview(let preview):
            var json: [String: Any] = [
                "state": "preview",
                "title": preview.title,
                "confirmLabel": preview.confirmLabel,
                "canImport": preview.canImport,
                // Every run; the app lists `showMoreSteps[taps].listed` of them.
                "runs": preview.runs.map { run -> [String: Any] in
                    [
                        "fileName": run.fileName,
                        "dateLabel": run.dateLabel,
                        "details": run.details.map { ["label": $0.label, "value": $0.value] },
                        "spokenSummary": run.spokenSummary,
                        "alreadyImported": run.alreadyImported,
                        "track": run.track
                    ]
                },
                "showMoreSteps": Self.showMoreSteps(preview),
                "alreadyImportedBadge": SharedRunImport.alreadyImportedBadge
            ]
            if let line = preview.unreadableLine { json["unreadableLine"] = line }
            if let line = preview.skippedLine { json["skippedLine"] = line }
            json["unreadable"] = preview.unreadable.map { ["fileName": $0.fileName, "error": $0.error] }
            return json
        }
    }

    private static func stravaStart(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let start = try await RaceDayAPI.stravaStart(graph: graph)
            return [
                "offline": false,
                "authorizeUrl": start.authorizeUrl,
                "state": start.state,
                "redirectUri": start.redirectUri
            ]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "authorizeUrl": "", "state": "", "redirectUri": ""]
            }
            throw error
        }
    }

    private static func stravaConnection(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            let connection = try await RaceDayAPI.stravaConnection(graph: graph)
            var payload: [String: Any] = [
                "offline": false,
                "connected": connection.connected ?? false
            ]
            if let athleteId = connection.athleteId?.trimmingCharacters(in: .whitespacesAndNewlines), !athleteId.isEmpty {
                payload["athleteId"] = athleteId
            }
            return payload
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "connected": false]
            }
            throw error
        }
    }

    private static func stravaDisconnect(_ object: [String: Any]) async throws -> Any {
        do {
            let graph = try graph(object)
            try await RaceDayAPI.stravaDisconnect(graph: graph)
            return ["offline": false, "connected": false]
        } catch {
            if TransportFailure.isOffline(error) {
                return ["offline": true, "connected": false]
            }
            throw error
        }
    }

    /// `deleted: true` only when the server confirmed; the app then signs out. A 401 still throws so
    /// the app's session-expired path runs. A confirmed delete also removes the user's onboarding
    /// progress, which sign-out keeps.
    /// `onboardingHistoryComparison`: withHistoryFinishAt, withoutHistoryFinishAt, optional timeZone (IANA id).
    /// Result `{"text": String?}`; text is null when the line should be hidden.
    private static func onboardingHistoryComparison(_ object: [String: Any]) throws -> Any {
        guard let with = text(object, "withHistoryFinishAt"), let without = text(object, "withoutHistoryFinishAt") else {
            throw ClientHTTPError(status: 400, message: "withHistoryFinishAt and withoutHistoryFinishAt are required.")
        }
        let zone = text(object, "timeZone").flatMap(DeviceTimeZone.resolve) ?? DeviceTimeZone.current
        let line = OnboardingCopy.historyComparison(withHistoryFinishAt: with, withoutHistoryFinishAt: without, timeZone: zone)
        return ["text": line ?? NSNull()] as [String: Any]
    }

    private static func deleteAccount(_ object: [String: Any]) async throws -> Any {
        try await deleteAccount(graph: try graph(object), onboarding: try? onboardingStore(object), userId: text(object, "userId"))
    }

    static func deleteAccount(graph: ClientGraph, onboarding: OnboardingStore? = nil, userId: String? = nil) async throws -> [String: Any] {
        switch await AccountDeletion.run(graph: graph, onboarding: onboarding, userId: userId) {
        case let .deleted(identityProvider):
            return ["deleted": true, "identityProvider": identityProvider]
        case let .failed(message, retryable):
            if message == AccountDeletion.expiredMessage {
                throw ClientHTTPError(status: 401, message: message)
            }
            return ["deleted": false, "message": message, "retryable": retryable]
        }
    }

    /// `DELETE /race-rooms/:roomId` for Android. `deleted` is true once the race is gone (a 404
    /// included); otherwise `message` is the shared failure copy. A 401 still throws, so the app
    /// wipes the expired session as for every other op.
    static func deleteRace(graph: ClientGraph, roomId: String) async throws -> [String: Any] {
        guard !roomId.isEmpty else { throw ClientHTTPError(status: 400, message: "roomId is required.") }
        let outcome: RaceDeletion.Outcome
        do {
            try await RaceDayAPI.deleteRace(graph: graph, roomId: roomId)
            outcome = .deleted
        } catch let failure as ClientHTTPError where failure.status == 401 {
            throw failure
        } catch {
            outcome = RaceDeletion.outcome(for: error)
        }
        switch outcome {
        case .deleted:
            return ["deleted": true, "message": RaceDeletion.deletedMessage]
        case let .failed(message):
            return ["deleted": false, "message": message]
        }
    }

    /// Every Delete race string Android shows, the confirm built for this race's name and paid state.
    static func raceDeletionCopy(raceName: String, paid: Bool) -> [String: String] {
        [
            "rowTitle": RaceDeletion.rowTitle,
            "rowDetail": RaceDeletion.rowDetail,
            "confirmTitle": RaceDeletion.confirmTitle(raceName: raceName),
            "confirmBody": RaceDeletion.confirmBody(paid: paid),
            "confirmButton": RaceDeletion.confirmButton,
            "cancelButton": RaceDeletion.cancelButton,
            "deletedMessage": RaceDeletion.deletedMessage,
            "offlineMessage": RaceDeletion.offlineMessage,
            "genericFailureMessage": RaceDeletion.genericFailureMessage
        ]
    }

    /// `PATCH /race-rooms/:roomId` `{ name }` for Android. `renamed` is true with the room's `id`
    /// and saved `name`; otherwise `message` is the shared failure line (`RaceRenameCopy.message`).
    /// A 401 still throws, so the app wipes the expired session as for every other op.
    static func renameRace(graph: ClientGraph, roomId: String, name: String) async throws -> [String: Any] {
        guard !roomId.isEmpty else { throw ClientHTTPError(status: 400, message: "roomId is required.") }
        do {
            let room = try await RaceDayAPI.renameRace(graph: graph, roomId: roomId, name: name)
            return ["renamed": true, "id": room.id, "name": room.name, "message": RaceRenameCopy.saved]
        } catch let failure as ClientHTTPError where failure.status == 401 {
            throw failure
        } catch {
            return ["renamed": false, "message": RaceRenameCopy.message(for: error)]
        }
    }

    /// Every Rename race string Android shows, and whether [role] may rename (`PlanAuthority.mayEditRaceSetup`).
    static func raceRenameCopy(role: String) -> [String: Any] {
        [
            "rowTitle": RaceRenameCopy.rowTitle,
            "rowDetail": RaceRenameCopy.rowDetail,
            "hint": RaceRenameCopy.hint,
            "saved": RaceRenameCopy.saved,
            "failed": RaceRenameCopy.failed,
            "offline": RaceRenameCopy.offline,
            "invalid": RaceName.invalidMessage,
            "maxLength": RaceName.maxLength,
            "mayRename": PlanAuthority.mayEditRaceSetup(role: role)
        ]
    }

    private static func memberUserId(_ object: [String: Any]) -> String {
        text(object, "memberUserId") ?? ""
    }

    private static func incidentPayload(_ event: IncidentEvent) -> [String: Any] {
        var payload: [String: Any] = [
            "id": event.id,
            "summary": event.summary,
            "category": event.category,
            "severity": event.severity
        ]
        if let checkpointId = event.checkpointId?.trimmingCharacters(in: .whitespacesAndNewlines), !checkpointId.isEmpty {
            payload["checkpointId"] = checkpointId
        }
        return payload
    }

    private static func membershipPayload(_ memberships: [RaceRoomMembership]) -> [[String: Any]] {
        memberships.compactMap { membership -> [String: Any]? in
            let userId = membership.userId.trimmingCharacters(in: .whitespacesAndNewlines)
            if userId.isEmpty { return nil }
            var row: [String: Any] = ["userId": userId, "role": membership.role]
            if let displayName = membership.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !displayName.isEmpty {
                row["displayName"] = displayName
            }
            return row
        }
    }

    private static func stringList(_ value: Any?) -> [String] {
        if let list = value as? [String] { return list }
        if let list = value as? [Any] { return list.compactMap { $0 as? String } }
        return []
    }

    private static func jsonValue<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    /// A replay's requests read and write its temporary directory, never the app's storage; a
    /// retired replay has none.
    private static func storageRoot(_ object: [String: Any]) -> URL? {
        if demoURL(object) != nil {
            return demoRace(object)?.cacheDirectory
        }
        guard let path = object["storageDir"] as? String, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// The signed-in user's directory under the storage root. The outbox keys rows by room itself.
    /// A replay's is under its temporary directory, and none once the replay ended.
    static func userDirectory(_ object: [String: Any]) -> URL? {
        let userId = object["userId"] as? String ?? ""
        if demoURL(object) != nil {
            return try? demoRace(object)?.userDirectory(userId: userId)
        }
        guard let root = storageRoot(object) else { return nil }
        return try? UserStorage(root: root).directory(userId: userId)
    }

    /// Per-room caches and drafts. Nil without a room, so one race never reads another's files.
    private static func directory(_ object: [String: Any]) -> URL? {
        guard let root = userDirectory(object), let roomId = text(object, "roomId") else { return nil }
        return RoomStorage.directory(userDirectory: root, roomId: roomId)
    }

    static func store(_ object: [String: Any]) throws -> OutboxStore {
        guard demoURL(object) == nil else {
            throw DemoRaceError.readOnly("the replay has no outbox")
        }
        guard let directory = userDirectory(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        return try OutboxStore.shared(userId: object["userId"] as? String ?? "guest", directory: directory)
    }

    static func graph(_ object: [String: Any]) throws -> ClientGraph {
        guard let base = object["baseURL"] as? String, let baseURL = URL(string: base) else {
            throw ClientHTTPError(status: 0, message: "baseURL is required.")
        }
        if DemoRace.isDemo(baseURL) {
            guard let demo = DemoRuntimes.shared.session(for: baseURL) else { throw DemoRaceError.ended }
            return demo.graph
        }
        let token = object["token"] as? String
        let outbox = try? store(object)
        return ClientGraph(
            transport: transportForTests.get(baseURL: base) ?? URLSessionTransport(),
            clock: SystemClock(),
            logger: SilentRuntimeLogger(),
            baseURL: baseURL,
            tokenProvider: StaticTokenProvider(token: token),
            outbox: outbox
        )
    }

    /// The clock readouts use: a replay's scripted clock, else the system clock.
    static func clock(_ object: [String: Any]) -> any Clock {
        demoRace(object)?.graph.clock ?? SystemClock()
    }

    static func text(_ object: [String: Any], _ key: String) -> String? {
        guard let value = object[key] as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func boolValue(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        return nil
    }

    static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let number = value as? Int { return number }
        return nil
    }

    static func doubleValue(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
    }

    private static func isoNow(_ object: [String: Any]) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: clock(object).now())
    }
}

private struct PersistedEstimateRecord: Codable {
    var estimateId: String?
    var fingerprint: String?
}

private enum EstimateRecordFile {
    static func file(_ directory: URL) -> URL {
        directory.appendingPathComponent("estimate-record.json")
    }

    static func load(_ directory: URL?) -> EstimateHistoryRecord {
        guard let directory,
              let data = try? Data(contentsOf: file(directory)),
              let saved = try? JSONDecoder().decode(PersistedEstimateRecord.self, from: data) else {
            return .empty
        }
        return EstimateHistoryRecord(estimateId: saved.estimateId, fingerprint: saved.fingerprint)
    }

    static func save(_ record: EstimateHistoryRecord, _ directory: URL?) {
        guard let directory else { return }
        let saved = PersistedEstimateRecord(estimateId: record.estimateId, fingerprint: record.fingerprint)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? JSONEncoder().encode(saved).write(to: file(directory), options: .atomic)
    }
}

struct SilentRuntimeLogger: Logger {
    func log(_ message: String) {}
}

private final class CapturingTransport: HTTPTransport, @unchecked Sendable {
    private let inner: any HTTPTransport
    private let lock = NSLock()
    private var body: Data?

    init(_ inner: any HTTPTransport) {
        self.inner = inner
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let response = try await inner.send(request)
        remember(response.body)
        return response
    }

    private func remember(_ data: Data) {
        lock.lock()
        body = data
        lock.unlock()
    }

    var lastBody: Data? {
        lock.lock()
        defer { lock.unlock() }
        return body
    }
}

/// Course geometry from a race-room document. The workspace line is the course polyline.
enum CoursePayload {
    static func empty(offline: Bool) -> [String: Any] {
        [
            "offline": offline,
            "checkpoints": [] as [[String: Any]],
            "line": [] as [[Double]],
            "elevation": [] as [[Double]],
            "memberships": [] as [[String: Any]]
        ]
    }

    static func make(from data: Data) -> [String: Any] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return empty(offline: false)
        }
        return make(room: (root["room"] as? [String: Any]) ?? root)
    }

    /// The course a `gpx-preview` answer describes (`course`, `routeOverlayLayer`), before it is
    /// saved: the same `line`, `checkpoints` and `elevation` as a saved room, plus the server's
    /// `plannedPaceSecondsPerKm` for the GPX.
    static func preview(from data: Data) -> [String: Any] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return empty(offline: false)
        }
        var room: [String: Any] = [:]
        if let course = root["course"] { room["course"] = course }
        if let layer = root["routeOverlayLayer"] as? [String: Any] {
            room["mapWorkspace"] = ["layers": [layer], "selectedLayerId": layer["id"] ?? NSNull()] as [String: Any]
        }
        var payload = make(room: room)
        payload["courseFileName"] = (root["courseFileName"] as? String) ?? ""
        if let pace = number(root["plannedPaceSecondsPerKm"]), pace > 0 {
            payload["plannedPaceSecondsPerKm"] = pace
        }
        return payload
    }

    private static func make(room: [String: Any]) -> [String: Any] {
        let checkpoints = checkpointRows(room)
        let geometry = workspaceGeometry(room)
        let drawn = coordinates(from: geometry)
        let line = drawn.count >= 2 ? drawn : checkpointLine(checkpoints)
        let planned = elevationRows(room)
        return [
            "offline": false,
            "checkpoints": checkpoints,
            // Runner setup's line under the map ("31.1 mi · 4 checkpoints"), as iOS writes it. "" with no course.
            "summary": summary(line: line, checkpoints: checkpoints.count),
            "name": (room["name"] as? String) ?? "",
            // Android shows Remove member only to the race's athlete, as the API allows.
            "athleteId": (room["athleteId"] as? String) ?? "",
            // The saved course's file name, for runner setup's "Course saved" on a phone without the file.
            "courseFileName": (room["courseFileName"] as? String) ?? "",
            "line": line,
            // An unpaid race's teaser has no baseline track, so its profile comes from the route.
            "elevation": planned.isEmpty ? geometryElevation(geometry) : planned,
            "memberships": membershipRows(room)
        ]
    }

    /// `OnboardingCopy.courseSummary` for the course drawn: its length along `line` (the route,
    /// else the checkpoints: the rule `CoursePreview.lengthMeters` follows) and its checkpoint
    /// count. "" when there are no checkpoints.
    static func summary(line: [[Double]], checkpoints: Int) -> String {
        guard checkpoints > 0 else { return "" }
        let route = line.compactMap { pair in
            pair.count >= 2 ? CourseRoutePoint(latitude: pair[1], longitude: pair[0]) : nil
        }
        let length = CoursePreview(courseFileName: "", checkpoints: [], plannedPaceSecondsPerKm: nil, route: route).lengthMeters
        return OnboardingCopy.courseSummary(lengthMeters: length, checkpoints: checkpoints)
    }

    /// `[distanceMeters, elevationMeters]` along the route line, from each vertex's third value
    /// (GeoJSON altitude), distances summed great-circle from the first vertex. Empty when fewer
    /// than two vertices carry an elevation.
    static func geometryElevation(_ geometry: Any?) -> [[Double]] {
        var rows: [[Double]] = []
        var distance = 0.0
        var previous: (latitude: Double, longitude: Double)?
        for vertex in vertices(from: geometry) {
            if let previous {
                distance += greatCircleMeters(previous.latitude, previous.longitude, vertex.latitude, vertex.longitude)
            }
            previous = (vertex.latitude, vertex.longitude)
            if let elevation = vertex.elevation { rows.append([distance, elevation]) }
        }
        return rows.count >= 2 ? rows : []
    }

    private static func greatCircleMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let radius = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * asin(min(1, sqrt(a)))
    }

    /// `[distanceMeters, elevationMeters]` pairs from the course baseline track.
    private static func elevationRows(_ room: [String: Any]) -> [[Double]] {
        let track = ((room["course"] as? [String: Any])?["baselineTrack"] as? [String: Any])?["points"] as? [Any] ?? []
        return track.compactMap { item in
            guard let row = item as? [String: Any],
                  let distance = number(row["distanceMetersFromStart"]),
                  let elevation = number(row["elevationMeters"]) else {
                return nil
            }
            return [distance, elevation]
        }
    }

    private static func membershipRows(_ room: [String: Any]) -> [[String: Any]] {
        let source = (room["memberships"] as? [Any]) ?? []
        return source.compactMap { item in
            guard let row = item as? [String: Any],
                  let userId = row["userId"] as? String,
                  !userId.isEmpty else {
                return nil
            }
            var member: [String: Any] = [
                "userId": userId,
                "role": (row["role"] as? String) ?? ""
            ]
            if let displayName = row["displayName"] as? String {
                let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    member["displayName"] = trimmed
                }
            }
            return member
        }
    }

    private static func checkpointRows(_ room: [String: Any]) -> [[String: Any]] {
        let courseRows = ((room["course"] as? [String: Any])?["checkpoints"] as? [Any]) ?? []
        let workspaceRows = ((room["mapWorkspace"] as? [String: Any])?["checkpoints"] as? [Any]) ?? []
        let source = courseRows.isEmpty ? workspaceRows : courseRows
        let parsed: [(distance: Double, row: [String: Any])] = source.compactMap { item in
            guard let row = item as? [String: Any],
                  let id = row["id"] as? String,
                  let latitude = number(row["latitude"]),
                  let longitude = number(row["longitude"]) else {
                return nil
            }
            let title = ScheduleFormat.checkpointDisplayTitle(id: id, title: row["title"] as? String)
            var payload: [String: Any] = [
                "id": id,
                "title": title,
                "latitude": latitude,
                "longitude": longitude
            ]
            if let distance = number(row["distanceMetersFromStart"]) {
                payload["distanceMetersFromStart"] = distance
            }
            if let stoppage = number(row["plannedStopSeconds"]) {
                payload["plannedStopSeconds"] = stoppage
            }
            return (number(row["distanceMetersFromStart"]) ?? 0, payload)
        }
        return parsed.sorted { $0.distance < $1.distance }.map(\.row)
    }

    /// The saved course line's vertices (the driving layer of `mapWorkspace`), for `CourseRouteLine`.
    static func routeVertices(room: [String: Any]) -> [(longitude: Double, latitude: Double, elevation: Double?)] {
        vertices(from: workspaceGeometry(room))
    }

    /// The geometry of the layer that drives the projection (else the selected one, else the first
    /// with a line), or nil.
    private static func workspaceGeometry(_ room: [String: Any]) -> Any? {
        guard let workspace = room["mapWorkspace"] as? [String: Any] else { return nil }
        let layers = ((workspace["layers"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }
        let driver = (workspace["drivesProjectionLayerId"] as? String) ?? (workspace["selectedLayerId"] as? String)
        let chosen: [String: Any]?
        if let driver, let match = layers.first(where: { ($0["id"] as? String) == driver }) {
            chosen = match
        } else {
            chosen = layers.first { coordinates(from: $0["geometry"]).count >= 2 }
        }
        return chosen?["geometry"]
    }

    private static func coordinates(from geometry: Any?) -> [[Double]] {
        vertices(from: geometry).map { [$0.longitude, $0.latitude] }
    }

    private static func vertices(from geometry: Any?) -> [(longitude: Double, latitude: Double, elevation: Double?)] {
        guard let geometry = geometry as? [String: Any],
              let coordinates = geometry["coordinates"] as? [Any] else {
            return []
        }
        switch geometry["type"] as? String {
        case "LineString":
            return coordinates.compactMap(position)
        case "MultiLineString":
            return coordinates.flatMap { item in
                (item as? [Any])?.compactMap(position) ?? []
            }
        default:
            return []
        }
    }

    private static func position(_ value: Any) -> (longitude: Double, latitude: Double, elevation: Double?)? {
        guard let pair = value as? [Any], pair.count >= 2,
              let longitude = number(pair[0]),
              let latitude = number(pair[1]) else {
            return nil
        }
        let elevation = pair.count >= 3 ? number(pair[2]) : nil
        return (longitude, latitude, elevation)
    }

    private static func checkpointLine(_ checkpoints: [[String: Any]]) -> [[Double]] {
        let line: [[Double]] = checkpoints.compactMap { row in
            guard let latitude = number(row["latitude"]), let longitude = number(row["longitude"]) else { return nil }
            return [longitude, latitude]
        }
        return line.count >= 2 ? line : []
    }

    private static func number(_ value: Any?) -> Double? {
        JSONNumber.double(value)
    }
}

private final class BridgeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?
    func set(_ value: String) {
        lock.lock()
        stored = value
        lock.unlock()
    }
    var value: String? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

@_cdecl("crewcue_runtime_json")
public func crewcue_runtime_json(_ request: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let json = request.map { String(cString: $0) } ?? ""
    let box = BridgeBox()
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached {
        let value = await RuntimeCall.perform(json)
        box.set(value)
        semaphore.signal()
    }
    semaphore.wait()
    return strdup(box.value ?? #"{"ok":false,"message":"bridge failed"}"#)
}

