import Foundation

/// One run in a shared or picked file, as the API previewed it (nothing saved yet).
public struct ActivityPreviewRun: Equatable, Sendable, Decodable {
    public var fileName: String
    public var source: String
    public var recordedAt: String
    public var distanceMeters: Double
    public var elapsedSeconds: Double?
    public var elevationGainMeters: Double?
    /// Route line, `[latitude, longitude]` pairs (at most 200).
    public var track: [[Double]]
    public var alreadyImported: Bool

    public init(
        fileName: String,
        source: String,
        recordedAt: String,
        distanceMeters: Double,
        elapsedSeconds: Double? = nil,
        elevationGainMeters: Double? = nil,
        track: [[Double]] = [],
        alreadyImported: Bool = false
    ) {
        self.fileName = fileName
        self.source = source
        self.recordedAt = recordedAt
        self.distanceMeters = distanceMeters
        self.elapsedSeconds = elapsedSeconds
        self.elevationGainMeters = elevationGainMeters
        self.track = track
        self.alreadyImported = alreadyImported
    }

    /// "Thu, Nov 19, 2026": the row's heading. The run's start date as the file records it (UTC).
    public var dateLabel: String {
        let ymd = recordedAt.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard ymd.count == 3, (1...12).contains(ymd[1]) else { return String(recordedAt.prefix(10)) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
        let month = Self.months[ymd[1] - 1]
        guard let date = calendar.date(from: DateComponents(year: ymd[0], month: ymd[1], day: ymd[2])) else {
            return "\(month) \(ymd[2]), \(ymd[0])"
        }
        let weekday = Self.weekdays[calendar.component(.weekday, from: date) - 1]
        return "\(weekday), \(month) \(ymd[2]), \(ymd[0])"
    }

    /// The row's labeled values: Distance, Time, Climb. A value the file lacks reads "–".
    public var details: [ActivityRunDetail] {
        [
            ActivityRunDetail(label: "Distance", value: String(format: "%.1f km", distanceMeters / 1000)),
            ActivityRunDetail(label: "Time", value: elapsedSeconds.map { ScheduleFormat.formatDurationSeconds($0) } ?? Self.missing),
            ActivityRunDetail(label: "Climb", value: elevationGainMeters.map { "\(Int($0.rounded())) m" } ?? Self.missing)
        ]
    }

    /// "Thu, Nov 19, 2026. Distance 14.6 km. Time 1:43:12. Climb 604 m." What VoiceOver/TalkBack read.
    public var spokenSummary: String {
        var parts = [dateLabel] + details.filter { $0.value != Self.missing }.map { "\($0.label) \($0.value)" }
        if alreadyImported { parts.append(SharedRunImport.alreadyImportedBadge) }
        return parts.joined(separator: ". ") + "."
    }

    static let missing = "–"
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
}

/// One labeled value in a preview row: "Distance" over "14.6 km".
public struct ActivityRunDetail: Equatable, Sendable {
    public var label: String
    public var value: String
}

/// A file in a shared .zip that isn't a run or couldn't be read.
public struct ActivityUnreadableFile: Equatable, Sendable, Decodable {
    public var fileName: String
    public var error: String

    public init(fileName: String, error: String) {
        self.fileName = fileName
        self.error = error
    }
}

/// Files in a shared upload that weren't imported, by reason.
public struct ActivityUploadSkipped: Equatable, Sendable, Decodable {
    /// Runs more than a year before the upload's newest run (multi-run uploads only).
    public var older: Int
    /// Rides, walks and other sports.
    public var notRun: Int
    /// Not an activity file, or one that couldn't be read.
    public var unreadable: Int

    public init(older: Int = 0, notRun: Int = 0, unreadable: Int = 0) {
        self.older = older
        self.notRun = notRun
        self.unreadable = unreadable
    }

