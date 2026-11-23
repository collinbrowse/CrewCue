import Foundation

/// One stop on the crew sheet, ready to show as a table row.
public struct CrewSheetRow: Equatable, Sendable {
    public var title: String
    /// Clock time the runner is due, e.g. "11:31 AM".
    public var arrival: String
    /// Race time at that stop, e.g. "1:22:37".
    public var elapsed: String

    public init(title: String, arrival: String, elapsed: String) {
        self.title = title
        self.arrival = arrival
        self.elapsed = elapsed
    }
}

/// One aid station's planned stop in the Race tools course readout.
public struct CourseStopRow: Equatable, Sendable {
    public var title: String
    public var duration: String

    public init(title: String, duration: String) {
        self.title = title
        self.duration = duration
    }
}

/// Words for the Race tools sheet (Pace → tools button). Both apps show these.
public enum RaceToolsCopy {
    public static let sheetTitle = "Race tools"

    public static let courseFileTitle = "Course file"
    public static let courseFileHint = "The race's .gpx route. Sets the aid stations and schedule."
    public static let pasteGpxLabel = "Paste GPX text instead"

    public static let crewSheetTitle = "Crew sheet"
    public static let crewSheetHint = "When the runner is due at each stop, for crew without the app."

    public static let stopsTitle = "Aid station stops"
    public static let cutoffsTitle = "Cutoffs"

    public static let outboxTitle = "Waiting to upload"
    public static let outboxHint = "Check-ins, course files and messages made without signal wait here. They upload on their own once this phone is back online."
    public static let outboxEmpty = "Nothing waiting. Everything is uploaded."
    public static let outboxOffline = "No signal. These upload once this phone is back online."
    public static let outboxRejected = "The server turned down a change, so it won't upload."

    /// Plain name for a queued outbox operation type.
    public static func outboxLabel(type: String) -> String {
        switch type {
        case "check-in": "Check-in"
        case "gpx": "Course file"
        case "chat": "Chat message"
        case "ping": "Location update"
        case "push": "Alert setup for this phone"
        default: ScheduleFormat.slugToTitle(type)
        }
    }

    /// "Aid 1", not the uppercased timeline title.
    public static func checkpointName(id: String, title: String?) -> String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? ScheduleFormat.slugToTitle(id) : trimmed
    }

    /// "2 min", "1 h 5 min".
    public static func minutesText(_ seconds: Double) -> String {
        let minutes = Int((max(0, seconds) / 60).rounded())
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        let rest = minutes % 60
        return rest == 0 ? "\(hours) h" : "\(hours) h \(rest) min"
    }

    /// Planned stops at the aid stations between start and finish. When every aid station has
    /// the same stop, one sentence says so and there are no rows.
    public static func stopSummary(_ stops: [(title: String, seconds: Double?)]) -> (summary: String, rows: [CourseStopRow]) {
        let aids = stops.count > 2 ? Array(stops.dropFirst().dropLast()) : []
        let planned = aids.compactMap { stop in stop.seconds.map { (stop.title, $0) } }.filter { $0.1 > 0 }
        guard planned.isEmpty == false else {
            return ("No aid station stops planned. Use Edit planned stops on Pace to add them.", [])
        }
        let durations = Set(planned.map { minutesText($0.1) })
        if durations.count == 1, planned.count == aids.count, let only = durations.first {
            let count = aids.count == 1 ? "the aid station" : "each of the \(aids.count) aid stations"
            return ("\(only) planned at \(count). Use Edit planned stops on Pace to change it.", [])
        }
        let rows = planned.map { CourseStopRow(title: $0.0, duration: minutesText($0.1)) }
        return ("Planned time at each aid station. Use Edit planned stops on Pace to change them.", rows)
    }

    /// One cutoff readout line from the schedule's cutoff status and margin (seconds ahead).
    public static func cutoffLine(title: String, status: String, marginSeconds: Double?) -> String {
        let margin = marginSeconds.map { minutesText(abs($0)) }
        switch status {
        case "breach":
            return margin.map { "\(title): due \($0) after the cutoff" } ?? "\(title): due after the cutoff"
        case "warn":
            return margin.map { "\(title): only \($0) ahead of the cutoff" } ?? "\(title): close to the cutoff"
        default:
            return margin.map { "\(title): \($0) ahead of the cutoff" } ?? "\(title): ahead of the cutoff"
        }
    }

    /// Aid stop summary and cutoff lines from schedule stops, in course order.
    public static func courseReadout(
        _ stops: [ScheduleStop],
        titles: [String: String] = [:]
    ) -> (summary: String, rows: [CourseStopRow], cutoffs: [String]) {
        let named = stops.map { (stop: $0, title: checkpointName(id: $0.checkpointId, title: titles[$0.checkpointId])) }
        let stopSummary = stopSummary(named.map { ($0.title, $0.stop.plannedStoppageSeconds) })
        let cutoffs = named.compactMap { item -> String? in
            guard let status = item.stop.cutoffStatus, status.isEmpty == false else { return nil }
            return cutoffLine(title: item.title, status: status, marginSeconds: item.stop.cutoffMarginSeconds)
        }
        return (stopSummary.summary, stopSummary.rows, cutoffs)
    }

    /// Crew sheet rows from schedule stops.
    public static func crewSheetRows(
        _ stops: [ScheduleStop],
        titles: [String: String] = [:],
        timeZone: TimeZone = DeviceTimeZone.current
    ) -> [CrewSheetRow] {
        stops.map { stop in
            CrewSheetRow(
                title: checkpointName(id: stop.checkpointId, title: titles[stop.checkpointId]),
                arrival: ScheduleFormat.formatScheduleClock(stop.clockArrivalAt, timeZone: timeZone),
                elapsed: ScheduleFormat.formatDurationSeconds(stop.elapsedSeconds)
            )
        }
    }

    /// The crew sheet as plain text for Messages or print: one readable line per stop.
    public static func crewSheetText(raceName: String, capturedAtIso: String, rows: [CrewSheetRow], timeZone: TimeZone = DeviceTimeZone.current) -> String {
        let name = raceName.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = name.isEmpty ? "Crew sheet" : "\(name) crew sheet"
        let captured = ScheduleFormat.formatScheduleClock(capturedAtIso, timeZone: timeZone)
        var lines = [heading, "Updated \(captured)", ""]
        lines += rows.map { "\($0.title): due \($0.arrival) (\($0.elapsed) race time)" }
        return lines.joined(separator: "\n")
    }
}
