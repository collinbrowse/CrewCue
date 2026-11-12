// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatMessagePage: Codable, Equatable, Sendable {
    public var messages: [ChatMessage]
    public var members: [ChatRoomMember]
    public var selfUserId: String
    public var olderCursor: String?
    public var latestCursor: String

    public init(messages: [ChatMessage], members: [ChatRoomMember], selfUserId: String, olderCursor: String? = nil, latestCursor: String) {
        self.messages = messages
        self.members = members
        self.selfUserId = selfUserId
        self.olderCursor = olderCursor
        self.latestCursor = latestCursor
    }
}
