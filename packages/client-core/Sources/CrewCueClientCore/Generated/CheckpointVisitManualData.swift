// Generated from packages/contracts. Do not edit.
import Foundation

public struct CheckpointVisitManualData: Codable, Equatable, Sendable {
    public var arrivalAt: String
    public var departureAt: String
    public var actualStopSeconds: Double
    public var recordedByUserId: String

    public init(arrivalAt: String, departureAt: String, actualStopSeconds: Double, recordedByUserId: String) {
        self.arrivalAt = arrivalAt
        self.departureAt = departureAt
        self.actualStopSeconds = actualStopSeconds
        self.recordedByUserId = recordedByUserId
    }
}
