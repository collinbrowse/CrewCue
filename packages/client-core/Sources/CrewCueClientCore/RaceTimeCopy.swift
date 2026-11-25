import Foundation

/// The planned race time at an aid: how long after the start the plan has the runner arriving.
/// A Pace row shows it under the planned arrival clock, labeled so the two times read apart.
public enum RaceTimeCopy {
    /// "RACE 1:10:00". "RACE —" for an unreadable time.
    public static func caption(elapsedSeconds: Double) -> String {
        "RACE \(ScheduleFormat.formatDurationSeconds(elapsedSeconds))"
    }

    /// "1 hour 10 minutes into the race", "45 minutes into the race", "At the start".
    public static func spoken(elapsedSeconds: Double) -> String {
        guard elapsedSeconds.isFinite, elapsedSeconds >= 0 else { return "Race time unknown" }
        let minutes = Int((elapsedSeconds / 60).rounded())
        guard minutes > 0 else { return "At the start" }
        return "\(spokenDuration(minutes: minutes)) into the race"
    }

    /// "Planned arrival 2:10 PM, 1 hour 10 minutes into the race".
    public static func spokenArrival(clock: String, elapsedSeconds: Double?) -> String {
        let arrival = "Planned arrival \(clock)"
        guard let elapsedSeconds else { return arrival }
        return "\(arrival), \(spoken(elapsedSeconds: elapsedSeconds))"
    }

    /// "1 hour 10 minutes", "2 hours", "1 minute".
    static func spokenDuration(minutes: Int) -> String {
        let hours = minutes / 60
        let rest = minutes % 60
        var parts: [String] = []
        if hours > 0 { parts.append(hours == 1 ? "1 hour" : "\(hours) hours") }
        if rest > 0 { parts.append(rest == 1 ? "1 minute" : "\(rest) minutes") }
        return parts.joined(separator: " ")
    }
}