    public var total: Int { older + notRun + unreadable }
}

/// What a shared file holds, before the runner confirms.
public struct ActivityUploadPreview: Equatable, Sendable, Decodable {
    public var runs: [ActivityPreviewRun]
    /// Unreadable files by name (the API lists up to 50).
    public var unreadable: [ActivityUnreadableFile]
    public var skipped: ActivityUploadSkipped?

    public init(runs: [ActivityPreviewRun], unreadable: [ActivityUnreadableFile] = [], skipped: ActivityUploadSkipped? = nil) {
        self.runs = runs
        self.unreadable = unreadable
        self.skipped = skipped
    }

    /// Runs listed before "Show more"; a whole export can hold hundreds.
    public static let firstListedRuns = 10
    /// The runs on screen: the first 10, or all of them once the runner taps Show more.
    public func listedRuns(showingAll: Bool) -> [ActivityPreviewRun] {
        showingAll ? runs : Array(runs.prefix(Self.firstListedRuns))
    }
    /// "Show 164 more", or nil when every run is already listed.
    public func showMoreLabel(showingAll: Bool) -> String? {
        guard !showingAll, runs.count > Self.firstListedRuns else { return nil }
        return "Show \(SharedRunImport.count(runs.count - Self.firstListedRuns)) more"
    }

    /// "1,905 files skipped: 847 older than a year, 344 not runs or hikes, 714 unreadable", or nil.
    public var skippedLine: String? {
        guard let skipped, skipped.total > 0 else { return nil }
        var parts: [String] = []
        if skipped.older > 0 { parts.append("\(SharedRunImport.count(skipped.older)) older than a year") }
        if skipped.notRun > 0 { parts.append("\(SharedRunImport.count(skipped.notRun)) not runs or hikes") }
        if skipped.unreadable > 0 { parts.append("\(SharedRunImport.count(skipped.unreadable)) unreadable") }
        let noun = skipped.total == 1 ? "file" : "files"
        return "\(SharedRunImport.count(skipped.total)) \(noun) skipped: " + parts.joined(separator: ", ")
    }

    /// Runs not yet in pacing history; the ones Import would add.
    public var newRuns: [ActivityPreviewRun] { runs.filter { !$0.alreadyImported } }
    public var canImport: Bool { !newRuns.isEmpty }

    /// "Import this run?" / "Import 1,041 runs?" / "Already in pacing history." / the unreadable message.
    public var title: String {
        if runs.isEmpty { return SharedRunImport.unreadableMessage }
        if newRuns.isEmpty { return ActivityImport.duplicateMessage }
        return newRuns.count == 1 ? "Import this run?" : "Import \(SharedRunImport.count(newRuns.count)) runs?"
    }

    /// "Import" / "Import 41 runs".
    public var confirmLabel: String {
        newRuns.count == 1 ? "Import" : "Import \(SharedRunImport.count(newRuns.count)) runs"
    }

    /// "1 file can't be read" / "3 files can't be read", or nil. For a bulk export, see `skippedLine`.
    public var unreadableLine: String? {
        let count = skipped?.unreadable ?? unreadable.count
        if skipped != nil, skippedLine != nil { return nil }
        switch count {
        case 0: return nil
        case 1: return "1 file can't be read"
        default: return "\(SharedRunImport.count(count)) files can't be read"
        }
    }
}

/// How a confirmed import ended.
public struct ActivityUploadResult: Equatable, Sendable, Decodable {
    public var saved: Int
    public var duplicates: Int

    public init(saved: Int, duplicates: Int) {
        self.saved = saved
        self.duplicates = duplicates
    }

