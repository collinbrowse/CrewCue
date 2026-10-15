package com.crewcue.android.generated

data class PacingEstimate(
    val id: String,
    val coldStart: Boolean,
    val expectedFinishAt: String,
    val expectedFinishElapsedSeconds: Double,
    val aidEtas: List<PacingAidEta>,
    val explanation: String,
    val historyRefIds: List<String>? = null
)
