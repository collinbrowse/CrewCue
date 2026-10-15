package com.crewcue.android.auth

import android.content.Context
import com.crewcue.android.BuildConfig
import com.crewcue.android.R

data class AuthConfig(
    val domain: String,
    val clientId: String,
    val audience: String,
    val apiBaseUrl: String
) {
    val isConfigured: Boolean = domain.isNotBlank() && clientId.isNotBlank()

    companion object {
        /** Emulator loopback to the host machine. Used only when no API URL is configured. */
        private const val EMULATOR_HOST_API_BASE_URL = "http://10.0.2.2:3000"

        fun load(context: Context): AuthConfig {
            return AuthConfig(
                domain = normalizeDomain(pick(context, R.string.crewcue_auth0_domain, BuildConfig.crewcue_auth0_domain)),
                clientId = pick(context, R.string.crewcue_auth0_client_id, BuildConfig.crewcue_auth0_client_id),
                audience = pick(context, R.string.crewcue_auth0_audience, BuildConfig.crewcue_auth0_audience),
                apiBaseUrl = apiBaseUrl(context)
            )
        }

        private fun apiBaseUrl(context: Context): String {
            val configured = pick(context, R.string.crewcue_api_base_url, BuildConfig.crewcue_api_base_url)
                .trim()
                .trimEnd('/')
            return configured.ifBlank { EMULATOR_HOST_API_BASE_URL }
        }

        private fun pick(context: Context, resource: Int, buildValue: String): String {
            val fromResource = context.getString(resource).trim()
            return fromResource.ifBlank { buildValue.trim() }
        }

        private fun normalizeDomain(value: String): String {
            return value
                .removePrefix("https://")
                .removePrefix("http://")
                .trimEnd('/')
        }
    }
}
