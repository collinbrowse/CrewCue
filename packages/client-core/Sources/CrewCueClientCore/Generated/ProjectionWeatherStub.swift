// Generated from packages/contracts. Do not edit.
import Foundation

public struct ProjectionWeatherStub: Codable, Equatable, Sendable {
    public var source: String
    public var summary: String
    public var assumedHeadwindMps: Double

    public init(source: String, summary: String, assumedHeadwindMps: Double) {
        self.source = source
        self.summary = summary
        self.assumedHeadwindMps = assumedHeadwindMps
    }
}
