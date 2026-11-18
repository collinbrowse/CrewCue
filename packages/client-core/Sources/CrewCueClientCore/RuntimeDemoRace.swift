import Foundation

/// Replays Android is showing, by their own `baseURL`. Separate from the real runtime and from
/// `setTransportForTests`: a request whose `baseURL` is a replay's gets that replay's transport
/// and clock, no outbox, and its temporary directory as `storageDir`, so a second `RaceDayBridge`
/// built on that base URL drives the real race-day ops against the replay.
final class DemoRuntimes: @unchecked Sendable {
    static let shared = DemoRuntimes()
    private let lock = NSLock()
    private var sessions: [String: DemoRaceSession] = [:]

    func insert(_ session: DemoRaceSession) {
        guard let key = Self.key(session.baseURL) else { return }
        lock.lock()
        sessions[key] = session
        lock.unlock()
    }

    func session(for url: URL) -> DemoRaceSession? {
        guard let key = Self.key(url) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return sessions[key]
    }

    func remove(_ url: URL) {
        guard let key = Self.key(url) else { return }
        lock.lock()
        sessions[key] = nil
        lock.unlock()
    }

    /// Every live replay, for retiring before a new one starts.
    func all() -> [DemoRaceSession] {
        lock.lock()
        defer { lock.unlock() }
        return Array(sessions.values)
    }

    private static func key(_ url: URL) -> String? {
        url.host?.lowercased()
    }
}

/// Ops: `demoRaceCreate` (`room`: a `GET /race-rooms/:roomId` body, or `roomId` to read it with
/// the request's real `baseURL` and token, or `fixture: true` for `DemoRaceFixture` with no API;
/// `tempDir`, required: the directory the replay's own directory goes in, Android
/// `context.cacheDir`, since the runtime's default temporary directory is not writable there;
/// `finishEtaAt?`: the finish ETA the teaser showed, ISO 8601, so the replay starts from the same
/// time; `planFinish?: true` without one: start from the plan's finish the teaser shows, the
/// schedule's finish row (`PlanFinish`, planned stops included), read with the request's real
/// `baseURL`, or offline from the sheet cached for the race, instead of the estimate's own
/// moving-time finish) answers the replay's `baseURL`, `viewerUserId` (the `userId` to send on the
/// replay's ops), `durationSeconds`, `stepSeconds` and, when it read the room itself, `room`, the
/// body as the server sent it, for the app to save for an offline replay. A replay that can't
/// start fails with `state`, its checklist state (`DemoRace.unavailableState`). Creating a replay
/// retires any earlier one (a recreated screen never leaves the old one live). `demoRacePlay`,
/// `demoRacePause`, `demoRaceTick`, `demoRaceSkip` and `demoRaceSeek` (`seconds`: wall time
/// played, `DemoRacePlayer.seek`) take that `baseURL` and answer a snapshot. Finishing or skipping
/// deletes the directory and retires the base URL: later calls on it fail and never fall back to
/// the network. `demoRaceCleanup` (`tempDir`) at app start removes directories an app kill left
/// behind.
extension RuntimeCall {
    static func demoRace(_ object: [String: Any]) -> DemoRaceSession? {
        guard let url = demoURL(object) else { return nil }
        return DemoRuntimes.shared.session(for: url)
    }

    /// The request's `baseURL` when it names a replay host, live or retired.
    static func demoURL(_ object: [String: Any]) -> URL? {
        guard let base = object["baseURL"] as? String, let url = URL(string: base), DemoRace.isDemo(url) else { return nil }
        return url
    }

    static func demoRaceCreate(_ object: [String: Any]) async throws -> Any {
        guard let tempDir = text(object, "tempDir") else {
            throw ClientHTTPError(status: 400, message: "tempDir is required: the app's cache directory (Android context.cacheDir).")
        }
        var finishEtaAt: Date?
        if let raw = text(object, "finishEtaAt") {
            guard let parsed = ScheduleFormat.parseISO8601(raw) else {
                throw ClientHTTPError(status: 400, message: "finishEtaAt must be an ISO 8601 time.")
            }
            finishEtaAt = parsed
        }
        let fixture = boolValue(object["fixture"]) == true
        let roomData: Data
        /// The body read from the API here, handed back for the app to save.
        var readRoom: Any?
        if fixture {
            roomData = DemoRaceFixture.roomData
        } else if let room = object["room"] as? [String: Any] {
            roomData = try JSONSerialization.data(withJSONObject: room)
        } else {
            guard demoURL(object) == nil else { throw DemoRaceError.invalidRoom }
            guard let roomId = text(object, "roomId") else {
                throw ClientHTTPError(status: 400, message: "room or roomId is required.")
            }
            roomData = try await RaceDayAPI.sendData(try graph(object), "/race-rooms/\(roomId)", method: .get, body: nil)
            readRoom = try? JSONSerialization.jsonObject(with: roomData)
        }
        if finishEtaAt == nil, !fixture, boolValue(object["planFinish"]) == true {
            finishEtaAt = await demoPlanFinish(object, roomData: roomData)
        }
        let viewer = fixture ? DemoRaceFixture.runnerUserId : text(object, "userId") ?? ""
        let session = try DemoRace.session(
            roomData: roomData,
            viewerUserId: viewer,
            finishEtaAt: finishEtaAt,
            logger: SilentRuntimeLogger(),
            temporaryRoot: URL(fileURLWithPath: tempDir, isDirectory: true)
        )
        let baseURL = session.baseURL
        session.player.onTeardown {
            DemoRuntimes.shared.remove(baseURL)
            RuntimeChatThreads.shared.reset(prefix: demoChatPrefix(baseURL))
        }
        // One replay at a time: an earlier one (a recreated screen that never skipped) ends now.
        for earlier in DemoRuntimes.shared.all() {
            earlier.player.skip()
        }
        DemoRuntimes.shared.insert(session)
        let course = session.player.script.course
        var result: [String: Any] = [
            "baseURL": baseURL.absoluteString,
            "roomId": session.roomId,
            "viewerUserId": viewer,
            "durationSeconds": DemoRaceScript.durationSeconds,
            "stepSeconds": DemoRaceScript.stepSeconds,
            // The plan finish the replay starts from, before beat 2 moves it.
            "finishEtaAt": RaceDayReadouts.iso8601(course.raceStart.addingTimeInterval(course.plannedFinishSeconds)),
            "beats": DemoRaceBeat.allCases.map { ["beat": $0.rawValue, "number": $0.number, "caption": $0.caption] },
            "snapshot": demoSnapshotJSON(session.player.snapshot)
        ]
        if let readRoom {
            result["room"] = readRoom
        }
        return result
    }

