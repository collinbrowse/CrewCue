import Foundation

public enum TrackStatus: String, Equatable, Sendable {
    case onTrack
    case ahead
    case behind
    case unknown
}

/// Course elevation samples ordered by distance. Built from the room's baseline track.
public struct ElevationProfile: Equatable, Sendable {
    public var samples: [(distanceMeters: Double, elevationMeters: Double)]

    public init(samples: [(distanceMeters: Double, elevationMeters: Double)]) {
        self.samples = samples
            .filter { $0.distanceMeters.isFinite && $0.elevationMeters.isFinite }
            .sorted { $0.distanceMeters < $1.distanceMeters }
    }

    public init(points: [RaceCourseBaselinePoint]) {
        self.init(samples: points.compactMap { point in
            guard let elevation = point.elevationMeters else { return nil }
            return (point.distanceMetersFromStart, elevation)
        })
    }

    public static func == (lhs: ElevationProfile, rhs: ElevationProfile) -> Bool {
        lhs.samples.count == rhs.samples.count && zip(lhs.samples, rhs.samples).allSatisfy {
            $0.distanceMeters == $1.distanceMeters && $0.elevationMeters == $1.elevationMeters
        }
    }

    /// Total climb between two course distances. Nil when the profile has fewer than two samples in range.
    public func gainMeters(from start: Double, to end: Double) -> Double? {
        guard start.isFinite, end.isFinite, end > start else { return nil }
        let inside = samples.filter { $0.distanceMeters >= start && $0.distanceMeters <= end }
        guard inside.count >= 2 else { return nil }
        var gain = 0.0
        for (previous, next) in zip(inside, inside.dropFirst()) where next.elevationMeters > previous.elevationMeters {
            gain += next.elevationMeters - previous.elevationMeters
        }
        return gain
    }
}

/// The athlete's latest accepted ping, read from the API. Race progress comes only from this,
/// never from the viewing phone's GPS, so every crew member sees the same readout.
public struct RunnerPing: Equatable, Sendable {
    public var pingId: String
    public var latitude: Double
    public var longitude: Double
    /// Athlete device time for the sample. "Last ping" readouts use this.
    public var recordedAt: Date
    /// Route-snapped progress from the server projection for this ping. Nil when the room has none.
    public var progressMeters: Double?

    public init(pingId: String, latitude: Double, longitude: Double, recordedAt: Date, progressMeters: Double? = nil) {
        self.pingId = pingId
        self.latitude = latitude
        self.longitude = longitude
        self.recordedAt = recordedAt
        self.progressMeters = progressMeters
    }
}

/// Whether crew can trust the runner readouts right now.
public enum RunnerPingState: String, Equatable, Sendable {
    /// The athlete has not sent an accepted ping yet.
    case none
    case live
    /// The latest ping is older than the room's staleness threshold.
    case stale
}

/// What every crew phone knows about the runner's position.
public struct RunnerProgress: Equatable, Sendable {
    /// Server default when the athlete app has not declared an upload interval (15 minutes).
    public static let defaultStalenessThresholdSeconds: Double = 15 * 60
    /// How often crew phones read the latest ping again while race day is on screen.
    public static let refreshIntervalSeconds: Double = 30

    public static let none = RunnerProgress(ping: nil)

    public var ping: RunnerPing?
    public var stalenessThresholdSeconds: Double

    public init(ping: RunnerPing?, stalenessThresholdSeconds: Double = RunnerProgress.defaultStalenessThresholdSeconds) {
        self.ping = ping
        self.stalenessThresholdSeconds = stalenessThresholdSeconds.isFinite && stalenessThresholdSeconds > 0
            ? stalenessThresholdSeconds
            : RunnerProgress.defaultStalenessThresholdSeconds
    }

