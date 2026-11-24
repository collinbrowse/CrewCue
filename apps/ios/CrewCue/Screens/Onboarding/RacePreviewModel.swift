import CoreLocation
import Foundation
import Observation
import CrewCueClientCore

/// Where the replay's race comes from.
enum RacePreviewSource: Equatable {
    /// Onboarding: the runner's own race, read once with `GET /race-rooms/:roomId`.
    /// `finishEtaAt` is the finish the teaser just showed, so the replay starts from it.
    case race(userId: String, roomId: String, finishEtaAt: Date?)
    /// `crewcue://dev/onboarding-race-preview`: `DemoRaceFixture`, with no API. `?state=empty`,
    /// `error` or `offline` shows that state on the real screen, Skip included. `start` is the
    /// dev route's `?at=&paused=` (DEBUG): the replay opens at that moment.
    case fixture(state: FeatureState, start: RacePreviewDevStart? = nil)

    /// Which race: the teaser's finish going away (a sign-in elsewhere, a relaunch) is still the
    /// same replay and doesn't restart it.
    var key: String {
        switch self {
        case .race(let userId, let roomId, _): "race|\(userId)|\(roomId)"
        case .fixture(let state, let start): "fixture|\(state.rawValue)|\(start?.key ?? "")"
        }
    }

    /// The dev route's start moment; the runner's own race always starts from the beginning.
    var devStart: RacePreviewDevStart? {
        guard case .fixture(_, let start) = self else { return nil }
        return start
    }
}

/// `crewcue://dev/onboarding-race-preview?at=<seconds>&paused=1` (dev links, DEBUG only): the
/// fixture replay opens `at` seconds in, at the step, beat, caption and panel it would have
/// reached playing, and with `paused` it holds there (Back from the paywall too, at the start).
/// UI tests read each beat this way instead of racing the 25 s replay clock. The real onboarding
/// flow never has one.
struct RacePreviewDevStart: Equatable, Sendable {
    var atSeconds: Double
    var paused: Bool

    var key: String { "\(atSeconds)|\(paused)" }

    /// Nil when the link sets neither.
    init?(deeplink urlString: String) {
        guard let queryStart = urlString.firstIndex(of: "?") else { return nil }
        var at: Double?
        var paused: Bool?
        for pair in urlString[urlString.index(after: queryStart)...].split(separator: "&") {
            let bits = pair.split(separator: "=", maxSplits: 1)
            guard bits.count == 2 else { continue }
            switch bits[0] {
            case "at":
                if let seconds = Double(bits[1]), seconds.isFinite, seconds >= 0 { at = seconds }
            case "paused":
                paused = bits[1] == "1" || bits[1] == "true"
            default:
                break
            }
        }
        guard at != nil || paused != nil else { return nil }
        self.init(atSeconds: at ?? 0, paused: paused ?? false)
    }

    init(atSeconds: Double, paused: Bool) {
        self.atSeconds = atSeconds
        self.paused = paused
    }
}

/// Runner onboarding phase 2 (clients/behavior/onboarding-race-preview.md): about 25 s of race day
/// on the runner's own course, played in the real Map, Pace and Chat views, then the paywall.
///
/// The replay runs on its own `DemoRaceSession`: a separate graph (scripted transport and clock,
/// no outbox, no token) and a temporary directory. The replay's Map, Pace and Chat models are
/// built on that graph and those directories, so nothing reaches the real graph, the outbox or the
/// real room's caches. They hold no role, so they offer no edit and never upload, recompute or
/// track. Progress on every readout comes from the scripted runner pings the replay's
/// `GET .../pings/latest` answers, never from this phone's GPS.
///
/// The replay clock (`DemoRacePlayer`), the beat, the stage and the panel live here, not in a
/// view, so a rotation, a size-class change or a display switch carries on from the same moment.
@MainActor
@Observable
final class RacePreviewModel {
    enum Stage: Equatable {
        case replay
        case paywall
    }

