import CoreLocation
import Foundation
import Network
import Observation
import CrewCueClientCore

struct MapCoursePoint: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var latitude: Double
    var longitude: Double
}

/// The course map's offline copy: the checkpoints and the GPX line.
private struct MapCourseCache: Codable {
    var points: [MapCoursePoint]
    var route: [CourseRoutePoint]
}

/// A position the person typed for a new checkpoint. `id` changes with every new one, so the
/// same position typed twice still moves the map.
struct PickTarget: Equatable, Sendable {
    var id: Int
    var latitude: Double
    var longitude: Double
}

/// How far the map's aid sheet is open.
enum MapSheetDetent: Int, CaseIterable, Sendable {
    /// One row: the next aid station and when the runner gets there.
    case closed
    /// The aid station pager.
    case half
    /// The pager and the course progress, stop and delay details.
    case open
}

@MainActor
@Observable
final class MapModel {
    private let client: AppClient
    /// The app's storage, or the onboarding replay's temporary directory.
    private let storage: ModelStorage
    private let locator = RaceTrackingLocator()
    /// Flushes the backlog the moment the phone gets service back.
    private var pathMonitor: NWPathMonitor?
    private var generation = 0
    private var userId: String?
    private var roomId: String?
    private var role = ""
    private var wantsLocation = false
    /// Five-second upload cooldown. Released when the signed-in race changes.
    private var locationGate = LocationUploadGate()
    private var courseOffline = false
    private var courseFailed = false
    private var schedule: CrewScheduleSheet?
    private var courseCheckpoints: [AidStationCheckpoint] = []
    /// The athlete's latest ping from the API. The only source of race progress on this phone.
    private(set) var runner: RunnerProgress = .none
    /// The server's live ETAs, built from the athlete's pings. Nil until the room has a projection.
    private(set) var live: LiveProjection?
    /// The runner's path from the API (every crew phone draws the same one).
    private(set) var track: RunnerTrack = .empty
    /// The athlete tapped Start tracking for this race.
    private(set) var trackingActive = false
    private(set) var trackingIntervalSeconds = TrackingSettings.defaultIntervalSeconds
    private var elevation: ElevationProfile?
    private var styleOffline = false
    private var styleFailed = false

    private(set) var points: [MapCoursePoint] = []
    /// The course line from the race's saved GPX. Empty: the map joins the checkpoints.
    private(set) var route: [CLLocationCoordinate2D] = []
    private(set) var aidPages: [AidStationPage] = []
    private(set) var aidLiveNextIndex: Int?
    private(set) var aidIndex = 0
    private(set) var aidFollow = true
    private(set) var readout = RaceDayReadouts.make(sheet: nil, checkpoints: [], runner: .none, now: Date())
    /// Bumped to ask the map to fit the course again.
    private(set) var recenterRequest = 0
    private(set) var mapMessage = "No course on the map."
    /// The new checkpoint's position as one "latitude, longitude" field, so a pasted position
    /// goes in whole. The map's crosshair writes it as the map moves; typing a valid one moves
    /// the map under the crosshair.
    var coordinateText = "" {
        didSet {
            guard coordinateText != oldValue, !writingCoordinateFromMap else { return }
            followTypedCoordinate(pasted: coordinateText.count - oldValue.count > 1)
        }
    }
    @ObservationIgnored private var writingCoordinateFromMap = false
    @ObservationIgnored private var typedCoordinateTask: Task<Void, Never>?
    /// A position typed or pasted into the field: the map centers it under the crosshair.
    private(set) var pickTarget: PickTarget?
    var checkpointTitle = ""
    /// How far the aid sheet is open. Kept here so a fold or rotation keeps it.
    var sheetDetent = MapSheetDetent.half
    /// The map's base style, kept on this phone.
    var baseMap: MapBaseStyle = MapBaseStyle.saved() {
        didSet { baseMap.save() }
    }
    /// Bumped by the runner button: the map zooms to the runner's latest ping.
    private(set) var runnerFocusRequest = 0
    /// A short note beside the runner button (the runner isn't tracking yet), cleared after a few seconds.
    private(set) var runnerNote: String?
    @ObservationIgnored private var runnerNoteTask: Task<Void, Never>?
    /// A short note over the map after the place-checkpoint sheet closes ("Saved Water Stop."),
    /// cleared after a few seconds.
    private(set) var mapNote: String?
    @ObservationIgnored private var mapNoteTask: Task<Void, Never>?
    private(set) var pickMessage = "No checkpoint selected."
    private(set) var pickBusy = false
    var originId = ""
    var destinationId = ""
    var routeMode = "hike"
    private(set) var navigateMessage = "No destination."
    private(set) var navigateBusy = false
    private(set) var locationMessage = "No location sample yet."

