import Foundation

public enum AidStationPhase: String, Equatable, Sendable {
    case preStart
    case race
    case finish
}

public struct AidStationCheckpoint: Equatable, Sendable {
    public var id: String
    public var title: String?
    public var latitude: Double?
    public var longitude: Double?
    public var distanceMetersFromStart: Double?
    public var plannedStopSeconds: Double?

    public init(
        id: String,
        title: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        distanceMetersFromStart: Double? = nil,
        plannedStopSeconds: Double? = nil
    ) {
        self.id = id
        self.title = title
        self.latitude = latitude
        self.longitude = longitude
        self.distanceMetersFromStart = distanceMetersFromStart
        self.plannedStopSeconds = plannedStopSeconds
    }
}

public struct AidStationPage: Equatable, Sendable, Identifiable {
    public var checkpointId: String
    public var index: Int
    public var title: String
    public var kicker: String
    public var clockLabel: String
    public var remainLabel: String
    public var distanceLabel: String
    public var stoppageLabel: String
    public var delayLabel: String?
    public var stoppageDurationLabel: String
    public var elapsedLabel: String
    public var movingLabel: String?
    public var waitedLabel: String?
    public var scheduleLine: String
    /// Arrival instant (ISO-8601 UTC) so each platform can render a local clock.
    public var arrivalAt: String?
    public var elevationLabel: String?

    public var id: String { checkpointId }

    public init(
        checkpointId: String,
        index: Int,
        title: String,
        kicker: String,
        clockLabel: String,
        remainLabel: String,
        distanceLabel: String,
        stoppageLabel: String,
        delayLabel: String? = nil,
        stoppageDurationLabel: String = "0:00",
        elapsedLabel: String = "—",
        movingLabel: String? = nil,
        waitedLabel: String? = nil,
        scheduleLine: String,
        arrivalAt: String? = nil,
        elevationLabel: String? = nil
    ) {
        self.checkpointId = checkpointId
        self.index = index
        self.title = title
        self.kicker = kicker
        self.clockLabel = clockLabel
        self.remainLabel = remainLabel
        self.distanceLabel = distanceLabel
        self.stoppageLabel = stoppageLabel
        self.delayLabel = delayLabel
        self.stoppageDurationLabel = stoppageDurationLabel
        self.elapsedLabel = elapsedLabel
        self.movingLabel = movingLabel
        self.waitedLabel = waitedLabel
        self.scheduleLine = scheduleLine
        self.arrivalAt = arrivalAt
        self.elevationLabel = elevationLabel
    }
}

public struct AidStationProjection: Equatable, Sendable {
    public var pages: [AidStationPage]
    public var liveNextIndex: Int?
    public var selectedIndex: Int
    public var phase: AidStationPhase

    public init(pages: [AidStationPage], liveNextIndex: Int?, selectedIndex: Int, phase: AidStationPhase) {
        self.pages = pages
        self.liveNextIndex = liveNextIndex
        self.selectedIndex = selectedIndex
        self.phase = phase
    }
}

public enum AidStationSheet {
    public static func project(
        sheet: CrewScheduleSheet?,
        checkpoints: [AidStationCheckpoint],
        progressMeters: Double,
        now: Date,
        paceSecondsPerKm: Double?,
        selectedIndex: Int,
        follow: Bool,
        elevation: ElevationProfile? = nil
    ) -> AidStationProjection {
        let progress = progressMeters.isFinite ? progressMeters : 0
        let rows = pages(sheet: sheet, checkpoints: checkpoints)
        let phase = phase(progressMeters: progress, checkpoints: checkpoints, pages: rows)
        let live = liveNextIndex(progressMeters: progress, checkpoints: checkpoints, pages: rows)
        let index = follow
            ? defaultIndex(phase: phase, pageCount: rows.count, liveNext: live)
            : clamp(selectedIndex, rows.count)
        let count = rows.count
        let stamped = rows.enumerated().map { offset, row in
            stampedPage(
                row,
                index: offset,
                pageCount: count,
                phase: phase,
                liveNext: live,
                progress: progress,
                now: now,
                pace: paceSecondsPerKm,
                elevation: elevation
            )
        }
        return AidStationProjection(pages: stamped, liveNextIndex: live, selectedIndex: index, phase: phase)
    }

