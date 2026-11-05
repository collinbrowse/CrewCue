// Generated from packages/contracts. Do not edit.
import Foundation

public struct ArrivalWindowClock: Codable, Equatable, Sendable {
    public var earliestIso: String
    public var latestIso: String

    public init(earliestIso: String, latestIso: String) {
        self.earliestIso = earliestIso
        self.latestIso = latestIso
    }
}