    enum Status: Equatable {
        case loading
        case playing
        /// The race has no course to replay on.
        case empty
        case error
        /// Offline with no race saved on this phone.
        case offline

        /// A replay that can't start, by its checklist state (`DemoRace.unavailableState`).
        init(_ unavailable: FeatureState) {
            switch unavailable {
            case .empty: self = .empty
            case .offline: self = .offline
            default: self = .error
            }
        }
    }

    /// The view a compact width shows, following the beats.
    enum Panel: String, CaseIterable, Identifiable {
        case map, pace, chat

        var id: String { rawValue }

        /// The compact strip's title: the tab bar's own names, from client-core.
        var title: String {
            switch self {
            case .map: OnboardingCopy.replayMapTitle
            case .pace: OnboardingCopy.replayPaceTitle
            case .chat: OnboardingCopy.replayChatTitle
            }
        }
    }

    /// The replay's own models, on its graph and its directories.
    struct Replay {
        let map: MapModel
        let pace: PaceModel
        let chat: ChatModel
        let userId: String
        let roomId: String
        /// The course line the replay's runner follows, drawn as the Map's course (the race map
        /// joins the checkpoints; the replay's trail runs along this line, so it draws this one).
        let route: [CLLocationCoordinate2D]
        /// The dot between updates: it glides along `route` while the replay plays.
        let glide: RunnerGlide
    }

    /// No role: the replay only watches, so its models offer no edit and attempt no write.
    static let viewerRole = ""
    /// The runner's room body, kept in the race's own directory so an offline relaunch can still play.
    static let savedRoomFileName = "replay-room.json"
    /// A view that goes away and comes back this fast (a display switch rebuilding the window)
    /// keeps its replay; one that stays away ends it.
    static let cleanupGraceSeconds = 1.0

    private(set) var stage: Stage = .replay
    private(set) var status: Status = .loading
    private(set) var beat: DemoRaceBeat = .following
    /// 0 to 1 through the replay.
    private(set) var progress: Double = 0
    /// The replay clock runs. The Map's dot glides only then.
    private(set) var isPlaying = false
    private(set) var pausedByUser = false
    /// How many pings the replay's Map path holds: its path chip counts these, not the points
    /// the replay adds along the course between pings.
    private(set) var pathPings = 0
    /// Offline, the replay plays from the room saved on this phone.
    private(set) var fromSavedRace = false
    /// Compact width shows this one; it follows the beats, and the strip can pick another.
    var panel: Panel = .map
    private(set) var replay: Replay?
    private(set) var source: RacePreviewSource?

    private let client: AppClient
    /// The room body, read once per source. Back from the paywall replays it without a new read.
    private var roomData: Data?
    /// The room body runner setup's teaser just read (`seed`): the replay right after setup plays
    /// from it, online or not.
    private var seeded: (userId: String, roomId: String, data: Data)?
    private var session: DemoRaceSession?
    private var loop: Task<Void, Never>?
    private var starting: Task<Void, Never>?
    private var pendingCleanup: Task<Void, Never>?
    private var generation = 0
    private var sceneActive = true
    /// The views on screen. A late disappearance from an old one (a rebuilt window, a second
    /// window) leaves the replay playing while another still shows it.
    private var audience = DemoRaceAudience()

    init(client: AppClient) {
        self.client = client
    }

    var caption: String { OnboardingCopy.replayCaption(beat) }

    // MARK: Showing

    /// The flow is on screen for `source`. The same source carries on where it was (the paywall
    /// stays, a playing replay keeps its moment); another source starts over.
    func show(_ source: RacePreviewSource) {
        if source.key != self.source?.key {
            // Another race (or the dev fixture): the last one's saved room goes with its flow.
            reset(removingSaved: true)
            self.source = source
        } else if stage == .paywall || session != nil || starting != nil {
            return
        }
        begin(at: source.devStart)
    }

    /// A view showed the flow: it plays, and a pending cleanup is called off.
    func viewAppeared() {
        audience.appeared()
        pendingCleanup?.cancel()
        pendingCleanup = nil
        applyPlayback()
    }

