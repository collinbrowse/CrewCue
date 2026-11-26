import Foundation
import Testing
@testable import CrewCueClientCore

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(root["ok"] as? Bool == true, "\(raw)")
    return try #require(root["result"] as? [String: Any])
}

private func userDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("tracking-test-\(UUID().uuidString)", isDirectory: true)
}

@Test func aTestSessionEndsAfterTheTestWindow() throws {
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    let session = TrackingSession.test(roomId: "room", at: start)
    #expect(session.isTest)
    #expect(TrackingSession.testSeconds == LocationTest.timeoutSeconds + LocationTest.alwaysPromptSeconds)
    #expect(!session.testExpired(now: start.addingTimeInterval(TrackingSession.testSeconds - 1)))
    #expect(session.testExpired(now: start.addingTimeInterval(TrackingSession.testSeconds)))
    // Race-day tracking never expires.
    #expect(!TrackingSession(roomId: "room", startedAt: "2026-08-15T12:00:00Z").testExpired(now: .distantFuture))
    // An end that can't be read counts as passed: a test must never keep tracking.
    #expect(TrackingSession(roomId: "room", startedAt: "x", testUntil: "not a date").testExpired(now: start))
}

@Test func aTestSessionSavesItsMarkingAndOldSessionsReadAsRaceDay() throws {
    let directory = userDirectory()
    let test = TrackingSession.test(roomId: "room", at: Date(timeIntervalSince1970: 1_800_000_000))
    try test.save(userDirectory: directory)
    #expect(TrackingSession.load(userDirectory: directory) == test)

    // A session saved before the marking existed has no `testUntil`: race-day tracking.
    let old = try JSONSerialization.data(withJSONObject: ["roomId": "room", "startedAt": "2026-08-15T12:00:00Z"])
    try old.write(to: TrackingSession.file(userDirectory: directory))
    let loaded = try #require(TrackingSession.load(userDirectory: directory))
    #expect(!loaded.isTest)
    #expect(loaded.testUntil == nil)
}

@Test func runtimeRealTrackingReplacesTheTestMarking() async throws {
    let base = userDirectory()
    let fields: [String: Any] = ["storageDir": base.path, "userId": "runner", "role": "athlete", "roomId": "room"]
    func op(_ name: String, _ extra: [String: Any] = [:]) async throws -> [String: Any] {
        try await runtime(fields.merging(extra) { $1 }.merging(["op": name]) { $1 })
    }
    let started = try await op("startTrackingSession", ["test": true])
    #expect(started["test"] as? Bool == true)
    #expect(started["testUntil"] as? String != nil)
    #expect(started["testExpired"] as? Bool == false)
    #expect(try await op("trackingSession")["test"] as? Bool == true)

    // Start tracking for race day over a running test: the marking goes.
    let real = try await op("startTrackingSession")
    #expect(real["test"] as? Bool == false)
    #expect(real["testUntil"] is NSNull)
    let read = try await op("trackingSession")
    #expect(read["active"] as? Bool == true)
    #expect(read["test"] as? Bool == false)
    #expect(read["testExpired"] as? Bool == false)
}

@Test func runtimeLocationTestCountsOnlyPingsRecordedOnceTrackingStarted() async throws {
    func step(_ test: Any?, _ event: String, _ extra: [String: Any] = [:]) async throws -> [String: Any] {
        var fields: [String: Any] = ["op": "locationTest", "event": event]
        if let test { fields["test"] = test }
        return try await runtime(fields.merging(extra) { $1 })
    }
    let now = "2026-08-01T10:00:00Z"
    let before: [String: Any] = ["ping": ["pingId": "p1", "recordedAt": "2026-08-01T09:00:00Z"]]
    // The app's one-off sample, recorded just before the test's tracking started, landing after.
    let sample: [String: Any] = ["ping": ["pingId": "p2", "recordedAt": "2026-08-01T10:00:02.500Z"]]
    let tracked: [String: Any] = ["ping": ["pingId": "p3", "recordedAt": "2026-08-01T10:00:04Z"]]
    var answer = try await step(nil, "start", ["session": ["active": false], "roomId": "r1", "latest": before, "now": now])
    answer = try await step(answer["test"], "permission", ["permission": "always"])
    answer = try await step(answer["test"], "trackingStarted", ["startedAt": "2026-08-01T10:00:03Z"])
    #expect((answer["test"] as? [String: Any])?["trackingStartedAt"] as? String != nil)
    answer = try await step(answer["test"], "poll", ["latest": sample, "now": "2026-08-01T10:00:05Z"])
    #expect(answer["phase"] as? String == "waitingForPing")
    answer = try await step(answer["test"], "poll", ["latest": tracked, "now": "2026-08-01T10:00:06Z"])
    #expect(answer["phase"] as? String == "sent")
    // Tracking that was on before the test: any newer ping counts, as before.
    var on = try await step(nil, "start", ["session": ["active": true, "roomId": "r1"], "roomId": "r1", "latest": before, "now": now])
    on = try await step(on["test"], "permission", ["permission": "always"])
    on = try await step(on["test"], "poll", ["latest": sample, "now": "2026-08-01T10:00:05Z"])
    #expect(on["phase"] as? String == "sent")
}
