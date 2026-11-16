import Foundation

/// A race start the person types in their own wall-clock time: a local date and time of day in a chosen
/// IANA time zone (default: the device's). Converts to and from the UTC `raceStartAt` the API uses.
/// The API's zod schema takes `Z` timestamps only (no offsets), so `raceStartAt` always ends in `Z`.
public struct RaceStartInput: Equatable, Sendable {
    public var year: Int
    public var month: Int
    public var day: Int
    public var hour: Int
    public var minute: Int
    /// IANA identifier, e.g. `America/Denver`.
    public var timeZoneIdentifier: String

    public init(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        timeZoneIdentifier: String = TimeZone.current.identifier
    ) {
        self.year = year
        self.month = month
        self.day = day
        self.hour = hour
        self.minute = minute
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// Builds the fields from an existing `raceStartAt` for display in `timeZoneIdentifier`.
    /// Nil when the string is not an ISO-8601 instant or the zone is unknown.
    public init?(raceStartAt: String, timeZoneIdentifier: String = TimeZone.current.identifier) {
        guard let zone = TimeZone(identifier: timeZoneIdentifier),
              let date = ScheduleFormat.parseISO8601(raceStartAt) else {
            return nil
        }
        let parts = Self.calendar(zone).dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard let year = parts.year, let month = parts.month, let day = parts.day,
              let hour = parts.hour, let minute = parts.minute else {
            return nil
        }
        self.init(year: year, month: month, day: day, hour: hour, minute: minute, timeZoneIdentifier: timeZoneIdentifier)
    }

    /// The instant these fields name, or nil when the fields are out of range, the zone is unknown, or the
    /// local time does not exist (the hour skipped when clocks spring forward). A time that happens twice
    /// when clocks fall back resolves to its first occurrence.
    public var instant: Date? {
        guard let zone = TimeZone(identifier: timeZoneIdentifier) else { return nil }
        var parts = DateComponents()
        parts.year = year
        parts.month = month
        parts.day = day
        parts.hour = hour
        parts.minute = minute
        parts.second = 0
        let calendar = Self.calendar(zone)
        guard let date = calendar.date(from: parts) else { return nil }
        // Calendar normalises invalid or skipped fields; reject them instead of silently shifting.
        let back = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard back.year == year, back.month == month, back.day == day,
              back.hour == hour, back.minute == minute else {
            return nil
        }
        return date
    }

    /// UTC ISO-8601 with milliseconds and a `Z` suffix, the form the API's `raceStartAt` requires.
    public var raceStartAt: String? {
        instant.map(RaceDayReadouts.iso8601)
    }

    private static func calendar(_ zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }
}
