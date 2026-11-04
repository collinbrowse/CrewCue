// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthletePingBatchPointResult: Codable, Equatable, Sendable {
    public var recordedAt: String
    public var decision: String
    public var reason: String?
    public var pingId: String?

    public init(recordedAt: String, decision: String, reason: String? = nil, pingId: String? = nil) {
        self.recordedAt = recordedAt
        self.decision = decision
        self.reason = reason
        self.pingId = pingId
    }
}
