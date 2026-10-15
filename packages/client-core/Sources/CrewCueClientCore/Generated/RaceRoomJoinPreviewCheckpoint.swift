// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomJoinPreviewCheckpoint: Codable, Equatable, Sendable {
    public var id: String
    public var latitude: Double
    public var longitude: Double
    public var title: String?

    public init(id: String, latitude: Double, longitude: Double, title: String? = nil) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.title = title
    }
}
