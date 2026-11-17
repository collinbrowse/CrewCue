import Foundation
import Testing
@testable import CrewCueClientCore

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func result(_ root: [String: Any]) throws -> [String: Any] {
    #expect(root["ok"] as? Bool == true, "\(root)")
    return try #require(root["result"] as? [String: Any], "\(root)")
}

/// Answers each request path with a fixed status and body, and records what it was sent.
private final class ScriptedServer: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [String: [(Int, String)]]
    private(set) var requests: [(method: String, path: String, body: [String: Any])] = []

    init(_ answers: [String: [(Int, String)]]) {
        self.answers = answers
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let body = request.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        return lock.withLock {
            requests.append((request.method.rawValue, request.url.path, body))
            let key = "\(request.method.rawValue) \(request.url.path)"
            guard var queue = answers[key], !queue.isEmpty else {
                return HTTPResponse(status: 500, body: Data(#"{"error":"unscripted \#(key)"}"#.utf8))
            }
            let next = queue.count > 1 ? queue.removeFirst() : queue[0]
            answers[key] = queue
            return HTTPResponse(status: next.0, body: Data(next.1.utf8))
        }
    }

    var sent: [(method: String, path: String, body: [String: Any])] { lock.withLock { requests } }
}

/// No network: every request fails the way an offline phone's does.
private struct ScriptedOffline: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

// MARK: raceStartInput

@Test func raceStartInputOpConvertsTheTypedFieldsInClientCore() async throws {
    let start = try result(try await runtime([
        "op": "raceStartInput", "year": 2026, "month": 8, "day": 15, "hour": 6, "minute": 30, "timeZone": "America/Denver"
    ]))
    #expect(start["raceStartAt"] as? String == "2026-08-15T12:30:00.000Z")
    #expect(start["problem"] is NSNull)
    #expect(start["message"] is NSNull)
    #expect(start["timeZone"] as? String == "America/Denver")
    // The pickers show client-core's labels, not a second Kotlin formatter.
    let input = RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(start["dateLabel"] as? String == input.dateLabel())
    #expect(start["timeLabel"] as? String == input.timeLabel())
}

@Test func raceStartLabelsWriteThePickedFieldsWithoutConverting() {
    let posix = Locale(identifier: "en_US_POSIX")
    let us = Locale(identifier: "en_US")
    let start = RaceStartInput(year: 2026, month: 8, day: 15, hour: 18, minute: 5, timeZoneIdentifier: "Asia/Tokyo")
    #expect(start.dateLabel(locale: us) == "Aug 15, 2026")
    #expect(start.timeLabel(locale: posix).hasPrefix("6:05"))
    // A time in the spring-forward gap still reads as picked, beside the problem.
    let gap = RaceStartInput(year: 2026, month: 3, day: 8, hour: 2, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(gap.problem == .daylightSavingGap)
    #expect(gap.timeLabel(locale: posix).hasPrefix("2:30"))
    #expect(gap.dateLabel(locale: us) == "Mar 8, 2026")
    // Impossible fields read as their numbers.
    #expect(RaceStartInput(year: 2026, month: 2, day: 30, hour: 9, minute: 0).dateLabel(locale: us) == "2026-02-30")
    #expect(RaceStartInput(year: 2026, month: 2, day: 3, hour: 25, minute: 7).timeLabel(locale: us) == "25:07")
}

@Test func raceStartInputOpGivesTheDstCopyOnlyForTheSpringForwardGap() async throws {
    // 2026-03-08 02:30 is skipped in Denver.
    let gap = try result(try await runtime([
        "op": "raceStartInput", "year": 2026, "month": 3, "day": 8, "hour": 2, "minute": 30, "timeZone": "America/Denver"
    ]))
    #expect(gap["raceStartAt"] is NSNull)
    #expect(gap["problem"] as? String == "daylightSavingGap")
    #expect(gap["message"] as? String == OnboardingCopy.startTimeDstGap)

    let invalid = try result(try await runtime([
        "op": "raceStartInput", "year": 2026, "month": 2, "day": 30, "hour": 9, "minute": 0, "timeZone": "America/Denver"
    ]))
    #expect(invalid["problem"] as? String == "invalidDate")
    #expect(invalid["message"] is NSNull)

    let zone = try result(try await runtime([
        "op": "raceStartInput", "year": 2026, "month": 8, "day": 15, "hour": 6, "minute": 0, "timeZone": "Nowhere/Land"
    ]))
    #expect(zone["problem"] as? String == "unknownZone")
    #expect(zone["message"] is NSNull)

    let missing = try result(try await runtime(["op": "raceStartInput", "timeZone": "America/Denver"]))
    #expect(missing["problem"] as? String == "invalidDate")
    #expect(missing["raceStartAt"] is NSNull)
}

@Test func raceStartInputOpReadsASavedStartBackIntoFields() async throws {
    let fields = try result(try await runtime([
        "op": "raceStartInput", "raceStartAt": "2026-08-16T03:00:00.000Z", "timeZone": "America/Los_Angeles"
    ]))
    #expect(fields["year"] as? Int == 2026)
    #expect(fields["month"] as? Int == 8)
    #expect(fields["day"] as? Int == 15)
    #expect(fields["hour"] as? Int == 20)
    #expect(fields["minute"] as? Int == 0)
    #expect(fields["raceStartAt"] as? String == "2026-08-16T03:00:00.000Z")
}

// MARK: gpxPreview

private let previewJSON = """
{"course":{"checkpoints":[
 {"id":"finish","title":"Finish","latitude":39.01,"longitude":-120.0,"distanceMetersFromStart":2224},
 {"id":"start","title":"Start","latitude":39.0,"longitude":-120.0,"distanceMetersFromStart":0}]},
 "plannedPaceSecondsPerKm":420,
 "routeOverlayLayer":{"id":"layer-1","label":"route","visible":true,"geometry":{"type":"LineString",
  "coordinates":[[-120.0,39.0,1800],[-120.0,39.005,1850],[-120.0,39.01,1830]]}},
 "courseFileName":"route.gpx"}
"""

@Test func gpxPreviewOpDrawsTheServerParseWithElevationFromTheRoute() async throws {
    let base = "https://gpx-preview.test"
    let server = ScriptedServer(["POST /race-rooms/r1/course/gpx-preview": [(200, previewJSON)]])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("gpx-preview-\(UUID().uuidString)").path
    let preview = try result(try await runtime([
        "op": "gpxPreview", "baseURL": base, "token": "t", "userId": "ada", "storageDir": storage,
        "roomId": "r1", "fileName": "route.gpx", "gpxXml": "<gpx/>"
    ]))
    #expect(preview["status"] as? String == "previewed")
    #expect((preview["checkpoints"] as? [[String: Any]])?.compactMap { $0["id"] as? String } == ["start", "finish"])
    #expect((preview["line"] as? [[Double]])?.first == [-120.0, 39.0])
    #expect(preview["plannedPaceSecondsPerKm"] as? Double == 420)
    #expect(preview["courseFileName"] as? String == "route.gpx")
    let elevation = try #require(preview["elevation"] as? [[Double]])
    #expect(elevation.count == 3)
    #expect(elevation[0] == [0, 1800])
    #expect(abs(elevation[2][0] - 1112) < 5)
    #expect(elevation[2][1] == 1830)
    let request = try #require(server.sent.first)
    #expect(request.body["gpxXml"] as? String == "<gpx/>")
    #expect(request.body["courseFileName"] as? String == "route.gpx")
}

@Test func gpxPreviewOpSkipsTheRequestForABlankFile() async throws {
    let base = "https://gpx-preview-empty.test"
    let server = ScriptedServer([:])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let empty = try result(try await runtime(["op": "gpxPreview", "baseURL": base, "roomId": "r1", "gpxXml": "  \n"]))
    #expect(empty["status"] as? String == "empty")
    #expect(server.sent.isEmpty)
}

@Test func failuresCarryTheHttpStatusAndBodyCodeForAndroid() async throws {
    let base = "https://gpx-preview-limits.test"
    let server = ScriptedServer([
        "POST /race-rooms/r1/course/gpx-preview": [(429, #"{"error":"Too many requests"}"#)],
        "POST /race-rooms/r2/course/gpx-preview": [(402, #"{"error":"Race not unlocked","code":"room_unpaid"}"#)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let limited = try await runtime(["op": "gpxPreview", "baseURL": base, "roomId": "r1", "gpxXml": "<gpx/>"])
    #expect(limited["ok"] as? Bool == false)
    #expect(limited["status"] as? Int == 429)
    #expect(limited["code"] == nil)
    #expect(limited["offline"] as? Bool == false)
    let unpaid = try await runtime(["op": "gpxPreview", "baseURL": base, "roomId": "r2", "gpxXml": "<gpx/>"])
    #expect(unpaid["status"] as? Int == 402)
    #expect(unpaid["code"] as? String == "room_unpaid")
    // Not an HTTP answer: status 0, no code.
    let local = try await runtime(["op": "gpxPreview", "baseURL": base, "gpxXml": "<gpx/>"])
    #expect(local["ok"] as? Bool == false)
    #expect(local["status"] as? Int == 400)
    let unknown = try await runtime(["op": "noSuchOp"])
    #expect(unknown["status"] as? Int == 400)
    let bad = await RuntimeCall.perform("not json")
    #expect(!bad.contains("status"))
}

// MARK: estimates

private let estimateJSON = #"{"id":"e1","coldStart":true,"expectedFinishAt":"2026-08-15T22:10:00.000Z","expectedFinishElapsedSeconds":36600,"aidEtas":[],"explanation":"No history yet."}"#

@Test func computeEstimateRetriesACourseMismatchInClientCore() async throws {
    let base = "https://estimate-finish.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [
            (400, #"{"error":"The estimate was computed for another course.","code":"course_mismatch"}"#),
            (200, "{\"estimate\":\(estimateJSON)}")
        ]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("estimate-\(UUID().uuidString)").path
    let request: [String: Any] = [
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete",
        "storageDir": storage, "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]
    // `PlanOfRecord` computes and attaches once more, as on iOS: the app sees the attached plan.
    let attached = try result(try await runtime(request))
    #expect(server.sent.filter { $0.path == "/pacing-estimates" }.count == 2)
    #expect(attached["expectedFinishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(attached["estimateId"] as? String == "e1")
    // The big finish readout uses the summary's clock, never a Kotlin formatter.
    let clock = try #require(attached["finishClock"] as? String)
    #expect(clock == ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z"))
    #expect((attached["summary"] as? String)?.hasSuffix(clock) == true)
}

/// The estimate above with its planned stops: 8 minutes before the finish, the finish row 22:18.
private let plannedSheetJSON = """
{"roomId":"r1","raceStartAt":"2026-08-15T12:00:00.000Z","stops":[
 {"id":"s1","checkpointId":"start","elapsedSeconds":0,"plannedStoppageSeconds":120,"clockArrivalAt":"2026-08-15T12:00:00.000Z"},
 {"id":"s2","checkpointId":"finish","elapsedSeconds":37080,"plannedStoppageSeconds":0,"clockArrivalAt":"2026-08-15T22:18:00.000Z"}],
 "locked":{"checkpointIds":["aid-1"]}}
"""

@Test func theEstimatePayloadShowsTheSchedulesFinishNotTheEstimatesOwn() async throws {
    let base = "https://estimate-plan-finish.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(estimateJSON)}")],
        "GET /race-rooms/r1/schedule": [(200, plannedSheetJSON)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("estimate-\(UUID().uuidString)").path
    let attached = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "America/Denver",
        "storageDir": storage, "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]))
    let zone = try #require(TimeZone(identifier: "America/Denver"))
    // The estimate's own finish stays for the history comparison; every readout shows the plan's.
    #expect(attached["expectedFinishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(attached["finishAt"] as? String == "2026-08-15T22:18:00.000Z")
    let clock = ScheduleFormat.formatScheduleClock("2026-08-15T22:18:00.000Z", timeZone: zone)
    #expect(attached["finishClock"] as? String == clock)
    // One space each side of the separator, never two in a row.
    #expect(attached["summary"] as? String == "No history yet.\nFinish 10:18:00 · \(clock)")
    #expect(server.sent.map { "\($0.method) \($0.path)" }.last == "GET /race-rooms/r1/schedule")

    // Offline: the race's sheet this device read last.
    RuntimeCall.setTransportForTests(ScriptedOffline(), baseURL: base)
    let cached = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "America/Denver",
        "storageDir": storage, "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]))
    #expect(cached["offline"] as? Bool == true)
    #expect(cached["finishAt"] as? String == "2026-08-15T22:18:00.000Z")
    #expect(cached["finishClock"] as? String == clock)
}

@Test func withoutASchedulesFinishTheEstimatePayloadKeepsTheEstimatesOwn() async throws {
    let base = "https://estimate-no-schedule.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(estimateJSON)}")],
        // A crew member's unpaid race, or no schedule yet.
        "GET /race-rooms/r1/schedule": [(402, #"{"error":"Race not unlocked","code":"room_unpaid"}"#)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let attached = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "UTC",
        "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]))
    #expect(attached["finishAt"] as? String == "2026-08-15T22:10:00.000Z")
    let utc = try #require(TimeZone(identifier: "UTC"))
    #expect(attached["summary"] as? String == "No history yet.\nFinish 10:10:00 · \(ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z", timeZone: utc))")
}

@Test func thePlanFinishIsTheSchedulesFinishRow() throws {
    let sheet = try JSONDecoder().decode(CrewScheduleSheet.self, from: Data(plannedSheetJSON.utf8))
    #expect(PlanFinish.row(in: sheet)?.clockArrivalAt == "2026-08-15T22:18:00.000Z")
    // Only the start: no finish to read.
    #expect(PlanFinish.row(in: CrewScheduleSheet(roomId: "r1", raceStartAt: sheet.raceStartAt, stops: [sheet.stops[0]])) == nil)
    #expect(PlanFinish.row(in: nil) == nil)
}

/// A paid sheet for `estimateJSON` (e1, 36600 s moving): the start, an aid station, then `last`.
private func paidSheet(planFrom estimateId: String?, last: String) -> CrewScheduleSheet {
    let plan = estimateId.map { #","pacingEstimateId":"\#($0)""# } ?? ""
    let json = """
    {"roomId":"r1","raceStartAt":"2026-08-15T12:00:00.000Z"\(plan),"stops":[
     {"id":"s1","checkpointId":"start","elapsedSeconds":0,"movingElapsedSeconds":0,"plannedStoppageSeconds":300,"clockArrivalAt":"2026-08-15T12:00:00.000Z"},
     {"id":"s2","checkpointId":"aid-1","elapsedSeconds":18300,"movingElapsedSeconds":18000,"plannedStoppageSeconds":180,"clockArrivalAt":"2026-08-15T17:05:00.000Z"},
     \(last)]}
    """
    return try! JSONDecoder().decode(CrewScheduleSheet.self, from: Data(json.utf8))
}

/// The finish row: moving time is the estimate's finish, 8 minutes of planned stops before it.
private let paidFinishStop = #"{"id":"s3","checkpointId":"cp-9","elapsedSeconds":37080,"movingElapsedSeconds":36600,"plannedStoppageSeconds":0,"clockArrivalAt":"2026-08-15T22:18:00.000Z"}"#
/// A course with no finish waypoint ends at an aid station, which keeps its own ETA.
private let paidLastAidStop = #"{"id":"s3","checkpointId":"aid-2","elapsedSeconds":34680,"movingElapsedSeconds":34200,"plannedStoppageSeconds":300,"clockArrivalAt":"2026-08-15T21:38:00.000Z"}"#

@Test func aPaidSheetsFinishRowIsTheOneCarryingThePlansFinish() throws {
    let estimate = try JSONDecoder().decode(PacingEstimate.self, from: Data(estimateJSON.utf8))
    #expect(PlanFinish.row(in: paidSheet(planFrom: "e1", last: paidFinishStop), for: estimate)?.clockArrivalAt == "2026-08-15T22:18:00.000Z")
    // No finish waypoint: the last row is an aid arrival, never shown as the finish.
    #expect(PlanFinish.row(in: paidSheet(planFrom: "e1", last: paidLastAidStop), for: estimate) == nil)
    // Without the estimate a paid sheet can't say which row is the finish.
    #expect(PlanFinish.row(in: paidSheet(planFrom: "e1", last: paidFinishStop)) == nil)
}

@Test func anUnpaidSheetsStandInFinishIsStillTheFinish() throws {
    let estimate = try JSONDecoder().decode(PacingEstimate.self, from: Data(estimateJSON.utf8))
    // No finish waypoint on an unpaid race: the farthest stop stands in for the finish, after its own stop.
    let json = """
    {"roomId":"r1","raceStartAt":"2026-08-15T12:00:00.000Z","pacingEstimateId":"e1","stops":[
     {"id":"s1","checkpointId":"start","elapsedSeconds":0,"movingElapsedSeconds":0,"plannedStoppageSeconds":300,"clockArrivalAt":"2026-08-15T12:00:00.000Z"},
     {"id":"s2","checkpointId":"aid-2","elapsedSeconds":37200,"movingElapsedSeconds":36600,"plannedStoppageSeconds":300,"clockArrivalAt":"2026-08-15T22:20:00.000Z"}],
     "locked":{"checkpointIds":["aid-1"]}}
    """
    let sheet = try JSONDecoder().decode(CrewScheduleSheet.self, from: Data(json.utf8))
    #expect(PlanFinish.row(in: sheet, for: estimate)?.clockArrivalAt == "2026-08-15T22:20:00.000Z")
    #expect(PlanFinish.row(in: sheet)?.clockArrivalAt == "2026-08-15T22:20:00.000Z")
}

@Test func aSheetPlannedFromAnotherEstimateFallsBackToTheEstimatesOwnFinish() async throws {
    let estimate = try JSONDecoder().decode(PacingEstimate.self, from: Data(estimateJSON.utf8))
    let stale = paidSheet(planFrom: "e0", last: paidFinishStop)
    #expect(PlanFinish.row(in: stale, for: estimate) == nil)
    var unpaid = try JSONDecoder().decode(CrewScheduleSheet.self, from: Data(plannedSheetJSON.utf8))
    unpaid.pacingEstimateId = "e0"
    #expect(PlanFinish.row(in: unpaid, for: estimate) == nil)
    unpaid.pacingEstimateId = "e1"
    #expect(PlanFinish.row(in: unpaid, for: estimate) != nil)

    // The attach landed after the schedule was planned: the attached estimate's own finish, online and offline.
    let base = "https://estimate-stale-sheet.test"
    let sheetBody = String(decoding: try JSONEncoder().encode(stale), as: UTF8.self)
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(estimateJSON)}")],
        "GET /race-rooms/r1/schedule": [(200, sheetBody)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("estimate-\(UUID().uuidString)").path
    let request: [String: Any] = [
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "UTC",
        "storageDir": storage, "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]
    let utc = try #require(TimeZone(identifier: "UTC"))
    let own = ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z", timeZone: utc)
    let attached = try result(try await runtime(request))
    #expect(attached["finishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(attached["summary"] as? String == "No history yet.\nFinish 10:10:00 · \(own)")
    RuntimeCall.setTransportForTests(ScriptedOffline(), baseURL: base)
    let cached = try result(try await runtime(request))
    #expect(cached["offline"] as? Bool == true)
    #expect(cached["estimateId"] as? String == "e1")
    #expect(cached["finishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(cached["finishClock"] as? String == own)
}

@Test func aPaidCourseWithoutAFinishWaypointShowsTheEstimatesOwnFinish() async throws {
    let base = "https://estimate-no-finish-waypoint.test"
    let sheetBody = String(decoding: try JSONEncoder().encode(paidSheet(planFrom: "e1", last: paidLastAidStop)), as: UTF8.self)
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(estimateJSON)}")],
        "GET /race-rooms/r1/schedule": [(200, sheetBody)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let attached = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "UTC",
        "roomId": "r1", "trigger": "auto", "hasPlanOfRecord": false, "usableHistoryCount": 0
    ]))
    let utc = try #require(TimeZone(identifier: "UTC"))
    #expect(attached["finishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(attached["finishClock"] as? String == ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z", timeZone: utc))
}

@Test func theComparePathCachesTheSheetAndOfflineAnswersTheCachedPlanWithNoComparison() async throws {
    let withHistory = #"{"id":"e2","coldStart":false,"expectedFinishAt":"2026-08-15T21:42:00.000Z","expectedFinishElapsedSeconds":34920,"aidEtas":[],"explanation":"History."}"#
    let sheet = plannedSheetJSON.replacingOccurrences(of: "\"elapsedSeconds\":37080", with: "\"elapsedSeconds\":35400")
        .replacingOccurrences(of: "2026-08-15T22:18:00.000Z", with: "2026-08-15T21:50:00.000Z")
        .replacingOccurrences(of: #""stops":"#, with: #""pacingEstimateId":"e2","stops":"#)
    let base = "https://estimate-compare-offline.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON), (201, withHistory)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(withHistory)}")],
        "GET /race-rooms/r1/schedule": [(200, sheet)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("estimate-\(UUID().uuidString)").path
    let request: [String: Any] = [
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "UTC",
        "storageDir": storage, "roomId": "r1", "historyMode": "compare"
    ]
    let compared = try result(try await runtime(request))
    #expect(compared["offline"] as? Bool == false)
    #expect(compared["comparison"] is String)
    #expect(compared["finishAt"] as? String == "2026-08-15T21:50:00.000Z")

    // Offline: nothing computed or attached. The plan this phone cached, on the sheet the compare
    // cached, and no comparison: the app keeps the step instead of reading this as attached.
    RuntimeCall.setTransportForTests(ScriptedOffline(), baseURL: base)
    let offline = try result(try await runtime(request))
    #expect(offline["offline"] as? Bool == true)
    #expect(offline["comparison"] == nil)
    #expect(offline["estimateId"] as? String == "e2")
    #expect(offline["finishAt"] as? String == "2026-08-15T21:50:00.000Z")
}

@Test func theHistoryComparisonReadsThePlansClockOnBothSides() async throws {
    // Estimates: 21:42 with history, 22:10 without. The plan with history finishes at 21:50
    // (8 minutes of planned stops), so without history it would have finished at 22:18.
    let planned = try #require(PlanFinish.historyComparison(
        planFinishAt: "2026-08-15T21:50:00.000Z",
        withHistoryEstimateAt: "2026-08-15T21:42:00.000Z",
        withoutHistoryEstimateAt: "2026-08-15T22:10:00.000Z"
    ))
    #expect(planned.withHistory == "2026-08-15T21:50:00.000Z")
    #expect(ScheduleFormat.parseISO8601(planned.withoutHistory) == ScheduleFormat.parseISO8601("2026-08-15T22:18:00.000Z"))
    #expect(PlanFinish.historyComparison(planFinishAt: "nope", withHistoryEstimateAt: "2026-08-15T21:42:00Z", withoutHistoryEstimateAt: "2026-08-15T22:10:00Z") == nil)

    // The shared path iOS and Android both take: the line reads the schedule's finish.
    let withHistory = #"{"id":"e2","coldStart":false,"expectedFinishAt":"2026-08-15T21:42:00.000Z","expectedFinishElapsedSeconds":34920,"aidEtas":[],"explanation":"History."}"#
    let sheet = plannedSheetJSON.replacingOccurrences(of: "\"elapsedSeconds\":37080", with: "\"elapsedSeconds\":35400")
        .replacingOccurrences(of: "2026-08-15T22:18:00.000Z", with: "2026-08-15T21:50:00.000Z")
    let base = "https://estimate-compare.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON), (201, withHistory)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(withHistory)}")],
        "GET /race-rooms/r1/schedule": [(200, sheet)]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let compared = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete", "timeZone": "UTC",
        "roomId": "r1", "historyMode": "compare"
    ]))
    let utc = try #require(TimeZone(identifier: "UTC"))
    let with = ScheduleFormat.formatScheduleClock("2026-08-15T21:50:00.000Z", timeZone: utc)
    let without = ScheduleFormat.formatScheduleClock("2026-08-15T22:18:00.000Z", timeZone: utc)
    #expect(compared["comparison"] as? String == "Finish \(with) instead of \(without)")
    #expect(compared["finishAt"] as? String == "2026-08-15T21:50:00.000Z")
    #expect(compared["summary"] as? String == "History.\nFinish 9:50:00 · \(with)")
    let computes = server.sent.filter { $0.path == "/pacing-estimates" }
    #expect(computes.first?.body["historyRefIds"] as? [Any] != nil)
    #expect(computes.last?.body["historyRefIds"] == nil)

    // Without the plan's finish (no schedule yet): the two estimates as they are.
    let line = HistoryComparison(
        withoutHistory: PacingEstimate(id: "a", coldStart: true, expectedFinishAt: "2026-08-15T22:10:00.000Z", expectedFinishElapsedSeconds: 1, aidEtas: [], explanation: ""),
        attached: PacingEstimate(id: "b", coldStart: false, expectedFinishAt: "2026-08-15T21:42:00.000Z", expectedFinishElapsedSeconds: 1, aidEtas: [], explanation: "")
    ).line(timeZone: utc)
    #expect(line == "Finish \(ScheduleFormat.formatScheduleClock("2026-08-15T21:42:00.000Z", timeZone: utc)) instead of \(ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z", timeZone: utc))")
}

