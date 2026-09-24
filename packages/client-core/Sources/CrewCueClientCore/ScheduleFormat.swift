import Foundation

public enum ScheduleFormat {
    /// Duration from the API in whole seconds, rendered as `mm:ss` or `h:mm:ss`.
    public static func formatDurationSeconds(_ totalSeconds: Double) -> String {
        guard totalSeconds.isFinite, totalSeconds >= 0 else {
            return "—"
        }
        let sec = Int(totalSeconds.rounded(.down))
        let hours = sec / 3600
        let minutes = (sec % 3600) / 60
        let seconds = sec % 60
        let mm = String(format: "%02d", minutes)
        let ss = String(format: "%02d", seconds)
        if hours > 0 {
            return "\(hours):\(mm):\(ss)"
        }
        return "\(mm):\(ss)"
    }

    /// Locale clock for an API ISO-8601 instant. Does not recompute from elapsed.
    public static func formatScheduleClock(_ isoUtc: String) -> String {
        guard let date = parseISO8601(isoUtc) else {
            return "—"
        }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    /// Stable `HH:MM UTC` for crew-sheet snapshots.
    public static func formatUtcHhMm(_ isoUtc: String) -> String {
        guard let date = parseISO8601(isoUtc) else {
            return "—"
        }
        let calendar = Calendar(identifier: .gregorian)
        var utc = calendar
        utc.timeZone = TimeZone(secondsFromGMT: 0) ?? utc.timeZone
        let hour = utc.component(.hour, from: date)
        let minute = utc.component(.minute, from: date)
        return String(format: "%02d:%02d UTC", hour, minute)
    }

    public static func checkpointDisplayTitle(id: String, title: String?) -> String {
        let raw = (title?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? slugToTitle(id)
        return raw.uppercased()
    }

    public static func milesRemaining(progressMeters: Double, checkpointDistanceMeters: Double?) -> String {
        guard let checkpointDistanceMeters, checkpointDistanceMeters.isFinite else {
            return "—"
        }
        let miles = max(0, checkpointDistanceMeters - progressMeters) / 1609.344
        return String(format: "%.1f mi", miles)
    }

    public static func slugToTitle(_ slug: String) -> String {
        slug.split(separator: "-").map { part in
            guard let first = part.first else { return "" }
            return String(first).uppercased() + part.dropFirst()
        }.joined(separator: " ")
    }

    static func parseISO8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}
