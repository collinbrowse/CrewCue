package com.crewcue.android.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthConfigTest {
    private fun release(apiBaseUrl: String, clientId: String = "client") = AuthConfig.release(
        domain = "https://crewcue.us.auth0.com/",
        clientId = clientId,
        audience = "https://api.crewcue.app",
        apiBaseUrl = apiBaseUrl
    )

    @Test
    fun releaseWithHttpsApiAndAuth0IsReady() {
        val config = release("https://api.crewcue.app/")

        assertNull(config.problem)
        assertEquals("https://api.crewcue.app", config.apiBaseUrl)
        assertEquals("crewcue.us.auth0.com", config.domain)
    }

    @Test
    fun releaseNeverFallsBackToTheEmulatorHost() {
        val config = release("")

        assertEquals("", config.apiBaseUrl)
        assertEquals("This build has no server address.", config.problem)
    }

    @Test
    fun releaseRejectsCleartextAndLoopbackHosts() {
        assertEquals("This build has no server address.", release("http://api.crewcue.app").problem)
        assertEquals("This build has no server address.", release("https://10.0.2.2:3000").problem)
        assertEquals("This build has no server address.", release("https://localhost").problem)
    }

    @Test
    fun releaseWithoutAuth0SaysSignInIsMissing() {
        assertEquals("This build has no sign-in settings.", release("https://api.crewcue.app", clientId = " ").problem)
    }

    @Test
    fun debugKeepsTheLocalApiFallback() {
        val config = AuthConfig.debug(domain = "", clientId = "", audience = "", apiBaseUrl = " ")

        assertEquals("http://10.0.2.2:3000", config.apiBaseUrl)
        assertNull(config.problem)
    }

    @Test
    fun releaseUrlRule() {
        assertTrue(AuthConfig.isReleaseApiUrl("https://crewcue-staging.up.railway.app"))
        assertFalse(AuthConfig.isReleaseApiUrl("https://127.0.0.1:3000"))
        assertFalse(AuthConfig.isReleaseApiUrl("https://"))
    }
}