@Test func skipAttachesAColdStartThroughTheSharedPath() async throws {
    let base = "https://estimate-skip.test"
    let server = ScriptedServer([
        "POST /pacing-estimates": [(201, estimateJSON)],
        "PUT /race-rooms/r1/pacing-estimate": [(200, "{\"estimate\":\(estimateJSON)}")]
    ])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let skipped = try result(try await runtime([
        "op": "computeEstimate", "baseURL": base, "token": "t", "userId": "ada", "role": "athlete",
        "roomId": "r1", "historyMode": "none"
    ]))
    #expect(skipped["estimateId"] as? String == "e1")
    #expect(skipped["comparison"] == nil)
    let compute = try #require(server.sent.first { $0.path == "/pacing-estimates" })
    #expect((compute.body["historyRefIds"] as? [Any])?.isEmpty == true)
}

@Test func timelineRowsCarryThePlanClockLabel() async throws {
    let sheet: [String: Any] = [
        "roomId": "r1", "raceStartAt": "2026-08-15T12:30:00.000Z",
        "stops": [
            ["id": "s1", "checkpointId": "start", "elapsedSeconds": 0, "plannedStoppageSeconds": 0, "clockArrivalAt": "2026-08-15T12:30:00.000Z"],
            ["id": "s2", "checkpointId": "finish", "elapsedSeconds": 34800, "plannedStoppageSeconds": 0, "clockArrivalAt": "2026-08-15T22:10:00.000Z"]
        ]
    ]
    let checkpoints: [[String: Any]] = [
        ["id": "start", "title": "Start", "latitude": 39.0, "longitude": -120.0, "distanceMetersFromStart": 0],
        ["id": "finish", "title": "Finish", "latitude": 39.01, "longitude": -120.0, "distanceMetersFromStart": 1100]
    ]
    let projected = try result(try await runtime([
        "op": "projectAidSheet", "sheet": sheet, "checkpoints": checkpoints, "selectedIndex": 0, "follow": true,
        "timeZone": "America/Denver"
    ]))
    let rows = try #require(projected["timeline"] as? [[String: Any]])
    let finish = try #require(rows.first { $0["checkpointId"] as? String == "finish" })
    let zone = try #require(TimeZone(identifier: "America/Denver"))
    #expect(finish["clockLabel"] as? String == ScheduleFormat.formatScheduleClock("2026-08-15T22:10:00.000Z", timeZone: zone))
}