    init(client: AppClient, storage: ModelStorage = .app) {
        self.client = client
        self.storage = storage
        locator.onSample = { [weak self] latitude, longitude, accuracy, time in
            self?.receive(latitude: latitude, longitude: longitude, accuracy: accuracy, at: time)
        }
        locator.onDenied = { [weak self] in
            self?.locationMessage = "Location permission was denied. Turn it on in Settings to share your position."
        }
        locator.onWhenInUseOnly = { [weak self] in
            self?.locationMessage = "Tracking. Choose \"Always\" so it keeps going while the phone is locked."
        }
    }

    func activate(userId: String?, roomId: String?, role: String?) async {
        invalidateInFlight()
        let ticket = generation
        let nextUser = userId
        let trimmedRoom = roomId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextRoom = (trimmedRoom?.isEmpty == false) ? trimmedRoom : nil
        let nextRole = role ?? ""
        let contextChanged = nextUser != self.userId || nextRoom != self.roomId || nextRole != self.role
        self.userId = nextUser
        self.roomId = nextRoom
        self.role = nextRole
        if nextUser == nil || nextRoom == nil {
            points = []
            route = []
            schedule = nil
            courseCheckpoints = []
            aidPages = []
            courseOffline = false
            courseFailed = false
            refreshMapMessage()
            if contextChanged {
                resetActions()
            }
            return
        }
        if contextChanged {
            resetActions()
            route = []
            runner = .none
            live = nil
            track = .empty
            stopLocator()
        }
        await loadCourse(ticket: ticket)
        await refreshRunner(ticket: ticket)
        resumeTrackingIfSaved()
        if trackingActive {
            // A sample taken since tracking resumed at launch lost its upload to
            // `invalidateInFlight` above. It is still in the outbox; send it now, not next interval.
            await flushBacklog(ticket: ticket)
        }
    }

    /// The athlete on this phone, the only role that shares location.
    var isAthlete: Bool { PingPolicy.mayUpload(role: role) }

    /// Starts race-day sampling for this race on the athlete's phone. Persisted, so a relaunch resumes.
    func startTracking() {
        guard isAthlete, let roomId, let directory = userDirectory() else {
            locationMessage = "Only the runner's phone shares location."
            return
        }
        try? TrackingSession(roomId: roomId, startedAt: RaceDayReadouts.iso8601(client.graph.clock.now()))
            .save(userDirectory: directory)
        reloadTrackingInterval()
        locationMessage = "Tracking. A sample every \(Self.intervalText(trackingIntervalSeconds))."
        beginSampling()
    }

    func stopTracking() {
        if let directory = userDirectory() {
            try? TrackingSession.clear(userDirectory: directory)
        }
        stopLocator()
        locationMessage = "Tracking stopped."
    }

    /// The settings sheet saved a new interval.
    func reloadTrackingInterval() {
        guard let directory = userDirectory() else { return }
        trackingIntervalSeconds = TrackingSettings.load(userDirectory: directory).intervalSeconds
        locator.updateInterval(trackingIntervalSeconds)
    }

    /// App came to the foreground: read the runner now instead of waiting for the next tick.
    func refreshNow() async {
        await refreshRunner(ticket: generation)
        if trackingActive {
            await flushBacklog(ticket: generation)
        }
    }

