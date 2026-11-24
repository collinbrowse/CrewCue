package com.crewcue.android.auth

import android.app.Activity

sealed interface AuthResult {
    data class Success(
        val userId: String,
        val displayName: String?,
        val accessToken: String
    ) : AuthResult

    /** [canceled]: the person closed the sign-in page. */
    data class Failure(val message: String, val offline: Boolean, val canceled: Boolean = false) : AuthResult
}

interface AuthGateway {
    val isConfigured: Boolean
    fun signIn(activity: Activity, connection: String?, signUp: Boolean, callback: (AuthResult) -> Unit)
    fun signOut(activity: Activity, callback: () -> Unit)
}
