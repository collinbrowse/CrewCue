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
/// the request's real `baseURL` and token; `tempDir`, required: the directory the replay's own
/// directory goes in, Android `context.cacheDir`, since the runtime's default temporary directory
/// is not writable there; `finishEtaAt?`: the finish ETA the teaser showed, ISO 8601, so the replay
/// starts from the same time) answers the replay's `baseURL`. Creating a replay retires any earlier
/// one (a recreated screen never leaves the old one live). `demoRacePlay`, `demoRacePause`,
/// `demoRaceTick` and `demoRaceSkip` take that `baseURL` and answer a snapshot. Finishing or
/// skipping deletes the directory and retires the base URL: later calls on it fail and never fall
/// back to the network. `demoRaceCleanup` (`tempDir`) at app start removes directories an app kill
/// left behind.
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
        let roomData: Data
        if let room = object["room"] as? [String: Any] {
            roomData = try JSONSerialization.data(withJSONObject: room)
        } else {
            guard demoURL(object) == nil else { throw DemoRaceError.invalidRoom }
            guard let roomId = text(object, "roomId") else {
                throw ClientHTTPError(status: 400, message: "room or roomId is required.")
            }
            roomData = try await RaceDayAPI.sendData(try graph(object), "/race-rooms/\(roomId)", method: .get, body: nil)
        }
        let session = try DemoRace.session(
            roomData: roomData,
            viewerUserId: text(object, "userId") ?? "",
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
        return [
            "baseURL": baseURL.absoluteString,
            "roomId": session.roomId,
            "durationSeconds": DemoRaceScript.durationSeconds,
            // The plan finish the replay starts from, before beat 2 moves it.
            "finishEtaAt": RaceDayReadouts.iso8601(course.raceStart.addingTimeInterval(course.plannedFinishSeconds)),
            "beats": DemoRaceBeat.allCases.map { ["beat": $0.rawValue, "number": $0.number, "caption": $0.caption] },
            "snapshot": demoSnapshotJSON(session.player.snapshot)
        ] as [String: Any]
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

    static func demoChatPrefix(_ baseURL: URL) -> String {
        "demo|\(baseURL.host?.lowercased() ?? "")|"
    }

    static func demoSnapshotJSON(_ snapshot: DemoRaceSnapshot) -> [String: Any] {
        [
            "progress": snapshot.progress,
            "beat": snapshot.beat.rawValue,
            "beatNumber": snapshot.beat.number,
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
