// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthleteTrackPoint: Codable, Equatable, Sendable {
    public var recordedAt: String
    public var latitude: Double
    public var longitude: Double

    public init(recordedAt: String, latitude: Double, longitude: Double) {
        self.recordedAt = recordedAt
        self.latitude = latitude
        self.longitude = longitude
    }
}
