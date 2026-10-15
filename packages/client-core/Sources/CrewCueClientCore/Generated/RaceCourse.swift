// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceCourse: Codable, Equatable, Sendable {
    public var checkpoints: [RaceCourseCheckpoint]
    public var baselineTrack: RaceCourseBaselineTrack?
    public var derivedMetrics: RaceCourseDerivedMetrics?

    public init(checkpoints: [RaceCourseCheckpoint], baselineTrack: RaceCourseBaselineTrack? = nil, derivedMetrics: RaceCourseDerivedMetrics? = nil) {
        self.checkpoints = checkpoints
        self.baselineTrack = baselineTrack
        self.derivedMetrics = derivedMetrics
    }
}
