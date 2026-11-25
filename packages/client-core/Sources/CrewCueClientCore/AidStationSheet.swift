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
    /// The runner's pings are past this aid (the same 5 m rule as the Pace timeline).
    public var passed: Bool
    /// The caption under the big clock: "EST. ARRIVAL", "LIVE ETA", "ARRIVED" or "PASSED".
    public var arrivalCaption: String
    /// When the runner's track first reached this aid (ISO-8601 UTC), for a passed aid.
    public var actualArrivalAt: String?
    /// When the runner's track left this aid (ISO-8601 UTC), for a passed aid.
    public var actualDepartureAt: String?
    /// "6 min" between the actual arrival and departure.
    public var actualStopLabel: String?
    /// "2 min", the planned stop.
    public var plannedStopLabel: String
    /// The countdown pill: "IN 1H 5M", "DUE NOW" (only the next unpassed aid), "AFTER AID 2"
    /// (a later aid with no time to project), or "" for none.
    public var countdownLabel: String
    /// "RACE 1:10:00": the planned race time at arrival, from the schedule. Nil without one.
    public var raceTimeCaption: String?
    /// "Planned arrival 2:10 PM, 1 hour 10 minutes into the race", for VoiceOver and TalkBack.
    public var plannedArrivalSpoken: String?

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
        elevationLabel: String? = nil,
        passed: Bool = false,
        arrivalCaption: String = "EST. ARRIVAL",
        actualArrivalAt: String? = nil,
        actualDepartureAt: String? = nil,
        actualStopLabel: String? = nil,
        plannedStopLabel: String = "0 min",
        countdownLabel: String = "",
        raceTimeCaption: String? = nil,
        plannedArrivalSpoken: String? = nil
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
        self.passed = passed
        self.arrivalCaption = arrivalCaption
        self.actualArrivalAt = actualArrivalAt
        self.actualDepartureAt = actualDepartureAt
        self.actualStopLabel = actualStopLabel
        self.plannedStopLabel = plannedStopLabel
        self.countdownLabel = countdownLabel
        self.raceTimeCaption = raceTimeCaption
        self.plannedArrivalSpoken = plannedArrivalSpoken
    }
}

public struct AidStationProjection: Equatable, Sendable {
    public var pages: [AidStationPage]
    public var liveNextIndex: Int?
    public var selectedIndex: Int
    public var phase: AidStationPhase
    /// The pager shows an aid other than the runner's next one: "Back to next aid" is offered.
    /// Any page counts, a pin dropped along the course as much as a GPX aid.
    public var showsBackToNext: Bool

