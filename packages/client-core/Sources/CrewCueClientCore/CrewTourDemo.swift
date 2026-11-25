import Foundation

/// The crew tour's example race: the demo runner partway through `DemoRaceFixture`'s 50K, with a
/// ping a few minutes old and running behind plan into the next aid station. Explanations only.
/// It is never mixed into a real race's readouts, which come from the runner's own pings.
public struct CrewTourDemo: Equatable, Sendable {
    public var runnerName: String
    /// "Mile 13.0": where the demo runner's last ping put them.
    public var mileText: String
    /// "4 min ago".
    public var lastUpdateAge: String
    public var nextAid: String
    /// "2.5 mi ahead": how far the next aid is past the runner.
    public var nextAidAheadText: String
    /// The next aid's clock times: the runner's ETA and their plan.
    public var etaClock: String
    public var planClock: String

    /// Where the demo runner is, how old their last ping is, and how far behind plan they run.
    static let progressMeters = 21_000.0
    static let pingAgeMinutes = 4
    static let behindPlanSeconds = 12.0 * 60

    /// The demo race read from `DemoRaceFixture`: the planned pace is the fixture's, every planned
    /// stop before the next aid counts, and the ETA runs `behindPlanSeconds` late. Clock times read
    /// in `timeZone`.
    public static func fixture(timeZone: TimeZone = DeviceTimeZone.current, locale: Locale = .current) -> CrewTourDemo {
        let paceSecondsPerMeter = DemoRaceFixture.finishElapsedSeconds / DemoRaceFixture.courseLengthMeters
        // Aid 1 at 12 km (5 min stop), Aid 2 at 25 km: the runner at 21 km is heading to Aid 2.
        let nextAidMeters = 25_000.0
        let stopsBefore = 300.0
        let start = ScheduleFormat.parseISO8601(DemoRaceFixture.raceStartAt) ?? Date(timeIntervalSince1970: 0)
        let plan = start.addingTimeInterval(nextAidMeters * paceSecondsPerMeter + stopsBefore)
        let eta = plan.addingTimeInterval(behindPlanSeconds)
        return CrewTourDemo(
            runnerName: "Ada",
            mileText: "Mile \(PortableFormat.oneDecimal(progressMeters / 1609.344))",
            lastUpdateAge: "\(pingAgeMinutes) min ago",
            nextAid: "Aid 2",
            nextAidAheadText: "\(PortableFormat.oneDecimal((nextAidMeters - progressMeters) / 1609.344)) mi ahead",
            etaClock: clock(eta, timeZone: timeZone, locale: locale),
            planClock: clock(plan, timeZone: timeZone, locale: locale)
        )
    }

    private static func clock(_ date: Date, timeZone: TimeZone, locale: Locale) -> String {
        ScheduleFormat.formatScheduleClock(RaceDayReadouts.iso8601(date), timeZone: timeZone, locale: locale)
    }
}