    /// "Run imported." / "41 runs imported." / "Already in pacing history."
    public var message: String {
        switch saved {
        case 0: ActivityImport.duplicateMessage
        case 1: SharedRunImport.doneOne
        default: "\(saved) runs imported."
        }
    }
}

/// The share-sheet (and picker) import flow: a file arrives → preview → the runner confirms.
/// Copy and rules: `clients/behavior/run-share-import.md`.
public enum SharedRunImportState: Equatable, Sendable {
    /// Reading the file and asking the API what's in it.
    case reading(fileName: String)
    case preview(ActivityUploadPreview)
    case importing
    case done(String)
    case failed(String)
    /// A file arrived while signed out. It's dropped; the runner shares it again after signing in.
    case signedOut
}

public enum SharedRunImport {
    /// Matches the API's MAX_RAW_UPLOAD_BYTES: one run, or a .zip up to a whole watch-app export.
    public static let maxUploadBytes = 200 * 1024 * 1024
    public static let fileExtensions = ActivityImport.fileExtensions + ["zip"]

    public static let tip = "Export a run from your watch app and share it to CrewCue."
    public static let signedOutMessage = "Sign in to import runs."
    public static let readingMessage = "Reading your run…"
    public static let importingMessage = "Importing…"
    public static let doneOne = "Run imported."
    public static let alreadyImportedBadge = "Already imported"
    public static let tooLargeMessage = "The file is larger than 200 MB. Export fewer runs at a time."

    /// "1,905": thousands grouped with commas, the same on every platform.
    public static func count(_ value: Int) -> String {
        let digits = String(abs(value))
        var out = ""
        for (index, char) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(char)
        }
        return value < 0 ? "-" + out : out
    }
    public static let unreadableMessage = "Couldn't read that file. Choose a .gpx, .fit, .tcx or .zip export."
    /// The server lost the upload (a restart, or it waited too long for the app).
    public static let uploadLostMessage = "The upload was interrupted. Share the file again."
    public static let uploadTimeoutMessage = "This export is taking too long. Try again, or export fewer runs."

    /// A failed preview or import: the server's own message for a 400/413, offline, else unreadable.
    public static func message(for error: any Error) -> String {
        if TransportFailure.isOffline(error) { return ActivityImport.offlineMessage }
        if let http = error as? ClientHTTPError, http.status == 401 { return signedOutMessage }
        if let http = error as? ClientHTTPError, http.status == 404, http.reason == "upload_not_found" { return uploadLostMessage }
        if let http = error as? ClientHTTPError, http.reason == "upload_timeout" { return uploadTimeoutMessage }
        if let http = error as? ClientHTTPError, http.status == 400 || http.status == 413,
           let server = http.serverMessage, !server.isEmpty {
            return server
        }
        return unreadableMessage
    }

    /// The state a newly arrived file starts in: signed out, a local problem, or reading.
    public static func start(signedIn: Bool, fileName: String, byteCount: Int) -> SharedRunImportState {
        guard signedIn else { return .signedOut }
        if let problem = localProblem(fileName: fileName, byteCount: byteCount) { return .failed(problem) }
        return .reading(fileName: fileName)
    }

    /// Local check before upload. Nil when the file may be sent.
    public static func localProblem(fileName: String, byteCount: Int) -> String? {
        if byteCount == 0 { return ActivityImport.emptyMessage }
        if byteCount > maxUploadBytes { return tooLargeMessage }
        let ext = (fileName as NSString).pathExtension.lowercased()
        if !ext.isEmpty && !fileExtensions.contains(ext) { return unreadableMessage }
        return nil
    }

    /// The state after the preview call: the preview, or a failure message.
    public static func afterPreview(_ result: Result<ActivityUploadPreview, any Error>) -> SharedRunImportState {
        switch result {
        case .success(let preview):
            return preview.runs.isEmpty ? .failed(unreadableMessage) : .preview(preview)
        case .failure(let error):
            return .failed(message(for: error))
        }
    }

    /// The state after the import call.
    public static func afterImport(_ result: Result<ActivityUploadResult, any Error>) -> SharedRunImportState {
        switch result {
        case .success(let done): .done(done.message)
        case .failure(let error): .failed(message(for: error))
        }
    }
}
