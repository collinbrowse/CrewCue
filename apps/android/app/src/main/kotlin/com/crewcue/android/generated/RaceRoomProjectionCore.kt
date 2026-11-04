package com.crewcue.android.generated

data class RaceRoomProjectionCore(
    val roomId: String,
    val asOfPingId: String,
    val asOfRecordedAt: String,
    val progressMeters: Double,
    val courseLengthMeters: Double,
    val plannedPaceSecondsPerKm: Double,
    val etaFinishPlanIso: String,
    val checkpointSplits: List<RaceCheckpointSplitRow>,
    val stoppageSummary: CheckpointStoppageSummary,
    val weatherStub: ProjectionWeatherStub? = null,
    val remainingCheckpointEtas: List<RemainingCheckpointEta>? = null
)
