import Foundation

/// One checkpoint's new planned stop, sent to `PATCH /race-rooms/:roomId/checkpoint-stops`.
public struct PlannedStopEdit: Codable, Equatable, Sendable {
    public var checkpointId: String
    public var plannedStopSeconds: Int

    public init(checkpointId: String, plannedStopSeconds: Int) {
        self.checkpointId = checkpointId
        self.plannedStopSeconds = plannedStopSeconds
    }
}

/// User-facing copy for planned-stop editing, shared by iOS, Android, and the dev fixture.
public enum StopPlanCopy {
    public static let saved = "Planned stops saved."
    public static let offline = "Offline. Planned stops not saved. Try again when you're online."
    public static let forbidden = "Only the athlete, crew chief, or team manager can change planned stops."
    public static let failed = "Couldn't save planned stops."
    public static let empty = "No stops on this sheet."

    /// Message for a failed save.
    public static func failure(_ error: Error) -> String {
        if TransportFailure.isOffline(error) { return offline }
        if (error as? ClientHTTPError)?.status == 403 { return forbidden }
        return failed
    }
}

/// Result of reading a minutes field.
public enum StopMinutesInput: Equatable, Sendable {
    case ok(seconds: Int)
    case invalid(String)
}

/// #250 Pace edit: planned aid stop minutes per checkpoint, edited as a draft before saving.
///
/// While editing, the Pace timeline renders from the draft (`projectedStops`), so every later
/// arrival, and its cutoff status, previews the change before anything is sent. Saving sends only
/// the changed rows; the server recomputes the schedule from the same rule
/// (arrival = moving time + planned stops before it).
public struct StopPlanDraft: Equatable, Sendable {
    /// Matches the API's MAX_PLANNED_STOP_SECONDS (6 h).
    public static let maxMinutes = 360
    /// Same threshold as the server's CUTOFF_WARN_MARGIN_SECONDS.
    static let cutoffWarnMarginSeconds: Double = 900
    static let invalidMinutesMessage = "Enter whole minutes from 0 to 360."

    public struct Row: Equatable, Sendable, Identifiable {
        public var checkpointId: String
        public var title: String
        /// Planned stop the server has now (seconds).
        public var savedSeconds: Int
        /// Planned stop in the draft (seconds). Unchanged while `error` is set.
        public var draftSeconds: Int
        /// What the minutes field shows, kept as typed so a half-typed value is not rewritten.
        public var minutesText: String
        public var error: String?
        /// False for the start, the finish, and checkpoints the runner has already passed.
        public var editable: Bool

        public var id: String { checkpointId }
        public var isChanged: Bool { draftSeconds != savedSeconds }
    }

    public private(set) var rows: [Row]

    /// Rows in course order. `progressMeters` (from the runner's pings) locks passed checkpoints,
    /// using the same 5 m rule as the Pace timeline's done state.
    public init(checkpoints: [AidStationCheckpoint], progressMeters: Double) {
        let progress = progressMeters.isFinite ? max(0, progressMeters) : 0
        let ordered = checkpoints.enumerated().sorted { lhs, rhs in
            let left = lhs.element.distanceMetersFromStart ?? Double(lhs.offset)
            let right = rhs.element.distanceMetersFromStart ?? Double(rhs.offset)
            return left == right ? lhs.offset < rhs.offset : left < right
        }.map(\.element)
        rows = ordered.enumerated().map { index, checkpoint in
            let saved = Self.seconds(checkpoint.plannedStopSeconds)
            let distance = checkpoint.distanceMetersFromStart.flatMap { $0.isFinite ? $0 : nil }
            let isStart = index == 0 && (distance ?? 0) <= 5
            let isFinish = index == ordered.count - 1 && ordered.count > 1
            let passed = progress > 5 && (distance.map { $0 <= progress + 5 } ?? false)
            return Row(
                checkpointId: checkpoint.id,
                title: ScheduleFormat.checkpointDisplayTitle(id: checkpoint.id, title: checkpoint.title),
                savedSeconds: saved,
                draftSeconds: saved,
                minutesText: Self.minutesText(seconds: saved),
                error: nil,
                editable: !(isStart || isFinish || passed)
            )
        }
    }

    public var hasChanges: Bool { rows.contains { $0.isChanged } }
    public var hasErrors: Bool { rows.contains { $0.error != nil } }
    public var canSave: Bool { hasChanges && !hasErrors }

