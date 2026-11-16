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
        let mm = PortableFormat.zeroPadded(minutes, width: 2)
        let ss = PortableFormat.zeroPadded(seconds, width: 2)
        if hours > 0 {
            return "\(hours):\(mm):\(ss)"
        }
        return "\(mm):\(ss)"
    }

    /// Clock for an API ISO-8601 instant, shown in the viewer's time zone (default: the device's).
    /// The wire format stays UTC; only display converts. Does not recompute from elapsed.
    public static func formatScheduleClock(
        _ isoUtc: String,
        timeZone: TimeZone = .current,
        locale: Locale = .current
    ) -> String {
        guard let date = parseISO8601(isoUtc) else {
            return "—"
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    /// One schedule row: title, elapsed duration, and local clock. Matches the fixture sheet spacing.
    public static func scheduleLine(
        checkpointId: String,
        elapsedSeconds: Double,
        clockArrivalAt: String,
        timeZone: TimeZone = .current
    ) -> String {
        let title = slugToTitle(checkpointId)
        let clock = formatScheduleClock(clockArrivalAt, timeZone: timeZone)
        return "\(title)  \(formatDurationSeconds(elapsedSeconds))  \(clock)"
    }

    public static func crewSheetText(
        roomId: String,
        capturedAtIso: String,
        stopLines: [String],
        timeZone: TimeZone = .current
    ) -> String {
        let captured = formatScheduleClock(capturedAtIso, timeZone: timeZone)
        var lines = ["Crew sheet", "Captured \(captured)", "Room \(roomId)"]
        lines.append(contentsOf: stopLines)
        return lines.joined(separator: "\n")
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
        return "\(PortableFormat.oneDecimal(miles)) mi"
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
