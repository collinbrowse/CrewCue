// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoom: Codable, Equatable, Sendable {
    public var id: String
    public var joinCode: String?
    public var creatorName: String?
    public var description: String?
    public var crewName: String?
    public var teamId: String
    public var athleteId: String
    public var name: String
    public var status: String
    public var createdAt: String
    public var raceStartAt: String?
    public var activatedAt: String?
    public var eventEndsAt: String?
    public var memberships: [RaceRoomMembership]
    public var entitlement: RaceRoomEntitlement
    public var course: RaceCourse?
    public var courseDistanceMeters: Double?
    public var courseElevationGainMeters: Double?
    public var courseElevationLossMeters: Double?
    public var courseFileName: String?
    public var plannedPaceSecondsPerKm: Double?
    public var pacingEstimateId: String?
    public var pacingEstimate: PacingEstimate?

    public init(id: String, joinCode: String? = nil, creatorName: String? = nil, description: String? = nil, crewName: String? = nil, teamId: String, athleteId: String, name: String, status: String, createdAt: String, raceStartAt: String? = nil, activatedAt: String? = nil, eventEndsAt: String? = nil, memberships: [RaceRoomMembership], entitlement: RaceRoomEntitlement, course: RaceCourse? = nil, courseDistanceMeters: Double? = nil, courseElevationGainMeters: Double? = nil, courseElevationLossMeters: Double? = nil, courseFileName: String? = nil, plannedPaceSecondsPerKm: Double? = nil, pacingEstimateId: String? = nil, pacingEstimate: PacingEstimate? = nil) {
        self.id = id
        self.joinCode = joinCode
        self.creatorName = creatorName
        self.description = description
        self.crewName = crewName
        self.teamId = teamId
        self.athleteId = athleteId
        self.name = name
        self.status = status
        self.createdAt = createdAt
        self.raceStartAt = raceStartAt
        self.activatedAt = activatedAt
        self.eventEndsAt = eventEndsAt
        self.memberships = memberships
        self.entitlement = entitlement
        self.course = course
        self.courseDistanceMeters = courseDistanceMeters
        self.courseElevationGainMeters = courseElevationGainMeters
        self.courseElevationLossMeters = courseElevationLossMeters
        self.courseFileName = courseFileName
        self.plannedPaceSecondsPerKm = plannedPaceSecondsPerKm
        self.pacingEstimateId = pacingEstimateId
        self.pacingEstimate = pacingEstimate
    }
}
