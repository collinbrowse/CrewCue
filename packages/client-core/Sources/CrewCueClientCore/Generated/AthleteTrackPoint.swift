// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthleteTrackPoint: Codable, Equatable, Sendable {
    public var recordedAt: String
    public var latitude: Double
    public var longitude: Double
    public var preStart: Bool?

    public init(recordedAt: String, latitude: Double, longitude: Double, preStart: Bool? = nil) {
        self.recordedAt = recordedAt
        self.latitude = latitude
        self.longitude = longitude
        self.preStart = preStart
    }
}