    /// Only the rows that differ from the server, in course order.
    public var edits: [PlannedStopEdit] {
        rows.filter(\.isChanged).map { PlannedStopEdit(checkpointId: $0.checkpointId, plannedStopSeconds: $0.draftSeconds) }
    }

    public func row(_ checkpointId: String) -> Row? {
        rows.first { $0.checkpointId == checkpointId }
    }

    /// Whole minutes 0...maxMinutes; empty means no stop.
    public static func parseMinutes(_ text: String) -> StopMinutesInput {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .ok(seconds: 0)
        }
        guard trimmed.allSatisfy(\.isASCII), trimmed.allSatisfy(\.isNumber),
              let minutes = Int(trimmed), minutes <= maxMinutes else {
            return .invalid(invalidMinutesMessage)
        }
        return .ok(seconds: minutes * 60)
    }

    /// Updates one row from its minutes field. Locked rows ignore the change.
    @discardableResult
    public mutating func setMinutes(_ text: String, for checkpointId: String) -> StopMinutesInput {
        guard let index = rows.firstIndex(where: { $0.checkpointId == checkpointId }) else {
            return .invalid("Unknown checkpoint.")
        }
        guard rows[index].editable else {
            return .invalid("This stop can't be changed.")
        }
        rows[index].minutesText = text
        let result = Self.parseMinutes(text)
        switch result {
        case .ok(let seconds):
            rows[index].draftSeconds = seconds
            rows[index].error = nil
        case .invalid(let message):
            rows[index].error = message
        }
        return result
    }

    /// Adds `deltaMinutes` (a stepper tap), clamped to 0...maxMinutes.
    public mutating func step(_ checkpointId: String, deltaMinutes: Int) {
        guard let row = row(checkpointId), row.editable else { return }
        let current = row.error == nil ? row.draftSeconds / 60 : row.savedSeconds / 60
        let next = min(Self.maxMinutes, max(0, current + deltaMinutes))
        setMinutes(String(next), for: checkpointId)
    }

    /// Back to what the server has.
    public mutating func reset() {
        for index in rows.indices {
            rows[index].draftSeconds = rows[index].savedSeconds
            rows[index].minutesText = Self.minutesText(seconds: rows[index].savedSeconds)
            rows[index].error = nil
        }
    }

    /// The schedule as it will read after saving: every stop after a changed checkpoint moves by the
    /// change, its cutoff margin and status follow, and each row's planned stop shows the draft.
    public func projectedStops(_ stops: [ScheduleStop]) -> [ScheduleStop] {
        let deltaById = Dictionary(
            rows.map { ($0.checkpointId, Double($0.draftSeconds - $0.savedSeconds)) },
            uniquingKeysWith: { first, _ in first }
        )
        let draftById = Dictionary(rows.map { ($0.checkpointId, $0.draftSeconds) }, uniquingKeysWith: { first, _ in first })
        var shift = 0.0
        return stops.map { stop in
            var next = stop
            if shift != 0 {
                next.elapsedSeconds = stop.elapsedSeconds + shift
                if let arrival = ScheduleFormat.parseISO8601(stop.clockArrivalAt) {
                    next.clockArrivalAt = Self.iso(arrival.addingTimeInterval(shift))
                }
                if let margin = stop.cutoffMarginSeconds, margin.isFinite {
                    let moved = margin - shift
                    next.cutoffMarginSeconds = moved
                    next.cutoffStatus = moved > Self.cutoffWarnMarginSeconds ? "ok" : (moved > 0 ? "warn" : "breach")
                }
            }
            if let draft = draftById[stop.checkpointId] {
                next.plannedStoppageSeconds = Double(draft)
            }
            shift += deltaById[stop.checkpointId] ?? 0
            return next
        }
    }

    /// Short dwell label for the Pace rail, e.g. "NO STOP", "5 MIN STOP", "1H 30M STOP".
    public static func stopLabel(seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 30 else { return "NO STOP" }
        let minutes = Int((seconds / 60).rounded())
        if minutes >= 60 {
            let rest = minutes % 60
            return rest > 0 ? "\(minutes / 60)H \(rest)M STOP" : "\(minutes / 60)H STOP"
        }
        return "\(minutes) MIN STOP"
    }

    static func minutesText(seconds: Int) -> String {
        String(Int((Double(seconds) / 60).rounded()))
    }

    private static func seconds(_ value: Double?) -> Int {
        guard let value, value.isFinite, value > 0 else { return 0 }
        return Int(value.rounded())
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}
