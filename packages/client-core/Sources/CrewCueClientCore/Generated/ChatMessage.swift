// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatMessage: Codable, Equatable, Sendable {
    public var id: String
    public var roomId: String
    public var senderUserId: String
    public var clientMessageId: String
    public var text: String
    public var photo: ChatMessagePhoto?
    public var createdAt: String

    public init(id: String, roomId: String, senderUserId: String, clientMessageId: String, text: String, photo: ChatMessagePhoto? = nil, createdAt: String) {
        self.id = id
        self.roomId = roomId
        self.senderUserId = senderUserId
        self.clientMessageId = clientMessageId
        self.text = text
        self.photo = photo
        self.createdAt = createdAt
    }
}