    /// A view went away. Only when it was the last one: paused at once, and the replay ends if no
    /// view comes back within the grace period.
    func viewDisappeared() {
        guard audience.disappeared() else { return }
        applyPlayback()
        scheduleCleanup()
    }

    /// The app went to the background (paused) or came back.
    func setScene(active: Bool) {
        sceneActive = active
        applyPlayback()
    }

    // MARK: Controls

    func togglePlay() {
        guard session != nil, status == .playing else { return }
        pausedByUser.toggle()
        applyPlayback()
    }

    /// Always available: ends the replay and opens the paywall.
    func skip() {
        endSession()
        stage = .paywall
    }

    /// Back from the paywall: the replay again from its start.
    func replayFromStart() {
        stage = .replay
        pausedByUser = false
        // The dev route's paused start stays paused, at the first beat.
        begin(at: source?.devStart.map { RacePreviewDevStart(atSeconds: 0, paused: $0.paused) })
    }

    /// The flow is over (Not now, a purchase, or leaving the dev route): the next race starts
    /// fresh, and the room saved for it goes.
    func finish() {
        reset(removingSaved: true)
        removeSeed()
    }

    /// Sign-out. The user's directory is already wiped, so nothing here touches the disk.
    func clear() {
        reset(removingSaved: false)
        seeded = nil
    }

    /// Runner setup's teaser just read this race's room body (`GET /race-rooms/:roomId`). The
    /// replay plays from it with no second read, and it's saved now, so the replay can play
    /// offline right after setup.
    func seed(roomData: Data, userId: String, roomId: String) {
        if let old = seeded, old.userId != userId || old.roomId != roomId {
            removeSavedRoom(userId: old.userId, roomId: old.roomId)
        }
        seeded = (userId, roomId, roomData)
        if let url = savedRoomURL(userId: userId, roomId: roomId) {
            try? roomData.write(to: url, options: .atomic)
        }
    }

    /// The onboarding gate is on the replay step for `source`. A race other than the one this
    /// model holds (the active race switched) ends that race's flow and deletes its saved room;
    /// the view then starts `source` (`show`).
    func follow(_ source: RacePreviewSource) {
        guard case .race(let userId, let roomId, _) = source else { return }
        if case .race = self.source, self.source?.key != source.key {
            reset(removingSaved: true)
        }
        if let seeded, seeded.userId != userId || seeded.roomId != roomId {
            removeSeed()
        }
    }

    /// The gate left the replay step other than by Not now or a purchase here (the race paid
    /// elsewhere, another race made active, no race): the flow is over and its saved room goes.
    /// The dev route's fixture replay isn't the gate's, so it carries on.
    func leave() {
        if case .race = source {
            reset(removingSaved: true)
        }
        removeSeed()
    }

    // MARK: Replay

    /// `devStart`: the dev route's moment (DEBUG); nil plays from the beginning.
    private func begin(at devStart: RacePreviewDevStart? = nil) {
        endSession()
        // `endSession` called off a pending cleanup. With no view left (a quick appear and
        // disappear before `show`), the replay starting now, paused, ends after the grace period.
        if !audience.isWatched {
            scheduleCleanup()
        }
        let ticket = generation
        status = .loading
        beat = .following
        progress = 0
        panel = .map
        fromSavedRace = false
        starting = Task { [weak self] in
            await self?.start(ticket: ticket, devStart: devStart)
        }
    }