    public init(pages: [AidStationPage], liveNextIndex: Int?, selectedIndex: Int, phase: AidStationPhase, showsBackToNext: Bool = false) {
        self.pages = pages
        self.liveNextIndex = liveNextIndex
        self.selectedIndex = selectedIndex
        self.phase = phase
        self.showsBackToNext = showsBackToNext
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
        elevation: ElevationProfile? = nil,
        timeZone: TimeZone = DeviceTimeZone.current,
        liveArrivals: [String: Date] = [:],
        track: [RunnerTrackPoint] = []
    ) -> AidStationProjection {
        let progress = progressMeters.isFinite ? progressMeters : 0
        let rows = withInferredDistances(pages(sheet: sheet, checkpoints: checkpoints))
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
                elevation: elevation,
                timeZone: timeZone,
                liveArrival: liveArrivals[row.checkpointId],
                track: track
            )
        }
        let pages = projectLaterAids(
            stamped,
            rows: rows,
            liveNext: live,
            now: now,
            timeZone: timeZone,
            liveArrivals: liveArrivals
        )
        return AidStationProjection(
            pages: pages,
            liveNextIndex: live,
            selectedIndex: index,
            phase: phase,
            showsBackToNext: !follow && live != nil && index != live && pages.indices.contains(live ?? -1)
        )
    }

    /// Aids after the runner's next one never read "DUE NOW": a plan time that has gone by there
    /// only says the runner is late. Each one's arrival is projected from the next aid's (its
    /// live ETA, or now when that is overdue too) plus the planned legs between them. With no
    /// time to project from, it reads "AFTER <next aid>".
    private static func projectLaterAids(
        _ pages: [AidStationPage],
        rows: [Draft],
        liveNext: Int?,
        now: Date,
        timeZone: TimeZone,
        liveArrivals: [String: Date]
    ) -> [AidStationPage] {
        guard let next = liveNext, pages.indices.contains(next), rows.indices.contains(next) else { return pages }
        let nextArrival = liveArrivals[rows[next].checkpointId]
            ?? rows[next].stop.flatMap { ScheduleFormat.parseISO8601($0.clockArrivalAt) }
        let base = nextArrival.map { max($0, now) }
        var out = pages
        for index in pages.indices where index > next {
            var page = pages[index]
            guard !page.passed, let arrival = page.arrivalAt.flatMap(ScheduleFormat.parseISO8601),
                  arrival <= now else { continue }
            if let base, let leg = plannedLeg(from: rows[next], to: rows[index]), leg > 0 {
                let projected = base.addingTimeInterval(leg)
                let iso = RaceDayReadouts.iso8601(projected)
                page.arrivalAt = iso
                page.clockLabel = ScheduleFormat.formatScheduleClock(iso, timeZone: timeZone)
                page.remainLabel = remainLabel(projected.timeIntervalSince(now))
                page.countdownLabel = countdown(page.remainLabel)
                page.arrivalCaption = "EST. ARRIVAL"
            } else {
                page.remainLabel = "—"
                page.countdownLabel = "AFTER \(pages[next].title)"
                page.arrivalCaption = "PLANNED"
            }
            out[index] = page
        }
        return out
    }

    /// Planned seconds from one aid's arrival to a later one's: the schedule's elapsed times,
    /// else its clock times. Nil when either has neither.
    private static func plannedLeg(from start: Draft, to end: Draft) -> Double? {
        guard let a = start.stop, let b = end.stop else { return nil }
        if a.elapsedSeconds.isFinite, b.elapsedSeconds.isFinite, b.elapsedSeconds > a.elapsedSeconds {
            return b.elapsedSeconds - a.elapsedSeconds
        }
        guard let from = ScheduleFormat.parseISO8601(a.clockArrivalAt),
              let to = ScheduleFormat.parseISO8601(b.clockArrivalAt) else { return nil }
        return to.timeIntervalSince(from)
    }

    /// A page with no course distance (a pin whose distance the course doesn't carry yet) takes
    /// one from where it sits between the pages around it that have one, so the runner's
    /// progress can pass it and make it the next aid like any other.
    private static func withInferredDistances(_ rows: [Draft]) -> [Draft] {
        var out = rows
        for index in rows.indices where rows[index].distanceMetersFromStart == nil {
            guard let lat = rows[index].latitude, let lon = rows[index].longitude,
                  let before = rows[..<index].lastIndex(where: { $0.distanceMetersFromStart != nil && $0.latitude != nil }),
                  let after = rows[(index + 1)...].firstIndex(where: { $0.distanceMetersFromStart != nil && $0.latitude != nil }),
                  let d0 = rows[before].distanceMetersFromStart, let d1 = rows[after].distanceMetersFromStart,
                  let lat0 = rows[before].latitude, let lon0 = rows[before].longitude,
                  let lat1 = rows[after].latitude, let lon1 = rows[after].longitude,
                  d1 > d0 else { continue }
            let toBefore = haversine(lat, lon, lat0, lon0)
            let toAfter = haversine(lat, lon, lat1, lon1)
            let share = toBefore + toAfter > 0 ? toBefore / (toBefore + toAfter) : 0.5
            out[index].distanceMetersFromStart = d0 + (d1 - d0) * share
        }
        return out
    }

    /// The pill's text for a remaining time: "IN 35M", "DUE NOW", or "" for none.
    static func countdown(_ remain: String) -> String {
        switch remain {
        case "—", "": ""
        case "DUE NOW": "DUE NOW"
        default: "IN \(remain)"
        }
    }

    /// Course distance of the checkpoint nearest the sample. Zero when the course has no distances.
    /// The sample must be the athlete's latest ping, not the viewing device's location (AGENTS.md, runner progress).
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
            "showsBackToNext": projection.showsBackToNext,
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
                row["passed"] = page.passed
                row["arrivalCaption"] = page.arrivalCaption
                row["plannedStopLabel"] = page.plannedStopLabel
                if let at = page.actualArrivalAt {
                    row["actualArrivalAt"] = at
                }
                if let at = page.actualDepartureAt {
                    row["actualDepartureAt"] = at
                }
                if let label = page.actualStopLabel {
                    row["actualStopLabel"] = label
                }
                row["countdownLabel"] = page.countdownLabel
                if let caption = page.raceTimeCaption {
                    row["raceTimeCaption"] = caption
                }
                if let spoken = page.plannedArrivalSpoken {
                    row["plannedArrivalSpoken"] = spoken
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
        var latitude: Double?
        var longitude: Double?
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
                    plannedStoppageSeconds: stop.plannedStoppageSeconds,
                    latitude: finite(course?.latitude),
                    longitude: finite(course?.longitude)
                )
            }
        }
        return checkpoints.map { checkpoint in
            Draft(
                checkpointId: checkpoint.id,
                title: ScheduleFormat.checkpointDisplayTitle(id: checkpoint.id, title: checkpoint.title),
                stop: nil,
                distanceMetersFromStart: finite(checkpoint.distanceMetersFromStart),
                plannedStoppageSeconds: finite(checkpoint.plannedStopSeconds),
                latitude: finite(checkpoint.latitude),
                longitude: finite(checkpoint.longitude)
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
        elevation: ElevationProfile?,
        timeZone: TimeZone,
        liveArrival: Date?,
        track: [RunnerTrackPoint]
    ) -> AidStationPage {
        // Passed comes from the runner's pings, never from the clock: a plan time that has gone by
        // says nothing about whether the runner got there.
        let passed: Bool = {
            guard let distance = row.distanceMetersFromStart else { return false }
            if distance <= 5 { return phase != .preStart }
            return progress + 5 >= distance
        }()
        let visit = passed ? AidVisit.find(track: track, latitude: row.latitude, longitude: row.longitude) : nil
        let planned = arrival(
            stop: row.stop,
            distance: row.distanceMetersFromStart,
            progress: progress,
            now: now,
            pace: pace,
            timeZone: timeZone
        )
        var arrival = planned
        var caption = "EST. ARRIVAL"
        if passed {
            if let visit {
                let iso = RaceDayReadouts.iso8601(visit.arrivedAt)
                arrival = (ScheduleFormat.formatScheduleClock(iso, timeZone: timeZone), "PASSED", iso)
                caption = "ARRIVED"
            } else {
                arrival = ("Passed", "PASSED", nil)
                caption = "PASSED"
            }
        } else if let liveArrival {
            let iso = RaceDayReadouts.iso8601(liveArrival)
            arrival = (ScheduleFormat.formatScheduleClock(iso, timeZone: timeZone), remainLabel(liveArrival.timeIntervalSince(now)), iso)
            caption = "LIVE ETA"
        }
        let climb = row.distanceMetersFromStart.flatMap { elevation?.gainMeters(from: progress, to: $0) }
        let delay = row.stop?.delayOverrideSeconds
        let line: String
        if let stop = row.stop {
            line = ScheduleFormat.scheduleLine(
                checkpointId: stop.checkpointId,
                elapsedSeconds: stop.elapsedSeconds,
                clockArrivalAt: stop.clockArrivalAt,
                timeZone: timeZone
            )
        } else {
            line = row.title
        }
        return AidStationPage(
            checkpointId: row.checkpointId,
            index: index,
            title: row.title,
            kicker: kicker(phase: phase, pageIndex: index, pageCount: pageCount, liveNext: liveNext, passed: passed),
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
            elevationLabel: passed ? nil : RaceDayReadouts.elevationLabel(meters: climb),
            passed: passed,
            arrivalCaption: caption,
            actualArrivalAt: visit.map { RaceDayReadouts.iso8601($0.arrivedAt) },
            actualDepartureAt: visit?.departedAt.map { RaceDayReadouts.iso8601($0) },
            actualStopLabel: visit?.departedAt.map { minutesLabel($0.timeIntervalSince(visit!.arrivedAt)) },
            plannedStopLabel: minutesLabel(row.plannedStoppageSeconds ?? 0),
            countdownLabel: passed ? "" : countdown(arrival.remain),
            raceTimeCaption: row.stop.map { RaceTimeCopy.caption(elapsedSeconds: $0.elapsedSeconds) },
            plannedArrivalSpoken: row.stop.map {
                RaceTimeCopy.spokenArrival(
                    clock: ScheduleFormat.formatScheduleClock($0.clockArrivalAt, timeZone: timeZone),
                    elapsedSeconds: $0.elapsedSeconds
                )
            }
        )
    }

    /// The pager's eyebrow. Never a number: the start is a page too, so "AID 2" would sit over Aid 1.
    private static func kicker(phase: AidStationPhase, pageIndex: Int, pageCount: Int, liveNext: Int?, passed: Bool) -> String {
        if pageCount <= 0 {
            return "AID"
        }
        if phase == .preStart && pageIndex == 0 {
            return "START"
        }
        if phase == .finish && pageIndex == pageCount - 1 {
            return "FINISHED"
        }
        if liveNext != nil && pageIndex == liveNext && !passed {
            return "NEXT"
        }
        if passed {
            return "PASSED"
        }
        return pageIndex == pageCount - 1 ? "FINISH" : "AHEAD"
    }

    private static func arrival(
        stop: ScheduleStop?,
        distance: Double?,
        progress: Double,
        now: Date,
        pace: Double?,
        timeZone: TimeZone
    ) -> (clock: String, remain: String, iso: String?) {
        if let iso = stop?.clockArrivalAt, let date = ScheduleFormat.parseISO8601(iso) {
            let remain = date.timeIntervalSince(now)
            return (ScheduleFormat.formatScheduleClock(iso, timeZone: timeZone), remainLabel(remain), iso)
        }
        if let distance, let pace, pace > 0, pace.isFinite, distance.isFinite {
            let remain = max(0, distance - progress) / 1000 * pace
            let eta = now.addingTimeInterval(remain)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            let iso = formatter.string(from: eta)
            return (ScheduleFormat.formatScheduleClock(iso, timeZone: timeZone), remainLabel(remain), iso)
        }
        return ("—", "—", nil)
    }

    /// Time until an aid the runner hasn't reached. A time that has gone by means the runner is
    /// late for it ("DUE NOW"), not that they are done with it.
    private static func remainLabel(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "—" }
        if seconds <= 0 { return "DUE NOW" }
        if seconds < 60 { return "< 1 min" }
        let totalMinutes = max(1, Int((seconds / 60).rounded()))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 {
            return minutes > 0 ? "\(hours)H \(minutes)M" : "\(hours)H"
        }
        return "\(minutes)M"
    }

    /// "6 min"
    static func minutesLabel(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0 min" }
        return "\(Int((seconds / 60).rounded())) min"
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

    static func haversine(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let radius = 6_371_000.0
        let p1 = lat1 * .pi / 180
        let p2 = lat2 * .pi / 180
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(p1) * cos(p2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * asin(min(1, sqrt(a)))
    }
}

/// When the runner's track was at an aid: the first ping within `radiusMeters` of it, and the last
/// ping of that same run of pings. A track with no ping that close has no visit.
public struct AidVisit: Equatable, Sendable {
    public var arrivedAt: Date
    /// Nil while the runner is still there (the newest ping is at the aid).
    public var departedAt: Date?

    public static let radiusMeters = 120.0

    public static func find(
        track: [RunnerTrackPoint],
        latitude: Double?,
        longitude: Double?,
        radiusMeters: Double = AidVisit.radiusMeters
    ) -> AidVisit? {
        guard let latitude, let longitude, latitude.isFinite, longitude.isFinite else { return nil }
        var arrived: Date?
        var lastInside: Date?
        for (offset, point) in track.enumerated() {
            let inside = AidStationSheet.haversine(point.latitude, point.longitude, latitude, longitude) <= radiusMeters
            if inside {
                if arrived == nil { arrived = point.recordedAt }
                lastInside = point.recordedAt
                if offset == track.count - 1 {
                    return AidVisit(arrivedAt: arrived!, departedAt: nil)
                }
            } else if let arrived, let lastInside {
                return AidVisit(arrivedAt: arrived, departedAt: lastInside)
            }
        }
        return nil
    }
}
