import Foundation

/// Client feature flags. Off unless the build defines the matching compiler flag.
public enum ClientFeatureFlags {
    /// Strava connect (#652). v1 imports exported watch files instead; the API routes stay for later.
    /// Turn on for a build with `-D CREWCUE_STRAVA` (Swift) / the Android `crewcue.strava` Gradle property.
    #if CREWCUE_STRAVA
    public static let stravaEnabled = true
    #else
    public static let stravaEnabled = false
    #endif
}

/// One past activity in the athlete's pacing history, for display.
public struct ActivityHistoryItem: Equatable, Sendable {
    public var id: String
    public var source: String
    public var recordedAt: String
    public var distanceMeters: Double?
    public var elapsedSeconds: Double?
    /// The activity's own title from the file ("Morning Run" in a Strava GPX). Nil when the file
    /// had none (COROS exports) or the row predates names.
    public var name: String?

    public init(
        id: String, source: String, recordedAt: String, distanceMeters: Double? = nil, elapsedSeconds: Double? = nil,
        name: String? = nil
    ) {
        self.id = id
        self.source = source
        self.recordedAt = recordedAt
        self.distanceMeters = distanceMeters
        self.elapsedSeconds = elapsedSeconds
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.name = trimmed.isEmpty ? nil : trimmed
    }

    /// The row's title: the activity's name, else its date ("May 10, 2026").
    public var titleLabel: String { name ?? dateLabel }

    /// The date under a named row's title; nil when the title already is the date.
    public var subtitleDateLabel: String? { name == nil ? nil : dateLabel }

    /// "FIT · 8.0 km · 40:00 · 2026-05-10"
    public var summary: String {
        var parts = [ActivityImport.sourceLabel(source)]
        if let distanceMeters { parts.append(String(format: "%.1f km", distanceMeters / 1000)) }
        if let elapsedSeconds { parts.append(ScheduleFormat.formatDurationSeconds(elapsedSeconds)) }
        parts.append(String(recordedAt.prefix(10)))
        return parts.joined(separator: " · ")
    }

    /// "FIT", "GPX", "Strava".
    public var sourceLabel: String { ActivityImport.sourceLabel(source) }

    /// "May 10, 2026" from the recorded date; the raw date when it can't be read.
    public var dateLabel: String {
        let day = String(recordedAt.prefix(10))
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return day }
        return "\(ActivityImport.monthNames[parts[1] - 1]) \(parts[2]), \(parts[0])"
    }

    /// "6.2 mi"
    public var distanceLabel: String? {
        guard let distanceMeters, distanceMeters.isFinite, distanceMeters > 0 else { return nil }
        return "\(PortableFormat.oneDecimal(distanceMeters / ActivityImport.metersPerMile)) mi"
    }

    /// "1:02:10"
    public var durationLabel: String? {
        guard let elapsedSeconds, elapsedSeconds.isFinite, elapsedSeconds > 0 else { return nil }
        return ScheduleFormat.formatDurationSeconds(elapsedSeconds)
    }

    /// "9'40\" / mi" over the whole activity, stops included.
    public var paceLabel: String? {
        guard let distanceMeters, let elapsedSeconds, distanceMeters > 0, elapsedSeconds > 0,
              distanceMeters.isFinite, elapsedSeconds.isFinite else { return nil }
        let perMile = Int((elapsedSeconds / (distanceMeters / ActivityImport.metersPerMile)).rounded())
        guard perMile > 0, perMile < 24 * 3600 else { return nil }
        return "\(perMile / 60)'\(PortableFormat.zeroPadded(perMile % 60, width: 2))\" / mi"
    }
}

public enum ActivityImportStatus: String, Sendable {
    case saved
    case duplicate
}

public struct ActivityImportResult: Equatable, Sendable {
    public var status: ActivityImportStatus
    public var item: ActivityHistoryItem
}

public enum ActivityImport {
    /// Matches the API's MAX_ACTIVITY_FILE_BYTES.
    public static let maxFileBytes = 10 * 1024 * 1024
    public static let fileExtensions = ["gpx", "fit", "tcx"]

    public static let successMessage = "Run imported to pacing history."
    public static let duplicateMessage = "Already in pacing history."
    public static let emptyMessage = "Choose a .gpx, .fit or .tcx file from your watch."
    public static let errorMessage = "Couldn't read that file. Choose a .gpx, .fit or .tcx export."
    public static let tooLargeMessage = "The file is larger than 10 MB. Export a single activity."
    static let metersPerMile = 1609.344
    static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// Settings' one line about the history: "3 runs imported".
    public static func countLabel(_ count: Int) -> String {
        switch count {
        case ..<1: "No runs imported yet"
        case 1: "1 run imported"
        default: "\(count) runs imported"
        }
    }

    public static let offlineMessage = "Offline. Import the file when you're back online."

    public static func sourceLabel(_ source: String) -> String {
        switch source {
        case "fit_upload": "FIT"
        case "tcx_upload": "TCX"
        case "gpx_upload": "GPX"
        case "strava": "Strava"
        default: source
        }
    }

    /// Local check before upload. Nil when the file may be sent.
    public static func localProblem(fileName: String, byteCount: Int) -> String? {
        if byteCount == 0 { return emptyMessage }
        if byteCount > maxFileBytes { return tooLargeMessage }
        let ext = (fileName as NSString).pathExtension.lowercased()
        if !ext.isEmpty && !fileExtensions.contains(ext) { return errorMessage }
        return nil
    }

    /// The message to show for a failed upload: the server's own message for a 400/413, else generic.
    public static func message(for error: any Error) -> String {
        if TransportFailure.isOffline(error) { return offlineMessage }
        if let http = error as? ClientHTTPError, http.status == 400 || http.status == 413,
           let server = http.serverMessage, !server.isEmpty {
            return server
        }
        return errorMessage
    }
}
