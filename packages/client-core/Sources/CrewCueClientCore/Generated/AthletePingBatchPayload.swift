// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthletePingBatchPayload: Codable, Equatable, Sendable {
    public var points: [AthletePingBatchPoint]
    public var uploadIntervalSeconds: Double?

    public init(points: [AthletePingBatchPoint], uploadIntervalSeconds: Double? = nil) {
        self.points = points
        self.uploadIntervalSeconds = uploadIntervalSeconds
    }
}
