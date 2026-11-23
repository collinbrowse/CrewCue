package com.crewcue.android.auth

import android.app.Activity
import com.auth0.android.Auth0
import com.auth0.android.authentication.AuthenticationException
import com.auth0.android.callback.Callback
import com.auth0.android.provider.WebAuthProvider
import com.auth0.android.result.Credentials

/**
 * [suggestName] is client-core `SuggestedDisplayName` (`RaceDayBridge.suggestedDisplayName`): an
 * email sign-up's Auth0 `name` is the email and its `nickname` the part before the @, so neither
 * is the name crew see. Only a real name (Google, Apple) reaches the session.
 */
class Auth0SdkGateway(
    private val config: AuthConfig,
    private val suggestName: (name: String?, email: String?) -> String?
) : AuthGateway {
    override val isConfigured: Boolean = config.isConfigured

    override fun signIn(activity: Activity, connection: String?, signUp: Boolean, callback: (AuthResult) -> Unit) {
        if (!config.isConfigured) {
            callback(AuthResult.Failure("Sign-in isn't configured.", offline = false))
            return
        }
        val account = Auth0.getInstance(config.clientId, config.domain)
        val login = WebAuthProvider.login(account)
            .withScheme(SCHEME)
            .withScope("openid profile email")
        if (config.audience.isNotBlank()) {
            login.withAudience(config.audience)
        }
        if (!connection.isNullOrBlank()) {
            login.withConnection(connection)
        }
        if (signUp) {
            login.withParameters(mapOf("screen_hint" to "signup"))
        }
        login.withRedirectUri("$SCHEME://auth")
        login.start(activity, object : Callback<Credentials, AuthenticationException> {
            override fun onFailure(error: AuthenticationException) {
                val offline = error.isNetworkError
                callback(
                    AuthResult.Failure(
                        message = if (offline) "Offline. Can't reach Auth0." else "Sign-in failed.",
                        offline = offline
                    )
                )
            }

            override fun onSuccess(result: Credentials) {
                val profile = runCatching { result.user }.getOrNull()
                val userId = profile?.getId()?.trim().orEmpty().ifBlank { "auth0-user" }
                val name = suggestName(profile?.name, profile?.email)
                callback(
                    AuthResult.Success(
                        userId = userId,
                        displayName = name,
                        accessToken = result.accessToken
                    )
                )
            }
        })
    }

    override fun signOut(activity: Activity, callback: () -> Unit) {
        if (!config.isConfigured) {
            callback()
            return
        }
        val account = Auth0.getInstance(config.clientId, config.domain)
        WebAuthProvider.logout(account)
            .withScheme(SCHEME)
            .start(activity, object : Callback<Void?, AuthenticationException> {
                override fun onFailure(error: AuthenticationException) {
                    callback()
                }

                override fun onSuccess(result: Void?) {
                    callback()
                }
            })
    }

    private companion object {
        const val SCHEME = "crewcue"
    }
}
