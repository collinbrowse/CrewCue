// Generated from packages/contracts. Do not edit.
import Foundation

public struct RaceRoomProjectionCore: Codable, Equatable, Sendable {
    public var roomId: String
    public var asOfPingId: String
    public var asOfRecordedAt: String
    public var progressMeters: Double
    public var courseLengthMeters: Double
    public var plannedPaceSecondsPerKm: Double
    public var etaFinishPlanIso: String
    public var checkpointSplits: [RaceCheckpointSplitRow]
    public var stoppageSummary: CheckpointStoppageSummary
    public var weatherStub: ProjectionWeatherStub?
    public var remainingCheckpointEtas: [RemainingCheckpointEta]?

    public init(roomId: String, asOfPingId: String, asOfRecordedAt: String, progressMeters: Double, courseLengthMeters: Double, plannedPaceSecondsPerKm: Double, etaFinishPlanIso: String, checkpointSplits: [RaceCheckpointSplitRow], stoppageSummary: CheckpointStoppageSummary, weatherStub: ProjectionWeatherStub? = nil, remainingCheckpointEtas: [RemainingCheckpointEta]? = nil) {
        self.roomId = roomId
        self.asOfPingId = asOfPingId
        self.asOfRecordedAt = asOfRecordedAt
        self.progressMeters = progressMeters
        self.courseLengthMeters = courseLengthMeters
        self.plannedPaceSecondsPerKm = plannedPaceSecondsPerKm
        self.etaFinishPlanIso = etaFinishPlanIso
        self.checkpointSplits = checkpointSplits
        self.stoppageSummary = stoppageSummary
        self.weatherStub = weatherStub
        self.remainingCheckpointEtas = remainingCheckpointEtas
    }
}
