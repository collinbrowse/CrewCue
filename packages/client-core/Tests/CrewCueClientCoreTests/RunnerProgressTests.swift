import Foundation
import Testing
@testable import CrewCueClientCore

private let mile = 1609.344

private let course = [
    AidStationCheckpoint(id: "start", title: "Start", latitude: 39.0, longitude: -120.0, distanceMetersFromStart: 0),
    AidStationCheckpoint(id: "ridge", title: "Ridge", latitude: 39.1, longitude: -120.0, distanceMetersFromStart: 10 * mile),
    AidStationCheckpoint(id: "finish", title: "Finish", latitude: 39.2, longitude: -120.0, distanceMetersFromStart: 20 * mile)
]

private let sheet = CrewScheduleSheet(
    roomId: "room",
    raceStartAt: "2026-08-15T12:00:00.000Z",
    stops: [
        ScheduleStop(id: "s0", checkpointId: "start", clockArrivalAt: "2026-08-15T12:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
        ScheduleStop(id: "s1", checkpointId: "ridge", clockArrivalAt: "2026-08-15T14:00:00.000Z", elapsedSeconds: 7200, plannedStoppageSeconds: 300),
        ScheduleStop(id: "s2", checkpointId: "finish", clockArrivalAt: "2026-08-15T16:00:00.000Z", elapsedSeconds: 14400, plannedStoppageSeconds: 0)
    ]
)

private func latestJSON(ping: String?, threshold: Double = 900) -> String {
    let pingField = ping.map { #","ping":\#($0)"# } ?? ""
    return #"{"roomId":"room","stalenessThresholdSeconds":\#(threshold),"evaluatedAt":"2026-08-15T13:00:00.000Z"\#(pingField)}"#
}

private let serverPing = #"{"pingId":"p-1","latitude":39.05,"longitude":-120.0,"recordedAt":"2026-08-15T12:58:00.000Z","receivedAt":"2026-08-15T12:58:02.000Z","progressMeters":8046.72}"#

private struct LatestPingTransport: HTTPTransport {
    var body: String
    var status = 200

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.method == .get, request.url.path == "/race-rooms/room/pings/latest" else {
            return HTTPResponse(status: 404, body: Data("{}".utf8))
        }
        return HTTPResponse(status: status, body: Data(body.utf8))
    }
}

private struct RunnerTestLogger: Logger {
    func log(_ message: String) {}
}

private func graph(_ transport: some HTTPTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: RunnerTestLogger(),
        baseURL: URL(string: "https://example.invalid"),
        tokenProvider: StaticTokenProvider(token: "t")
    )
}

@Test func latestPingMapsServerPingAndProgress() async throws {
    let runner = try await RaceDayAPI.latestPing(graph: graph(LatestPingTransport(body: latestJSON(ping: serverPing, threshold: 180))), roomId: "room")
    let ping = try #require(runner.ping)
    #expect(ping.pingId == "p-1")
    #expect(ping.recordedAt == date("2026-08-15T12:58:00.000Z"))
    #expect(ping.progressMeters == 8046.72)
    #expect(runner.stalenessThresholdSeconds == 180)
    #expect(runner.progressMeters(checkpoints: course) == 8046.72)
}

@Test func latestPingWithoutPingIsNone() async throws {
    let runner = try await RaceDayAPI.latestPing(graph: graph(LatestPingTransport(body: latestJSON(ping: nil))), roomId: "room")
    #expect(runner == .none)
    #expect(runner.state(now: date("2026-08-15T13:00:00.000Z")) == .none)
    #expect(runner.progressMeters(checkpoints: course) == 0)
}