    /// Restarts the athlete's saved tracking at app launch, before any view or network call.
    /// When iOS relaunches a killed app in the background for a significant location change, no
    /// window appears, so the shell's `.task` never calls `activate`, and the relaunched app has
    /// only a few seconds before it is suspended again. A later `activate` for the same race
    /// sees no context change and leaves the locator running.
    func resumeTrackingAtLaunch(userId: String?, roomId: String?, role: String?) {
        guard self.userId == nil, self.roomId == nil else { return }
        let trimmedRoom = roomId?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let userId, let room = trimmedRoom, !room.isEmpty else { return }
        self.userId = userId
        self.roomId = room
        self.role = role ?? ""
        resumeTrackingIfSaved()
    }

    private func resumeTrackingIfSaved() {
        guard isAthlete, let roomId, let directory = userDirectory(),
              let session = TrackingSession.load(userDirectory: directory), session.roomId == roomId else {
            return
        }
        if !trackingActive {
            // Set before sampling starts, so a permission denial reported during start wins.
            locationMessage = "Tracking resumed."
            beginSampling()
        }
    }

    private func beginSampling() {
        reloadTrackingInterval()
        wantsLocation = true
        trackingActive = true
        locator.start(intervalSeconds: trackingIntervalSeconds)
        startPathMonitor()
    }

    private func stopLocator() {
        wantsLocation = false
        trackingActive = false
        locator.stop()
        pathMonitor?.cancel()
        pathMonitor = nil
    }

