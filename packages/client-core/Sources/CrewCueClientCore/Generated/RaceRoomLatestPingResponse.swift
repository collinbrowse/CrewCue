// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomLatestPingResponse: Codable, Equatable, Sendable {
    public var roomId: String
    public var ping: AthleteLatestPing?
    public var stalenessThresholdSeconds: Double
    public var evaluatedAt: String

    public init(roomId: String, ping: AthleteLatestPing? = nil, stalenessThresholdSeconds: Double, evaluatedAt: String) {
        self.roomId = roomId
        self.ping = ping
        self.stalenessThresholdSeconds = stalenessThresholdSeconds
        self.evaluatedAt = evaluatedAt
    }
}
