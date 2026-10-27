// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomEntitlement: Codable, Equatable, Sendable {
    public var status: String
    public var lastUpdatedAt: String
    public var source: String

    public init(status: String, lastUpdatedAt: String, source: String) {
        self.status = status
        self.lastUpdatedAt = lastUpdatedAt
        self.source = source
    }
}
