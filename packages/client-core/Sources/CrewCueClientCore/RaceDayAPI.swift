import Foundation

public struct JoinPreviewEnvelope: Codable, Sendable {
    public var preview: RaceRoomJoinPreview
}

public struct RoomEnvelope: Codable, Sendable {
    public var room: RaceRoom
    public var assignedRole: String?
}

public struct AttachEnvelope: Codable, Sendable {
    public var roomId: String
    public var pacingEstimateId: String
    public var estimate: PacingEstimate
}

public struct IncidentEnvelope: Codable, Sendable {
    public var incident: IncidentEvent
}

public struct IncidentListEnvelope: Codable, Sendable {
    public var incidents: [IncidentEvent]
}

public struct StravaStart: Codable, Sendable {
    public var authorizeUrl: String
    public var state: String
    public var redirectUri: String
}

public struct StravaConnection: Codable, Sendable {
    public var connected: Bool?
    public var athleteId: String?
}

public struct ChatPreference: Codable, Sendable {
    public var preference: String
    public var updatedAt: String?
}

enum TransportFailure {
    static func isOffline(_ error: Error) -> Bool {
        offlineCodes.contains(urlErrorCode(error) ?? 0)
    }

    /// `.unknown` (-1) is how Foundation on Android reports a host it could not connect to or
    /// resolve (airplane mode included); Apple platforms use the specific codes.
    private static let offlineCodes: Set<Int> = [
        URLError.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
        .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
        .cannotLoadFromNetwork, .unknown
    ].reduce(into: []) { codes, code in codes.insert(code.rawValue) }

    /// Off Apple platforms an `NSError` in `NSURLErrorDomain` does not bridge to `URLError`,
    /// so the Android build reads the domain and code instead.
    private static func urlErrorCode(_ error: Error) -> Int? {
        if let urlError = error as? URLError { return urlError.code.rawValue }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain ? nsError.code : nil
    }
}

public struct ScheduleLoadResult: Sendable {
    public var sheet: CrewScheduleSheet
    public var offline: Bool

    public init(sheet: CrewScheduleSheet, offline: Bool) {
        self.sheet = sheet
        self.offline = offline
    }
}

public struct ScheduleCache {
    public static func file(directory: URL) -> URL {
        directory.appendingPathComponent("schedule.json")
    }

    public static func save(_ sheet: CrewScheduleSheet, directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(sheet).write(to: file(directory: directory), options: .atomic)
    }

    public static func load(directory: URL) throws -> CrewScheduleSheet? {
        let url = file(directory: directory)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(CrewScheduleSheet.self, from: Data(contentsOf: url))
    }
}

public struct EstimateCache {
    public static func file(directory: URL) -> URL {
        directory.appendingPathComponent("estimate.json")
    }

    public static func save(_ estimate: PacingEstimate, directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(estimate).write(to: file(directory: directory), options: .atomic)
    }

    public static func load(directory: URL) throws -> PacingEstimate? {
        let url = file(directory: directory)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(PacingEstimate.self, from: Data(contentsOf: url))
    }
}

public struct CourseSettingsDraft: Codable, Equatable, Sendable {
    public var cutoffNote: String
    public var stoppageSeconds: Double

    public init(cutoffNote: String, stoppageSeconds: Double) {
        self.cutoffNote = cutoffNote
        self.stoppageSeconds = stoppageSeconds
    }

    public static func file(directory: URL) -> URL {
        directory.appendingPathComponent("course-settings.json")
    }

    public static func save(_ draft: CourseSettingsDraft, directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(draft).write(to: file(directory: directory), options: .atomic)
    }

    public static func load(directory: URL) throws -> CourseSettingsDraft? {
        let url = file(directory: directory)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(CourseSettingsDraft.self, from: Data(contentsOf: url))
    }
}

public enum RaceDayAPI {
    public static func previewJoin(graph: ClientGraph, code: String) async throws -> RaceRoomJoinPreview {
        let envelope: JoinPreviewEnvelope = try await get(graph, "/race-rooms/join-preview/\(code)", token: false)
        return envelope.preview
    }

