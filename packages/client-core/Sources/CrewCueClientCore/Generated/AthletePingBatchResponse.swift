// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthletePingBatchResponse: Codable, Equatable, Sendable {
    public var roomId: String
    public var receivedAt: String
    public var results: [AthletePingBatchPointResult]
    public var acceptedCount: Double

    public init(roomId: String, receivedAt: String, results: [AthletePingBatchPointResult], acceptedCount: Double) {
        self.roomId = roomId
        self.receivedAt = receivedAt
        self.results = results
        self.acceptedCount = acceptedCount
    }
}
