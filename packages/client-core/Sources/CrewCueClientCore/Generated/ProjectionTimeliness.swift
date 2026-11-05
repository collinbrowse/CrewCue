// Generated from packages/contracts. Do not edit.
import Foundation

public struct ProjectionTimeliness: Codable, Equatable, Sendable {
    public var projectionConfidence: String
    public var stalenessThresholdSeconds: Double
    public var secondsSinceLastAcceptedPing: Double
    public var evaluatedAt: String

    public init(projectionConfidence: String, stalenessThresholdSeconds: Double, secondsSinceLastAcceptedPing: Double, evaluatedAt: String) {
        self.projectionConfidence = projectionConfidence
        self.stalenessThresholdSeconds = stalenessThresholdSeconds
        self.secondsSinceLastAcceptedPing = secondsSinceLastAcceptedPing
        self.evaluatedAt = evaluatedAt
    }
}
