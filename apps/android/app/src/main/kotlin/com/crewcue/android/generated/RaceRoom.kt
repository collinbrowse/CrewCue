package com.crewcue.android.generated

data class RaceRoom(
    val id: String,
    val joinCode: String? = null,
    val creatorName: String? = null,
    val description: String? = null,
    val crewName: String? = null,
    val teamId: String,
    val athleteId: String,
    val name: String,
    val status: String,
    val createdAt: String,
    val raceStartAt: String? = null,
    val activatedAt: String? = null,
    val eventEndsAt: String? = null,
    val memberships: List<RaceRoomMembership>,
    val entitlement: RaceRoomEntitlement,
    val course: RaceCourse? = null,
    val courseDistanceMeters: Double? = null,
    val courseElevationGainMeters: Double? = null,
    val courseElevationLossMeters: Double? = null,
    val courseFileName: String? = null,
    val plannedPaceSecondsPerKm: Double? = null,
    val pacingEstimateId: String? = null,
    val pacingEstimate: PacingEstimate? = null
)
