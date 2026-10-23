// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatStreamMember: Codable, Equatable, Sendable {
    public var streamUserId: String
    public var displayName: String?

    public init(streamUserId: String, displayName: String? = nil) {
        self.streamUserId = streamUserId
        self.displayName = displayName
    }
}
