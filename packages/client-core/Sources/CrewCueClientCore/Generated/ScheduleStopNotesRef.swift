// Generated from packages/contracts. Do not edit.
import Foundation

public struct ScheduleStopNotesRef: Codable, Equatable, Sendable {
    public var athleteNotesId: String?
    public var planNotesId: String?

    public init(athleteNotesId: String? = nil, planNotesId: String? = nil) {
        self.athleteNotesId = athleteNotesId
        self.planNotesId = planNotesId
    }
}
