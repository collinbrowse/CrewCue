// Generated from packages/contracts. Do not edit.
import Foundation

public struct RemainingCheckpointEta: Codable, Equatable, Sendable {
    public var checkpointId: String
    public var liveProjectedElapsedSeconds: Double
    public var frozenPlanElapsedSeconds: Double
    public var deltaSecondsVsFrozenPlan: Double

    public init(checkpointId: String, liveProjectedElapsedSeconds: Double, frozenPlanElapsedSeconds: Double, deltaSecondsVsFrozenPlan: Double) {
        self.checkpointId = checkpointId
        self.liveProjectedElapsedSeconds = liveProjectedElapsedSeconds
        self.frozenPlanElapsedSeconds = frozenPlanElapsedSeconds
        self.deltaSecondsVsFrozenPlan = deltaSecondsVsFrozenPlan
    }
}
