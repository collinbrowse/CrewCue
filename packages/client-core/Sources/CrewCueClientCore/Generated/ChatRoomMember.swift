// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatRoomMember: Codable, Equatable, Sendable {
    public var userId: String
    public var displayName: String?

    public init(userId: String, displayName: String? = nil) {
        self.userId = userId
        self.displayName = displayName
    }
}
