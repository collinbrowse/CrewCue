package com.crewcue.android.generated

data class RaceCheckpointSplitRow(
    val checkpointId: String,
    val distanceMetersFromStart: Double,
    val crossedAtRecordedAt: String? = null,
    val plannedElapsedSecondsAtCross: Double,
    val plannedAidStationClockIso: String? = null,
    val actualElapsedSecondsAtCross: Double? = null,
    val deltaSecondsAtCross: Double? = null,
    val plannedStopSeconds: Double,
    val visits: List<CheckpointVisit>,
    val totalActualStopSeconds: Double? = null,
    val deltaStopSeconds: Double? = null
)
