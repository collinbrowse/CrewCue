// Generated from packages/contracts. Do not edit.
import Foundation

public struct AthletePingIngestPayload: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var recordedAt: String
    public var horizontalAccuracyMeters: Double?
    public var uploadIntervalSeconds: Double?

    public init(latitude: Double, longitude: Double, recordedAt: String, horizontalAccuracyMeters: Double? = nil, uploadIntervalSeconds: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.recordedAt = recordedAt
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.uploadIntervalSeconds = uploadIntervalSeconds
    }
}
