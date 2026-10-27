// Generated from packages/contracts. Do not edit.
import Foundation

public struct IncidentEvent: Codable, Equatable, Sendable {
    public var id: String
    public var roomId: String
    public var category: String
    public var severity: String
    public var checkpointId: String?
    public var summary: String
    public var details: String?
    public var reportedByUserId: String
    public var recordedAt: String

    public init(id: String, roomId: String, category: String, severity: String, checkpointId: String? = nil, summary: String, details: String? = nil, reportedByUserId: String, recordedAt: String) {
        self.id = id
        self.roomId = roomId
        self.category = category
        self.severity = severity
        self.checkpointId = checkpointId
        self.summary = summary
        self.details = details
        self.reportedByUserId = reportedByUserId
        self.recordedAt = recordedAt
    }
}
