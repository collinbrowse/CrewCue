// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourseCheckpoint: Codable, Equatable, Sendable {
    public var id: String
    public var title: String?
    public var latitude: Double
    public var longitude: Double
    public var distanceMetersFromStart: Double?
    public var plannedStopSeconds: Double?
    public var stoppageRadiusMeters: Double?
    public var slowdownThresholdRatio: Double?
    public var tags: [String]?

    public init(id: String, title: String? = nil, latitude: Double, longitude: Double, distanceMetersFromStart: Double? = nil, plannedStopSeconds: Double? = nil, stoppageRadiusMeters: Double? = nil, slowdownThresholdRatio: Double? = nil, tags: [String]? = nil) {
        self.id = id
        self.title = title
        self.latitude = latitude
        self.longitude = longitude
        self.distanceMetersFromStart = distanceMetersFromStart
        self.plannedStopSeconds = plannedStopSeconds
        self.stoppageRadiusMeters = stoppageRadiusMeters
        self.slowdownThresholdRatio = slowdownThresholdRatio
        self.tags = tags
    }
}
