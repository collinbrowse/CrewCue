import Foundation

/// How often the runner's phone keeps a location sample. Per device, under the user's directory.
public struct TrackingSettings: Equatable, Sendable {
    /// The choices the settings screen offers (1, 2, 3, 5, 10 minutes).
    public static let allowedIntervalSeconds = [60, 120, 180, 300, 600]
    public static let defaultIntervalSeconds = 180
    public static let `default` = TrackingSettings(intervalSeconds: defaultIntervalSeconds)

    public var intervalSeconds: Int

    /// An interval that isn't one of the choices falls back to the default.
    public init(intervalSeconds: Int) {
        self.intervalSeconds = Self.allowedIntervalSeconds.contains(intervalSeconds)
            ? intervalSeconds
            : Self.defaultIntervalSeconds
    }

    public static func file(userDirectory: URL) -> URL {
        userDirectory.appendingPathComponent("tracking-settings.json")
    }

    /// Missing or unreadable file → the default.
    public static func load(userDirectory: URL) -> TrackingSettings {
        guard let data = try? Data(contentsOf: file(userDirectory: userDirectory)),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let interval = (object["intervalSeconds"] as? NSNumber)?.intValue else {
            return .default
        }
        return TrackingSettings(intervalSeconds: interval)
    }

    public func save(userDirectory: URL) throws {
        try FileManager.default.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: ["intervalSeconds": intervalSeconds], options: [.sortedKeys])
        try data.write(to: Self.file(userDirectory: userDirectory), options: .atomic)
    }
}

/// The runner tapped Start tracking for this room. Persisted so a relaunch (or an OS wake after the
/// app was killed) resumes sampling. Cleared on Stop or when the server reports the finish crossed.
///
/// The onboarding tour's location test (`LocationTest`) saves a session too, marked with
/// `testUntil`: it ends by itself once that time has passed, even when nothing in the app is left
/// to stop it (the process died mid-test). A real Start tracking saves an unmarked session over it,
/// so a test never turns into race-day tracking.
public struct TrackingSession: Equatable, Sendable {
    public var roomId: String
    public var startedAt: String
    /// The location test's end (ISO 8601); nil for race-day tracking.
    public var testUntil: String?

    /// How long a test session may run: the test's wait for its ping, then the Always window.
    public static let testSeconds: TimeInterval = LocationTest.timeoutSeconds + LocationTest.alwaysPromptSeconds

    public init(roomId: String, startedAt: String, testUntil: String? = nil) {
        self.roomId = roomId
        self.startedAt = startedAt
        self.testUntil = testUntil
    }

    /// A test session started at `now`, ending `testSeconds` later.
    public static func test(roomId: String, at now: Date) -> TrackingSession {
        TrackingSession(
            roomId: roomId,
            startedAt: RaceDayReadouts.iso8601(now),
            testUntil: RaceDayReadouts.iso8601(now.addingTimeInterval(testSeconds))
        )
    }

    public var isTest: Bool { testUntil != nil }

    /// A test session past its end: tracking stops. An unreadable end counts as passed.
    public func testExpired(now: Date) -> Bool {
        guard let testUntil else { return false }
        guard let end = ScheduleFormat.parseISO8601(testUntil) else { return true }
        return now >= end
    }

    public static func file(userDirectory: URL) -> URL {
        userDirectory.appendingPathComponent("tracking-session.json")
    }

