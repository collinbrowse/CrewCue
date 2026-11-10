package com.crewcue.android.generated

data class CrewLimitReachedError(
    val error: String,
    val code: String,
    val roomId: String,
    val crewLimit: Double,
    val crewCount: Double,
    val upgradeProductId: String
)
