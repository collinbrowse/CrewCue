package com.crewcue.android.generated

data class IncidentEvent(
    val id: String,
    val roomId: String,
    val category: String,
    val severity: String,
    val checkpointId: String? = null,
    val summary: String,
    val details: String? = null,
    val reportedByUserId: String,
    val recordedAt: String
)
