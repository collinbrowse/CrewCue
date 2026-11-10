// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatMessagePhoto: Codable, Equatable, Sendable {
    public var url: String
    public var contentType: String
    public var byteSize: Double

    public init(url: String, contentType: String, byteSize: Double) {
        self.url = url
        self.contentType = contentType
        self.byteSize = byteSize
    }
}
