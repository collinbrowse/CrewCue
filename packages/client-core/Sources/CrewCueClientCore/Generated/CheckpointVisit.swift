// Generated from packages/contracts. Do not edit.
import Foundation

public struct CheckpointVisit: Codable, Equatable, Sendable {
    public var visitIndex: Double
    public var resolvedSource: String
    public var autoDetected: CheckpointVisitAutoData?
    public var manualEntry: CheckpointVisitManualData?
    public var activeActualStopSeconds: Double?
    public var note: String?

    public init(visitIndex: Double, resolvedSource: String, autoDetected: CheckpointVisitAutoData? = nil, manualEntry: CheckpointVisitManualData? = nil, activeActualStopSeconds: Double? = nil, note: String? = nil) {
        self.visitIndex = visitIndex
        self.resolvedSource = resolvedSource
        self.autoDetected = autoDetected
        self.manualEntry = manualEntry
        self.activeActualStopSeconds = activeActualStopSeconds
        self.note = note
    }
}