    private func startPathMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                guard let self, self.trackingActive else { return }
                await self.flushBacklog(ticket: self.generation)
            }
        }
        monitor.start(queue: DispatchQueue(label: "crewcue.tracking.path"))
        pathMonitor = monitor
    }

    private func userDirectory() -> URL? {
        guard let userId else { return nil }
        return try? storage.userDirectory(userId)
    }

    static func intervalText(_ seconds: Int) -> String {
        seconds % 60 == 0 ? "\(seconds / 60) min" : "\(seconds) s"
    }

    /// Reads the athlete's latest ping until the calling task is cancelled.
    func followRunner() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(RunnerProgress.refreshIntervalSeconds))
            } catch {
                return
            }
            await refreshRunner(ticket: generation)
        }
    }

    func clear() {
        invalidateInFlight()
        stopLocator()
        userId = nil
        roomId = nil
        role = ""
        points = []
        route = []
        schedule = nil
        courseCheckpoints = []
        runner = .none
        live = nil
        track = .empty
        elevation = nil
        aidPages = []
        aidIndex = 0
        aidFollow = true
        courseOffline = false
        courseFailed = false
        styleOffline = false
        styleFailed = false
        coordinateText = ""
        coordinateInvalid = false
        pickTarget = nil
        checkpointTitle = ""
        originId = ""
        destinationId = ""
        routeMode = "hike"
        pickBusy = false
        navigateBusy = false
        pickMessage = "No checkpoint selected."
        navigateMessage = "No destination."
        locationMessage = "No location sample yet."
        refreshMapMessage()
    }

    /// The crosshair settled over a new spot. Leaves the field alone while its text already
    /// names that spot, so a typed position isn't rewritten under the person's cursor.
    func selectCoordinate(latitude: Double, longitude: Double) {
        if let current = CoordinateText.parse(coordinateText),
           // About 5 m: the camera lands a hair off a typed position, which stays as typed.
           abs(current.latitude - latitude) < 0.000_05, abs(current.longitude - longitude) < 0.000_05 {
            return
        }
        writingCoordinateFromMap = true
        coordinateText = CoordinateText.format(latitude: latitude, longitude: longitude)
        writingCoordinateFromMap = false
        coordinateInvalid = false
        if pickMessage == "No checkpoint selected." {
            pickMessage = ""
        }
    }

    /// Moves the map under the crosshair to a typed position once typing pauses, so a half-typed
    /// number ("39.35, -1") never sends the map across the world. A paste moves it at once.
    private func followTypedCoordinate(pasted: Bool) {
        typedCoordinateTask?.cancel()
        let text = coordinateText
        if !Self.isInvalidCoordinate(text) { coordinateInvalid = false }
        typedCoordinateTask = Task { [weak self] in
            if !pasted {
                try? await Task.sleep(for: .milliseconds(400))
            }
            guard !Task.isCancelled, let self, self.coordinateText == text else { return }
            self.coordinateInvalid = Self.isInvalidCoordinate(text)
            guard let parsed = CoordinateText.parse(text) else { return }
            self.pickTarget = PickTarget(id: (self.pickTarget?.id ?? 0) + 1, latitude: parsed.latitude, longitude: parsed.longitude)
        }
    }

    /// The text in the coordinate field isn't a position (shown under the field once typing
    /// pauses, so it doesn't flash on every keystroke).
    private(set) var coordinateInvalid = false

    private static func isInvalidCoordinate(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && CoordinateText.parse(trimmed) == nil
    }

    func noteStyleFailure(offline: Bool) {
        if offline {
            styleOffline = true
            styleFailed = false
        } else {
            styleFailed = true
            styleOffline = false
        }
        refreshMapMessage()
    }

    func noteStyleLoaded() {
        styleFailed = false
        styleOffline = false
        refreshMapMessage()
    }

    /// Clears the place-checkpoint form: a closed or saved checkpoint leaves nothing behind for
    /// the next one.
    func resetPick() {
        typedCoordinateTask?.cancel()
        writingCoordinateFromMap = true
        coordinateText = ""
        writingCoordinateFromMap = false
        coordinateInvalid = false
        pickTarget = nil
        checkpointTitle = ""
        pickMessage = "No checkpoint selected."
    }

    /// Saves the checkpoint. True when it saved: the form is cleared and the caller closes it,
    /// and the map says what was saved.
    @discardableResult
    func placeCheckpoint() async -> Bool {
        guard let coordinate = selectedCoordinate() else {
            pickMessage = "No checkpoint selected."
            return false
        }
        guard let roomId else {
            pickMessage = "Couldn't save the checkpoint."
            return false
        }
        guard !pickBusy else { return false }
        pickBusy = true
        defer { pickBusy = false }
        let ticket = generation
        let trimmedTitle = checkpointTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmedTitle.isEmpty ? "Checkpoint" : trimmedTitle
        let id = "cp-\(Int(client.graph.clock.now().timeIntervalSince1970 * 1000))"
        do {
            _ = try await RaceDayAPI.placeCheckpoint(
                graph: client.graph,
                roomId: roomId,
                id: id,
                title: title,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
            guard ticket == generation else { return false }
            resetPick()
            show(mapNote: "Saved \(title).")
            await loadCourse(ticket: ticket)
            return true
        } catch {
            guard ticket == generation else { return false }
            pickMessage = APIFailure.isTransport(error)
                ? "Offline. Checkpoint placement needs the network."
                : "Couldn't save the checkpoint."
            return false
        }
    }

    private func show(mapNote text: String) {
        mapNote = text
        mapNoteTask?.cancel()
        mapNoteTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            self?.mapNote = nil
        }
    }

    func startNavigation() async {
        let origin = originId.trimmingCharacters(in: .whitespacesAndNewlines)
        let destination = destinationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !origin.isEmpty, !destination.isEmpty else {
            navigateMessage = "No destination."
            return
        }
        guard let roomId else {
            navigateMessage = "Couldn't start navigation."
            return
        }
        guard !navigateBusy else { return }
        navigateBusy = true
        defer { navigateBusy = false }
        let ticket = generation
        let mode = routeMode == "drive" ? "drive" : "hike"
        do {
            let data = try await RaceDayAPI.route(
                graph: client.graph,
                roomId: roomId,
                mode: mode,
                checkpointIds: [origin, destination]
            )
            guard ticket == generation else { return }
            guard let meters = Self.distanceMeters(from: data) else {
                navigateMessage = "Couldn't start navigation."
                return
            }
            navigateMessage = Self.distanceText(meters: meters)
        } catch {
            guard ticket == generation else { return }
            navigateMessage = APIFailure.isTransport(error)
                ? "Offline. Navigation needs a route."
                : "Couldn't start navigation."
        }
    }

    func showAid(index: Int) {
        aidFollow = aidLiveNextIndex == index
        aidIndex = index
        reproject(follow: aidFollow, selected: index)
    }

    func recenter() {
        recenterRequest += 1
    }

    /// Where the runner's phone last was: the latest ping from the API, else the end of their path.
    /// Nil until the runner's phone sends a position.
    var runnerCoordinate: CLLocationCoordinate2D? {
        if let ping = runner.ping {
            return CLLocationCoordinate2D(latitude: ping.latitude, longitude: ping.longitude)
        }
        return trackCoordinates.last
    }

    /// The runner button: zoom to the runner, or say they aren't tracking yet.
    func focusRunner() {
        guard runnerCoordinate != nil else {
            runnerNote = "The runner isn't tracking yet."
            runnerNoteTask?.cancel()
            runnerNoteTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                self?.runnerNote = nil
            }
            return
        }
        runnerNote = nil
        runnerFocusRequest += 1
    }

    func jumpToNextAid() {
        aidFollow = true
        reproject(follow: true, selected: aidIndex)
    }

    /// Course progress for Pace and the aid sheet, from the athlete's ping.
    var progressMeters: Double {
        runner.progressMeters(checkpoints: courseCheckpoints)
    }

    /// This phone's GPS only uploads (athlete role). It never feeds readouts; those come from
    /// `runner`, so every crew member sees the same progress.
    private func receive(latitude: Double, longitude: Double, accuracy: Double, at time: Date) {
        guard wantsLocation, trackingActive, let sampledRoom = roomId else { return }
        guard let cooldown = locationGate.acquire() else { return }
        let sampledRole = role
        let ticket = generation
        Task {
            await self.record(
                roomId: sampledRoom,
                role: sampledRole,
                latitude: latitude,
                longitude: longitude,
                accuracy: accuracy,
                at: time,
                ticket: ticket
            )
            try? await Task.sleep(for: .seconds(5))
            self.locationGate.release(ticket: cooldown)
        }
    }

    /// Room and role changes abandon in-flight samples. The upload cooldown has to drop with them,
    /// or `locationGate` stays held and the athlete's later pings never enqueue.
    private func invalidateInFlight() {
        generation += 1
        locationGate.advance()
    }

    private func record(
        roomId: String,
        role: String,
        latitude: Double,
        longitude: Double,
        accuracy: Double,
        at time: Date,
        ticket: Int
    ) async {
        guard let outbox = client.graph.outbox else {
            client.graph.logger.log("outbox unavailable")
            return
        }
        do {
            let outcome = try await enqueueIncreasing(
                outbox: outbox,
                roomId: roomId,
                role: role,
                latitude: latitude,
                longitude: longitude,
                accuracy: accuracy,
                at: time
            )
            guard ticket == generation else { return }
            switch outcome {
            case .rejected(let message):
                locationMessage = message
            case .queued(let operation):
                await flushQueuedPing(operation, ticket: ticket)
            }
        } catch {
            guard ticket == generation else { return }
            client.graph.logger.log("location sample failed")
        }
    }

    private func enqueueIncreasing(
        outbox: OutboxStore,
        roomId: String,
        role: String,
        latitude: Double,
        longitude: Double,
        accuracy: Double,
        at time: Date
    ) async throws -> PingEnqueue {
        let existing = try await outbox.operations()
        // The fix's own time, so a sample from a dead zone keeps the moment the runner was there.
        var date = time
        let pending = existing.compactMap { operation -> Date? in
            guard operation.roomId == roomId, operation.type == "ping", operation.status == "pending",
                  let recorded = operation.recordedAt else {
                return nil
            }
            return LocationTimestamp.date(from: recorded)
        }
        if let latest = pending.max(), date <= latest {
            date = latest.addingTimeInterval(1)
        }
        let accuracyValue = accuracy >= 0 ? accuracy : nil
        var stamp = LocationTimestamp.string(from: date)
        var outcome = try await outbox.enqueuePing(
            roomId: roomId,
            role: role,
            latitude: latitude,
            longitude: longitude,
            recordedAt: stamp,
            horizontalAccuracyMeters: accuracyValue
        )
        var tries = 0
        while case .rejected(let message) = outcome, message == "recordedAt must increase.", tries < 4 {
            guard let parsed = LocationTimestamp.date(from: stamp) else { break }
            stamp = LocationTimestamp.string(from: parsed.addingTimeInterval(1))
            outcome = try await outbox.enqueuePing(
                roomId: roomId,
                role: role,
                latitude: latitude,
                longitude: longitude,
                recordedAt: stamp,
                horizontalAccuracyMeters: accuracyValue
            )
            tries += 1
        }
        return outcome
    }

    /// Sends every queued sample (one batch request per 500) when the phone has service.
    private func flushBacklog(ticket: Int) async {
        guard let report = try? await RaceDayAPI.flushOutbox(graph: client.graph, uploadIntervalSeconds: trackingIntervalSeconds),
              ticket == generation else { return }
        if report.accepted.isEmpty == false {
            locationMessage = "Location sent."
            await refreshRunner(ticket: ticket)
        }
    }

    private func flushQueuedPing(_ operation: StoredOperation, ticket: Int) async {
        do {
            let report = try await RaceDayAPI.flushOutbox(graph: client.graph, uploadIntervalSeconds: trackingIntervalSeconds)
            guard ticket == generation else { return }
            if report.rejected.contains(operation.id) {
                locationMessage = "The server didn't accept that sample. Tracking continues."
                return
            }
            let sent = !report.pending.contains(operation.id)
            locationMessage = sent ? "Location sample sent." : "Offline. Sample queued in the outbox."
            if sent {
                await refreshRunner(ticket: ticket)
            }
        } catch {
            guard ticket == generation else { return }
            locationMessage = "Offline. Sample queued in the outbox."
        }
    }

    private func loadCourse(ticket: Int) async {
        guard let roomId else {
            points = []
            route = []
            schedule = nil
            courseCheckpoints = []
            aidPages = []
            courseOffline = false
            courseFailed = false
            refreshMapMessage()
            return
        }
        do {
            let data = try await RaceDayAPI.loadRoomData(graph: client.graph, roomId: roomId)
            guard ticket == generation else { return }
            let envelope = try JSONDecoder().decode(RoomEnvelope.self, from: data)
            let next = Self.points(from: envelope.room.course)
            let line = CourseRouteLine.points(roomData: data)
            points = next
            route = line.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            courseCheckpoints = Self.aidCheckpoints(from: envelope.room.course)
            elevation = envelope.room.course?.baselineTrack.map { ElevationProfile(points: $0.points) }
            if let loaded = try? await RaceDayAPI.loadScheduleResult(
                graph: client.graph,
                roomId: roomId,
                cacheDirectory: cacheDirectory()
            ) {
                schedule = loaded.sheet
            }
            reproject(follow: aidFollow, selected: aidIndex)
            courseOffline = false
            courseFailed = false
            if next.isEmpty {
                deleteCache()
            } else {
                saveCache(MapCourseCache(points: next, route: line))
            }
            refreshMapMessage()
        } catch {
            guard ticket == generation else { return }
            if APIFailure.isTransport(error) {
                courseOffline = true
                courseFailed = false
                let cached = loadCache()
                points = cached.points
                route = cached.route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            } else {
                courseOffline = false
                courseFailed = true
                points = []
                route = []
            }
            refreshMapMessage()
        }
    }

    /// Offline or failed reads keep the last ping, path, and ETAs, which then age into the stale state.
    private func refreshRunner(ticket: Int) async {
        guard let roomId else { return }
        if let next = try? await RaceDayAPI.latestPing(graph: client.graph, roomId: roomId) {
            guard ticket == generation else { return }
            runner = next
        }
        if let next = try? await RaceDayAPI.refreshTrack(graph: client.graph, roomId: roomId, track: track) {
            guard ticket == generation else { return }
            track = next
        }
        if let next = try? await RaceDayAPI.liveProjection(graph: client.graph, roomId: roomId) {
            guard ticket == generation else { return }
            live = next
        }
        guard ticket == generation else { return }
        if trackingActive, TrackingSession.shouldAutoStop(live) {
            stopTracking()
            locationMessage = "Finish crossed. Tracking stopped."
        }
        reproject(follow: aidFollow, selected: aidIndex)
    }

    /// The runner's path for the map, oldest first.
    var trackCoordinates: [CLLocationCoordinate2D] {
        track.points.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }

    private func refreshMapMessage() {
        if courseOffline || styleOffline {
            mapMessage = "Offline. Map tiles are unavailable."
        } else if courseFailed || styleFailed {
            mapMessage = "Couldn't load the map style."
        } else if points.isEmpty {
            mapMessage = "No course on the map."
        } else {
            mapMessage = ""
        }
    }

    private func resetActions() {
        coordinateText = ""
        coordinateInvalid = false
        pickTarget = nil
        checkpointTitle = ""
        originId = ""
        destinationId = ""
        routeMode = "hike"
        pickMessage = "No checkpoint selected."
        navigateMessage = "No destination."
        locationMessage = "No location sample yet."
    }

    private func selectedCoordinate() -> (latitude: Double, longitude: Double)? {
        CoordinateText.parse(coordinateText).map { ($0.latitude, $0.longitude) }
    }

    private func cacheDirectory() -> URL? {
        guard let userId, let roomId else { return nil }
        return try? storage.roomDirectory(userId, roomId)
    }

    private func cacheURL() -> URL? {
        cacheDirectory()?.appendingPathComponent("course-map.json")
    }

    private func saveCache(_ cache: MapCourseCache) {
        guard let url = cacheURL(), let data = try? JSONEncoder().encode(cache) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// The course as last loaded. A cache written before the course line was kept holds the
    /// checkpoints alone.
    private func loadCache() -> MapCourseCache {
        guard let url = cacheURL(), let data = try? Data(contentsOf: url) else { return MapCourseCache(points: [], route: []) }
        if let cache = try? JSONDecoder().decode(MapCourseCache.self, from: data) { return cache }
        let points = (try? JSONDecoder().decode([MapCoursePoint].self, from: data)) ?? []
        return MapCourseCache(points: points, route: [])
    }

    private func deleteCache() {
        guard let url = cacheURL() else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func reproject(follow: Bool, selected: Int) {
        let now = client.graph.clock.now()
        let projection = AidStationSheet.project(
            sheet: schedule,
            checkpoints: courseCheckpoints,
            progressMeters: progressMeters,
            now: now,
            paceSecondsPerKm: nil,
            selectedIndex: selected,
            follow: follow,
            elevation: elevation
        )
        readout = RaceDayReadouts.withLive(
            RaceDayReadouts.make(sheet: schedule, checkpoints: courseCheckpoints, runner: runner, now: now),
            live: live
        )
        aidPages = projection.pages
        aidLiveNextIndex = projection.liveNextIndex
        aidIndex = projection.selectedIndex
        aidFollow = follow
    }

    private static func aidCheckpoints(from course: RaceCourse?) -> [AidStationCheckpoint] {
        guard let course else { return [] }
        return course.checkpoints.map { checkpoint in
            AidStationCheckpoint(
                id: checkpoint.id,
                title: checkpoint.title,
                latitude: checkpoint.latitude,
                longitude: checkpoint.longitude,
                distanceMetersFromStart: checkpoint.distanceMetersFromStart,
                plannedStopSeconds: checkpoint.plannedStopSeconds
            )
        }
    }

    private static func points(from course: RaceCourse?) -> [MapCoursePoint] {
        guard let course else { return [] }
        return course.checkpoints.map { checkpoint in
            MapCoursePoint(
                id: checkpoint.id,
                title: ScheduleFormat.checkpointDisplayTitle(id: checkpoint.id, title: checkpoint.title),
                latitude: checkpoint.latitude,
                longitude: checkpoint.longitude
            )
        }
    }

    private static func distanceMeters(from data: Data) -> Double? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let route = root["route"] as? [String: Any] else {
            return nil
        }
        if let number = route["distanceMeters"] as? NSNumber {
            return number.doubleValue
        }
        return nil
    }

    private static func distanceText(meters: Double) -> String {
        let miles = meters / 1609.344
        return String(format: "Distance %.1f mi.", miles)
    }
}

private enum LocationTimestamp {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        fractional.timeZone = TimeZone(secondsFromGMT: 0)
        if let date = fractional.date(from: value) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        plain.timeZone = TimeZone(secondsFromGMT: 0)
        return plain.date(from: value)
    }
}
