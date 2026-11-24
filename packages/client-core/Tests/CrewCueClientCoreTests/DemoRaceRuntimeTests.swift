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

/// The runner's room and its unpaid schedule, whose finish row carries the 15 minutes of planned
/// stops the estimate's own finish (20:00) leaves out. `offline` makes every request fail the way
/// a phone with no network does.
private final class PlanServer: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var isOffline = false
    private var planFrom = "est-1"
    private var seen: [String] = []

    var offline: Bool {
        get { lock.withLock { isOffline } }
        set { lock.withLock { isOffline = newValue } }
    }

    var paths: [String] { lock.withLock { seen } }

    /// The estimate the sheet was planned from; another than the room's leaves no finish row.
    func planned(from estimateId: String) {
        lock.withLock { planFrom = estimateId }
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let (offline, estimateId) = lock.withLock { () -> (Bool, String) in
            seen.append(request.url.path)
            return (isOffline, planFrom)
        }
        if offline { throw URLError(.notConnectedToInternet) }
        switch request.url.path {
        case "/race-rooms/room-1":
            return HTTPResponse(status: 200, body: try demoRoomData())
        case "/race-rooms/room-1/schedule":
            let stops = #"[{"id":"s0","checkpointId":"start","clockArrivalAt":"2026-08-15T12:00:00.000Z","elapsedSeconds":0,"plannedStoppageSeconds":0},"#
                + #"{"id":"s3","checkpointId":"finish","clockArrivalAt":"2026-08-15T20:15:00.000Z","elapsedSeconds":29700,"movingElapsedSeconds":28800,"plannedStoppageSeconds":0}]"#
            let body = #"{"roomId":"room-1","raceStartAt":"2026-08-15T12:00:00.000Z","pacingEstimateId":""#
                + estimateId + #"","stops":"# + stops + #","locked":{"checkpointIds":["aid-1","aid-2"]}}"#
            return HTTPResponse(status: 200, body: Data(body.utf8))
        default:
            return HTTPResponse(status: 404, body: Data(#"{"error":"Race room not found"}"#.utf8))
        }
    }
}

/// Every file under `directory`, or none when it doesn't exist.
private func files(under directory: URL) -> [String] {
    guard let walker = FileManager.default.enumerator(atPath: directory.path) else { return [] }
    return walker.compactMap { $0 as? String }
}

private func realBase() -> String {
    "https://real-\(UUID().uuidString.lowercased()).example.invalid"
}

/// One replay at a time: `demoRaceCreate` retires any earlier one, so these run one by one.
@Suite(.serialized)
struct DemoRaceRuntimeTests {
    @Test func demoRaceCreateSendsAndroidTheSharedOnboardingCaptions() async throws {
        let created = try result(try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "tempDir": freshDirectory().path, "room": demoRoomObject()
        ]))
        let beats = try #require(created["beats"] as? [[String: Any]])
        #expect(beats.count == DemoRaceBeat.allCases.count)
        for entry in beats {
            let beat = try #require(DemoRaceBeat(rawValue: entry["beat"] as? String ?? ""))
            #expect(entry["caption"] as? String == OnboardingCopy.replayCaption(beat))
        }
        let snapshot = try #require(created["snapshot"] as? [String: Any])
        #expect(snapshot["caption"] as? String == OnboardingCopy.replayCaption(.following))
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
        #expect(!ok(try await runtime([
            "op": "demoRaceCreate", "baseURL": "https://nobody.demo.invalid", "roomId": "room-1", "tempDir": freshDirectory().path
        ])))
    }

    @Test func demoRaceCreateOnTheFixtureNeedsNoAPI() async throws {
        let created = try result(try await runtime(["op": "demoRaceCreate", "fixture": true, "tempDir": freshDirectory().path]))
        #expect(created["roomId"] as? String == DemoRaceFixture.roomId)
        #expect(created["viewerUserId"] as? String == DemoRaceFixture.runnerUserId)
        #expect(created["durationSeconds"] as? Double == DemoRaceScript.durationSeconds)
        #expect(created["stepSeconds"] as? Double == DemoRaceScript.stepSeconds)
        #expect(created["finishEtaAt"] as? String == DemoRaceFixture.finishAt)
        // Nothing was read from an API, so there is no body to save.
        #expect(created["room"] == nil)
        let base = try #require(created["baseURL"] as? String)
        let request: [String: Any] = [
            "baseURL": base, "userId": DemoRaceFixture.runnerUserId, "storageDir": freshDirectory().path, "roomId": DemoRaceFixture.roomId
        ]
        let latest = try result(try await runtime(request.merging(["op": "latestPing"]) { $1 }))
        #expect(latest["latest"] != nil)
        _ = try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 })
    }

    /// Android's dot can glide too: `demoRaceRunner` answers where the dot is now, on the course
    /// line, and the path `pingTrack` serves runs along the line up to it.
    @Test func demoRaceRunnerAnswersTheGlidingDotOnTheCourseLine() async throws {
        let created = try result(try await runtime(["op": "demoRaceCreate", "fixture": true, "tempDir": freshDirectory().path]))
        let base = try #require(created["baseURL"] as? String)
        let request: [String: Any] = [
            "baseURL": base, "userId": DemoRaceFixture.runnerUserId, "storageDir": freshDirectory().path, "roomId": DemoRaceFixture.roomId
        ]
        _ = try await runtime(request.merging(["op": "demoRaceSeek", "seconds": 3.25]) { $1 })
        let runner = try result(try await runtime(request.merging(["op": "demoRaceRunner"]) { $1 }))
        let script = DemoRaceScript(course: try DemoRaceCourse(roomData: DemoRaceFixture.roomData, viewerUserId: DemoRaceFixture.runnerUserId))
        let expected = try #require(script.runnerPosition(atWallSeconds: 3.25))
        // The JSON round trip can move the last bit differently on Linux, so compare within a hair.
        #expect(abs(try #require(runner["latitude"] as? Double) - expected.latitude) < 1e-9)
        #expect(abs(try #require(runner["longitude"] as? Double) - expected.longitude) < 1e-9)
        #expect(abs(try #require(runner["lineMeters"] as? Double) - expected.lineMeters) < 1e-3)
        #expect(runner["recordedAt"] as? String == RaceDayReadouts.iso8601(expected.recordedAt))
        #expect(runner["fromRecordedAt"] as? String == RaceDayReadouts.iso8601(expected.fromRecordedAt))
        let track = try result(try await runtime(request.merging(["op": "pingTrack"]) { $1 }))
        let points = try #require(track["points"] as? [[String: Any]])
        #expect(points.count == script.track(through: 6).count)
        #expect(points.count > script.pings(through: 6).count)
        _ = try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 })
        // Ended: the op fails, never answers a stale dot.
        #expect(!ok(try await runtime(request.merging(["op": "demoRaceRunner"]) { $1 })))
    }

    /// Android's path chip counts the runner's pings, as on a race, not the points the replay adds
    /// along the course between them: every snapshot names the pings in the path served so far.
    @Test func demoRaceSnapshotsCountThePingsInTheServedPath() async throws {
        let created = try result(try await runtime(["op": "demoRaceCreate", "fixture": true, "tempDir": freshDirectory().path]))
        let base = try #require(created["baseURL"] as? String)
        let script = DemoRaceScript(course: try DemoRaceCourse(roomData: DemoRaceFixture.roomData, viewerUserId: DemoRaceFixture.runnerUserId))
        let first = try #require(created["snapshot"] as? [String: Any])
        #expect(first["pathPings"] as? Int == 1)
        let request: [String: Any] = [
            "baseURL": base, "userId": DemoRaceFixture.runnerUserId, "storageDir": freshDirectory().path, "roomId": DemoRaceFixture.roomId
        ]
        // 10 s in: ten pings while following, then the first of falling behind.
        let atTen = try result(try await runtime(request.merging(["op": "demoRaceSeek", "seconds": 10.0]) { $1 }))
        #expect(atTen["stepIndex"] as? Int == 20)
        #expect(atTen["pathPings"] as? Int == 11)
        let served = try #require(try result(try await runtime(request.merging(["op": "pingTrack"]) { $1 }))["points"] as? [[String: Any]])
        #expect(served.count > 11)
        // The last step: every ping of the replay.
        let last = try result(try await runtime(request.merging(["op": "demoRaceSeek", "seconds": 24.6]) { $1 }))
        #expect(last["stepIndex"] as? Int == script.steps.count - 1)
        #expect(last["pathPings"] as? Int == script.pings(through: script.steps.count - 1).count)
        #expect(last["pathPings"] as? Int == 25)
        _ = try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 })
    }

    @Test func demoRaceCreateHandsBackTheRoomBodyItReadForAnOfflineReplay() async throws {
        let real = realBase()
        RuntimeCall.setTransportForTests(PlanServer(), baseURL: real)
        defer { RuntimeCall.setTransportForTests(nil, baseURL: real) }
        let read = try result(try await runtime([
            "op": "demoRaceCreate", "baseURL": real, "token": "t", "userId": "runner-1", "roomId": "room-1",
            "storageDir": freshDirectory().path, "tempDir": freshDirectory().path
        ]))
        #expect(read["viewerUserId"] as? String == "runner-1")
        let room = try #require(read["room"] as? [String: Any])
        let body = try #require(room["room"] as? [String: Any])
        #expect(body["id"] as? String == "room-1")
        // The raw body: the course line the replay runs along is still there.
        #expect(body["mapWorkspace"] != nil)
        // Played from that saved body (no read), it is the same race, and nothing is handed back.
        let saved = try result(try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "room": room, "tempDir": freshDirectory().path
        ]))
        #expect(saved["roomId"] as? String == "room-1")
        #expect(saved["room"] == nil)
        _ = try await runtime(["op": "demoRaceSkip", "baseURL": try #require(saved["baseURL"] as? String)])
    }

    @Test func demoRaceCreateStartsFromThePlansFinishOnlineAndOffline() async throws {
        let real = realBase()
        let server = PlanServer()
        RuntimeCall.setTransportForTests(server, baseURL: real)
        defer { RuntimeCall.setTransportForTests(nil, baseURL: real) }
        let storage = freshDirectory().path
        let common: [String: Any] = [
            "op": "demoRaceCreate", "baseURL": real, "token": "t", "userId": "runner-1", "roomId": "room-1", "storageDir": storage
        ]
        // Without the flag: the estimate's own moving-time finish, as before.
        let own = try result(try await runtime(common.merging(["tempDir": freshDirectory().path]) { $1 }))
        #expect(own["finishEtaAt"] as? String == "2026-08-15T20:00:00.000Z")
        #expect(!server.paths.contains("/race-rooms/room-1/schedule"))
        // The plan's finish, planned stops included: what the teaser shows.
        let planned = try result(try await runtime(common.merging(["tempDir": freshDirectory().path, "planFinish": true]) { $1 }))
        #expect(planned["finishEtaAt"] as? String == "2026-08-15T20:15:00.000Z")
        #expect(server.paths.contains("/race-rooms/room-1/schedule"))
        // The replay's readouts start from it.
        let base = try #require(planned["baseURL"] as? String)
        let request: [String: Any] = ["baseURL": base, "userId": "runner-1", "storageDir": freshDirectory().path, "roomId": "room-1"]
        let latest = try result(try await runtime(request.merging(["op": "latestPing"]) { $1 }))
        let live = try result(try await runtime(request.merging(["op": "liveProjection"]) { $1 }))
        let sheet = try result(try await runtime(request.merging([
            "op": "projectAidSheet", "runner": try #require(latest["latest"]), "live": try #require(live["live"]), "checkpoints": [Any]()
        ]) { $1 }))
        #expect((sheet["readout"] as? [String: Any])?["finishEtaAt"] as? String == "2026-08-15T20:15:00.000Z")

        // Offline, from the saved room body: the sheet the read above cached for the race.
        server.offline = true
        let room = demoRoomObject()
        let offline = try result(try await runtime(common.merging([
            "tempDir": freshDirectory().path, "planFinish": true, "room": room
        ]) { $1 }))
        #expect(offline["finishEtaAt"] as? String == "2026-08-15T20:15:00.000Z")
        // Offline with nothing cached: the estimate's own finish.
        let uncached = try result(try await runtime(common.merging([
            "tempDir": freshDirectory().path, "planFinish": true, "room": room, "storageDir": freshDirectory().path
        ]) { $1 }))
        #expect(uncached["finishEtaAt"] as? String == "2026-08-15T20:00:00.000Z")

        // A sheet planned from another estimate has no finish row for this plan.
        server.offline = false
        server.planned(from: "est-old")
        let stale = try result(try await runtime(common.merging([
            "tempDir": freshDirectory().path, "planFinish": true, "storageDir": freshDirectory().path
        ]) { $1 }))
        #expect(stale["finishEtaAt"] as? String == "2026-08-15T20:00:00.000Z")
        // The teaser's finish, when the app has it, wins.
        let teaser = try result(try await runtime(common.merging([
            "tempDir": freshDirectory().path, "planFinish": true, "finishEtaAt": "2026-08-15T19:30:00.000Z"
        ]) { $1 }))
        #expect(teaser["finishEtaAt"] as? String == "2026-08-15T19:30:00.000Z")
        _ = try await runtime(["op": "demoRaceSkip", "baseURL": try #require(teaser["baseURL"] as? String)])
    }

    @Test func demoRaceSeekMovesTheReplayToAMomentAndKeepsItsPause() async throws {
        let created = try result(try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject(), "tempDir": freshDirectory().path
        ]))
        let first = try #require(created["snapshot"] as? [String: Any])
        #expect(first["beatLabel"] as? String == "1 of 4")
        let base = try #require(created["baseURL"] as? String)
        let seeked = try result(try await runtime(["op": "demoRaceSeek", "baseURL": base, "seconds": 12]))
        #expect(seeked["stepIndex"] as? Int == 24)
        #expect(seeked["beat"] as? String == DemoRaceBeat.fallingBehind.rawValue)
        #expect(seeked["beatLabel"] as? String == "2 of 4")
        #expect(seeked["caption"] as? String == OnboardingCopy.replayCaption(.fallingBehind))
        #expect(seeked["playing"] as? Bool == false)
        #expect(seeked["changed"] as? Bool == true)
        #expect(seeked["progress"] as? Double == 12 / DemoRaceScript.durationSeconds)
        // Never backwards; a request without seconds is refused.
        let back = try result(try await runtime(["op": "demoRaceSeek", "baseURL": base, "seconds": 3]))
        #expect(back["stepIndex"] as? Int == 24)
        #expect(back["changed"] as? Bool == false)
        let missing = try await runtime(["op": "demoRaceSeek", "baseURL": base])
        #expect(!ok(missing))
        #expect(missing["message"] as? String == "seconds is required.")
        _ = try await runtime(["op": "demoRaceSkip", "baseURL": base])
        let ended = try await runtime(["op": "demoRaceSeek", "baseURL": base, "seconds": 20])
        #expect(!ok(ended))
        #expect(ended["message"] as? String == DemoRaceError.ended.message)
    }

    @Test func aReplayThatCantStartSaysWhichChecklistStateItShows() async throws {
        // No course to run on: Empty.
        var object = demoRoomObject()
        var room = try #require(object["room"] as? [String: Any])
        room["course"] = ["checkpoints": [["id": "start", "title": "Start", "latitude": 39.2, "longitude": -120.2, "distanceMetersFromStart": 0]]]
        room["mapWorkspace"] = nil
        object["room"] = room
        let empty = try await runtime(["op": "demoRaceCreate", "userId": "runner-1", "room": object, "tempDir": freshDirectory().path])
        #expect(!ok(empty))
        #expect(empty["state"] as? String == FeatureState.empty.rawValue)
        // No network: Offline.
        let real = realBase()
        let server = PlanServer()
        server.offline = true
        RuntimeCall.setTransportForTests(server, baseURL: real)
        defer { RuntimeCall.setTransportForTests(nil, baseURL: real) }
        let offline = try await runtime([
            "op": "demoRaceCreate", "baseURL": real, "token": "t", "userId": "runner-1", "roomId": "room-1", "tempDir": freshDirectory().path
        ])
        #expect(offline["state"] as? String == FeatureState.offline.rawValue)
        #expect(offline["offline"] as? Bool == true)
        // A room that won't read: Error.
        server.offline = false
        let missing = try await runtime([
            "op": "demoRaceCreate", "baseURL": real, "token": "t", "userId": "runner-1", "roomId": "room-9", "tempDir": freshDirectory().path
        ])
        #expect(missing["state"] as? String == FeatureState.error.rawValue)
        #expect(missing["status"] as? Int == 404)
        // Only a create says so: other failures carry no state.
        let tick = try await runtime(["op": "demoRaceTick", "baseURL": "https://nobody.demo.invalid"])
        #expect(!ok(tick))
        #expect(tick["state"] == nil)
    }

    @Test func demoRuntimeCreateNeedsATempDirAndAValidFinish() async throws {
        // Android's runtime default temporary directory is not writable by the app: no silent default.
        let noTemp = try await runtime(["op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject()])
        #expect(!ok(noTemp))
        #expect((noTemp["message"] as? String)?.hasPrefix("tempDir is required") == true)
        let badFinish = try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject(), "tempDir": freshDirectory().path, "finishEtaAt": "soon"
        ])
        #expect(!ok(badFinish))
        #expect(badFinish["message"] as? String == "finishEtaAt must be an ISO 8601 time.")
        let cleanup = try await runtime(["op": "demoRaceCleanup"])
        #expect(!ok(cleanup))
    }

    @Test func demoRuntimeStartsFromTheTeaserFinishEta() async throws {
        // The teaser showed 19:30; the room's own plan says 20:00. The replay follows the teaser.
        let created = try result(try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject(), "tempDir": freshDirectory().path,
            "finishEtaAt": "2026-08-15T19:30:00.000Z"
        ]))
        #expect(created["finishEtaAt"] as? String == "2026-08-15T19:30:00.000Z")
        let base = try #require(created["baseURL"] as? String)
        let request: [String: Any] = ["baseURL": base, "userId": "runner-1", "storageDir": freshDirectory().path, "roomId": "room-1"]
        let latest = try result(try await runtime(request.merging(["op": "latestPing"]) { $1 }))
        let live = try result(try await runtime(request.merging(["op": "liveProjection"]) { $1 }))
        let runner = try #require(latest["latest"])
        let projection = try #require(live["live"])
        let sheet = try result(try await runtime(request.merging([
            "op": "projectAidSheet", "runner": runner, "live": projection, "checkpoints": [Any]()
        ]) { $1 }))
        #expect((sheet["readout"] as? [String: Any])?["finishEtaAt"] as? String == "2026-08-15T19:30:00.000Z")
        _ = try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 })
    }

    @Test func demoRuntimeCreateRetiresTheEarlierReplay() async throws {
        let temp = freshDirectory()
        let create: [String: Any] = ["op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject(), "tempDir": temp.path]
        // A recreated screen creates again without skipping the first replay.
        let firstCreated = try result(try await runtime(create))
        let first = try #require(firstCreated["baseURL"] as? String)
        let firstURL = try #require(URL(string: first))
        let firstSession = try #require(DemoRuntimes.shared.session(for: firstURL))
        let secondCreated = try result(try await runtime(create))
        let second = try #require(secondCreated["baseURL"] as? String)
        #expect(first != second)
        #expect(DemoRuntimes.shared.session(for: firstURL) == nil)
        #expect(!FileManager.default.fileExists(atPath: firstSession.cacheDirectory.path))
        let retired = try await runtime(["op": "latestPing", "baseURL": first, "userId": "runner-1", "roomId": "room-1"])
        #expect(retired["message"] as? String == DemoRaceError.ended.message)
        #expect(ok(try await runtime(["op": "latestPing", "baseURL": second, "userId": "runner-1", "roomId": "room-1"])))
        #expect(DemoRuntimes.shared.all().count == 1)
        _ = try await runtime(["op": "demoRaceSkip", "baseURL": second])
        #expect(DemoRuntimes.shared.all().isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: temp.path).isEmpty)
    }

    @Test func demoRuntimeCleanupRemovesWhatAnAppKillLeft() async throws {
        let temp = freshDirectory()
        try FileManager.default.createDirectory(at: temp.appendingPathComponent("crewcue-demo-killed"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: temp.appendingPathComponent("unrelated"), withIntermediateDirectories: true)
        let cleaned = try result(try await runtime(["op": "demoRaceCleanup", "tempDir": temp.path]))
        #expect(cleaned["removed"] as? Int == 1)
        #expect(try FileManager.default.contentsOfDirectory(atPath: temp.path) == ["unrelated"])
    }

    @Test func demoRuntimeSweepsWhatAnOpWroteAfterTheReplayEnded() async throws {
        let created = try result(try await runtime([
            "op": "demoRaceCreate", "userId": "runner-1", "room": demoRoomObject(), "tempDir": freshDirectory().path
        ]))
        let base = try #require(created["baseURL"] as? String)
        let baseURL = try #require(URL(string: base))
        let session = try #require(DemoRuntimes.shared.session(for: baseURL))
        let request: [String: Any] = ["baseURL": base, "userId": "runner-1", "storageDir": freshDirectory().path, "roomId": "room-1"]
        _ = try result(try await runtime(request.merging(["op": "chatPoll", "fresh": true]) { $1 }))
        let key = RuntimeCall.demoChatPrefix(session.baseURL) + "runner-1|room-1"
        #expect(RuntimeChatThreads.shared.read(key, roomId: "room-1").thread.loaded)

        // A long-poll in flight when the replay is skipped writes its thread back as it returns.
        let poll = String(decoding: try JSONSerialization.data(withJSONObject: request.merging(["op": "chatPoll", "wait": 25]) { $1 }), as: UTF8.self)
        let held = Task { await RuntimeCall.perform(poll) }
        try await Task.sleep(nanoseconds: 100_000_000)
        _ = try result(try await runtime(request.merging(["op": "demoRaceSkip"]) { $1 }))
        _ = await held.value
        #expect(RuntimeChatThreads.shared.read(key, roomId: "room-1").thread.loaded == false)

        // A cache write that lands after the end is removed by the sweep that follows its op.
        try FileManager.default.createDirectory(at: session.cacheDirectory.appendingPathComponent("users"), withIntermediateDirectories: true)
        RuntimeCall.sweepDemo(session)
        #expect(!FileManager.default.fileExists(atPath: session.cacheDirectory.path))
    }
}
