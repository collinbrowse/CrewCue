// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatStreamTokenResponse: Codable, Equatable, Sendable {
    public var token: String
    public var streamUserId: String
    public var streamApiKey: String
    public var members: [ChatStreamMember]?

    public init(token: String, streamUserId: String, streamApiKey: String, members: [ChatStreamMember]? = nil) {
        self.token = token
        self.streamUserId = streamUserId
        self.streamApiKey = streamApiKey
        self.members = members
    }
}
