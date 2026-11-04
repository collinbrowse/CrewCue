// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourseBaselineTrack: Codable, Equatable, Sendable {
    public var points: [RaceCourseBaselinePoint]
    public var planLogSigma: Double?

    public init(points: [RaceCourseBaselinePoint], planLogSigma: Double? = nil) {
        self.points = points
        self.planLogSigma = planLogSigma
    }
}
