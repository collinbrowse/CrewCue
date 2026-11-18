import Foundation

public struct DemoRaceSnapshot: Equatable, Sendable {
    /// 0 at the start, 1 once finished or skipped.
    public var progress: Double
    public var beat: DemoRaceBeat
    public var stepIndex: Int
    /// The replay clock (simulated race time).
    public var now: Date
    public var isPlaying: Bool
    public var isFinished: Bool
    public var wasSkipped: Bool
    /// The step moved (or the replay ended) since the previous call. Refresh the models.
    public var changed: Bool

    public var caption: String { beat.caption }
}

/// Plays the script over about 25 s of wall time. Play, pause, skip, a 0–1 progress and the beat
/// for captions. Every step change calls the `onStep` hook so a screen can refresh its models at
/// once (`MapModel.refreshNow()`) instead of waiting for the 30 s poll.
///
/// The replay's caches live in `cacheDirectory`, a fresh temporary directory deleted on finish or
/// skip. The graph then answers nothing more and `DemoRaceSession`'s directories refuse to
/// resolve, but a request already in flight can still write once: the runtime removes the
/// directory again when such an op returns, and `DemoRace.removeStaleDirectories` at launch
/// sweeps whatever an app kill left.
public final class DemoRacePlayer: @unchecked Sendable {
    public let script: DemoRaceScript
    public let cacheDirectory: URL
    let world: DemoRaceWorld
    private let wallClock: any Clock
    private let lock = NSLock()
    private var banked: Double = 0
    private var since: Date?
    private var finished = false
    private var skipped = false
    private var hook: (@Sendable (DemoRaceSnapshot) -> Void)?
    private var teardowns: [@Sendable () -> Void] = []

    init(world: DemoRaceWorld, cacheDirectory: URL, wallClock: any Clock) {
        self.script = world.script
        self.world = world
        self.cacheDirectory = cacheDirectory
        self.wallClock = wallClock
    }

    deinit {
        if !finished {
            world.end()
            DemoRace.removeDirectory(cacheDirectory)
        }
    }

    /// Called after every step change and once when the replay ends, off the player's lock.
    public func onStep(_ hook: (@Sendable (DemoRaceSnapshot) -> Void)?) {
        lock.lock()
        self.hook = hook
        lock.unlock()
    }

    func onTeardown(_ action: @escaping @Sendable () -> Void) {
        lock.lock()
        teardowns.append(action)
        lock.unlock()
    }

