// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomJoinPreview: Codable, Equatable, Sendable {
    public var roomName: String
    public var joinCode: String
    public var status: String
    public var memberCount: Double
    public var members: [RaceRoomJoinPreviewMember]
    public var courseDistanceMeters: Double?
    public var courseElevationGainMeters: Double?
    public var plannedPaceSecondsPerKm: Double?
    public var courseFileName: String?
    public var baselineTrack: RaceCourseBaselineTrack?
    public var checkpoints: [RaceRoomJoinPreviewCheckpoint]?

    public init(roomName: String, joinCode: String, status: String, memberCount: Double, members: [RaceRoomJoinPreviewMember], courseDistanceMeters: Double? = nil, courseElevationGainMeters: Double? = nil, plannedPaceSecondsPerKm: Double? = nil, courseFileName: String? = nil, baselineTrack: RaceCourseBaselineTrack? = nil, checkpoints: [RaceRoomJoinPreviewCheckpoint]? = nil) {
        self.roomName = roomName
        self.joinCode = joinCode
        self.status = status
        self.memberCount = memberCount
        self.members = members
        self.courseDistanceMeters = courseDistanceMeters
        self.courseElevationGainMeters = courseElevationGainMeters
        self.plannedPaceSecondsPerKm = plannedPaceSecondsPerKm
        self.courseFileName = courseFileName
        self.baselineTrack = baselineTrack
        self.checkpoints = checkpoints
    }
}
