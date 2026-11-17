import Foundation
import Testing
@testable import CrewCueClientCore

/// The real API for these tests: its own ping, its own chat message, and the runner's room.
private struct RealServer: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        switch request.url.path {
        case "/race-rooms/room-1":
            return HTTPResponse(status: 200, body: try demoRoomData())
        case "/race-rooms/room-1/pings/latest":
            let body = #"{"roomId":"room-1","stalenessThresholdSeconds":900,"evaluatedAt":"2026-08-15T12:00:00.000Z","ping":{"pingId":"real-ping","latitude":39.2,"longitude":-120.2,"recordedAt":"2026-08-15T12:00:00.000Z","receivedAt":"2026-08-15T12:00:01.000Z"}}"#
            return HTTPResponse(status: 200, body: Data(body.utf8))
        case "/chat/rooms/room-1/messages":
            let body = #"{"messages":[{"id":"7","roomId":"room-1","senderUserId":"crew-2","clientMessageId":"c7","text":"real hello","createdAt":"2026-08-15T12:00:00.000Z"}],"members":[{"userId":"crew-2","displayName":"Bo"}],"selfUserId":"runner-1","latestCursor":"7"}"#
            return HTTPResponse(status: 200, body: Data(body.utf8))
        default:
            return HTTPResponse(status: 404, body: Data(#"{"error":"nope"}"#.utf8))
        }
    }
}

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func result(_ root: [String: Any]) throws -> [String: Any] {
    try #require(root["result"] as? [String: Any])
}

private func ok(_ root: [String: Any]) -> Bool {
    (root["ok"] as? Bool) == true
}

/// Every file under `directory`, or none when it doesn't exist.
private func files(under directory: URL) -> [String] {
    guard let walker = FileManager.default.enumerator(atPath: directory.path) else { return [] }
    return walker.compactMap { $0 as? String }
}

private func realBase() -> String {
    "https://real-\(UUID().uuidString.lowercased()).example.invalid"
}

@Test func demoRuntimeStaysIndependentOfTheRealRuntime() async throws {
    let real = realBase()
    RuntimeCall.setTransportForTests(RealServer(), baseURL: real)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: real) }
    // Android passes its storage root on every call; the replay must never write there.
    let storage = freshDirectory().appendingPathComponent("crewcue-user", isDirectory: true)
    let realStorage = freshDirectory().appendingPathComponent("crewcue-user", isDirectory: true)
    let common: [String: Any] = ["userId": "runner-1", "role": "athlete", "token": "real-token"]

    let created = try result(try await runtime(common.merging([
        "op": "demoRaceCreate", "baseURL": real, "storageDir": storage.path,
        "tempDir": freshDirectory().path, "room": demoRoomObject()
    ]) { $1 }))
    let base = try #require(created["baseURL"] as? String)
    let baseURL = try #require(URL(string: base))
    #expect(DemoRace.isDemo(baseURL))
    #expect((created["beats"] as? [[String: Any]])?.count == 4)
    let demo = try #require(DemoRuntimes.shared.session(for: baseURL))
    let onDemo = common.merging(["baseURL": base, "storageDir": storage.path, "roomId": "room-1"]) { $1 }
    let onReal = common.merging(["baseURL": real, "storageDir": realStorage.path, "roomId": "room-1"]) { $1 }

    demo.player.world.advance(to: 44)
    let demoPing = try result(try await runtime(onDemo.merging(["op": "latestPing"]) { $1 }))
    let realPing = try result(try await runtime(onReal.merging(["op": "latestPing"]) { $1 }))
    let demoLatest = try #require(demoPing["latest"] as? [String: Any])
    #expect(((demoLatest["ping"] as? [String: Any])?["pingId"] as? String)?.hasPrefix("demo-ping-") == true)
    #expect(((realPing["latest"] as? [String: Any])?["ping"] as? [String: Any])?["pingId"] as? String == "real-ping")

    // Caches land in the replay's directory, never under the storage root it was given.
    let schedule = try await runtime(onDemo.merging(["op": "loadSchedule"]) { $1 })
    #expect(ok(schedule))
    let cached = RoomStorage.directory(userDirectory: demo.cacheDirectory.appendingPathComponent("users/runner-1"), roomId: "room-1")
    #expect(FileManager.default.fileExists(atPath: ScheduleCache.file(directory: cached).path))

    // Chat threads are keyed apart: the crew message never reaches the real thread.
    let demoChat = try result(try await runtime(onDemo.merging(["op": "chatPoll", "fresh": true]) { $1 }))
    let realChat = try result(try await runtime(onReal.merging(["op": "chatPoll", "fresh": true]) { $1 }))
    #expect((demoChat["rows"] as? [[String: Any]])?.compactMap { $0["text"] as? String } == [DemoRaceScript.crewMessage])
    #expect((realChat["rows"] as? [[String: Any]])?.compactMap { $0["text"] as? String } == ["real hello"])

    // No outbox, no tracking, no ping upload on the replay.
    let ping = try await runtime(onDemo.merging(["op": "enqueuePing", "latitude": 39.2, "longitude": -120.2, "recordedAt": "2026-08-15T13:00:00.000Z"]) { $1 })
    #expect(!ok(ping))
    #expect((ping["message"] as? String)?.contains("no outbox") == true)
    #expect(!ok(try await runtime(onDemo.merging(["op": "startTrackingSession"]) { $1 })))
    #expect(!ok(try await runtime(onDemo.merging(["op": "flushOutbox"]) { $1 })))

    // Readouts without `nowMs` read the replay's clock: the dead zone shows stale, 18 minutes.
    demo.player.world.advance(to: 45)
    let fresh = try result(try await runtime(onDemo.merging(["op": "projectAidSheet", "runner": demoLatest]) { $1 }))
    #expect((fresh["readout"] as? [String: Any])?["pingState"] as? String == "live")

    let skipped = try result(try await runtime(onDemo.merging(["op": "demoRaceSkip"]) { $1 }))
    #expect(skipped["finished"] as? Bool == true)
    #expect(skipped["skipped"] as? Bool == true)
    #expect(!FileManager.default.fileExists(atPath: demo.cacheDirectory.path))
    let retired = try await runtime(onDemo.merging(["op": "latestPing"]) { $1 })
    #expect(!ok(retired))
    #expect(retired["message"] as? String == DemoRaceError.ended.message)
    #expect(!ok(try await runtime(onDemo.merging(["op": "loadSchedule"]) { $1 })))
    #expect(files(under: storage).isEmpty)

    // The real runtime is untouched.
    let after = try result(try await runtime(onReal.merging(["op": "latestPing"]) { $1 }))
    #expect(((after["latest"] as? [String: Any])?["ping"] as? [String: Any])?["pingId"] as? String == "real-ping")
}

