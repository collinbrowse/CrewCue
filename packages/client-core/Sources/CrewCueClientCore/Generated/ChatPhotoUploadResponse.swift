// Generated from packages/contracts. Do not edit.
import Foundation

public struct ChatPhotoUploadResponse: Codable, Equatable, Sendable {
    public var photoKey: String
    public var contentType: String
    public var byteSize: Double

    public init(photoKey: String, contentType: String, byteSize: Double) {
        self.photoKey = photoKey
        self.contentType = contentType
        self.byteSize = byteSize
    }
}
