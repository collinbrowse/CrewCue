// Generated from packages/contracts. Do not edit.
import Foundation

public struct ScheduleStop: Codable, Equatable, Sendable {
    public var id: String
    public var checkpointId: String
    public var clockArrivalAt: String
    public var elapsedSeconds: Double
    public var movingElapsedSeconds: Double?
    public var plannedStoppageSeconds: Double
    public var delayOverrideSeconds: Double?
    public var notes: ScheduleStopNotesRef?
    public var cutoffStatus: String?
    public var cutoffMarginSeconds: Double?

    public init(id: String, checkpointId: String, clockArrivalAt: String, elapsedSeconds: Double, movingElapsedSeconds: Double? = nil, plannedStoppageSeconds: Double, delayOverrideSeconds: Double? = nil, notes: ScheduleStopNotesRef? = nil, cutoffStatus: String? = nil, cutoffMarginSeconds: Double? = nil) {
        self.id = id
        self.checkpointId = checkpointId
        self.clockArrivalAt = clockArrivalAt
        self.elapsedSeconds = elapsedSeconds
        self.movingElapsedSeconds = movingElapsedSeconds
        self.plannedStoppageSeconds = plannedStoppageSeconds
        self.delayOverrideSeconds = delayOverrideSeconds
        self.notes = notes
        self.cutoffStatus = cutoffStatus
        self.cutoffMarginSeconds = cutoffMarginSeconds
    }
}