    public var snapshot: DemoRaceSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return snapshotLocked(changed: false)
    }

    @discardableResult
    public func play() -> DemoRaceSnapshot {
        lock.lock()
        if !finished, since == nil {
            since = wallClock.now()
        }
        let snap = snapshotLocked(changed: false)
        lock.unlock()
        return snap
    }

    @discardableResult
    public func pause() -> DemoRaceSnapshot {
        lock.lock()
        if !finished, let since {
            banked = min(DemoRaceScript.durationSeconds, banked + max(0, wallClock.now().timeIntervalSince(since)))
            self.since = nil
        }
        let snap = snapshotLocked(changed: false)
        lock.unlock()
        return snap
    }

    /// Moves to the step for the wall time played so far. Ends the replay at 25 s.
    @discardableResult
    public func tick() -> DemoRaceSnapshot {
        lock.lock()
        guard !finished else {
            let snap = snapshotLocked(changed: false)
            lock.unlock()
            return snap
        }
        let elapsed = elapsedLocked()
        let done = elapsed >= DemoRaceScript.durationSeconds
        let moved = world.advance(to: done ? script.steps.count - 1 : script.stepIndex(atWallSeconds: elapsed))
        if done {
            finished = true
            banked = DemoRaceScript.durationSeconds
            since = nil
        }
        let snap = snapshotLocked(changed: moved || done)
        let hook = hook
        lock.unlock()
        if done { teardown() }
        if snap.changed { hook?(snap) }
        return snap
    }

    /// Moves forward to `seconds` of wall time played, at the step for that moment, as if the
    /// replay had played there; play or pause stays as it was. A dev route opens the replay at a
    /// fixed moment with it, so a check reads one beat however slow the device is. A moment at or
    /// past the end, or not after the one played so far, changes nothing.
    @discardableResult
    public func seek(toWallSeconds seconds: Double) -> DemoRaceSnapshot {
        lock.lock()
        guard !finished, seconds.isFinite, seconds > elapsedLocked(), seconds < DemoRaceScript.durationSeconds else {
            let snap = snapshotLocked(changed: false)
            lock.unlock()
            return snap
        }
        banked = seconds
        if since != nil {
            since = wallClock.now()
        }
        let moved = world.advance(to: script.stepIndex(atWallSeconds: seconds))
        let snap = snapshotLocked(changed: moved)
        let hook = hook
        lock.unlock()
        if snap.changed { hook?(snap) }
        return snap
    }

    /// Ends the replay now.
    @discardableResult
    public func skip() -> DemoRaceSnapshot {
        lock.lock()
        guard !finished else {
            let snap = snapshotLocked(changed: false)
            lock.unlock()
            return snap
        }
        finished = true
        skipped = true
        since = nil
        let snap = snapshotLocked(changed: true)
        let hook = hook
        lock.unlock()
        teardown()
        hook?(snap)
        return snap
    }

    /// Plays to the end, waking for each step. Cancelling the task pauses; `skip()` ends it.
    public func run() async {
        play()
        while !Task.isCancelled {
            let snap = tick()
            if snap.isFinished { return }
            let delay = snap.isPlaying ? max(0.02, secondsToNextStep()) : 0.25
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        pause()
    }

    private func secondsToNextStep() -> Double {
        lock.lock()
        defer { lock.unlock() }
        let elapsed = elapsedLocked()
        let next = Double(script.stepIndex(atWallSeconds: elapsed) + 1) * DemoRaceScript.stepSeconds
        return min(next, DemoRaceScript.durationSeconds) - elapsed
    }

    private func elapsedLocked() -> Double {
        let running = since.map { max(0, wallClock.now().timeIntervalSince($0)) } ?? 0
        return min(DemoRaceScript.durationSeconds, banked + running)
    }

    private func snapshotLocked(changed: Bool) -> DemoRaceSnapshot {
        let step = world.step
        return DemoRaceSnapshot(
            progress: finished ? 1 : elapsedLocked() / DemoRaceScript.durationSeconds,
            beat: step.beat,
            stepIndex: step.index,
            now: step.now,
            isPlaying: !finished && since != nil,
            isFinished: finished,
            wasSkipped: skipped,
            changed: changed
        )
    }

    /// After the end, removes the directory again: a write that was in flight when the replay
    /// ended may have recreated it. True when the replay has ended.
    @discardableResult
    func sweepIfEnded() -> Bool {
        guard world.isEnded else { return false }
        DemoRace.removeDirectory(cacheDirectory)
        return true
    }

    private func teardown() {
        world.end()
        DemoRace.removeDirectory(cacheDirectory)
        lock.lock()
        let actions = teardowns
        teardowns = []
        lock.unlock()
        actions.forEach { $0() }
    }
}

/// A demo graph and the player that drives it. `graph` has the scripted transport and clock, no
/// outbox, no token and no session, so pointing the real Map, Pace and Chat models at it keeps the
/// network and the outbox away from the replay: nothing is uploaded, nothing is queued.
///
/// The graph does not isolate model caches. Models that pick their own directory (iOS `MapModel`
/// and `PaceModel` use `AppDirectories` with their user and room ids, and the replay reuses the
/// real room id) would write the replay's schedule, course map and estimate history into the real
/// `users/<id>/rooms/<roomId>`. Give those models `userDirectory(userId:)` and
/// `roomDirectory(userId:roomId:)` instead: the runtime's layout under the replay's temporary
/// directory (Android's runtime already redirects `storageDir` there). Keep tracking off: the
/// replay never starts a `TrackingSession`.
public struct DemoRaceSession: Sendable {
    public let roomId: String
    public let baseURL: URL
    public let graph: ClientGraph
    public let player: DemoRacePlayer

    public var cacheDirectory: URL { player.cacheDirectory }
    public var transport: DemoRaceTransport? { graph.transport as? DemoRaceTransport }

    /// `<cacheDirectory>/users/<id>`, the same layout as `UserStorage`. Throws once the replay ended.
    public func userDirectory(userId: String) throws -> URL {
        guard !player.world.isEnded else { throw DemoRaceError.ended }
        return try UserStorage(root: cacheDirectory).directory(userId: userId)
    }