    public static func createRoom(
        graph: ClientGraph,
        name: String,
        athleteId: String,
        teamId: String,
        creatorName: String?
    ) async throws -> RaceRoom {
        var object: [String: Any] = [
            "name": name,
            "athleteId": athleteId,
            "teamId": teamId,
            "creatorRole": "athlete"
        ]
        if let creatorName {
            let trimmed = creatorName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                object["creatorName"] = trimmed
            }
        }
        let data = try await sendJSON(graph, "/race-rooms", method: .post, object: object)
        return try JSONDecoder().decode(RaceRoom.self, from: data)
    }

    public static func join(graph: ClientGraph, code: String) async throws -> RoomEnvelope {
        try await send(graph, "/race-rooms/join-by-code", method: .post, body: #"{"roomCode":"\#(code)"}"#)
    }

    /// Every race room the user belongs to, newest server order kept.
    public static func myRaces(graph: ClientGraph, userId: String) async throws -> [RaceSummary] {
        let envelope: RaceListEnvelope = try await get(graph, "/race-rooms/mine")
        return envelope.rooms.map { RaceSummary(room: $0, userId: userId) }
    }

    public static func loadRoom(graph: ClientGraph, roomId: String) async throws -> RoomEnvelope {
        try await get(graph, "/race-rooms/\(roomId)")
    }

    /// The signed-in athlete's activity history, used to decide whether the estimate needs a recompute.
    public static func activityHistory(graph: ClientGraph) async throws -> [ActivityHistoryRef] {
        let payload: ActivityHistoryList = try await get(graph, "/activity-history")
        return payload.items.map { item in
            ActivityHistoryRef(
                id: item.id,
                distanceMeters: item.distanceMeters,
                elapsedSeconds: item.elapsedSeconds,
                elevationGainMeters: item.elevationGainMeters
            )
        }
    }

    public static func updateDisplayName(graph: ClientGraph, roomId: String, userId: String, displayName: String) async throws -> RoomEnvelope {
        let body = #"{"displayName":"\#(jsonEscape(displayName))"}"#
        return try await send(graph, "/race-rooms/\(roomId)/members/\(userId)", method: .patch, body: body)
    }

    public static func removeMember(graph: ClientGraph, roomId: String, userId: String) async throws {
        _ = try await sendData(graph, "/race-rooms/\(roomId)/members/\(userId)", method: .delete, body: nil)
    }

    /// Network sheet, or the on-device sheet when the transport is offline.
    public static func loadScheduleResult(graph: ClientGraph, roomId: String, cacheDirectory: URL?) async throws -> ScheduleLoadResult {
        do {
            let sheet: CrewScheduleSheet = try await get(graph, "/race-rooms/\(roomId)/schedule")
            if let cacheDirectory {
                try? ScheduleCache.save(sheet, directory: cacheDirectory)
            }
            return ScheduleLoadResult(sheet: sheet, offline: false)
        } catch let failure as ClientHTTPError where failure.status == 400 {
            // The API answers 400 only while the room has no schedule yet: no course, fewer than
            // two checkpoints, no start time, or no planned pace. That is an empty sheet, not an error.
            let sheet = CrewScheduleSheet(roomId: roomId, raceStartAt: "", stops: [])
            if let cacheDirectory {
                try? ScheduleCache.save(sheet, directory: cacheDirectory)
            }
            return ScheduleLoadResult(sheet: sheet, offline: false)
        } catch {
            if TransportFailure.isOffline(error),
               let cacheDirectory,
               let cached = try? ScheduleCache.load(directory: cacheDirectory) {
                return ScheduleLoadResult(sheet: cached, offline: true)
            }
            throw error
        }
    }

    public static func loadSchedule(graph: ClientGraph, roomId: String, cacheDirectory: URL?) async throws -> CrewScheduleSheet {
        do {
            return try await loadScheduleResult(graph: graph, roomId: roomId, cacheDirectory: cacheDirectory).sheet
        } catch {
            if let cacheDirectory, let cached = try? ScheduleCache.load(directory: cacheDirectory) {
                return cached
            }
            throw error
        }
    }

    /// The athlete's latest accepted ping. Race progress readouts come from this on every crew
    /// phone, never from the viewing device's GPS.
    public static func latestPing(graph: ClientGraph, roomId: String) async throws -> RunnerProgress {
        let response: RaceRoomLatestPingResponse = try await get(graph, "/race-rooms/\(roomId)/pings/latest")
        return RunnerProgress(response: response)
    }

    /// Local draft fields read from a room payload. Does not call stop-plan APIs.
    public static func courseDraftSeed(graph: ClientGraph, roomId: String) async throws -> CourseSettingsDraft {
        let data = try await sendData(graph, "/race-rooms/\(roomId)", method: .get, body: nil)
        return courseDraft(fromRoomData: data)
    }

    static func courseDraft(fromRoomData data: Data) -> CourseSettingsDraft {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return CourseSettingsDraft(cutoffNote: "", stoppageSeconds: 0)
        }
        let room = (root["room"] as? [String: Any]) ?? root
        let checkpoints = (room["course"] as? [String: Any])?["checkpoints"] as? [[String: Any]] ?? []
        var stoppage = 0.0
        var notes: [String] = []
        for checkpoint in checkpoints {
            if let seconds = jsonNumber(checkpoint["plannedStopSeconds"]) {
                stoppage += seconds
            }
            if let id = checkpoint["id"] as? String,
               let cutoff = checkpoint["cutoff"] as? [String: Any],
               let line = cutoffLine(checkpointId: id, cutoff: cutoff) {
                notes.append(line)
            }
        }
        return CourseSettingsDraft(cutoffNote: notes.joined(separator: "\n"), stoppageSeconds: stoppage)
    }

    public static func computeEstimate(graph: ClientGraph, roomId: String) async throws -> PacingEstimate {
        try await send(graph, "/pacing-estimates", method: .post, body: #"{"roomId":"\#(roomId)"}"#)
    }

    public static func attachEstimate(graph: ClientGraph, roomId: String, estimateId: String) async throws -> PacingEstimate {
        let envelope: AttachEnvelope = try await send(
            graph,
            "/race-rooms/\(roomId)/pacing-estimate",
            method: .put,
            body: #"{"pacingEstimateId":"\#(estimateId)"}"#
        )
        return envelope.estimate
    }

    public static func decideAutoRecompute(role: String, input: EstimateRecomputeInput) -> EstimateRecomputeDecision {
        EstimateRecompute.decide(role: role, input)
    }

    public static func importGpx(
        graph: ClientGraph,
        roomId: String,
        fileName: String,
        gpxXml: String,
        raceStartAt: String,
        plannedPaceSecondsPerKm: Double,
        idempotencyKey: String? = nil
    ) async throws -> Data {
        let previewBody: [String: Any] = ["gpxXml": gpxXml, "courseFileName": fileName]
        let preview = try await sendJSON(graph, "/race-rooms/\(roomId)/course/gpx-preview", method: .post, object: previewBody)
        guard var object = try JSONSerialization.jsonObject(with: preview) as? [String: Any] else {
            throw ClientHTTPError(status: 0, message: "Couldn't read the route file.")
        }
        let anchors = try await courseImportAnchors(
            graph: graph,
            roomId: roomId,
            raceStartAt: raceStartAt,
            plannedPaceSecondsPerKm: plannedPaceSecondsPerKm
        )
        object["plannedPaceSecondsPerKm"] = anchors.pace
        object["raceStartAt"] = anchors.start
        object["courseGpxXml"] = gpxXml
        object["courseFileName"] = fileName
        return try await sendJSON(
            graph,
            "/race-rooms/\(roomId)/course",
            method: .put,
            object: object,
            idempotencyKey: idempotencyKey
        )
    }

    /// #250: save planned stop minutes. Sends only the changed checkpoints; the server applies all
    /// of them or none and recomputes the schedule without resetting crew task state.
    public static func updatePlannedStops(graph: ClientGraph, roomId: String, edits: [PlannedStopEdit]) async throws -> RaceRoom {
        let stops: [[String: Any]] = edits.map { ["checkpointId": $0.checkpointId, "plannedStopSeconds": $0.plannedStopSeconds] }
        let data = try await sendJSON(graph, "/race-rooms/\(roomId)/checkpoint-stops", method: .patch, object: ["stops": stops])
        return try JSONDecoder().decode(RaceRoom.self, from: data)
    }

    public static func placeCheckpoint(graph: ClientGraph, roomId: String, id: String, title: String, latitude: Double, longitude: Double) async throws -> Data {
        let body: [String: Any] = ["id": id, "title": title, "latitude": latitude, "longitude": longitude]
        return try await sendJSON(graph, "/race-rooms/\(roomId)/checkpoints", method: .post, object: body)
    }

    public static func route(graph: ClientGraph, roomId: String, mode: String, checkpointIds: [String]) async throws -> Data {
        let body: [String: Any] = ["mode": mode, "checkpointIds": checkpointIds]
        return try await sendJSON(graph, "/race-rooms/\(roomId)/routing/route", method: .post, object: body)
    }

    public static func streamToken(graph: ClientGraph, roomId: String) async throws -> ChatStreamTokenResponse {
        try await send(graph, "/chat/stream-token", method: .post, body: #"{"roomId":"\#(roomId)"}"#)
    }

    public static func channelId(roomId: String) -> String {
        "crew-\(roomId)"
    }

    public static func notificationPreference(graph: ClientGraph, roomId: String) async throws -> ChatPreference {
        try await get(graph, "/chat/rooms/\(roomId)/notification-prefs")
    }

    public static func saveNotificationPreference(graph: ClientGraph, roomId: String, preference: String) async throws -> ChatPreference {
        try await send(graph, "/chat/rooms/\(roomId)/notification-prefs", method: .post, body: #"{"preference":"\#(preference)"}"#)
    }

    public static func incidents(graph: ClientGraph, roomId: String) async throws -> [IncidentEvent] {
        let envelope: IncidentListEnvelope = try await get(graph, "/race-rooms/\(roomId)/incidents")
        return envelope.incidents
    }

    public static func createIncident(
        graph: ClientGraph,
        roomId: String,
        category: String,
        severity: String,
        summary: String,
        checkpointId: String? = nil
    ) async throws -> IncidentEvent {
        var object: [String: Any] = ["category": category, "severity": severity, "summary": summary]
        if let checkpointId { object["checkpointId"] = checkpointId }
        let data = try await sendJSON(graph, "/race-rooms/\(roomId)/incidents", method: .post, object: object)
        return try JSONDecoder().decode(IncidentEnvelope.self, from: data).incident
    }

    public static func stravaStart(graph: ClientGraph) async throws -> StravaStart {
        try await get(graph, "/strava/oauth/start")
    }

    public static func stravaConnection(graph: ClientGraph) async throws -> StravaConnection {
        let data = try await sendData(graph, "/strava/connection", method: .get, body: nil)
        return try JSONDecoder().decode(StravaConnection.self, from: data)
    }

    public static func stravaDisconnect(graph: ClientGraph) async throws {
        _ = try await sendData(graph, "/strava/connection", method: .delete, body: nil)
    }

    public static func flushOutbox(graph: ClientGraph) async throws -> FlushReport {
        guard let outbox = graph.outbox, let baseURL = graph.baseURL else {
            throw ClientHTTPError(status: 0, message: "Outbox is not configured.")
        }
        let token = await graph.tokenProvider?.accessToken()
        return try await outbox.flush { operation in
            if operation.type == "chat" {
                return OutboxFailureResolution(status: "pending", retryable: true, feedback: "Waiting for the app to send this.")
            }
            if operation.type == "gpx" {
                do {
                    _ = try await importQueuedGpx(graph, operation)
                    return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
                } catch let error as ClientHTTPError {
                    return OutboxPolicy.resolve(error)
                } catch {
                    return OutboxPolicy.resolve(error)
                }
            }
            guard let path = outbox.path(for: operation), let url = APIClient.endpoint(baseURL, path) else {
                return OutboxFailureResolution(status: "rejected", retryable: false, feedback: "Couldn't build the request.")
            }
            let request = APIClient.authorized(
                url: url,
                method: .post,
                token: token,
                body: operation.payloadJSON.data(using: .utf8),
                idempotencyKey: operation.idempotencyKey
            )
            do {
                _ = try await APIClient.send(request, transport: graph.transport)
                return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
            } catch let error as ClientHTTPError {
                return OutboxPolicy.resolve(error)
            } catch {
                return OutboxPolicy.resolve(error)
            }
        }
    }

    private static func get<T: Decodable>(_ graph: ClientGraph, _ path: String, token: Bool = true) async throws -> T {
        try await send(graph, path, method: .get, body: nil, authorize: token)
    }

    private static func send<T: Decodable>(
        _ graph: ClientGraph,
        _ path: String,
        method: HTTPMethod,
        body: String?,
        authorize: Bool = true
    ) async throws -> T {
        guard let baseURL = graph.baseURL, let url = APIClient.endpoint(baseURL, path) else {
            throw ClientHTTPError(status: 0, message: "API base URL is not set.")
        }
        let token = authorize ? await graph.tokenProvider?.accessToken() : nil
        let request = APIClient.authorized(url: url, method: method, token: token, body: body?.data(using: .utf8))
        return try await APIClient.send(request, transport: graph.transport)
    }

    private static func sendJSON(
        _ graph: ClientGraph,
        _ path: String,
        method: HTTPMethod,
        object: [String: Any],
        idempotencyKey: String? = nil
    ) async throws -> Data {
        guard let baseURL = graph.baseURL, let url = APIClient.endpoint(baseURL, path) else {
            throw ClientHTTPError(status: 0, message: "API base URL is not set.")
        }
        let token = await graph.tokenProvider?.accessToken()
        let body = object.isEmpty ? nil : try JSONSerialization.data(withJSONObject: object)
        let request = APIClient.authorized(
            url: url,
            method: method,
            token: token,
            body: body,
            idempotencyKey: idempotencyKey
        )
        return try await APIClient.send(request, transport: graph.transport).body
    }

    private static func sendData(_ graph: ClientGraph, _ path: String, method: HTTPMethod, body: String?) async throws -> Data {
        guard let baseURL = graph.baseURL, let url = APIClient.endpoint(baseURL, path) else {
            throw ClientHTTPError(status: 0, message: "API base URL is not set.")
        }
        let token = await graph.tokenProvider?.accessToken()
        let request = APIClient.authorized(url: url, method: method, token: token, body: body?.data(using: .utf8))
        return try await APIClient.send(request, transport: graph.transport).body
    }

    /// A caller that has not loaded the room yet passes an empty start or a non-positive pace.
    /// Those must not replace the race clock or plan already stored on the room. A first import,
    /// where the room has neither, still supplies a clock and the default pace.
    private static func courseImportAnchors(
        graph: ClientGraph,
        roomId: String,
        raceStartAt: String,
        plannedPaceSecondsPerKm: Double
    ) async throws -> (start: String, pace: Double) {
        var start = raceStartAt.trimmingCharacters(in: .whitespacesAndNewlines)
        var pace = plannedPaceSecondsPerKm
        if start.isEmpty || pace <= 0 {
            let room = try await loadRoom(graph: graph, roomId: roomId).room
            if start.isEmpty {
                start = room.raceStartAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            }
            if pace <= 0, let existing = room.plannedPaceSecondsPerKm, existing > 0 {
                pace = existing
            }
        }
        if start.isEmpty {
            start = iso8601(graph.clock.now())
        }
        if pace <= 0 {
            pace = 360
        }
        return (start, pace)
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    private static func importQueuedGpx(_ graph: ClientGraph, _ operation: StoredOperation) async throws -> Data {
        guard let data = operation.payloadJSON.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fileName = object["fileName"] as? String,
              let gpxXml = object["gpxXml"] as? String,
              let raceStartAt = object["raceStartAt"] as? String,
              let pace = (object["plannedPaceSecondsPerKm"] as? NSNumber)?.doubleValue else {
            throw ClientHTTPError(status: 0, message: "Couldn't read the route file.")
        }
        return try await importGpx(
            graph: graph,
            roomId: operation.roomId,
            fileName: fileName,
            gpxXml: gpxXml,
            raceStartAt: raceStartAt,
            plannedPaceSecondsPerKm: pace,
            idempotencyKey: operation.idempotencyKey
        )
    }

    private static func jsonEscape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    }

    private static func jsonNumber(_ value: Any?) -> Double? {
        JSONNumber.double(value)
    }

    private static func cutoffLine(checkpointId: String, cutoff: [String: Any]) -> String? {
        let title = ScheduleFormat.slugToTitle(checkpointId)
        let mode = cutoff["mode"] as? String
        if mode == "time_of_day" {
            guard let hour = (cutoff["hour"] as? NSNumber)?.intValue,
                  let minute = (cutoff["minute"] as? NSNumber)?.intValue else { return nil }
            let hourText = PortableFormat.zeroPadded(hour, width: 2)
            let minuteText = PortableFormat.zeroPadded(minute, width: 2)
            return "\(title) cutoff \(hourText):\(minuteText)"
        }
        if mode == "elapsed_from_start" {
            guard let seconds = jsonNumber(cutoff["seconds"]) else { return nil }
            return "\(title) cutoff \(ScheduleFormat.formatDurationSeconds(seconds))"
        }
        return nil
    }
}

private struct ActivityHistoryList: Decodable {
    var items: [Item]

    struct Item: Decodable {
        var id: String
        var distanceMeters: Double?
        var elapsedSeconds: Double?
        var elevationGainMeters: Double?
    }
}
