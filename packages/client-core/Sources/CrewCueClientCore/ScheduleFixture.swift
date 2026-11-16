import Foundation

public struct ScheduleStopFixture: Equatable, Sendable {
    public let checkpointId: String
    public let title: String
    public let elapsedSeconds: Double
    public let clockArrivalAt: String

    public init(checkpointId: String, title: String, elapsedSeconds: Double, clockArrivalAt: String) {
        self.checkpointId = checkpointId
        self.title = title
        self.elapsedSeconds = elapsedSeconds
        self.clockArrivalAt = clockArrivalAt
    }
}

/// Rows copied from `fixtures/pacing/schedule-expected.json` for Auth0-free schedule proof.
public enum ScheduleFixture {
    public static let roomId = "room-fixture-50k"
    public static let stops: [ScheduleStopFixture] = [
        ScheduleStopFixture(checkpointId: "start", title: "Start", elapsedSeconds: 0, clockArrivalAt: "2026-08-15T13:00:00.000Z"),
        ScheduleStopFixture(checkpointId: "aid-1", title: "Aid 1", elapsedSeconds: 4200, clockArrivalAt: "2026-08-15T14:10:00.000Z"),
        ScheduleStopFixture(checkpointId: "aid-2", title: "Aid 2", elapsedSeconds: 8400, clockArrivalAt: "2026-08-15T15:20:00.000Z"),
        ScheduleStopFixture(checkpointId: "aid-3", title: "Aid 3", elapsedSeconds: 14700, clockArrivalAt: "2026-08-15T17:05:00.000Z"),
        ScheduleStopFixture(checkpointId: "finish", title: "Finish", elapsedSeconds: 21000, clockArrivalAt: "2026-08-15T18:50:00.000Z")
    ]

    public static func sheetLines(timeZone: TimeZone = .current) -> [String] {
        stops.map { stop in
            let duration = ScheduleFormat.formatDurationSeconds(stop.elapsedSeconds)
            let clock = ScheduleFormat.formatScheduleClock(stop.clockArrivalAt, timeZone: timeZone)
            return "\(stop.title)  \(duration)  \(clock)"
        }
    }

    public static func sheetText(timeZone: TimeZone = .current) -> String {
        sheetLines(timeZone: timeZone).joined(separator: "\n")
    }

    public static func exportText(
        capturedAtIso: String = "2026-09-23T16:00:00.000Z",
        timeZone: TimeZone = .current
    ) -> String {
        let captured = ScheduleFormat.formatScheduleClock(capturedAtIso, timeZone: timeZone)
        var lines = ["Crew sheet", "Captured \(captured)", "Room \(roomId)"]
        lines.append(contentsOf: sheetLines(timeZone: timeZone))
        return lines.joined(separator: "\n")
    }
}
