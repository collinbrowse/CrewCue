// Generated from packages/contracts. Do not edit.
import Foundation

public struct CrewLimitReachedError: Codable, Equatable, Sendable {
    public var error: String
    public var code: String
    public var roomId: String
    public var crewLimit: Double
    public var crewCount: Double
    public var upgradeProductId: String

    public init(error: String, code: String, roomId: String, crewLimit: Double, crewCount: Double, upgradeProductId: String) {
        self.error = error
        self.code = code
        self.roomId = roomId
        self.crewLimit = crewLimit
        self.crewCount = crewCount
        self.upgradeProductId = upgradeProductId
    }
}
