// Generated from packages/contracts. Do not edit.
import Foundation

public struct CrewScheduleSheet: Codable, Equatable, Sendable {
    public var roomId: String
    public var raceStartAt: String
    public var stops: [ScheduleStop]
    public var pacingEstimateId: String?

    public init(roomId: String, raceStartAt: String, stops: [ScheduleStop], pacingEstimateId: String? = nil) {
        self.roomId = roomId
        self.raceStartAt = raceStartAt
        self.stops = stops
        self.pacingEstimateId = pacingEstimateId
    }
}
