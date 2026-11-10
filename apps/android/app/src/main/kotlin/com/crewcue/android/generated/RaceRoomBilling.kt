package com.crewcue.android.generated

data class RaceRoomBilling(
    val roomId: String,
    val entitlement: RaceRoomEntitlement,
    val crewCount: Double,
    val crewLimit: Double? = null,
    val offers: List<String>
)
