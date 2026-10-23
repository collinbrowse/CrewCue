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

    public static func sheetLines() -> [String] {
        stops.map { stop in
            let duration = ScheduleFormat.formatDurationSeconds(stop.elapsedSeconds)
            let clock = ScheduleFormat.formatUtcHhMm(stop.clockArrivalAt)
            return "\(stop.title)  \(duration)  \(clock)"
        }
    }

    public static func sheetText() -> String {
        sheetLines().joined(separator: "\n")
    }

    public static func exportText(capturedAtIso: String = "2026-09-23T16:00:00.000Z") -> String {
        var lines = ["Crew sheet", "Captured \(ScheduleFormat.formatUtcHhMm(capturedAtIso))", "Room \(roomId)"]
        lines.append(contentsOf: sheetLines())
        return lines.joined(separator: "\n")
    }
}