    public static func load(userDirectory: URL) -> TrackingSession? {
        guard let data = try? Data(contentsOf: file(userDirectory: userDirectory)),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let roomId = object["roomId"] as? String, !roomId.isEmpty,
              let startedAt = object["startedAt"] as? String else {
            return nil
        }
        // Sessions saved before tests were marked have no `testUntil`: race-day tracking.
        let testUntil = (object["testUntil"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return TrackingSession(roomId: roomId, startedAt: startedAt, testUntil: testUntil)
    }

    public func save(userDirectory: URL) throws {
        try FileManager.default.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        var object = ["roomId": roomId, "startedAt": startedAt]
        if let testUntil { object["testUntil"] = testUntil }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: Self.file(userDirectory: userDirectory), options: .atomic)
    }

    public static func clear(userDirectory: URL) throws {
        let url = file(userDirectory: userDirectory)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    /// Stop sampling once the server says the runner crossed the finish.
    public static func shouldAutoStop(_ live: LiveProjection?) -> Bool {
        live?.finishCrossed == true
    }
}

/// One point of the runner's path as crews draw it.
public struct RunnerTrackPoint: Equatable, Sendable {
    public var recordedAt: Date
    public var latitude: Double
    public var longitude: Double

    public init(recordedAt: Date, latitude: Double, longitude: Double) {
        self.recordedAt = recordedAt
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// The runner's path from `GET /pings/track`, kept oldest first. Crews poll with `cursor` and
/// append, so each refresh downloads only new points.
public struct RunnerTrack: Equatable, Sendable {
    public static let empty = RunnerTrack(points: [], cursor: nil)

    public private(set) var points: [RunnerTrackPoint]
    /// The newest `recordedAt` (wire string) read so far; pass as `after`.
    public private(set) var cursor: String?
    /// The race start the held points' `preStart` marks were judged against (the last page's
    /// `raceStartAt`; nil when the room had no start).
    public private(set) var raceStartAt: String?
    /// Whether `raceStartAt` came from a page. A track rebuilt from a bare cursor doesn't know it.
    public private(set) var knowsRaceStart: Bool

    public init(points: [RunnerTrackPoint], cursor: String?, raceStartAt: String? = nil, knowsRaceStart: Bool = false) {
        self.points = points
        self.cursor = cursor
        self.raceStartAt = raceStartAt
        self.knowsRaceStart = knowsRaceStart
    }

    /// The server judged `page` against another start than the points held. Moving the start
    /// re-marks the whole stored track, so the held points and cursor are stale: read again from
    /// the beginning, and every phone draws the same line (the `RaceRoomPingTrackResponse` contract).
    public func isReadUnderAnotherStart(_ page: RaceRoomPingTrackResponse) -> Bool {
        cursor != nil && knowsRaceStart && page.raceStartAt != raceStartAt
    }

    /// Adds a page. Points with an unreadable time or position, or not newer than what's held, are
    /// skipped (the same rule as `RunnerProgress`), so a replayed page never duplicates the line.
    /// A pre-start (test) point is not part of the race's path: it is read past (the cursor moves
    /// on) but never drawn, so a test ping from home is not a line from home to the start.
    public mutating func append(_ page: RaceRoomPingTrackResponse) {
        var last = points.last?.recordedAt
        for wire in page.points {
            guard let at = ScheduleFormat.parseISO8601(wire.recordedAt),
                  wire.latitude.isFinite, wire.longitude.isFinite,
                  (-90...90).contains(wire.latitude), (-180...180).contains(wire.longitude) else {
                continue
            }
            if let last, at <= last {
                continue
            }
            if wire.preStart != true {
                points.append(RunnerTrackPoint(recordedAt: at, latitude: wire.latitude, longitude: wire.longitude))
            }
            cursor = wire.recordedAt
            last = at
        }
        raceStartAt = page.raceStartAt
        knowsRaceStart = true
    }
}

/// The server's live projection, mapped for crew screens. Client-core never computes an ETA; it
/// only turns the server's elapsed seconds into clock times.
public struct LiveProjection: Equatable, Sendable {
    public var asOfRecordedAt: Date
    public var finishEtaAt: Date?
    /// Live arrival per checkpoint still ahead.
    public var arrivals: [String: Date]
    /// Arrival windows per checkpoint, where the server sends one (10th–90th percentile).
    public var arrivalWindows: [String: ClosedRange<Date>]
    public var finishWindow: ClosedRange<Date>?
    /// The server marked the projection `degraded` (its last ping is older than the stale threshold).
    public var degraded: Bool
    public var finishCrossed: Bool

    public init(
        asOfRecordedAt: Date,
        finishEtaAt: Date?,
        arrivals: [String: Date],
        arrivalWindows: [String: ClosedRange<Date>] = [:],
        finishWindow: ClosedRange<Date>? = nil,
        degraded: Bool,
        finishCrossed: Bool
    ) {
        self.asOfRecordedAt = asOfRecordedAt
        self.finishEtaAt = finishEtaAt
        self.arrivals = arrivals
        self.arrivalWindows = arrivalWindows
        self.finishWindow = finishWindow
        self.degraded = degraded
        self.finishCrossed = finishCrossed
    }

    /// The server's pre-race placeholder projection (no athlete ping yet) uses this ping id.
    public static let bootstrapPingId = "bootstrap"

    /// Nil when the core has no readable time, or before the runner's first real ping (the server's
    /// placeholder projection is not a live ETA). The race clock is the start checkpoint's crossing,
    /// which the server sets to the room's race start.
    public init?(core: RaceRoomProjectionCore, timeliness: ProjectionTimeliness?) {
        guard core.asOfPingId != Self.bootstrapPingId,
              let asOf = ScheduleFormat.parseISO8601(core.asOfRecordedAt) else { return nil }
        let start = core.checkpointSplits.first?.crossedAtRecordedAt.flatMap(ScheduleFormat.parseISO8601)
        var arrivals: [String: Date] = [:]
        var windows: [String: ClosedRange<Date>] = [:]
        if let start {
            for eta in core.remainingCheckpointEtas ?? [] where eta.liveProjectedElapsedSeconds.isFinite {
                arrivals[eta.checkpointId] = start.addingTimeInterval(eta.liveProjectedElapsedSeconds)
                // The server omits a window where its band isn't calibrated; skip malformed ones too.
                if let w = eta.window, w.earliestElapsedSeconds.isFinite, w.latestElapsedSeconds.isFinite,
                   w.earliestElapsedSeconds <= w.latestElapsedSeconds {
                    windows[eta.checkpointId] = start.addingTimeInterval(w.earliestElapsedSeconds)...start.addingTimeInterval(w.latestElapsedSeconds)
                }
            }
        }
        let finish = core.checkpointSplits.last
        // The finish row and the finish readout must agree. With the tuned projection off, the
        // server's `etaFinishPlanIso` is the older plan-anchored finish while the live remaining
        // ETAs come from a re-simulation, so prefer the finish checkpoint's live arrival.
        let liveFinish = finish.flatMap { arrivals[$0.checkpointId] }
        // Same rule for the window: the finish row's window goes with the finish row's arrival.
        let finishWindow: ClosedRange<Date>? = liveFinish != nil
            ? finish.flatMap { windows[$0.checkpointId] }
            : core.etaFinishWindow.flatMap { w in
                guard let lo = ScheduleFormat.parseISO8601(w.earliestIso), let hi = ScheduleFormat.parseISO8601(w.latestIso), lo <= hi else { return nil }
                return lo...hi
            }
        self.init(
            asOfRecordedAt: asOf,
            finishEtaAt: liveFinish ?? ScheduleFormat.parseISO8601(core.etaFinishPlanIso),
            arrivals: arrivals,
            arrivalWindows: windows,
            finishWindow: finishWindow,
            degraded: timeliness?.projectionConfidence == "degraded",
            finishCrossed: core.checkpointSplits.count > 1 && finish?.crossedAtRecordedAt != nil
        )
    }
}

/// Maps the batch upload's per-point results onto outbox resolutions.
public enum PingBatchPolicy {
    /// `accepted` and `duplicate` (already stored) both finish the row; a stale sample is dropped,
    /// never retried; any other rejection is kept as rejected so it shows in the outbox.
    public static func resolution(for result: AthletePingBatchPointResult) -> OutboxFailureResolution {
        switch result.decision {
        case "accepted", "duplicate":
            return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
        default:
            if result.reason == "stale_recorded_at" {
                return OutboxFailureResolution(status: "dropped", retryable: false, feedback: "Stale location sample dropped.")
            }
            let reason = (result.reason ?? "server policy").replacingOccurrences(of: "_", with: " ")
            return OutboxFailureResolution(status: "rejected", retryable: false, feedback: "Rejected: \(reason)")
        }
    }

    /// One resolution per sent ping, in order. Results are matched by `recordedAt`, so a server
    /// that reorders them still settles each row from its own answer; a missing one stays pending.
    public static func resolutions(for pings: [StoredOperation], response: AthletePingBatchResponse) -> [OutboxFailureResolution] {
        var byTime: [Date: AthletePingBatchPointResult] = [:]
        for result in response.results {
            if let at = ScheduleFormat.parseISO8601(result.recordedAt) {
                byTime[at] = result
            }
        }
        return pings.map { ping in
            guard let at = ping.recordedAt.flatMap(ScheduleFormat.parseISO8601), let result = byTime[at] else {
                return OutboxFailureResolution(status: "pending", retryable: true, feedback: "No result yet. Will retry.")
            }
            return resolution(for: result)
        }
    }
}
