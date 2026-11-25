package com.crewcue.android.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class AidRequestTest {
    private fun row(id: String, live: String?) = TimelineRow(
        checkpointId = id,
        state = "upcoming",
        kicker = "",
        title = id,
        clockArrivalAt = null,
        cutoffAt = null,
        cutoffStatus = null,
        distanceToLabel = "",
        isFinish = false,
        liveArrivalAt = live
    )

    @Test
    fun liveArrivalsComeFromTheTimelineRowsClientCoreBuilt() {
        val arrivals = AidRequest.liveArrivals(listOf(row("aid-1", null), row("aid-2", "2026-08-15T17:05:00.000Z")))
        assertEquals("2026-08-15T17:05:00.000Z", arrivals.optString("aid-2"))
        assertFalse(arrivals.has("aid-1"))
    }

    @Test
    fun trackCarriesEachPointWithItsTimeOldestFirst() {
        val points = listOf(CoursePoint(40.085, -105.0), CoursePoint(40.09, -105.0), CoursePoint(40.1, -105.0))
        // 2026-08-15T14:20:00Z, then a point with no time, then 14:25:00Z.
        val track = AidRequest.track(points, listOf(1786803600000L, 0L, 1786803900000L))
        assertEquals(2, track.length())
        assertEquals("2026-08-15T14:20:00.000Z", track.getJSONObject(0).getString("recordedAt"))
        assertEquals(40.085, track.getJSONObject(0).getDouble("latitude"), 1e-9)
        assertEquals("2026-08-15T14:25:00.000Z", track.getJSONObject(1).getString("recordedAt"))
    }

    private fun page(id: String, index: Int) = AidPage(
        checkpointId = id,
        index = index,
        title = id,
        kicker = "AHEAD",
        clockLabel = "—",
        remainLabel = "—",
        distanceLabel = "—",
        stoppageLabel = "—",
        delayLabel = null,
        scheduleLine = id
    )

    @Test
    fun lineIsLongitudeThenLatitudeForClientCore() {
        val line = AidRequest.line(listOf(CoursePoint(39.15, -120.25), CoursePoint(39.6, -120.25)))
        assertEquals(2, line.length())
        assertEquals(-120.25, line.getJSONArray(0).getDouble(0), 1e-9)
        assertEquals(39.15, line.getJSONArray(0).getDouble(1), 1e-9)
    }

    @Test
    fun aDroppedPinKeepsTheShownAidOnShowWhenThePagesMove() {
        // Aid 2 was on show at index 2; a pin dropped before it moves it to index 3.
        val pages = listOf(page("start", 0), page("aid-1", 1), page("cp-1", 2), page("aid-2", 3))
        assertEquals(3, AidRequest.keptIndex(pages, "aid-2", fallback = 2))
        // Following the runner, or the aid is gone: client-core's index stands.
        assertEquals(2, AidRequest.keptIndex(pages, null, fallback = 2))
        assertEquals(1, AidRequest.keptIndex(pages, "removed", fallback = 1))
    }
}
