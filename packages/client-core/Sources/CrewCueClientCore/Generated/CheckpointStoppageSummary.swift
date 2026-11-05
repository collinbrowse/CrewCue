// Generated from packages/contracts. Do not edit.
import Foundation

public struct CheckpointStoppageSummary: Codable, Equatable, Sendable {
    public var totalPlannedStopSeconds: Double
    public var totalActualStopSeconds: Double
    public var totalDeltaStopSeconds: Double?
    public var stoppageTimePercent: Double?
    public var remainingPlannedStopSeconds: Double

    public init(totalPlannedStopSeconds: Double, totalActualStopSeconds: Double, totalDeltaStopSeconds: Double? = nil, stoppageTimePercent: Double? = nil, remainingPlannedStopSeconds: Double) {
        self.totalPlannedStopSeconds = totalPlannedStopSeconds
        self.totalActualStopSeconds = totalActualStopSeconds
        self.totalDeltaStopSeconds = totalDeltaStopSeconds
        self.stoppageTimePercent = stoppageTimePercent
        self.remainingPlannedStopSeconds = remainingPlannedStopSeconds
    }
}