    /// Maps the wire response. A ping with an unreadable time or position counts as no ping.
    public init(response: RaceRoomLatestPingResponse) {
        let ping = response.ping.flatMap { wire -> RunnerPing? in
            guard let recordedAt = ScheduleFormat.parseISO8601(wire.recordedAt),
                  wire.latitude.isFinite, wire.longitude.isFinite,
                  (-90...90).contains(wire.latitude), (-180...180).contains(wire.longitude) else {
                return nil
            }
            return RunnerPing(
                pingId: wire.pingId,
                latitude: wire.latitude,
                longitude: wire.longitude,
                recordedAt: recordedAt,
                progressMeters: wire.progressMeters.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
            )
        }
        self.init(ping: ping, stalenessThresholdSeconds: response.stalenessThresholdSeconds)
    }

    /// Server progress when the projection has it, else the ping snapped to the nearest checkpoint.
    public func progressMeters(checkpoints: [AidStationCheckpoint]) -> Double {
        guard let ping else { return 0 }
        if let meters = ping.progressMeters { return meters }
        return AidStationSheet.progressMeters(latitude: ping.latitude, longitude: ping.longitude, checkpoints: checkpoints)
    }

    public func state(now: Date) -> RunnerPingState {
        guard let ping else { return .none }
        return now.timeIntervalSince(ping.recordedAt) > stalenessThresholdSeconds ? .stale : .live
    }
}

/// Race-wide readouts for the map sheet, chat header, and profile stats.
public struct RaceDayReadout: Equatable, Sendable {
    public var status: TrackStatus
    public var statusLabel: String
    public var progressFraction: Double
    public var progressLabel: String
    public var percentLabel: String
    public var totalMilesLabel: String
    public var currentMileLabel: String
    public var elapsedLabel: String
    public var averagePaceLabel: String
    public var lastPingLabel: String?
    public var pingState: RunnerPingState
    /// Chip text: "NO PING YET" or "LAST PING: 3 MIN AGO".
    public var pingLabel: String

    public init(
        status: TrackStatus,
        statusLabel: String,
        progressFraction: Double,
        progressLabel: String,
        percentLabel: String,
        totalMilesLabel: String,
        currentMileLabel: String,
        elapsedLabel: String,
        averagePaceLabel: String,
        lastPingLabel: String?,
        pingState: RunnerPingState = .none,
        pingLabel: String = RaceDayReadouts.noPingLabel
    ) {
        self.status = status
        self.statusLabel = statusLabel
        self.progressFraction = progressFraction
        self.progressLabel = progressLabel
        self.percentLabel = percentLabel
        self.totalMilesLabel = totalMilesLabel
        self.currentMileLabel = currentMileLabel
        self.elapsedLabel = elapsedLabel
        self.averagePaceLabel = averagePaceLabel
        self.lastPingLabel = lastPingLabel
        self.pingState = pingState
        self.pingLabel = pingLabel
    }
}

public enum CheckpointState: String, Equatable, Sendable {
    case done
    case current
    case projected
}

/// One row of the Pace course timeline.
public struct CheckpointTimelineRow: Equatable, Sendable, Identifiable {
    public var checkpointId: String
    public var state: CheckpointState
    public var kicker: String
    public var title: String
    public var clockArrivalAt: String?
    public var cutoffAt: String?
    public var cutoffStatus: String?
    public var distanceToLabel: String
    public var isFinish: Bool

    public var id: String { checkpointId }

    public init(
        checkpointId: String,
        state: CheckpointState,
        kicker: String,
        title: String,
        clockArrivalAt: String?,
        cutoffAt: String?,
        cutoffStatus: String?,
        distanceToLabel: String,
        isFinish: Bool
    ) {
        self.checkpointId = checkpointId
        self.state = state
        self.kicker = kicker
        self.title = title
        self.clockArrivalAt = clockArrivalAt
        self.cutoffAt = cutoffAt
        self.cutoffStatus = cutoffStatus
        self.distanceToLabel = distanceToLabel
        self.isFinish = isFinish
    }
}

public enum RaceDayReadouts {
    /// Slack either side of the planned arrival that still counts as on track.
    public static let onTrackToleranceSeconds: Double = 600

    public static let noPingLabel = "NO PING YET"

