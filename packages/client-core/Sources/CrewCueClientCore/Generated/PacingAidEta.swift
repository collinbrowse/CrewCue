// Generated from packages/contracts. Do not edit.
import Foundation

public struct PacingAidEta: Codable, Equatable, Sendable {
    public var checkpointId: String
    public var clockArrivalAt: String
    public var elapsedSeconds: Double

    public init(checkpointId: String, clockArrivalAt: String, elapsedSeconds: Double) {
        self.checkpointId = checkpointId
        self.clockArrivalAt = clockArrivalAt
        self.elapsedSeconds = elapsedSeconds
    }
}
