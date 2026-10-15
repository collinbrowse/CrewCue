// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomMembership: Codable, Equatable, Sendable {
    public var userId: String
    public var role: String
    public var joinedAt: String
    public var displayName: String?

    public init(userId: String, role: String, joinedAt: String, displayName: String? = nil) {
        self.userId = userId
        self.role = role
        self.joinedAt = joinedAt
        self.displayName = displayName
    }
}