    /// The finish the teaser shows for the race in `roomData`: the schedule's finish row for the
    /// room's plan of record (`PlanFinish.scheduled`), read with the request's real graph (offline,
    /// the sheet cached for the race). Nil when the room has no plan, the read fails or the sheet
    /// has no finish row: the replay then starts from the estimate's own finish.
    static func demoPlanFinish(_ object: [String: Any], roomData: Data) async -> Date? {
        guard demoURL(object) == nil,
              let root = try? JSONSerialization.jsonObject(with: roomData) as? [String: Any] else { return nil }
        let room = root["room"] as? [String: Any] ?? root
        guard let roomId = room["id"] as? String, !roomId.isEmpty,
              let plan = room["pacingEstimate"] as? [String: Any],
              let planData = try? JSONSerialization.data(withJSONObject: plan),
              let estimate = try? JSONDecoder().decode(PacingEstimate.self, from: planData),
              let graph = try? graph(object) else { return nil }
        let cache = userDirectory(object).map { RoomStorage.directory(userDirectory: $0, roomId: roomId) }
        guard let row = await PlanFinish.scheduled(graph: graph, roomId: roomId, for: estimate, cacheDirectory: cache) else {
            return nil
        }
        return ScheduleFormat.parseISO8601(row.clockArrivalAt)
    }

    static func demoRaceCleanup(_ object: [String: Any]) throws -> Any {
        guard let tempDir = text(object, "tempDir") else {
            throw ClientHTTPError(status: 400, message: "tempDir is required: the app's cache directory (Android context.cacheDir).")
        }
        return ["removed": DemoRace.removeStaleDirectories(in: URL(fileURLWithPath: tempDir, isDirectory: true))]
    }

    /// Runs after every op on a replay's `baseURL`: once the replay has ended, removes its
    /// directory and chat threads again, since an op that started before the end may have written
    /// after it.
    static func sweepDemo(_ session: DemoRaceSession?) {
        guard let session, session.player.sweepIfEnded() else { return }
        RuntimeChatThreads.shared.reset(prefix: demoChatPrefix(session.baseURL))
    }

    static func demoRaceControl(_ op: String, _ object: [String: Any]) throws -> Any {
        guard let session = demoRace(object) else { throw DemoRaceError.ended }
        let player = session.player
        let snapshot: DemoRaceSnapshot
        switch op {
        case "demoRacePlay": snapshot = player.play()
        case "demoRacePause": snapshot = player.pause()
        case "demoRaceSkip": snapshot = player.skip()
        default: snapshot = player.tick()
        }
        return demoSnapshotJSON(snapshot)
    }

    /// Moves the replay forward to `seconds` of wall time played (a dev route's `?at=`, or the
    /// moment a screen restored after process death had reached); play or pause stays.
    static func demoRaceSeek(_ object: [String: Any]) throws -> Any {
        guard let session = demoRace(object) else { throw DemoRaceError.ended }
        guard let seconds = doubleValue(object["seconds"]), seconds.isFinite else {
            throw ClientHTTPError(status: 400, message: "seconds is required.")
        }
        return demoSnapshotJSON(session.player.seek(toWallSeconds: seconds))
    }

    static func demoChatPrefix(_ baseURL: URL) -> String {
        "demo|\(baseURL.host?.lowercased() ?? "")|"
    }

    static func demoSnapshotJSON(_ snapshot: DemoRaceSnapshot) -> [String: Any] {
        [
            "progress": snapshot.progress,
            "beat": snapshot.beat.rawValue,
            "beatNumber": snapshot.beat.number,
            // "2 of 4", shared copy.
            "beatLabel": OnboardingCopy.replayBeatCount(snapshot.beat),
            "caption": snapshot.caption,
            "stepIndex": snapshot.stepIndex,
            "nowMs": (snapshot.now.timeIntervalSince1970 * 1000).rounded(),
            "now": RaceDayReadouts.iso8601(snapshot.now),
            "playing": snapshot.isPlaying,
            "finished": snapshot.isFinished,
            "skipped": snapshot.wasSkipped,
            "changed": snapshot.changed
        ]
    }
}
