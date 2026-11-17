import Foundation

/// The race's one finish. The server plans it on the schedule: the estimate's moving time plus
/// every planned stop before the finish (the projection's start-line finish is the same instant).
/// An estimate's own `expectedFinishAt` leaves the planned stops out, so no screen shows it as the
/// finish when the schedule has one: the teaser's headline, every FINISH row, the estimate summary
/// and the history comparison all read this. Pure.
public enum PlanFinish {
    /// The schedule's finish row for `estimate`, the plan on show: the last stop of a sheet that has
    /// the start and at least one more, when that stop is the finish. Every timeline's finish row
    /// reads the same stop. Nil, so the screen shows the estimate's own finish, when:
    /// - the sheet was planned from another estimate (`pacingEstimateId` set and not `estimate`'s:
    ///   a sheet cached before the attach, or read before it landed);
    /// - a paid sheet's last stop is not the finish. The server writes the plan's finish
    ///   (`expectedFinishElapsedSeconds`) as the finish row's moving time; a course with no finish
    ///   waypoint ends at an aid station, which keeps its own ETA. Without `estimate` a paid sheet
    ///   can't tell, so it has no finish row;
    /// - the sheet is shorter, or the arrival doesn't parse.
    /// An unpaid race's sheet holds only the start and the finish (on a course with no finish
    /// waypoint, the farthest stop standing in for it), so its last stop is the finish.
    public static func row(in sheet: CrewScheduleSheet?, for estimate: PacingEstimate? = nil) -> ScheduleStop? {
        guard let sheet, sheet.stops.count >= 2, let last = sheet.stops.last,
              ScheduleFormat.parseISO8601(last.clockArrivalAt) != nil else { return nil }
        if let estimate, let planned = sheet.pacingEstimateId, planned != estimate.id { return nil }
        if sheet.locked != nil { return last }
        guard let estimate, let moving = last.movingElapsedSeconds,
              abs(moving - estimate.expectedFinishElapsedSeconds) < finishTolerance else { return nil }
        return last
    }

    /// The schedule's finish row for `estimate`, the room's plan of record, read from the server
    /// (offline, the sheet in `cacheDirectory`; online, the sheet read is cached there). Nil when
    /// the read fails (no schedule yet, a crew member's 402) or `row` has none.
    public static func scheduled(
        graph: ClientGraph,
        roomId: String,
        for estimate: PacingEstimate,
        cacheDirectory: URL? = nil
    ) async -> ScheduleStop? {
        guard let loaded = try? await RaceDayAPI.loadScheduleResult(graph: graph, roomId: roomId, cacheDirectory: cacheDirectory),
              loaded.sheet.roomId == roomId else { return nil }
        return row(in: loaded.sheet, for: estimate)
    }

    /// Seconds. The server writes the estimate's finish on the finish row as it is; this only
    /// absorbs a decimal round trip.
    private static let finishTolerance = 1.0

    /// The estimate's explanation, then "Finish 4:59:59 · 7:29 AM" for the race's finish: `plan`
    /// (the schedule's finish row) when there is one, else the estimate's own finish.
    public static func estimateSummary(
        _ estimate: PacingEstimate,
        plan: ScheduleStop?,
        timeZone: TimeZone = DeviceTimeZone.current,
        locale: Locale = .current
    ) -> String {
        let elapsed = ScheduleFormat.formatDurationSeconds(plan?.elapsedSeconds ?? estimate.expectedFinishElapsedSeconds)
        let clock = ScheduleFormat.formatScheduleClock(plan?.clockArrivalAt ?? estimate.expectedFinishAt, timeZone: timeZone, locale: locale)
        let line = "Finish \(elapsed) · \(clock)"
        return estimate.explanation.isEmpty ? line : "\(estimate.explanation)\n\(line)"
    }

    /// The history step's two finishes on the plan's clock. With history: `planFinishAt`, the
    /// server's finish for the plan the history made. Without: the same finish moved by as much as
    /// the estimate without history differs from the one with it, so both sides carry the same
    /// planned stops and differ only by what the history changed. Nil when an instant doesn't parse.
    public static func historyComparison(
        planFinishAt: String,
        withHistoryEstimateAt: String,
        withoutHistoryEstimateAt: String
    ) -> (withHistory: String, withoutHistory: String)? {
        guard let plan = ScheduleFormat.parseISO8601(planFinishAt),
              let with = ScheduleFormat.parseISO8601(withHistoryEstimateAt),
              let without = ScheduleFormat.parseISO8601(withoutHistoryEstimateAt) else { return nil }
        let moved = plan.addingTimeInterval(without.timeIntervalSince(with))
        return (planFinishAt, RaceDayReadouts.iso8601(moved))
    }
}
