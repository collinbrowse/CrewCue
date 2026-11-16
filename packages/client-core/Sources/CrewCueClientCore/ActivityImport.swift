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

    public init(id: String, source: String, recordedAt: String, distanceMeters: Double? = nil, elapsedSeconds: Double? = nil) {
        self.id = id
        self.source = source
        self.recordedAt = recordedAt
        self.distanceMeters = distanceMeters
        self.elapsedSeconds = elapsedSeconds
    }

    /// "FIT · 8.0 km · 40:00 · 2026-05-10"
    public var summary: String {
        var parts = [ActivityImport.sourceLabel(source)]
        if let distanceMeters { parts.append(String(format: "%.1f km", distanceMeters / 1000)) }
        if let elapsedSeconds { parts.append(ScheduleFormat.formatDurationSeconds(elapsedSeconds)) }
        parts.append(String(recordedAt.prefix(10)))
        return parts.joined(separator: " · ")
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
