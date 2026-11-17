import Foundation

/// The race's one finish. The server plans it on the schedule: the estimate's moving time plus
/// every planned stop before the finish (the projection's start-line finish is the same instant).
/// An estimate's own `expectedFinishAt` leaves the planned stops out, so no screen shows it as the
/// finish when the schedule has one: the teaser's headline, every FINISH row, the estimate summary
/// and the history comparison all read this. Pure.
public enum PlanFinish {
    /// The schedule's finish row: the last stop of a sheet that has the start and at least one
    /// more (a teaser sheet holds only those two). Every timeline's finish row reads the same stop.
    /// Nil for a shorter sheet or an arrival that doesn't parse.
    public static func row(in sheet: CrewScheduleSheet?) -> ScheduleStop? {
        guard let sheet, sheet.stops.count >= 2, let last = sheet.stops.last,
              ScheduleFormat.parseISO8601(last.clockArrivalAt) != nil else { return nil }
        return last
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
