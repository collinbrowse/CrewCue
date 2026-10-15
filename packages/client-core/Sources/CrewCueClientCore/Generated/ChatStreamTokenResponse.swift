// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatStreamTokenResponse: Codable, Equatable, Sendable {
    public var token: String
    public var streamUserId: String
    public var streamApiKey: String

    public init(token: String, streamUserId: String, streamApiKey: String) {
        self.token = token
        self.streamUserId = streamUserId
        self.streamApiKey = streamApiKey
    }
}
