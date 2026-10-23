// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomJoinPreviewMember: Codable, Equatable, Sendable {
    public var displayName: String
    public var role: String

    public init(displayName: String, role: String) {
        self.displayName = displayName
        self.role = role
    }
}
