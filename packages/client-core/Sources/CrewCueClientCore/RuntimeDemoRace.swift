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

    private static func key(_ url: URL) -> String? {
        url.host?.lowercased()
    }
}

/// Ops: `demoRaceCreate` (`room`: a `GET /race-rooms/:roomId` body, or `roomId` to read it with
/// the request's real `baseURL` and token; `tempDir?` for the replay's directory) answers the
/// replay's `baseURL`; `demoRacePlay`, `demoRacePause`, `demoRaceTick` and `demoRaceSkip` take
/// that `baseURL` and answer a snapshot. Finishing or skipping deletes the directory and retires
/// the base URL: later calls on it fail and never fall back to the network.
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
        let temporaryRoot = text(object, "tempDir").map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.temporaryDirectory
        let session = try DemoRace.session(
            roomData: roomData,
            viewerUserId: text(object, "userId") ?? "",
            logger: SilentRuntimeLogger(),
            temporaryRoot: temporaryRoot
        )
        let baseURL = session.baseURL
        session.player.onTeardown {
            DemoRuntimes.shared.remove(baseURL)
            RuntimeChatThreads.shared.reset(prefix: demoChatPrefix(baseURL))
        }
        DemoRuntimes.shared.insert(session)
        return [
            "baseURL": baseURL.absoluteString,
            "roomId": session.roomId,
            "durationSeconds": DemoRaceScript.durationSeconds,
            "beats": DemoRaceBeat.allCases.map { ["beat": $0.rawValue, "number": $0.number, "caption": $0.caption] },
            "snapshot": demoSnapshotJSON(session.player.snapshot)
        ] as [String: Any]
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
