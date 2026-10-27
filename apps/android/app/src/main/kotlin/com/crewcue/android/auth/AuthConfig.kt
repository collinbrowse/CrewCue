package com.crewcue.android.auth

import android.content.Context
import com.crewcue.android.BuildConfig
import com.crewcue.android.R

data class AuthConfig(
    val domain: String,
    val clientId: String,
    val audience: String,
    val apiBaseUrl: String,
    /** Why this build can't reach its API or Auth0. Release builds show it instead of the app. */
    val problem: String? = null
) {
    val isConfigured: Boolean = domain.isNotBlank() && clientId.isNotBlank()

    companion object {
        /** Emulator loopback to the host machine. Debug builds only, when no API URL is configured. */
        private const val EMULATOR_HOST_API_BASE_URL = "http://10.0.2.2:3000"

        fun load(context: Context): AuthConfig {
            if (!BuildConfig.DEBUG) {
                // Release values come only from the build (release.yml), never from dev resources.
                return release(
                    domain = BuildConfig.crewcue_auth0_domain,
                    clientId = BuildConfig.crewcue_auth0_client_id,
                    audience = BuildConfig.crewcue_auth0_audience,
                    apiBaseUrl = BuildConfig.crewcue_api_base_url
                )
            }
            return debug(
                domain = pick(context, R.string.crewcue_auth0_domain, BuildConfig.crewcue_auth0_domain),
                clientId = pick(context, R.string.crewcue_auth0_client_id, BuildConfig.crewcue_auth0_client_id),
                audience = pick(context, R.string.crewcue_auth0_audience, BuildConfig.crewcue_auth0_audience),
                apiBaseUrl = pick(context, R.string.crewcue_api_base_url, BuildConfig.crewcue_api_base_url)
            )
        }

        fun debug(domain: String, clientId: String, audience: String, apiBaseUrl: String): AuthConfig {
            return AuthConfig(
                domain = normalizeDomain(domain),
                clientId = clientId.trim(),
                audience = audience.trim(),
                apiBaseUrl = normalizeUrl(apiBaseUrl).ifBlank { EMULATOR_HOST_API_BASE_URL }
            )
        }

        /** No localhost fallback: a release build without an https API says so on screen. */
        fun release(domain: String, clientId: String, audience: String, apiBaseUrl: String): AuthConfig {
            val url = normalizeUrl(apiBaseUrl)
            val config = AuthConfig(
                domain = normalizeDomain(domain),
                clientId = clientId.trim(),
                audience = audience.trim(),
                apiBaseUrl = url
            )
            val problem = when {
                !isReleaseApiUrl(url) -> "This build has no server address."
                !config.isConfigured || config.audience.isBlank() -> "This build has no sign-in settings."
                else -> null
            }
            return config.copy(problem = problem)
        }

        /** https and not a loopback or emulator host. The Gradle release check uses the same rule. */
        fun isReleaseApiUrl(url: String): Boolean {
            if (!url.startsWith("https://")) return false
            val host = url.removePrefix("https://").substringBefore('/').substringBefore(':').lowercase()
            return host.isNotBlank() && host !in LOCAL_HOSTS
        }

        private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2", "0.0.0.0")

        private fun pick(context: Context, resource: Int, buildValue: String): String {
            val fromResource = context.getString(resource).trim()
            return fromResource.ifBlank { buildValue.trim() }
        }

        private fun normalizeUrl(value: String): String = value.trim().trimEnd('/')

        private fun normalizeDomain(value: String): String {
            return value
                .trim()
                .removePrefix("https://")
                .removePrefix("http://")
                .trimEnd('/')
        }
    }
}
