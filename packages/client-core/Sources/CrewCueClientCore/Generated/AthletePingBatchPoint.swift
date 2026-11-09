// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthletePingBatchPoint: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var recordedAt: String
    public var horizontalAccuracyMeters: Double?

    public init(latitude: Double, longitude: Double, recordedAt: String, horizontalAccuracyMeters: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.recordedAt = recordedAt
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
    }
}
