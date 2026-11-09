// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCheckpointSplitRow: Codable, Equatable, Sendable {
    public var checkpointId: String
    public var distanceMetersFromStart: Double
    public var crossedAtRecordedAt: String?
    public var plannedElapsedSecondsAtCross: Double
    public var plannedAidStationClockIso: String?
    public var actualElapsedSecondsAtCross: Double?
    public var deltaSecondsAtCross: Double?
    public var plannedStopSeconds: Double
    public var visits: [CheckpointVisit]
    public var totalActualStopSeconds: Double?
    public var deltaStopSeconds: Double?

    public init(checkpointId: String, distanceMetersFromStart: Double, crossedAtRecordedAt: String? = nil, plannedElapsedSecondsAtCross: Double, plannedAidStationClockIso: String? = nil, actualElapsedSecondsAtCross: Double? = nil, deltaSecondsAtCross: Double? = nil, plannedStopSeconds: Double, visits: [CheckpointVisit], totalActualStopSeconds: Double? = nil, deltaStopSeconds: Double? = nil) {
        self.checkpointId = checkpointId
        self.distanceMetersFromStart = distanceMetersFromStart
        self.crossedAtRecordedAt = crossedAtRecordedAt
        self.plannedElapsedSecondsAtCross = plannedElapsedSecondsAtCross
        self.plannedAidStationClockIso = plannedAidStationClockIso
        self.actualElapsedSecondsAtCross = actualElapsedSecondsAtCross
        self.deltaSecondsAtCross = deltaSecondsAtCross
        self.plannedStopSeconds = plannedStopSeconds
        self.visits = visits
        self.totalActualStopSeconds = totalActualStopSeconds
        self.deltaStopSeconds = deltaStopSeconds
    }
}
