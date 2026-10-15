package com.crewcue.android.session

import android.content.Intent
import android.os.Bundle

data class DevSessionRequest(
    val userId: String,
    val role: String,
    val token: String,
    val displayName: String?,
    val roomId: String?
)

object DevSession {
    fun parse(intent: Intent?): DevSessionRequest? {
        val extras = intent?.extras
        if (extras != null && flag(extras)) {
            return DevSessionRequest(
                userId = extras.getString("userId").orEmpty(),
                role = extras.getString("role").orEmpty(),
                token = extras.getString("token").orEmpty(),
                displayName = extras.getString("displayName"),
                roomId = extras.getString("roomId")?.trim()?.ifBlank { null }
            )
        }
        val uri = intent?.data ?: return null
        if (uri.getQueryParameter("devSession") != "1") return null
        return DevSessionRequest(
            userId = uri.getQueryParameter("userId").orEmpty(),
            role = uri.getQueryParameter("role").orEmpty(),
            token = uri.getQueryParameter("token").orEmpty(),
            displayName = uri.getQueryParameter("displayName"),
            roomId = uri.getQueryParameter("roomId")?.trim()?.ifBlank { null }
        )
    }

    private fun flag(extras: Bundle): Boolean {
        if (!extras.containsKey("devSession")) return false
        val asString = extras.getString("devSession")
        if (asString != null) {
            return asString == "1" || asString.equals("true", ignoreCase = true)
        }
        if (extras.getBoolean("devSession", false)) return true
        return extras.getInt("devSession", 0) == 1
    }
}