// MARK: course elevation

@Test func courseElevationPrefersTheBaselineTrackAndFallsBackToTheRoute() throws {
    let geometry: [String: Any] = ["type": "LineString", "coordinates": [[-120.0, 39.0, 100.0], [-120.0, 39.001, 110.0], [-120.0, 39.002]]]
    let profile = CoursePayload.geometryElevation(geometry)
    #expect(profile.count == 2)
    #expect(profile[0] == [0, 100])
    #expect(abs(profile[1][0] - 111.2) < 1)
    #expect(CoursePayload.geometryElevation(["type": "LineString", "coordinates": [[-120.0, 39.0], [-120.0, 39.1]]]).isEmpty)

    let teaser = """
    {"room":{"id":"r1","name":"Race","course":{"checkpoints":[]},"mapWorkspace":{"selectedLayerId":"l","layers":[{"id":"l","geometry":\(String(decoding: try JSONSerialization.data(withJSONObject: geometry), as: UTF8.self))}]}}}
    """
    let fromRoute = CoursePayload.make(from: Data(teaser.utf8))
    #expect((fromRoute["elevation"] as? [[Double]])?.count == 2)
    #expect((fromRoute["line"] as? [[Double]])?.count == 3)

    let paid = """
    {"room":{"id":"r1","course":{"checkpoints":[],"baselineTrack":{"points":[{"distanceMetersFromStart":0,"elevationMeters":5},{"distanceMetersFromStart":50,"elevationMeters":9}]}},"mapWorkspace":{"layers":[{"id":"l","geometry":\(String(decoding: try JSONSerialization.data(withJSONObject: geometry), as: UTF8.self))}]}}}
    """
    #expect(CoursePayload.make(from: Data(paid.utf8))["elevation"] as? [[Double]] == [[0, 5], [50, 9]])
}

// MARK: labels

@Test func onboardingCopyOpCarriesEveryControlLabel() async throws {
    let copy = try result(try await runtime(["op": "onboardingCopy"]))
    let labels = try #require(copy["labels"] as? [String: String])
    #expect(labels.count == OnboardingCopy.Label.allCases.count)
    for label in OnboardingCopy.Label.allCases {
        let text = try #require(labels[label.rawValue])
        #expect(text == OnboardingCopy.label(label))
        #expect(!text.isEmpty)
        #expect(!text.contains("!"), "\(text)")
    }
}
