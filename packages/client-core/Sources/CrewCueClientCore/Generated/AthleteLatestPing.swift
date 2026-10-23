// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthleteLatestPing: Codable, Equatable, Sendable {
    public var pingId: String
    public var latitude: Double
    public var longitude: Double
    public var recordedAt: String
    public var receivedAt: String
    public var progressMeters: Double?

    public init(pingId: String, latitude: Double, longitude: Double, recordedAt: String, receivedAt: String, progressMeters: Double? = nil) {
        self.pingId = pingId
        self.latitude = latitude
        self.longitude = longitude
        self.recordedAt = recordedAt
        self.receivedAt = receivedAt
        self.progressMeters = progressMeters
    }
}