    /// `<cacheDirectory>/users/<id>/rooms/<roomId>`, created, the same layout as `RoomStorage`.
    /// Throws once the replay ended.
    public func roomDirectory(userId: String, roomId: String) throws -> URL {
        let directory = RoomStorage.directory(userDirectory: try userDirectory(userId: userId), roomId: roomId)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

public enum DemoRace {
    /// Reserved by RFC 2606: never resolves. Each replay gets its own `<id>.demo.invalid`.
    public static let host = "demo.invalid"
    static let directoryPrefix = "crewcue-demo-"

    public static func isDemo(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == Self.host || host.hasSuffix(".\(Self.host)")
    }

    /// Builds a replay of the runner's race from its `GET /race-rooms/:roomId` body. Leftover
    /// replay directories under `temporaryRoot` (an app killed mid-replay) are removed first.
    public static func session(
        roomData: Data,
        viewerUserId: String,
        finishEtaAt: Date? = nil,
        logger: any Logger,
        temporaryRoot: URL = FileManager.default.temporaryDirectory,
        wallClock: any Clock = SystemClock()
    ) throws -> DemoRaceSession {
        let course = try DemoRaceCourse(roomData: roomData, viewerUserId: viewerUserId, finishEtaAt: finishEtaAt)
        let id = UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        guard let baseURL = URL(string: "https://\(id).\(host)") else { throw DemoRaceError.invalidRoom }
        removeStaleDirectories(in: temporaryRoot)
        let directory = temporaryRoot.appendingPathComponent("\(directoryPrefix)\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        LiveDemoDirectories.shared.insert(directory)
        let world = DemoRaceWorld(script: DemoRaceScript(course: course))
        let graph = ClientGraph(
            transport: DemoRaceTransport(baseURL: baseURL, world: world),
            clock: DemoRaceClock(world: world),
            logger: logger,
            baseURL: baseURL,
            tokenProvider: nil,
            outbox: nil,
            session: nil
        )
        let player = DemoRacePlayer(world: world, cacheDirectory: directory, wallClock: wallClock)
        return DemoRaceSession(roomId: course.roomId, baseURL: baseURL, graph: graph, player: player)
    }

    /// Removes replay directories no live player owns, for example the one an app killed
    /// mid-replay left. Call at app start with the root replays are created in (iOS: the default
    /// temporary directory; Android: `context.cacheDir`). Answers how many it removed.
    @discardableResult
    public static func removeStaleDirectories(in root: URL = FileManager.default.temporaryDirectory) -> Int {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return 0 }
        var removed = 0
        for name in names where name.hasPrefix(directoryPrefix) {
            let url = root.appendingPathComponent(name, isDirectory: true)
            if !LiveDemoDirectories.shared.contains(url), (try? FileManager.default.removeItem(at: url)) != nil {
                removed += 1
            }
        }
        return removed
    }

    /// The checklist state a replay that can't start shows (clients/behavior/onboarding-race-preview.md):
    /// no network is Offline, a race without a course to run on is Empty ("Add your course"), and
    /// anything else (a room that won't read, no start time, a server error) is Error. Skip stays
    /// available in each.
    public static func unavailableState(_ error: any Error) -> FeatureState {
        if TransportFailure.isOffline(error) { return .offline }
        if let reason = error as? DemoRaceError, reason == .noCourse { return .empty }
        return .error
    }

    static func removeDirectory(_ directory: URL) {
        LiveDemoDirectories.shared.remove(directory)
        if FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.removeItem(at: directory)
        }
    }
}

private final class LiveDemoDirectories: @unchecked Sendable {
    static let shared = LiveDemoDirectories()
    private let lock = NSLock()
    private var paths: Set<String> = []

    func insert(_ url: URL) { edit { $0.insert(url.standardizedFileURL.path) } }
    func remove(_ url: URL) { edit { $0.remove(url.standardizedFileURL.path) } }

    func contains(_ url: URL) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return paths.contains(url.standardizedFileURL.path)
    }

    private func edit(_ change: (inout Set<String>) -> Void) {
        lock.lock()
        change(&paths)
        lock.unlock()
    }
}
