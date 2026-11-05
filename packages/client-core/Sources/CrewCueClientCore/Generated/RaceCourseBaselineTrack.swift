// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourseBaselineTrack: Codable, Equatable, Sendable {
    public var points: [RaceCourseBaselinePoint]
    public var planLogSigma: Double?
    public var planProfileBranch: String?

    public init(points: [RaceCourseBaselinePoint], planLogSigma: Double? = nil, planProfileBranch: String? = nil) {
        self.points = points
        self.planLogSigma = planLogSigma
        self.planProfileBranch = planProfileBranch
    }
}
