package com.crewcue.android.generated

data class RemainingCheckpointEta(
    val checkpointId: String,
    val liveProjectedElapsedSeconds: Double,
    val frozenPlanElapsedSeconds: Double,
    val deltaSecondsVsFrozenPlan: Double,
    val window: ArrivalWindowElapsed? = null
)
