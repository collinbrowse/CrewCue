// Generated from packages/contracts. Do not edit.
import Foundation

public struct PacingTimePoint: Codable, Equatable, Sendable {
    public var finishAt: String
    public var finishElapsedSeconds: Double

    public init(finishAt: String, finishElapsedSeconds: Double) {
        self.finishAt = finishAt
        self.finishElapsedSeconds = finishElapsedSeconds
    }
}
