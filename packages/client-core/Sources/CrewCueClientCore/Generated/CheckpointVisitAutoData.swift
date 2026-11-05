// Generated from packages/contracts. Do not edit.
import Foundation

public struct CheckpointVisitAutoData: Codable, Equatable, Sendable {
    public var arrivalRecordedAt: String?
    public var departureRecordedAt: String?
    public var firstSlowedAt: String?
    public var actualStopSeconds: Double?

    public init(arrivalRecordedAt: String? = nil, departureRecordedAt: String? = nil, firstSlowedAt: String? = nil, actualStopSeconds: Double? = nil) {
        self.arrivalRecordedAt = arrivalRecordedAt
        self.departureRecordedAt = departureRecordedAt
        self.firstSlowedAt = firstSlowedAt
        self.actualStopSeconds = actualStopSeconds
    }
}