    /// Readouts from the athlete's latest ping. A stale ping keeps its position but drops the
    /// on-track call, because the runner may have moved on since.
    public static func make(
        sheet: CrewScheduleSheet?,
        checkpoints: [AidStationCheckpoint],
        runner: RunnerProgress,
        now: Date
    ) -> RaceDayReadout {
        let state = runner.state(now: now)
        var readout = make(
            sheet: sheet,
            checkpoints: checkpoints,
            progressMeters: runner.progressMeters(checkpoints: checkpoints),
            now: now,
            lastPingAt: runner.ping?.recordedAt
        )
        readout.pingState = state
        if state != .live {
            readout.status = .unknown
            readout.statusLabel = ""
        }
        return readout
    }

    public static func make(
        sheet: CrewScheduleSheet?,
        checkpoints: [AidStationCheckpoint],
        progressMeters: Double,
        now: Date,
        lastPingAt: Date?
    ) -> RaceDayReadout {
        let progress = progressMeters.isFinite ? max(0, progressMeters) : 0
        let total = totalMeters(checkpoints)
        let fraction = total > 0 ? min(1, progress / total) : 0
        let start = sheet.flatMap { ScheduleFormat.parseISO8601($0.raceStartAt) }
        let elapsed = start.map { now.timeIntervalSince($0) }.flatMap { $0 > 0 ? $0 : nil }
        let status = status(sheet: sheet, checkpoints: checkpoints, progressMeters: progress, now: now)
        let totalMiles = total / metersPerMile
        let currentMiles = progress / metersPerMile
        // Progress is as of the ping, so pace divides by the time the ping was taken, not now.
        let paceElapsed = lastPingAt.flatMap { at in start.map { at.timeIntervalSince($0) } } ?? elapsed
        let pingAge = lastPingAt.map { lastPingLabel(at: $0, now: now) }
        return RaceDayReadout(
            status: status.status,
            statusLabel: status.label,
            progressFraction: fraction,
            progressLabel: total > 0 ? "MILE \(Int(currentMiles.rounded(.down))) / \(Int(totalMiles.rounded()))" : "—",
            percentLabel: total > 0 ? "\(Int((fraction * 100).rounded()))%" : "—",
            totalMilesLabel: total > 0 ? PortableFormat.oneDecimal(totalMiles) : "—",
            currentMileLabel: PortableFormat.oneDecimal(currentMiles),
            elapsedLabel: elapsed.map(ScheduleFormat.formatDurationSeconds) ?? "—",
            averagePaceLabel: averagePaceLabel(elapsedSeconds: paceElapsed, progressMeters: progress),
            lastPingLabel: pingAge,
            pingState: lastPingAt == nil ? .none : .live,
            pingLabel: pingAge.map { "LAST PING: \($0)" } ?? noPingLabel
        )
    }

    /// Pace timeline: passed stops are done, the next stop is current, later stops are projected.
    public static func timeline(
        sheet: CrewScheduleSheet?,
        checkpoints: [AidStationCheckpoint],
        progressMeters: Double
    ) -> [CheckpointTimelineRow] {
        let progress = progressMeters.isFinite ? max(0, progressMeters) : 0
        let byID = Dictionary(uniqueKeysWithValues: checkpoints.map { ($0.id, $0) })
        let stops = sheet?.stops ?? []
        let ids = stops.isEmpty ? checkpoints.map(\.id) : stops.map(\.checkpointId)
        let stopByID = Dictionary(stops.map { ($0.checkpointId, $0) }, uniquingKeysWith: { first, _ in first })
        var currentAssigned = false
        return ids.enumerated().map { offset, id in
            let checkpoint = byID[id]
            let stop = stopByID[id]
            let distance = checkpoint?.distanceMetersFromStart.flatMap { $0.isFinite ? $0 : nil }
            let state: CheckpointState
            if progress > 5, let distance, distance <= progress + 5 {
                state = .done
            } else if currentAssigned == false {
                state = .current
                currentAssigned = true
            } else {
                state = .projected
            }
            let miles = distance.map { " — \(PortableFormat.oneDecimal($0 / metersPerMile)) MI" } ?? ""
            let label = offset == 0 && (distance ?? 0) <= 5 ? "CP\(offset + 1) — START" : "CP\(offset + 1)\(miles)"
            return CheckpointTimelineRow(
                checkpointId: id,
                state: state,
                kicker: label,
                title: ScheduleFormat.checkpointDisplayTitle(id: id, title: checkpoint?.title),
                clockArrivalAt: stop?.clockArrivalAt,
                cutoffAt: cutoffAt(stop),
                cutoffStatus: stop?.cutoffStatus,
                distanceToLabel: ScheduleFormat.milesRemaining(progressMeters: progress, checkpointDistanceMeters: distance).uppercased(),
                isFinish: offset == ids.count - 1 && ids.count > 1
            )
        }
    }

