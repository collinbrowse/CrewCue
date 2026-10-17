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
/// projectAidSheet,
/// readCourseSettings, writeCourseSettings, featureScreen, previewJoin, join,
/// myRaces, loadRoom, placeCheckpoint, route, enqueuePing, streamToken, parseMentions,
/// notificationPreference, saveNotificationPreference, enqueuePush, enqueueChat,
/// completeOutbox, claimChat, claimPendingChat, settleChat, wipeUserData, adoptUser, updateDisplayName, removeMember,
/// incidents, createIncident, stravaStart, stravaConnection, stravaDisconnect.
///
/// `storageDir` is the app's storage root. Per-user files live under `UserStorage(root:)` keyed
/// by `userId`. A failure on a 401 carries `sessionExpired: true` so the app wipes the session.
enum RuntimeCall {
    static func perform(_ json: String) async -> String {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let op = object["op"] as? String else {
            return #"{"ok":false,"message":"Invalid runtime request."}"#
        }
        do {
            let value = try await dispatch(op, object)
            let encoded = try JSONSerialization.data(withJSONObject: ["ok": true, "result": value])
            return String(decoding: encoded, as: UTF8.self)
        } catch {
            return failureJSON(error)
        }
    }

    static func failureJSON(_ error: any Error) -> String {
        let message: String
        if let authority = error as? PlanAuthorityError {
            message = authority.message
        } else {
            message = (error as? ClientHTTPError)?.message ?? "\(error)"
        }
        let expired = (error as? ClientHTTPError)?.status == 401
        let object: [String: Any] = ["ok": false, "message": message, "sessionExpired": expired]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
            return #"{"ok":false,"message":"Request failed."}"#
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func dispatch(_ op: String, _ object: [String: Any]) async throws -> Any {
        switch op {
        case "featureScreen":
            let url = object["url"] as? String ?? ""
            return CrewCueClientCore.featureScreenJSON(forCrewCueURL: url)
        case "openSession":
            return "opened"
        case "loadSchedule":
            return try await loadSchedule(object)
        case "projectAidSheet":
            return projectAidSheet(object)
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
            let report = try await RaceDayAPI.flushOutbox(graph: graph)
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
        case "readCourseSettings":
            return try await readCourseSettings(object)
        case "writeCourseSettings":
            return try writeCourseSettings(object)
        case "previewJoin":
            let graph = try graph(object)
            let code = object["code"] as? String ?? ""
            let preview = try await RaceDayAPI.previewJoin(graph: graph, code: code)
            return try jsonValue(preview)
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
        case "placeCheckpoint":
            return try await placeCheckpoint(object)
        case "route":
            return try await route(object)
        case "enqueuePing":
            return try await enqueuePing(object)
        case "streamToken":
            return try await streamToken(object)
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
        case "completeOutbox":
            return try await completeOutbox(object)
        case "claimChat":
            let claimed = try await store(object).claimChat(id: object["id"] as? String ?? "")
            return ["claimed": claimed]
        case "claimPendingChat":
            return try await claimPendingChat(object)
        case "settleChat":
            return try await settleChat(object)
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
        case "stravaStart":
            return try await stravaStart(object)
        case "stravaConnection":
            return try await stravaConnection(object)
        case "stravaDisconnect":
            return try await stravaDisconnect(object)
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

    private static func requestProgress(_ request: [String: Any], _ checkpoints: [AidStationCheckpoint]) -> Double {
        if let latitude = requestNumber(request["latitude"]), let longitude = requestNumber(request["longitude"]) {
            return AidStationSheet.progressMeters(latitude: latitude, longitude: longitude, checkpoints: checkpoints)
        }
        return requestNumber(request["progressMeters"]) ?? 0
    }

    private static func requestNow(_ request: [String: Any]) -> Date {
        requestNumber(request["nowMs"]).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
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
        let readout = RaceDayReadouts.make(
            sheet: sheet,
            checkpoints: checkpoints,
            progressMeters: requestProgress(request, checkpoints),
            now: requestNow(request),
            lastPingAt: requestNumber(request["lastPingAtMs"]).map { Date(timeIntervalSince1970: $0 / 1000) }
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
            "averagePaceLabel": readout.averagePaceLabel
        ]
        if let ping = readout.lastPingLabel {
            row["lastPingLabel"] = ping
        }
        return row
    }

    private static func timelinePayload(sheet: CrewScheduleSheet?, request: [String: Any]) -> [[String: Any]] {
        let checkpoints = aidCheckpoints(request["checkpoints"])
        return RaceDayReadouts.timeline(
            sheet: sheet,
            checkpoints: checkpoints,
            progressMeters: requestProgress(request, checkpoints)
        ).map { item in
            var row: [String: Any] = [
                "checkpointId": item.checkpointId,
                "state": item.state.rawValue,
                "kicker": item.kicker,
                "title": item.title,
                "distanceToLabel": item.distanceToLabel,
                "isFinish": item.isFinish
            ]
            if let arrival = item.clockArrivalAt { row["clockArrivalAt"] = arrival }
            if let cutoff = item.cutoffAt { row["cutoffAt"] = cutoff }
            if let status = item.cutoffStatus { row["cutoffStatus"] = status }
            return row
        }
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
            elevation: elevationProfile(request["elevation"])
        )
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
        if value is Bool || value is NSNull { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
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
        let lines = sheet.stops.map {
            ScheduleFormat.scheduleLine(
                checkpointId: $0.checkpointId,
                elapsedSeconds: $0.elapsedSeconds,
                clockArrivalAt: $0.clockArrivalAt
            )
        }
        return [
            "offline": offline,
            "raceStartAt": sheet.raceStartAt,
            "lines": lines,
            "checkpointIds": sheet.stops.map(\.checkpointId),
            "sheet": try jsonValue(sheet),
            "aidSheet": AidStationSheet.payload(aidProjection(sheet: sheet, request: request)),
            "readout": readoutPayload(sheet: sheet, request: request),
            "timeline": timelinePayload(sheet: sheet, request: request)
        ]
    }

    private static func loadEstimate(_ object: [String: Any]) async throws -> Any {
        let role = object["role"] as? String ?? ""
        let directory = directory(object)
        let record = EstimateRecordFile.load(directory)
        do {
            let graph = try graph(object)
            let roomId = object["roomId"] as? String ?? ""
            let envelope = try await RaceDayAPI.loadRoom(graph: graph, roomId: roomId)
            let estimate = envelope.room.pacingEstimate
            if let estimate, let directory {
                try? EstimateCache.save(estimate, directory: directory)
            }
            let input = recomputeInput(object, estimate: estimate, record: record)
            let decision = RaceDayAPI.decideAutoRecompute(role: role, input: input)
            if !decision.recompute {
                EstimateRecordFile.save(decision.nextRecord, directory)
            }
            var payload = estimatePayload(
                estimate,
                role: role,
                offline: false,
                recompute: decision.recompute,
                reason: decision.reason.rawValue,
                usableHistoryCount: input.usableHistoryCount,
                historyFingerprint: input.historyFingerprint
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
                    historyFingerprint: nil
                )
            }
            throw error
        }
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

    private static func computeEstimate(_ object: [String: Any]) async throws -> Any {
        let role = object["role"] as? String ?? ""
        // Without a trigger the request is an automatic recompute, which only the athlete may make.
        let trigger = text(object, "trigger").flatMap(PlanTrigger.init(rawValue:)) ?? .auto
        let hasPlanOfRecord = (object["hasPlanOfRecord"] as? Bool) ?? true
        guard PlanAuthority.allows(role: role, trigger: trigger, hasPlanOfRecord: hasPlanOfRecord) else {
            throw PlanAuthorityError.notAllowed
        }
        let directory = directory(object)
        do {
            let graph = try graph(object)
            let attached = try await PlanOfRecord.recompute(
                graph: graph,
                roomId: object["roomId"] as? String ?? "",
                role: role,
                trigger: trigger,
                hasPlanOfRecord: hasPlanOfRecord
            )
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
            return estimatePayload(
                attached,
                role: role,
                offline: false,
                recompute: false,
                reason: EstimateRecomputeReason.none.rawValue,
                usableHistoryCount: count,
                historyFingerprint: fingerprint
            )
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
                    historyFingerprint: text(object, "historyFingerprint")
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
            if start.isEmpty || pace <= 0 {
                throw ClientHTTPError(status: 400, message: "Couldn't read the route file.")
            }
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
        let lines = sheet.stops.map {
            ScheduleFormat.scheduleLine(
                checkpointId: $0.checkpointId,
                elapsedSeconds: $0.elapsedSeconds,
                clockArrivalAt: $0.clockArrivalAt
            )
        }
        let text = ScheduleFormat.crewSheetText(roomId: sheet.roomId, capturedAtIso: isoNow(), stopLines: lines)
        return ["empty": false, "text": text]
    }

    private static func readCourseSettings(_ object: [String: Any]) async throws -> Any {
        let directory = directory(object)
        if let directory, let existing = try? CourseSettingsDraft.load(directory: directory) {
            return coursePayload(existing, empty: blankDraft(existing), offline: false, saved: false)
        }
        do {
            let graph = try graph(object)
            let roomId = object["roomId"] as? String ?? ""
            let seed = try await RaceDayAPI.courseDraftSeed(graph: graph, roomId: roomId)
            return coursePayload(seed, empty: blankDraft(seed), offline: false, saved: false)
        } catch {
            if TransportFailure.isOffline(error) {
                let empty = CourseSettingsDraft(cutoffNote: "", stoppageSeconds: 0)
                return coursePayload(empty, empty: true, offline: true, saved: false)
            }
            throw error
        }
    }

    private static func writeCourseSettings(_ object: [String: Any]) throws -> Any {
        guard let directory = directory(object) else {
            throw ClientHTTPError(status: 0, message: "Couldn't save course settings.")
        }
        let draft = CourseSettingsDraft(
            cutoffNote: object["cutoffNote"] as? String ?? "",
            stoppageSeconds: doubleValue(object["stoppageSeconds"]) ?? 0
        )
        do {
            try CourseSettingsDraft.save(draft, directory: directory)
        } catch {
            throw ClientHTTPError(status: 0, message: "Couldn't save course settings.")
        }
        return coursePayload(draft, empty: false, offline: false, saved: true)
    }

    private static func coursePayload(_ draft: CourseSettingsDraft, empty: Bool, offline: Bool, saved: Bool) -> [String: Any] {
        [
            "cutoffNote": draft.cutoffNote,
            "stoppageSeconds": draft.stoppageSeconds,
            "empty": empty,
            "offline": offline,
            "saved": saved
        ]
    }

    private static func blankDraft(_ draft: CourseSettingsDraft) -> Bool {
        draft.cutoffNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.stoppageSeconds == 0
    }

    private static func estimatePayload(
        _ estimate: PacingEstimate?,
        role: String,
        offline: Bool,
        recompute: Bool,
        reason: String,
        usableHistoryCount: Int,
        historyFingerprint: String?
    ) -> [String: Any] {
        [
            "hasEstimate": estimate != nil,
            "coldStart": estimate?.coldStart ?? false,
            "estimateId": estimate?.id ?? "",
            "summary": estimate.map(estimateSummary) ?? "",
            "offline": offline,
            "recompute": recompute,
            "reason": reason,
            "usableHistoryCount": usableHistoryCount,
            "historyFingerprint": historyFingerprint ?? "",
            "mayRecalculate": PlanAuthority.mayExplicitRecalculate(role: role),
            "mayAutoRecompute": PlanAuthority.mayAutoRecompute(role: role)
        ]
    }

    private static func estimateSummary(_ estimate: PacingEstimate) -> String {
        let elapsed = ScheduleFormat.formatDurationSeconds(estimate.expectedFinishElapsedSeconds)
        let clock = ScheduleFormat.formatUtcHhMm(estimate.expectedFinishAt)
        let finish = "Finish \(elapsed)  \(clock)"
        if estimate.explanation.isEmpty { return finish }
        return "\(estimate.explanation)\n\(finish)"
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
    private static func myRaces(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let userId = object["userId"] as? String ?? ""
        let races = try await RaceDayAPI.myRaces(graph: graph, userId: userId)
        let roster = RaceRoster.reconciled(races: races, preferred: text(object, "roomId"))
        return [
            "races": try races.map { race -> Any in
                var row = try jsonValue(race) as? [String: Any] ?? [:]
                row["roleLabel"] = race.roleLabel
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

    private static func placeCheckpoint(_ object: [String: Any]) async throws -> Any {
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

    private static func streamToken(_ object: [String: Any]) async throws -> Any {
        let roomId = object["roomId"] as? String ?? ""
        let channelId = RaceDayAPI.channelId(roomId: roomId)
        do {
            let graph = try graph(object)
            let minted = try await RaceDayAPI.streamToken(graph: graph, roomId: roomId)
            let authors = ChatAuthors(token: minted)
            return [
                "token": minted.token,
                "streamUserId": minted.streamUserId,
                "streamApiKey": minted.streamApiKey,
                "channelId": channelId,
                "authorNames": authors.names,
                "selfAuthor": authors.selfLabel,
                "unknownAuthor": ChatAuthors.unknown,
                "offline": false
            ]
        } catch {
            if TransportFailure.isOffline(error) {
                return [
                    "token": "",
                    "streamUserId": "",
                    "streamApiKey": "",
                    "channelId": channelId,
                    "authorNames": [String: String](),
                    "selfAuthor": ChatAuthors.you,
                    "unknownAuthor": ChatAuthors.unknown,
                    "offline": true
                ]
            }
            throw error
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

    /// Pending chat for the room that no other caller is already sending.
    private static func claimPendingChat(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let claimed = try await store.claimPendingChat(roomId: object["roomId"] as? String ?? "")
        let messages: [[String: Any]] = claimed.map { operation in
            [
                "id": operation.id,
                "clientMessageId": operation.clientMessageId,
                "text": chatText(operation.payloadJSON)
            ]
        }
        return ["messages": messages]
    }

    /// Ends a claim. No `error` means delivered; an "already exists" error also counts as delivered.
    private static func settleChat(_ object: [String: Any]) async throws -> Any {
        let store = try store(object)
        let id = object["id"] as? String ?? ""
        let failure = text(object, "error").map { RuntimeSendFailure(description: $0) }
        try await store.settleChat(id: id, error: failure)
        let delivered = failure.map(OutboxPolicy.isAlreadyDelivered) ?? true
        return ["status": delivered ? "delivered" : "pending", "id": id]
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

    private static func chatText(_ payloadJSON: String) -> String {
        guard let data = payloadJSON.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ""
        }
        return object["text"] as? String ?? ""
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

    private static func storageRoot(_ object: [String: Any]) -> URL? {
        guard let path = object["storageDir"] as? String, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// The signed-in user's directory under the storage root. The outbox keys rows by room itself.
    private static func userDirectory(_ object: [String: Any]) -> URL? {
        guard let root = storageRoot(object) else { return nil }
        return try? UserStorage(root: root).directory(userId: object["userId"] as? String ?? "")
    }

    /// Per-room caches and drafts. Nil without a room, so one race never reads another's files.
    private static func directory(_ object: [String: Any]) -> URL? {
        guard let root = userDirectory(object), let roomId = text(object, "roomId") else { return nil }
        return RoomStorage.directory(userDirectory: root, roomId: roomId)
    }

    private static func store(_ object: [String: Any]) throws -> OutboxStore {
        guard let directory = userDirectory(object) else {
            throw ClientHTTPError(status: 0, message: "storageDir is required.")
        }
        return try OutboxStore.shared(userId: object["userId"] as? String ?? "guest", directory: directory)
    }

    private static func graph(_ object: [String: Any]) throws -> ClientGraph {
        guard let base = object["baseURL"] as? String, let baseURL = URL(string: base) else {
            throw ClientHTTPError(status: 0, message: "baseURL is required.")
        }
        let token = object["token"] as? String
        let outbox = try? store(object)
        return ClientGraph(
            transport: URLSessionTransport(),
            clock: SystemClock(),
            logger: SilentRuntimeLogger(),
            baseURL: baseURL,
            tokenProvider: StaticTokenProvider(token: token),
            outbox: outbox
        )
    }

    private static func text(_ object: [String: Any], _ key: String) -> String? {
        guard let value = object[key] as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let number = value as? Int { return number }
        return nil
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
    }

    private static func isoNow() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
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

private struct SilentRuntimeLogger: Logger {
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
        let room = (root["room"] as? [String: Any]) ?? root
        let checkpoints = checkpointRows(room)
        let drawn = workspaceLine(room)
        let line = drawn.count >= 2 ? drawn : checkpointLine(checkpoints)
        return [
            "offline": false,
            "checkpoints": checkpoints,
            "name": (room["name"] as? String) ?? "",
            "line": line,
            "elevation": elevationRows(room),
            "memberships": membershipRows(room)
        ]
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

    private static func workspaceLine(_ room: [String: Any]) -> [[Double]] {
        guard let workspace = room["mapWorkspace"] as? [String: Any] else { return [] }
        let layers = ((workspace["layers"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }
        let driver = (workspace["drivesProjectionLayerId"] as? String) ?? (workspace["selectedLayerId"] as? String)
        let chosen: [String: Any]?
        if let driver, let match = layers.first(where: { ($0["id"] as? String) == driver }) {
            chosen = match
        } else {
            chosen = layers.first { coordinates(from: $0["geometry"]).count >= 2 }
        }
        guard let chosen else { return [] }
        return coordinates(from: chosen["geometry"])
    }

    private static func coordinates(from geometry: Any?) -> [[Double]] {
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

    private static func position(_ value: Any) -> [Double]? {
        guard let pair = value as? [Any], pair.count >= 2,
              let longitude = number(pair[0]),
              let latitude = number(pair[1]) else {
            return nil
        }
        return [longitude, latitude]
    }

    private static func checkpointLine(_ checkpoints: [[String: Any]]) -> [[Double]] {
        let line: [[Double]] = checkpoints.compactMap { row in
            guard let latitude = number(row["latitude"]), let longitude = number(row["longitude"]) else { return nil }
            return [longitude, latitude]
        }
        return line.count >= 2 ? line : []
    }

    private static func number(_ value: Any?) -> Double? {
        if value is Bool { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
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

private struct RuntimeSendFailure: Error, CustomStringConvertible {
    var description: String
}
