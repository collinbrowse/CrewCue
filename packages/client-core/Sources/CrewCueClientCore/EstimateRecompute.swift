import Foundation

public struct ActivityHistoryRef: Equatable, Sendable {
    public var id: String
    public var distanceMeters: Double?
    public var elapsedSeconds: Double?
    public var elevationGainMeters: Double?

    public init(id: String, distanceMeters: Double? = nil, elapsedSeconds: Double? = nil, elevationGainMeters: Double? = nil) {
        self.id = id
        self.distanceMeters = distanceMeters
        self.elapsedSeconds = elapsedSeconds
        self.elevationGainMeters = elevationGainMeters
    }
}

public enum EstimateRecomputeReason: String, Equatable, Sendable {
    case none
    case coldStartWithHistory = "cold-start-with-history"
    case historyChanged = "history-changed"
}

public struct EstimateHistoryRecord: Equatable, Sendable {
    public var estimateId: String?
    public var fingerprint: String?

    public init(estimateId: String? = nil, fingerprint: String? = nil) {
        self.estimateId = estimateId
        self.fingerprint = fingerprint
    }

    public static let empty = EstimateHistoryRecord()
}

public struct EstimateRecomputeInput: Equatable, Sendable {
    public var canEdit: Bool
    public var busy: Bool
    public var estimateId: String?
    public var coldStart: Bool?
    public var usableHistoryCount: Int
    public var historyFingerprint: String?
    public var record: EstimateHistoryRecord

    public init(
        canEdit: Bool,
        busy: Bool,
        estimateId: String?,
        coldStart: Bool?,
        usableHistoryCount: Int,
        historyFingerprint: String?,
        record: EstimateHistoryRecord
    ) {
        self.canEdit = canEdit
        self.busy = busy
        self.estimateId = estimateId
        self.coldStart = coldStart
        self.usableHistoryCount = usableHistoryCount
        self.historyFingerprint = historyFingerprint
        self.record = record
    }
}

public struct EstimateRecomputeDecision: Equatable, Sendable {
    public var reason: EstimateRecomputeReason
    public var recompute: Bool
    public var nextRecord: EstimateHistoryRecord

    public init(reason: EstimateRecomputeReason, recompute: Bool, nextRecord: EstimateHistoryRecord) {
        self.reason = reason
        self.recompute = recompute
        self.nextRecord = nextRecord
    }
}

public enum PlanAuthority {
    public static func mayAutoRecompute(role: String) -> Bool {
        role == "athlete"
    }

    /// Crew may seed a cold start or tap Recalculate. They may not auto-recompute from history.
    public static func mayExplicitRecalculate(role: String) -> Bool {
        switch role {
        case "athlete", "crew_member", "crew_chief", "team_manager":
            true
        default:
            false
        }
    }

    public static func maySeedColdStart(role: String) -> Bool {
        mayExplicitRecalculate(role: role)
    }
}

public enum EstimateRecompute {
    public static func usableActivityHistory(_ items: [ActivityHistoryRef]) -> [ActivityHistoryRef] {
        items.filter { row in
            guard let distance = row.distanceMeters, let elapsed = row.elapsedSeconds else {
                return false
            }
            return distance > 0 && elapsed > 0
        }
    }

    public static func usableHistoryFingerprint(_ items: [ActivityHistoryRef]) -> String {
        usableActivityHistory(items).map { row in
            let gain = row.elevationGainMeters.map { String($0) } ?? ""
            return "\(row.id):\(row.distanceMeters ?? 0):\(row.elapsedSeconds ?? 0):\(gain)"
        }.sorted().joined(separator: "|")
    }

    public static func decide(_ input: EstimateRecomputeInput) -> EstimateRecomputeDecision {
        if !input.canEdit || input.busy || input.estimateId == nil || input.historyFingerprint == nil {
            return EstimateRecomputeDecision(reason: .none, recompute: false, nextRecord: input.record)
        }
        let next = EstimateHistoryRecord(estimateId: input.estimateId, fingerprint: input.historyFingerprint)
        let recorded = input.record.estimateId == input.estimateId ? input.record.fingerprint : nil
        if recorded != nil && recorded != input.historyFingerprint && input.usableHistoryCount > 0 {
            return EstimateRecomputeDecision(reason: .historyChanged, recompute: true, nextRecord: next)
        }
        if recorded == nil && input.coldStart == true && input.usableHistoryCount > 0 {
            return EstimateRecomputeDecision(reason: .coldStartWithHistory, recompute: true, nextRecord: next)
        }
        return EstimateRecomputeDecision(reason: .none, recompute: false, nextRecord: next)
    }

    /// Automatic history recompute is athlete-only. The API enforces the same rule by trigger.
    public static func decide(role: String, _ input: EstimateRecomputeInput) -> EstimateRecomputeDecision {
        guard PlanAuthority.mayAutoRecompute(role: role) else {
            return EstimateRecomputeDecision(reason: .none, recompute: false, nextRecord: input.record)
        }
        return decide(input)
    }
}
