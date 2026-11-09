// Generated from packages/contracts. Do not edit.
import Foundation

public struct AccountDeletionResult: Codable, Equatable, Sendable {
    public var deleted: Bool
    public var roomsClosed: Double
    public var membershipsRemoved: Double
    public var activityHistoryDeleted: Double
    public var pacingEstimatesDeleted: Double
    public var finishedEffortsDeleted: Double
    public var pushDevicesDeleted: Double
    public var chatPrefsDeleted: Double
    public var stravaDisconnected: Bool
    public var identityProvider: String

    public init(deleted: Bool, roomsClosed: Double, membershipsRemoved: Double, activityHistoryDeleted: Double, pacingEstimatesDeleted: Double, finishedEffortsDeleted: Double, pushDevicesDeleted: Double, chatPrefsDeleted: Double, stravaDisconnected: Bool, identityProvider: String) {
        self.deleted = deleted
        self.roomsClosed = roomsClosed
        self.membershipsRemoved = membershipsRemoved
        self.activityHistoryDeleted = activityHistoryDeleted
        self.pacingEstimatesDeleted = pacingEstimatesDeleted
        self.finishedEffortsDeleted = finishedEffortsDeleted
        self.pushDevicesDeleted = pushDevicesDeleted
        self.chatPrefsDeleted = chatPrefsDeleted
        self.stravaDisconnected = stravaDisconnected
        self.identityProvider = identityProvider
    }
}
