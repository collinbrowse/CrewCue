package com.crewcue.android.generated

data class ScheduleStop(
    val id: String,
    val checkpointId: String,
    val clockArrivalAt: String,
    val elapsedSeconds: Double,
    val movingElapsedSeconds: Double? = null,
    val plannedStoppageSeconds: Double,
    val delayOverrideSeconds: Double? = null,
    val notes: ScheduleStopNotesRef? = null,
    val cutoffStatus: String? = null,
    val cutoffMarginSeconds: Double? = null
)
