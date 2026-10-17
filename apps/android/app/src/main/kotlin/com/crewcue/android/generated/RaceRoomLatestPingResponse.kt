package com.crewcue.android.generated

data class RaceRoomLatestPingResponse(
    val roomId: String,
    val ping: AthleteLatestPing? = null,
    val stalenessThresholdSeconds: Double,
    val evaluatedAt: String
)