    private func start(ticket: Int, devStart: RacePreviewDevStart?) async {
        defer { if ticket == generation { starting = nil } }
        guard let source else { return }
        let data: Data
        let viewer: String
        let finishEtaAt: Date?
        switch source {
        case .fixture(let state, _):
            guard state == .success else {
                status = Status(state)
                return
            }
            data = DemoRaceFixture.roomData
            viewer = DemoRaceFixture.runnerUserId
            finishEtaAt = nil
        case .race(let userId, let roomId, let finish):
            guard let loaded = await room(userId: userId, roomId: roomId, ticket: ticket) else { return }
            data = loaded
            viewer = userId
            finishEtaAt = finish
        }
        guard ticket == generation else { return }
        // Off the main actor: the script lays its path along the whole course line, thousands of
        // points on a long route.
        let logger = client.graph.logger
        let built = await Task.detached(priority: .userInitiated) {
            Result { try DemoRace.session(roomData: data, viewerUserId: viewer, finishEtaAt: finishEtaAt, logger: logger) }
        }.value
        guard ticket == generation else {
            // Ended or started over meanwhile: this replay never plays, and its directory goes.
            if case .success(let late) = built { late.player.skip() }
            return
        }
        let session: DemoRaceSession
        switch built {
        case .success(let ready):
            session = ready
        case .failure(let error):
            status = Status(DemoRace.unavailableState(error))
            client.graph.logger.log("race preview replay unavailable: \((error as? DemoRaceError)?.message ?? "unknown")")
            return
        }
        self.session = session
        if let devStart {
            // Before the models read the replay, so their first read is at that moment.
            let moment = session.player.seek(toWallSeconds: devStart.atSeconds)
            progress = moment.progress
            beat = moment.beat
            panel = Self.panel(for: moment.beat)
            pausedByUser = devStart.paused
        }
        let graph = AppClient(graph: session.graph)
        let storage = ModelStorage.replay(session)
        let next = Replay(
            map: MapModel(client: graph, storage: storage),
            pace: PaceModel(client: graph, storage: storage),
            chat: ChatModel(client: graph),
            userId: viewer,
            roomId: session.roomId,
            route: session.player.script.course.line.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) },
            glide: RunnerGlide(player: session.player)
        )
        replay = next
        await next.map.activate(userId: viewer, roomId: session.roomId, role: Self.viewerRole)
        guard ticket == generation else { return }
        countPathPings()
        await next.pace.activate(userId: viewer, roomId: session.roomId, role: Self.viewerRole)
        guard ticket == generation else { return }
        next.chat.activate(userId: viewer, roomId: session.roomId, role: Self.viewerRole)
        status = .playing
        applyPlayback()
        loop = Task { [weak self] in
            await self?.run(ticket: ticket)
        }
    }

    /// The room body: this source's, else `GET /race-rooms/:roomId` once (saved for offline),
    /// else offline the one saved on this phone.
    private func room(userId: String, roomId: String, ticket: Int) async -> Data? {
        if let roomData { return roomData }
        if let seeded, seeded.userId == userId, seeded.roomId == roomId {
            roomData = seeded.data
            return seeded.data
        }
        do {
            let data = try await RaceDayAPI.loadRoomData(graph: client.graph, roomId: roomId)
            guard ticket == generation else { return nil }
            roomData = data
            if let url = savedRoomURL(userId: userId, roomId: roomId) {
                try? data.write(to: url, options: .atomic)
            }
            return data
        } catch {
            guard ticket == generation else { return nil }
            let state = DemoRace.unavailableState(error)
            if state == .offline, let url = savedRoomURL(userId: userId, roomId: roomId), let saved = try? Data(contentsOf: url) {
                fromSavedRace = true
                return saved
            }
            status = Status(state)
            client.graph.logger.log("race preview room unavailable: \(state.rawValue)")
            return nil
        }
    }

    private func savedRoomURL(userId: String, roomId: String) -> URL? {
        (try? AppDirectories.roomDirectory(userId: userId, roomId: roomId))?.appendingPathComponent(Self.savedRoomFileName)
    }

    /// Builds the path without creating a directory: an old source's user may have been wiped
    /// already (another user's session adopted without a sign-out), and that directory stays gone.
    private func removeSavedRoom(userId: String, roomId: String) {
        guard let url = AppDirectories.roomLocation(userId: userId, roomId: roomId)?
            .appendingPathComponent(Self.savedRoomFileName),
            FileManager.default.fileExists(atPath: url.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// Drops the teaser's room body and the copy saved from it.
    private func removeSeed() {
        guard let seeded else { return }
        self.seeded = nil
        removeSavedRoom(userId: seeded.userId, roomId: seeded.roomId)
    }

    /// Ticks the player to the end, refreshing the Map model at every step (instead of its 30 s
    /// poll); Pace reads the same runner, and Chat long-polls the replay on its own.
    private func run(ticket: Int) async {
        while !Task.isCancelled, ticket == generation, let player = session?.player {
            let snapshot = player.tick()
            if snapshot.changed {
                await apply(snapshot)
            }
            guard ticket == generation else { return }
            if snapshot.isFinished {
                // Played to the end: the paywall follows.
                skip()
                return
            }
            try? await Task.sleep(for: .seconds(snapshot.isPlaying ? Self.secondsToNextStep(snapshot.progress) : 0.25))
        }
    }

    private func apply(_ snapshot: DemoRaceSnapshot) async {
        progress = snapshot.progress
        isPlaying = snapshot.isPlaying
        if snapshot.beat != beat {
            beat = snapshot.beat
            panel = Self.panel(for: snapshot.beat)
        }
        guard !snapshot.isFinished, let replay else { return }
        await replay.map.refreshNow()
        countPathPings()
    }

    /// The pings in the path the replay's Map just read (`pathPings`).
    private func countPathPings() {
        guard let player = session?.player else {
            pathPings = 0
            return
        }
        pathPings = player.script.pings(through: player.snapshot.stepIndex).count
    }

    /// Plays unless the person paused, the app is in the background, or the view is away.
    private func applyPlayback() {
        guard let player = session?.player, status == .playing else { return }
        let snapshot = pausedByUser || !sceneActive || !audience.isWatched ? player.pause() : player.play()
        isPlaying = snapshot.isPlaying
    }

    /// The replay ends unless a view comes back within the grace period.
    private func scheduleCleanup() {
        pendingCleanup?.cancel()
        pendingCleanup = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.cleanupGraceSeconds))
            guard !Task.isCancelled else { return }
            self?.endSession()
        }
    }

    /// Ends the replay: the player stops (its directory goes), the models let go of the graph.
    private func endSession() {
        generation += 1
        pendingCleanup?.cancel()
        pendingCleanup = nil
        starting?.cancel()
        starting = nil
        loop?.cancel()
        loop = nil
        let ended = session
        session = nil
        ended?.player.skip()
        if let replay {
            replay.map.clear()
            replay.pace.clear()
            replay.chat.clear()
        }
        replay = nil
        isPlaying = false
        pathPings = 0
        if ended != nil {
            // A read already in flight when the replay ended may still write once; sweep again.
            Task.detached(priority: .utility) {
                try? await Task.sleep(for: .seconds(2))
                DemoRace.removeStaleDirectories()
            }
        }
    }

    /// Back to nothing shown. `removingSaved`: this source's room saved on the phone goes too
    /// (its flow is over); sign-out passes false, the user's directory being wiped already.
    private func reset(removingSaved: Bool) {
        if removingSaved, case .race(let userId, let roomId, _) = source {
            removeSavedRoom(userId: userId, roomId: roomId)
        }
        endSession()
        stage = .replay
        status = .loading
        beat = .following
        progress = 0
        panel = .map
        pausedByUser = false
        fromSavedRace = false
        roomData = nil
        source = nil
    }

    /// Map shows the dot moving and Last update (the following and dead zone beats), Pace the
    /// finish time slipping, Chat the crew message.
    static func panel(for beat: DemoRaceBeat) -> Panel {
        switch beat {
        case .following, .deadZone: .map
        case .fallingBehind: .pace
        case .crewChat: .chat
        }
    }

    /// Wakes for the next half-second step, or the end.
    static func secondsToNextStep(_ progress: Double) -> Double {
        let elapsed = progress * DemoRaceScript.durationSeconds
        let next = ((elapsed / DemoRaceScript.stepSeconds).rounded(.down) + 1) * DemoRaceScript.stepSeconds
        return max(0.02, min(next, DemoRaceScript.durationSeconds) - elapsed)
    }
}
