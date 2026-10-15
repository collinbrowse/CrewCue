// Generated from packages/contracts. Do not edit.
import Foundation

public struct PacingEstimate: Codable, Equatable, Sendable {
    public var id: String
    public var coldStart: Bool
    public var expectedFinishAt: String
    public var expectedFinishElapsedSeconds: Double
    public var aidEtas: [PacingAidEta]
    public var explanation: String
    public var historyRefIds: [String]?

    public init(id: String, coldStart: Bool, expectedFinishAt: String, expectedFinishElapsedSeconds: Double, aidEtas: [PacingAidEta], explanation: String, historyRefIds: [String]? = nil) {
        self.id = id
        self.coldStart = coldStart
        self.expectedFinishAt = expectedFinishAt
        self.expectedFinishElapsedSeconds = expectedFinishElapsedSeconds
        self.aidEtas = aidEtas
        self.explanation = explanation
        self.historyRefIds = historyRefIds
    }
}
