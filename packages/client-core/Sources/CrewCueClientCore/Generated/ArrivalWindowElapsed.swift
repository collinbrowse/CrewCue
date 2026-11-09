// Generated from packages/contracts. Do not edit.
import Foundation

public struct ArrivalWindowElapsed: Codable, Equatable, Sendable {
    public var earliestElapsedSeconds: Double
    public var latestElapsedSeconds: Double

    public init(earliestElapsedSeconds: Double, latestElapsedSeconds: Double) {
        self.earliestElapsedSeconds = earliestElapsedSeconds
        self.latestElapsedSeconds = latestElapsedSeconds
    }
}
