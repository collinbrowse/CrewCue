// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourseDerivedMetrics: Codable, Equatable, Sendable {
    public var canonicalDistanceMeters: Double
    public var elevationGainMeters: Double
    public var elevationLossMeters: Double
    public var elevationSource: String
    public var metricsVersion: Double

    public init(canonicalDistanceMeters: Double, elevationGainMeters: Double, elevationLossMeters: Double, elevationSource: String, metricsVersion: Double) {
        self.canonicalDistanceMeters = canonicalDistanceMeters
        self.elevationGainMeters = elevationGainMeters
        self.elevationLossMeters = elevationLossMeters
        self.elevationSource = elevationSource
        self.metricsVersion = metricsVersion
    }
}
