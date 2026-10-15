package com.crewcue.android.di

import android.content.Context
import com.crewcue.android.ClientCoreBridge
import com.crewcue.android.auth.Auth0SdkGateway
import com.crewcue.android.auth.AuthConfig
import com.crewcue.android.auth.AuthGateway
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import org.json.JSONObject

class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    val logger = AndroidLogger()
    val sessionStore = SessionStore(appContext)
    val authConfig = AuthConfig.load(appContext)
    val authGateway: AuthGateway = Auth0SdkGateway(authConfig)
    val raceDay = RaceDayBridge(authConfig.apiBaseUrl, sessionStore, logger)

    fun featureScreenJson(url: String): String {
        logger.log(url)
        val fromRuntime = runCatching { featureScreenFromRuntime(url) }.getOrNull()
        if (!fromRuntime.isNullOrBlank()) return fromRuntime
        return runCatching { ClientCoreBridge.featureScreenJsonForUrl(url) }
            .getOrElse {
                logger.log("feature screen fallback: ${it.message}")
                FALLBACK_SCREEN
            }
    }

    private fun featureScreenFromRuntime(url: String): String? {
        val request = JSONObject()
            .put("op", "featureScreen")
            .put("url", url)
            .toString()
        val raw = ClientCoreBridge.runtimeJson(request)
        val obj = JSONObject(raw)
        if (!obj.optBoolean("ok")) return null
        return when (val result = obj.opt("result")) {
            is String -> result.takeIf { it.contains("featureId") }
            is JSONObject -> result.toString().takeIf { it.contains("featureId") }
            else -> null
        }
    }

    private companion object {
        const val FALLBACK_SCREEN =
            """{"featureId":"hello","accessibilityIdentifier":"crewcue.hello","title":"CrewCue","body":""}"""
    }
}
