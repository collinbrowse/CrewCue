import CoreLocation
import Foundation
import Observation
import CrewCueClientCore

struct MapCoursePoint: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var latitude: Double
    var longitude: Double
}

@MainActor
@Observable
final class MapModel {
    private let client: AppClient
    private let locator = WhenInUseLocator()
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
    private var elevation: ElevationProfile?
    private var styleOffline = false
    private var styleFailed = false

    private(set) var points: [MapCoursePoint] = []
    private(set) var aidPages: [AidStationPage] = []
    private(set) var aidLiveNextIndex: Int?
    private(set) var aidIndex = 0
    private(set) var aidFollow = true
    private(set) var readout = RaceDayReadouts.make(sheet: nil, checkpoints: [], runner: .none, now: Date())
    /// Bumped to ask the map to fit the course again.
    private(set) var recenterRequest = 0
    private(set) var mapMessage = "No course on the map."
    var latitudeText = ""
    var longitudeText = ""
    var checkpointTitle = ""
    private(set) var pickMessage = "No checkpoint selected."
    private(set) var pickBusy = false
    var originId = ""
    var destinationId = ""
    var routeMode = "hike"
    private(set) var navigateMessage = "No destination."
    private(set) var navigateBusy = false
    private(set) var locationMessage = "No location sample yet."

    init(client: AppClient) {
        self.client = client
        locator.onSample = { [weak self] latitude, longitude, accuracy in
            self?.receive(latitude: latitude, longitude: longitude, accuracy: accuracy)
        }
        locator.onDenied = { [weak self] in
            self?.locationMessage = "Location permission was denied."
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
            runner = .none
        }
        await loadCourse(ticket: ticket)
        await refreshRunner(ticket: ticket)
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
        wantsLocation = false
        locator.stop()
        userId = nil
        roomId = nil
        role = ""
        points = []
        schedule = nil
        courseCheckpoints = []
        runner = .none
        elevation = nil
        aidPages = []
        aidIndex = 0
        aidFollow = true
        courseOffline = false
        courseFailed = false
        styleOffline = false
        styleFailed = false
        latitudeText = ""
        longitudeText = ""
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

    func beginLocation() {
        wantsLocation = true
        locator.request()
    }

    func selectCoordinate(latitude: Double, longitude: Double) {
        latitudeText = String(format: "%.6f", latitude)
        longitudeText = String(format: "%.6f", longitude)
        if pickMessage == "No checkpoint selected." {
            pickMessage = ""
        }
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

    func placeCheckpoint() async {
        guard let coordinate = selectedCoordinate() else {
            pickMessage = "No checkpoint selected."
            return
        }
        guard let roomId else {
            pickMessage = "Couldn't save the checkpoint."
            return
        }
        guard !pickBusy else { return }
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
            guard ticket == generation else { return }
            pickMessage = "Tap the map to place a checkpoint."
            await loadCourse(ticket: ticket)
        } catch {
            guard ticket == generation else { return }
            pickMessage = APIFailure.isTransport(error)
                ? "Offline. Checkpoint placement needs the network."
                : "Couldn't save the checkpoint."
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
    private func receive(latitude: Double, longitude: Double, accuracy: Double) {
        guard wantsLocation, let sampledRoom = roomId else { return }
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
                accuracy: accuracy
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
        accuracy: Double
    ) async throws -> PingEnqueue {
        let existing = try await outbox.operations()
        var date = client.graph.clock.now()
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

    private func flushQueuedPing(_ operation: StoredOperation, ticket: Int) async {
        do {
            let report = try await RaceDayAPI.flushOutbox(graph: client.graph)
            guard ticket == generation else { return }
            let sent = !report.pending.contains(operation.id)
            locationMessage = sent ? "Location sample queued." : "Offline. Sample queued in the outbox."
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
            schedule = nil
            courseCheckpoints = []
            aidPages = []
            courseOffline = false
            courseFailed = false
            refreshMapMessage()
            return
        }
        do {
            let envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
            guard ticket == generation else { return }
            let next = Self.points(from: envelope.room.course)
            points = next
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
                saveCache(next)
            }
            refreshMapMessage()
        } catch {
            guard ticket == generation else { return }
            if APIFailure.isTransport(error) {
                courseOffline = true
                courseFailed = false
                points = loadCache()
            } else {
                courseOffline = false
                courseFailed = true
                points = []
            }
            refreshMapMessage()
        }
    }

    /// Offline or failed reads keep the last ping, which then ages into the stale state.
    private func refreshRunner(ticket: Int) async {
        guard let roomId else { return }
        if let next = try? await RaceDayAPI.latestPing(graph: client.graph, roomId: roomId) {
            guard ticket == generation else { return }
            runner = next
        }
        guard ticket == generation else { return }
        reproject(follow: aidFollow, selected: aidIndex)
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
        latitudeText = ""
        longitudeText = ""
        checkpointTitle = ""
        originId = ""
        destinationId = ""
        routeMode = "hike"
        pickMessage = "No checkpoint selected."
        navigateMessage = "No destination."
        locationMessage = "No location sample yet."
    }

    private func selectedCoordinate() -> (latitude: Double, longitude: Double)? {
        let latitude = Double(latitudeText.trimmingCharacters(in: .whitespacesAndNewlines))
        let longitude = Double(longitudeText.trimmingCharacters(in: .whitespacesAndNewlines))
        guard let latitude, let longitude, latitude >= -90, latitude <= 90, longitude >= -180, longitude <= 180 else {
            return nil
        }
        return (latitude, longitude)
    }

    private func cacheDirectory() -> URL? {
        guard let userId, let roomId else { return nil }
        return try? AppDirectories.roomDirectory(userId: userId, roomId: roomId)
    }

    private func cacheURL() -> URL? {
        cacheDirectory()?.appendingPathComponent("course-map.json")
    }

    private func saveCache(_ points: [MapCoursePoint]) {
        guard let url = cacheURL(), let data = try? JSONEncoder().encode(points) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func loadCache() -> [MapCoursePoint] {
        guard let url = cacheURL(), let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([MapCoursePoint].self, from: data)) ?? []
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
        readout = RaceDayReadouts.make(
            sheet: schedule,
            checkpoints: courseCheckpoints,
            runner: runner,
            now: now
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

@MainActor
final class WhenInUseLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var armed = false
    var onSample: (@MainActor (Double, Double, Double) -> Void)?
    var onDenied: (@MainActor () -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 25
    }

    func request() {
        armed = true
        apply(manager.authorizationStatus)
    }

    func stop() {
        armed = false
        manager.stopUpdatingLocation()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.apply(status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let accuracy = location.horizontalAccuracy
        Task { @MainActor in
            self.onSample?(latitude, longitude, accuracy)
        }
    }

    private func apply(_ status: CLAuthorizationStatus) {
        guard armed else { return }
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.startUpdatingLocation()
        case .denied, .restricted:
            manager.stopUpdatingLocation()
            onDenied?()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
    }
}
