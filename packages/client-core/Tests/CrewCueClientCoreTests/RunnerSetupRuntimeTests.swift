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

// MARK: raceStartInput

@Test func raceStartInputOpConvertsTheTypedFieldsInClientCore() async throws {
    let start = try result(try await runtime([
        "op": "raceStartInput", "year": 2026, "month": 8, "day": 15, "hour": 6, "minute": 30, "timeZone": "America/Denver"
    ]))
    #expect(start["raceStartAt"] as? String == "2026-08-15T12:30:00.000Z")
    #expect(start["problem"] is NSNull)
    #expect(start["message"] is NSNull)
    #expect(start["timeZone"] as? String == "America/Denver")
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

@Test func computeEstimateGivesTheFinishInstantAndSurfacesCourseMismatch() async throws {
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
    let mismatch = try await runtime(request)
    #expect(mismatch["ok"] as? Bool == false)
    #expect(mismatch["status"] as? Int == 400)
    #expect(mismatch["code"] as? String == "course_mismatch")
    let attached = try result(try await runtime(request))
    #expect(attached["expectedFinishAt"] as? String == "2026-08-15T22:10:00.000Z")
    #expect(attached["estimateId"] as? String == "e1")
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
