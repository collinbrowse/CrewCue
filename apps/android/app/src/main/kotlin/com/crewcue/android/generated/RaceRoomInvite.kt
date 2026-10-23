package com.crewcue.android.generated

data class RaceRoomInvite(
    val token: String,
    val roomId: String,
    val email: String,
    val role: String,
    val expiresAt: String,
    val status: String,
    val invitedBy: String,
    val invitedAt: String,
    val acceptedBy: String? = null,
    val acceptedAt: String? = null
)
