package com.crewcue.android.generated

data class CheckpointVisit(
    val visitIndex: Double,
    val resolvedSource: String,
    val autoDetected: CheckpointVisitAutoData? = null,
    val manualEntry: CheckpointVisitManualData? = null,
    val activeActualStopSeconds: Double? = null,
    val note: String? = null
)
