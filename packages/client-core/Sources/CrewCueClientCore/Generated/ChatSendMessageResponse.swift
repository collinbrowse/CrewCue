// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatSendMessageResponse: Codable, Equatable, Sendable {
    public var message: ChatMessage
    public var duplicate: Bool

    public init(message: ChatMessage, duplicate: Bool) {
        self.message = message
        self.duplicate = duplicate
    }
}
