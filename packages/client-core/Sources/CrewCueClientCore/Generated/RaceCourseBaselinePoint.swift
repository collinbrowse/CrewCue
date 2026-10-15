// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourseBaselinePoint: Codable, Equatable, Sendable {
    public var distanceMetersFromStart: Double
    public var referenceElapsedSeconds: Double
    public var elevationMeters: Double?

    public init(distanceMetersFromStart: Double, referenceElapsedSeconds: Double, elevationMeters: Double? = nil) {
        self.distanceMetersFromStart = distanceMetersFromStart
        self.referenceElapsedSeconds = referenceElapsedSeconds
        self.elevationMeters = elevationMeters
    }
}
