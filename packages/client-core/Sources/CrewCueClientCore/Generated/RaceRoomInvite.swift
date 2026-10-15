// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomInvite: Codable, Equatable, Sendable {
    public var token: String
    public var roomId: String
    public var email: String
    public var role: String
    public var expiresAt: String
    public var status: String
    public var invitedBy: String
    public var invitedAt: String
    public var acceptedBy: String?
    public var acceptedAt: String?

    public init(token: String, roomId: String, email: String, role: String, expiresAt: String, status: String, invitedBy: String, invitedAt: String, acceptedBy: String? = nil, acceptedAt: String? = nil) {
        self.token = token
        self.roomId = roomId
        self.email = email
        self.role = role
        self.expiresAt = expiresAt
        self.status = status
        self.invitedBy = invitedBy
        self.invitedAt = invitedAt
        self.acceptedBy = acceptedBy
        self.acceptedAt = acceptedAt
    }
}
