// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomPingTrackResponse: Codable, Equatable, Sendable {
    public var roomId: String
    public var points: [AthleteTrackPoint]
    public var nextCursor: String?

    public init(roomId: String, points: [AthleteTrackPoint], nextCursor: String? = nil) {
        self.roomId = roomId
        self.points = points
        self.nextCursor = nextCursor
    }
}
