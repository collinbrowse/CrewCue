package com.crewcue.android.crash

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashScrubTest {
    @Test
    fun ec1_debugOrMissingDsnNeverStarts() {
        assertFalse(CrashReporting.shouldStart(debug = true, dsn = "https://k@o0.ingest.sentry.io/1"))
        assertFalse(CrashReporting.shouldStart(debug = false, dsn = ""))
        assertFalse(CrashReporting.shouldStart(debug = false, dsn = "  "))
        assertFalse(CrashReporting.shouldStart(debug = false, dsn = "not a dsn"))
        assertTrue(CrashReporting.shouldStart(debug = false, dsn = "https://k@o0.ingest.sentry.io/1"))
    }

    @Test
    fun ec7_textDropsTokensEmailsCoordinatesAndQueries() {
        assertEquals("Bearer [Filtered]", CrashScrub.text("Bearer abc.def.ghi"))
        assertEquals("jwt [Filtered]", CrashScrub.text("jwt eyJhbGciOiJI.eyJzdWIiOiIx.sig"))
        assertEquals("mail [Filtered] now", CrashScrub.text("mail a.b+c@example.co.uk now"))
        assertEquals("at [Filtered]", CrashScrub.text("at 39.739236, -104.990251"))
        assertEquals("GET /geocode", CrashScrub.text("GET /geocode?q=home"))
        assertEquals("mile 12.5 of 100", CrashScrub.text("mile 12.5 of 100"))
    }

    @Test
    fun ec7_mapFiltersSensitiveKeysAndUrls() {
        val out = CrashScrub.map(
            mapOf(
                "url" to "https://api.example/race-rooms/r1/pings?token=t",
                "method" to "POST",
                "accessToken" to "t",
                "lat" to 39.7,
                "lng" to -104.9,
                "status_code" to 500,
                "nested" to mapOf("email" to "x@y.io", "mile" to 12),
            ),
        )
        assertEquals("https://api.example/race-rooms/r1/pings", out["url"])
        assertEquals("POST", out["method"])
        assertEquals(CrashScrub.FILTERED, out["accessToken"])
        assertEquals(CrashScrub.FILTERED, out["lat"])
        assertEquals(CrashScrub.FILTERED, out["lng"])
        assertEquals(500, out["status_code"])
        assertEquals(mapOf("email" to CrashScrub.FILTERED, "mile" to 12), out["nested"])
    }
}
