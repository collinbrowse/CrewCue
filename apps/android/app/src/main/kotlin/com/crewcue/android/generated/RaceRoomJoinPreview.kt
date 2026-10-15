package com.crewcue.android.generated

data class RaceRoomJoinPreview(
    val roomName: String,
    val joinCode: String,
    val status: String,
    val memberCount: Double,
    val members: List<RaceRoomJoinPreviewMember>,
    val courseDistanceMeters: Double? = null,
    val courseElevationGainMeters: Double? = null,
    val plannedPaceSecondsPerKm: Double? = null,
    val courseFileName: String? = null,
    val baselineTrack: RaceCourseBaselineTrack? = null,
    val checkpoints: List<RaceRoomJoinPreviewCheckpoint>? = null
)