    /// Course distance of the checkpoint nearest the sample. Zero when the course has no distances.
    public static func progressMeters(
        latitude: Double,
        longitude: Double,
        checkpoints: [AidStationCheckpoint]
    ) -> Double {
        guard latitude.isFinite, longitude.isFinite else { return 0 }
        var best: (meters: Double, distance: Double)?
        for checkpoint in checkpoints {
            guard let lat = checkpoint.latitude, let lon = checkpoint.longitude,
                  lat.isFinite, lon.isFinite,
                  let along = checkpoint.distanceMetersFromStart, along.isFinite else {
                continue
            }
            let meters = haversine(latitude, longitude, lat, lon)
            if best == nil || meters < best!.meters {
                best = (meters, along)
            }
        }
        return best?.distance ?? 0
    }

    public static func payload(_ projection: AidStationProjection) -> [String: Any] {
        [
            "phase": projection.phase.rawValue,
            "selectedIndex": projection.selectedIndex,
            "liveNextIndex": projection.liveNextIndex ?? NSNull(),
            "pages": projection.pages.map { page in
                var row: [String: Any] = [
                    "checkpointId": page.checkpointId,
                    "index": page.index,
                    "title": page.title,
                    "kicker": page.kicker,
                    "clockLabel": page.clockLabel,
                    "remainLabel": page.remainLabel,
                    "distanceLabel": page.distanceLabel,
                    "stoppageLabel": page.stoppageLabel,
                    "scheduleLine": page.scheduleLine,
                    "elapsedLabel": page.elapsedLabel,
                    "stoppageDurationLabel": page.stoppageDurationLabel
                ]
                if let moving = page.movingLabel {
                    row["movingLabel"] = moving
                }
                if let waited = page.waitedLabel {
                    row["waitedLabel"] = waited
                }
                if let delay = page.delayLabel {
                    row["delayLabel"] = delay
                }
                if let arrivalAt = page.arrivalAt {
                    row["arrivalAt"] = arrivalAt
                }
                if let elevation = page.elevationLabel {
                    row["elevationLabel"] = elevation
                }
                return row
            }
        ]
    }

    private struct Draft {
        var checkpointId: String
        var title: String
        var stop: ScheduleStop?
        var distanceMetersFromStart: Double?
        var plannedStoppageSeconds: Double?
    }

    private static func pages(sheet: CrewScheduleSheet?, checkpoints: [AidStationCheckpoint]) -> [Draft] {
        let byID = Dictionary(uniqueKeysWithValues: checkpoints.map { ($0.id, $0) })
        let stops = sheet?.stops ?? []
        if stops.isEmpty == false {
            return stops.map { stop in
                let course = byID[stop.checkpointId]
                return Draft(
                    checkpointId: stop.checkpointId,
                    title: ScheduleFormat.checkpointDisplayTitle(id: stop.checkpointId, title: course?.title),
                    stop: stop,
                    distanceMetersFromStart: finite(course?.distanceMetersFromStart),
                    plannedStoppageSeconds: stop.plannedStoppageSeconds
                )
            }
        }
        return checkpoints.map { checkpoint in
            Draft(
                checkpointId: checkpoint.id,
                title: ScheduleFormat.checkpointDisplayTitle(id: checkpoint.id, title: checkpoint.title),
                stop: nil,
                distanceMetersFromStart: finite(checkpoint.distanceMetersFromStart),
                plannedStoppageSeconds: finite(checkpoint.plannedStopSeconds)
            )
        }
    }

    private static func stampedPage(
        _ row: Draft,
        index: Int,
        pageCount: Int,
        phase: AidStationPhase,
        liveNext: Int?,
        progress: Double,
        now: Date,
        pace: Double?,
        elevation: ElevationProfile?
    ) -> AidStationPage {
        let arrival = arrival(stop: row.stop, distance: row.distanceMetersFromStart, progress: progress, now: now, pace: pace)
        let climb = row.distanceMetersFromStart.flatMap { elevation?.gainMeters(from: progress, to: $0) }
        let delay = row.stop?.delayOverrideSeconds
        let line: String
        if let stop = row.stop {
            line = ScheduleFormat.scheduleLine(
                checkpointId: stop.checkpointId,
                elapsedSeconds: stop.elapsedSeconds,
                clockArrivalAt: stop.clockArrivalAt
            )
        } else {
            line = row.title
        }
        return AidStationPage(
            checkpointId: row.checkpointId,
            index: index,
            title: row.title,
            kicker: kicker(phase: phase, pageIndex: index, pageCount: pageCount, liveNext: liveNext),
            clockLabel: arrival.clock,
            remainLabel: arrival.remain,
            distanceLabel: ScheduleFormat.milesRemaining(progressMeters: progress, checkpointDistanceMeters: row.distanceMetersFromStart),
            stoppageLabel: stoppage(row.plannedStoppageSeconds),
            delayLabel: delay.map { ScheduleFormat.formatDurationSeconds($0) },
            stoppageDurationLabel: ScheduleFormat.formatDurationSeconds(row.plannedStoppageSeconds ?? 0),
            elapsedLabel: row.stop.map { ScheduleFormat.formatDurationSeconds($0.elapsedSeconds) } ?? "—",
            movingLabel: row.stop?.movingElapsedSeconds.map { ScheduleFormat.formatDurationSeconds($0) },
            waitedLabel: row.stop?.movingElapsedSeconds.map { moving in
                ScheduleFormat.formatDurationSeconds(max(0, (row.stop?.elapsedSeconds ?? moving) - moving))
            },
            scheduleLine: line,
            arrivalAt: arrival.iso,
            elevationLabel: RaceDayReadouts.elevationLabel(meters: climb)
        )
    }

