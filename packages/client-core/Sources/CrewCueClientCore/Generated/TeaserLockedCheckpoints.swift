// Generated from packages/contracts. Do not edit.
import Foundation

public struct TeaserLockedCheckpoints: Codable, Equatable, Sendable {
    public var checkpointIds: [String]

    public init(checkpointIds: [String]) {
        self.checkpointIds = checkpointIds
    }
}