@Test func latestPingSurfacesServerErrors() async {
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RaceDayAPI.latestPing(graph: graph(LatestPingTransport(body: #"{"error":"Forbidden"}"#, status: 403)), roomId: "room")
    }
}

@Test func runnerWithoutServerProgressSnapsPingToNearestCheckpoint() throws {
    let json = #"{"pingId":"p-2","latitude":39.099,"longitude":-120.0,"recordedAt":"2026-08-15T12:58:00.000Z","receivedAt":"2026-08-15T12:58:01.000Z"}"#
    let response = try JSONDecoder().decode(RaceRoomLatestPingResponse.self, from: Data(latestJSON(ping: json).utf8))
    let runner = RunnerProgress(response: response)
    #expect(runner.ping?.progressMeters == nil)
    #expect(runner.progressMeters(checkpoints: course) == 10 * mile)
}

@Test func unreadablePingCountsAsNoPing() throws {
    let badTime = #"{"pingId":"p","latitude":39,"longitude":-120,"recordedAt":"yesterday","receivedAt":"x"}"#
    let badLat = #"{"pingId":"p","latitude":91,"longitude":-120,"recordedAt":"2026-08-15T12:58:00.000Z","receivedAt":"x"}"#
    for ping in [badTime, badLat] {
        let response = try JSONDecoder().decode(RaceRoomLatestPingResponse.self, from: Data(latestJSON(ping: ping).utf8))
        #expect(RunnerProgress(response: response).ping == nil)
    }
}

@Test func nonPositiveThresholdFallsBackToServerDefault() {
    #expect(RunnerProgress(ping: nil, stalenessThresholdSeconds: 0).stalenessThresholdSeconds == 900)
    #expect(RunnerProgress(ping: nil, stalenessThresholdSeconds: .nan).stalenessThresholdSeconds == 900)
}

@Test func runnerStateTurnsStaleAfterThreshold() {
    let ping = RunnerPing(pingId: "p", latitude: 39, longitude: -120, recordedAt: date("2026-08-15T13:00:00.000Z"))
    let runner = RunnerProgress(ping: ping, stalenessThresholdSeconds: 180)
    #expect(runner.state(now: date("2026-08-15T13:03:00.000Z")) == .live)
    #expect(runner.state(now: date("2026-08-15T13:03:01.000Z")) == .stale)
}

@Test func liveRunnerReadoutComesFromThePing() {
    let ping = RunnerPing(pingId: "p", latitude: 0, longitude: 0, recordedAt: date("2026-08-15T13:00:00.000Z"), progressMeters: 5 * mile)
    let readout = RaceDayReadouts.make(
        sheet: sheet,
        checkpoints: course,
        runner: RunnerProgress(ping: ping),
        now: date("2026-08-15T13:02:00.000Z")
    )
    #expect(readout.pingState == .live)
    #expect(readout.pingLabel == "LAST PING: 2 MIN AGO")
    #expect(readout.lastPingLabel == "2 MIN AGO")
    #expect(readout.progressLabel == "MILE 5 / 20")
    #expect(readout.statusLabel == "ON TRACK")
    #expect(readout.elapsedLabel == "1:02:00")
    // Five miles in the hour up to the ping, not the 62 minutes up to now.
    #expect(readout.averagePaceLabel == "12'00\" / MI")
}

@Test func staleRunnerKeepsPositionButDropsTrackCall() {
    let ping = RunnerPing(pingId: "p", latitude: 0, longitude: 0, recordedAt: date("2026-08-15T13:00:00.000Z"), progressMeters: 5 * mile)
    let readout = RaceDayReadouts.make(
        sheet: sheet,
        checkpoints: course,
        runner: RunnerProgress(ping: ping, stalenessThresholdSeconds: 900),
        now: date("2026-08-15T14:30:00.000Z")
    )
    #expect(readout.pingState == .stale)
    #expect(readout.pingLabel == "LAST PING: 1H 30M AGO")
    #expect(readout.progressLabel == "MILE 5 / 20")
    #expect(readout.status == .unknown)
    #expect(readout.statusLabel == "")
}

@Test func noPingReadoutSaysSoAndShowsNoProgress() {
    let readout = RaceDayReadouts.make(sheet: sheet, checkpoints: course, runner: .none, now: date("2026-08-15T13:00:00.000Z"))
    #expect(readout.pingState == .none)
    #expect(readout.pingLabel == "NO PING YET")
    #expect(readout.lastPingLabel == nil)
    #expect(readout.progressFraction == 0)
    #expect(readout.statusLabel == "")
    #expect(readout.averagePaceLabel == "—")
}

@Test func runtimeProjectAidSheetReadsRunnerNotDeviceLocation() async throws {
    let runner = try #require(try JSONSerialization.jsonObject(with: Data(latestJSON(ping: serverPing).utf8)))
    let checkpoints = course.map { checkpoint -> [String: Any] in
        [
            "id": checkpoint.id,
            "title": checkpoint.title ?? checkpoint.id,
            "latitude": checkpoint.latitude ?? 0,
            "longitude": checkpoint.longitude ?? 0,
            "distanceMetersFromStart": checkpoint.distanceMetersFromStart ?? 0
        ]
    }
    let request: [String: Any] = [
        "op": "projectAidSheet",
        "checkpoints": checkpoints,
        "runner": runner,
        // A device fix at the finish must not move the runner.
        "latitude": 39.2,
        "longitude": -120.0,
        "selectedIndex": 0,
        "follow": true,
        "nowMs": date("2026-08-15T13:00:00.000Z").timeIntervalSince1970 * 1000
    ]
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    let result = try #require(root["result"] as? [String: Any])
    let readout = try #require(result["readout"] as? [String: Any])
    #expect((readout["progressLabel"] as? String) == "MILE 5 / 20")
    #expect((readout["pingState"] as? String) == "live")
    #expect((readout["pingLabel"] as? String) == "LAST PING: 2 MIN AGO")
    let timeline = try #require(result["timeline"] as? [[String: Any]])
    // The device fix at the finish would mark every stop done; the runner is past the start at mile 0.
    #expect(timeline.map { $0["state"] as? String } == ["done", "current", "projected"])
}

@Test func runtimeCheckpointAtMileZeroKeepsItsDistance() async throws {
    let request: [String: Any] = [
        "op": "projectAidSheet",
        "checkpoints": [
            ["id": "start", "distanceMetersFromStart": 0, "plannedStopSeconds": true],
            ["id": "finish", "distanceMetersFromStart": 1]
        ] as [Any],
        "runner": try #require(try JSONSerialization.jsonObject(with: Data(latestJSON(ping: serverPing).utf8)))
    ]
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    let timeline = try #require((root["result"] as? [String: Any])?["timeline"] as? [[String: Any]])
    #expect(timeline.map { $0["state"] as? String } == ["done", "done"])
}

@Test func runtimeProjectAidSheetWithoutRunnerHasNoPing() async throws {
    let request: [String: Any] = ["op": "projectAidSheet", "checkpoints": [] as [Any], "latitude": 39.2, "longitude": -120.0]
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    let readout = try #require((root["result"] as? [String: Any])?["readout"] as? [String: Any])
    #expect((readout["pingState"] as? String) == "none")
    #expect((readout["pingLabel"] as? String) == "NO PING YET")
    #expect(readout["lastPingLabel"] == nil)
}

private func date(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
}

/// JSON `0` passes `is Bool` on Darwin. The start line's 0 m distance must survive the Android `loadRoom` payload,
/// or the start is never "done" and the timeline marks it current while the runner is miles in.
@Test func androidTimelineMarksStartDoneFromRunnerWhenStartDistanceIsZero() async throws {
    let roomJSON = #"{"room":{"id":"room","course":{"checkpoints":[{"id":"start","title":"Start","latitude":39.15,"longitude":-120.25,"distanceMetersFromStart":0},{"id":"aid-1","title":"Aid 1","latitude":39.24,"longitude":-120.25,"distanceMetersFromStart":9988.7},{"id":"aid-2","title":"Aid 2","latitude":39.33,"longitude":-120.25,"distanceMetersFromStart":19977.5},{"id":"finish","title":"Finish","latitude":39.6,"longitude":-120.25,"distanceMetersFromStart":49943.9}]}}}"#
    let course = CoursePayload.make(from: Data(roomJSON.utf8))
    let rows = try #require(course["checkpoints"] as? [[String: Any]])
    #expect(rows.first?["distanceMetersFromStart"] as? Double == 0)

    let runner = try #require(try JSONSerialization.jsonObject(with: Data(latestJSON(ping: #"{"pingId":"p","latitude":39.28,"longitude":-120.25,"recordedAt":"2026-08-15T12:58:00.000Z","receivedAt":"2026-08-15T12:58:02.000Z","progressMeters":14455.4}"#).utf8)))
    let request: [String: Any] = ["op": "projectAidSheet", "checkpoints": rows, "runner": runner, "selectedIndex": 0, "follow": true]
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
    let result = try #require((try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])?["result"] as? [String: Any])
    let states = try #require(result["timeline"] as? [[String: Any]]).map { "\($0["checkpointId"]!)=\($0["state"]!)" }
    #expect(states == ["start=done", "aid-1=done", "aid-2=current", "finish=projected"])
}