    private static func kicker(phase: AidStationPhase, pageIndex: Int, pageCount: Int, liveNext: Int?) -> String {
        if pageCount <= 0 {
            return "AID"
        }
        if phase == .preStart && pageIndex == 0 {
            return "START"
        }
        if phase == .finish && pageIndex == pageCount - 1 {
            return "FINISHED"
        }
        if liveNext != nil && pageIndex == liveNext {
            return "NEXT"
        }
        return "AID \(pageIndex + 1)"
    }

    private static func arrival(
        stop: ScheduleStop?,
        distance: Double?,
        progress: Double,
        now: Date,
        pace: Double?
    ) -> (clock: String, remain: String, iso: String?) {
        if let iso = stop?.clockArrivalAt, let date = ScheduleFormat.parseISO8601(iso) {
            let remain = date.timeIntervalSince(now)
            return (ScheduleFormat.formatUtcHhMm(iso), remainLabel(remain), iso)
        }
        if let distance, let pace, pace > 0, pace.isFinite, distance.isFinite {
            let remain = max(0, distance - progress) / 1000 * pace
            let eta = now.addingTimeInterval(remain)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            let iso = formatter.string(from: eta)
            return (ScheduleFormat.formatUtcHhMm(iso), remainLabel(remain), iso)
        }
        return ("—", "—", nil)
    }

    private static func remainLabel(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "—" }
        if seconds <= 0 { return "DONE" }
        if seconds < 60 { return "< 1 min" }
        let totalMinutes = max(1, Int((seconds / 60).rounded()))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 {
            return minutes > 0 ? "\(hours)H \(minutes)M" : "\(hours)H"
        }
        return "\(minutes)M"
    }

    private static func stoppage(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return "—" }
        return "\(Int((seconds / 60).rounded()))m"
    }

    private static func phase(progressMeters: Double, checkpoints: [AidStationCheckpoint], pages: [Draft]) -> AidStationPhase {
        let distances = (checkpoints.compactMap(\.distanceMetersFromStart) + pages.compactMap(\.distanceMetersFromStart))
            .filter(\.isFinite)
        guard let last = distances.max(), last > 5 else { return .preStart }
        if progressMeters + 5 >= last { return .finish }
        if progressMeters <= 5 { return .preStart }
        return .race
    }

    private static func liveNextIndex(progressMeters: Double, checkpoints: [AidStationCheckpoint], pages: [Draft]) -> Int? {
        guard pages.isEmpty == false else { return nil }
        let distances = Dictionary(uniqueKeysWithValues: checkpoints.compactMap { checkpoint -> (String, Double)? in
            guard let distance = checkpoint.distanceMetersFromStart, distance.isFinite else { return nil }
            return (checkpoint.id, distance)
        })
        for (offset, page) in pages.enumerated() {
            let distance = page.distanceMetersFromStart ?? distances[page.checkpointId]
            guard let distance, distance.isFinite else { continue }
            if distance > progressMeters + 5 {
                return offset
            }
        }
        return pages.count - 1
    }

    private static func defaultIndex(phase: AidStationPhase, pageCount: Int, liveNext: Int?) -> Int {
        guard pageCount > 0 else { return 0 }
        if phase == .preStart { return 0 }
        if phase == .finish { return pageCount - 1 }
        return clamp(liveNext ?? 0, pageCount)
    }

    private static func clamp(_ index: Int, _ count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(0, index), count - 1)
    }

    private static func finite(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }

    private static func haversine(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let radius = 6_371_000.0
        let p1 = lat1 * .pi / 180
        let p2 = lat2 * .pi / 180
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(p1) * cos(p2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * asin(min(1, sqrt(a)))
    }
}