@Test func demoRuntimeReadoutsUseTheReplayClock() async throws {
    let storage = freshDirectory()
    let created = try result(try await runtime([
        "op": "demoRaceCreate", "userId": "runner-1", "tempDir": freshDirectory().path, "room": demoRoomObject()
    ]))
    let base = try #require(created["baseURL"] as? String)
    let baseURL = try #require(URL(string: base))
    let demo = try #require(DemoRuntimes.shared.session(for: baseURL))
    let request: [String: Any] = ["baseURL": base, "userId": "runner-1", "storageDir": storage.path, "roomId": "room-1"]
    demo.player.world.advance(to: 37)
    let latest = try result(try await runtime(request.merging(["op": "latestPing"]) { $1 }))
    let live = try result(try await runtime(request.merging(["op": "liveProjection"]) { $1 }))
    let runner = try #require(latest["latest"])
    let projection = try #require(live["live"])
    let sheet = try result(try await runtime(request.merging([
        "op": "projectAidSheet", "runner": runner, "live": projection, "checkpoints": [Any]()
    ]) { $1 }))
    let readout = try #require(sheet["readout"] as? [String: Any])
    #expect(readout["pingState"] as? String == "stale")
    #expect(readout["lastPingLabel"] as? String == "18 MIN AGO")
    #expect(readout["liveEtaStale"] as? Bool == true)
    #expect(readout["finishEtaAt"] as? String == "2026-08-15T20:12:00.000Z")
    _ = try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 })
}

@Test func demoRuntimePlaysPausesTicksAndSkips() async throws {
    let real = realBase()
    RuntimeCall.setTransportForTests(RealServer(), baseURL: real)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: real) }
    // Without an inline room the replay reads the runner's room from the real API.
    let created = try result(try await runtime([
        "op": "demoRaceCreate", "baseURL": real, "token": "t", "userId": "runner-1", "roomId": "room-1", "tempDir": freshDirectory().path
    ]))
    #expect(created["roomId"] as? String == "room-1")
    let base = try #require(created["baseURL"] as? String)
    let first = try result(try await runtime(["op": "demoRaceTick", "baseURL": base]))
    #expect(first["stepIndex"] as? Int == 0)
    #expect(first["playing"] as? Bool == false)
    #expect(first["beat"] as? String == "following")
    let playing = try result(try await runtime(["op": "demoRacePlay", "baseURL": base]))
    #expect(playing["playing"] as? Bool == true)
    let paused = try result(try await runtime(["op": "demoRacePause", "baseURL": base]))
    #expect(paused["playing"] as? Bool == false)
    #expect((paused["progress"] as? Double ?? 1) < 0.1)
    let skipped = try result(try await runtime(["op": "demoRaceSkip", "baseURL": base]))
    #expect(skipped["finished"] as? Bool == true)
    #expect(skipped["progress"] as? Double == 1)
    #expect(!ok(try await runtime(["op": "demoRaceTick", "baseURL": base])))
    // A replay base URL that was never created is refused too, never sent to the network.
    #expect(!ok(try await runtime(["op": "latestPing", "baseURL": "https://nobody.demo.invalid", "roomId": "room-1"])))
    #expect(!ok(try await runtime(["op": "demoRaceCreate", "baseURL": "https://nobody.demo.invalid", "roomId": "room-1"])))
}
