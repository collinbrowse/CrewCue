package com.crewcue.android.generated

data class RaceCourseCheckpoint(
    val id: String,
    val title: String? = null,
    val latitude: Double,
    val longitude: Double,
    val distanceMetersFromStart: Double? = null,
    val plannedStopSeconds: Double? = null,
    val stoppageRadiusMeters: Double? = null,
    val slowdownThresholdRatio: Double? = null,
    val tags: List<String>? = null
)
