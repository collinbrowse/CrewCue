// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomBilling: Codable, Equatable, Sendable {
    public var roomId: String
    public var entitlement: RaceRoomEntitlement
    public var crewCount: Double
    public var crewLimit: Double?
    public var offers: [String]

    public init(roomId: String, entitlement: RaceRoomEntitlement, crewCount: Double, crewLimit: Double? = nil, offers: [String]) {
        self.roomId = roomId
        self.entitlement = entitlement
        self.crewCount = crewCount
        self.crewLimit = crewLimit
        self.offers = offers
    }
}