    public static func elevationLabel(meters: Double?) -> String? {
        guard let meters, meters.isFinite else { return nil }
        return "+\(Int((meters * 3.28084).rounded())) FT"
    }

    public static func averagePaceLabel(elapsedSeconds: Double?, progressMeters: Double) -> String {
        guard let elapsedSeconds, elapsedSeconds > 0, progressMeters > 100 else { return "—" }
        let perMile = Int((elapsedSeconds / (progressMeters / metersPerMile)).rounded())
        guard perMile > 0, perMile < 24 * 3600 else { return "—" }
        return "\(perMile / 60)'\(PortableFormat.zeroPadded(perMile % 60, width: 2))\" / MI"
    }

    public static func lastPingLabel(at date: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "JUST NOW" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes) MIN AGO" }
        return "\(minutes / 60)H \(minutes % 60)M AGO"
    }

    static let metersPerMile = 1609.344

    private static func totalMeters(_ checkpoints: [AidStationCheckpoint]) -> Double {
        checkpoints.compactMap(\.distanceMetersFromStart).filter(\.isFinite).max() ?? 0
    }

    private static func cutoffAt(_ stop: ScheduleStop?) -> String? {
        guard let stop, let margin = stop.cutoffMarginSeconds, margin.isFinite,
              let arrival = ScheduleFormat.parseISO8601(stop.clockArrivalAt) else {
            return nil
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: arrival.addingTimeInterval(margin))
    }

    /// Compares now against the planned arrival at the last passed and the next checkpoint.
    private static func status(
        sheet: CrewScheduleSheet?,
        checkpoints: [AidStationCheckpoint],
        progressMeters: Double,
        now: Date
    ) -> (status: TrackStatus, label: String) {
        guard let sheet, sheet.stops.isEmpty == false else { return (.unknown, "") }
        let distances = Dictionary(checkpoints.compactMap { checkpoint -> (String, Double)? in
            guard let distance = checkpoint.distanceMetersFromStart, distance.isFinite else { return nil }
            return (checkpoint.id, distance)
        }, uniquingKeysWith: { first, _ in first })
        let timed = sheet.stops.compactMap { stop -> (distance: Double, arrival: Date)? in
            guard let distance = distances[stop.checkpointId],
                  let arrival = ScheduleFormat.parseISO8601(stop.clockArrivalAt) else { return nil }
            return (distance, arrival)
        }
        guard timed.isEmpty == false else { return (.unknown, "") }
        if let next = timed.first(where: { $0.distance > progressMeters + 5 }) {
            let late = now.timeIntervalSince(next.arrival)
            if late > onTrackToleranceSeconds {
                return (.behind, "BEHIND \(minutesLabel(late))")
            }
        }
        if let passed = timed.last(where: { $0.distance <= progressMeters + 5 && $0.distance > 5 }) {
            let early = passed.arrival.timeIntervalSince(now)
            if early > onTrackToleranceSeconds {
                return (.ahead, "AHEAD \(minutesLabel(early))")
            }
        }
        return (.onTrack, "ON TRACK")
    }

    private static func minutesLabel(_ seconds: Double) -> String {
        let minutes = max(1, Int((seconds / 60).rounded()))
        if minutes >= 60 {
            let rest = minutes % 60
            return rest > 0 ? "\(minutes / 60)H \(rest)M" : "\(minutes / 60)H"
        }
        return "\(minutes)M"
    }
}
