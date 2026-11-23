package com.crewcue.android.ui.map

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GlideLayoutTest {
    /** A ping at 0 and one at 4000 ms, and the points the replay serves along the course between them. */
    private val track = (0..4).map { CoursePoint(39.0 + it * 0.001, -120.0) }
    private val times = listOf(0L, 1_000L, 2_000L, 3_000L, 4_000L)

    @Test
    fun midGlideTheTrailEndsAtTheDotNotAtTheNewestPing() {
        val frame = RunnerGlideFrame(latitude = 39.0025, longitude = -120.0, atMillis = 2_500, fromMillis = 1_000)
        val layout = GlideLayout.of(frame, track, times)
        // Behind the dot when the glide began, and now.
        assertEquals(2, layout.settled)
        assertEquals(3, layout.reached)
        assertEquals(CoursePoint(39.0025, -120.0), layout.dot)
        // From the last settled point, through the points passed since, to the dot. The points ahead stay hidden.
        assertEquals(listOf(track[1], track[2], layout.dot), layout.stretch(track))
    }

    @Test
    fun aGlideThatReachedThePingDrawsTheWholePath() {
        val frame = RunnerGlideFrame(latitude = track[4].latitude, longitude = track[4].longitude, atMillis = 4_000, fromMillis = 4_000)
        val layout = GlideLayout.of(frame, track, times)
        assertEquals(5, layout.settled)
        assertEquals(5, layout.reached)
        // The settled path is all of it; the stretch is only its last point to the dot there.
        assertEquals(listOf(track[4], track[4]), layout.stretch(track))
    }

    @Test
    fun aPathReadBehindTheGlideKeepsTheDotOnItsLastPoint() {
        // The Map hasn't read the step's points yet: the dot waits on the path, never off it.
        val frame = RunnerGlideFrame(latitude = 39.009, longitude = -120.0, atMillis = 9_000, fromMillis = 4_000)
        val layout = GlideLayout.of(frame, track, times)
        assertEquals(5, layout.reached)
        assertEquals(5, layout.settled)
        assertEquals(track[4], layout.dot)
    }

    @Test
    fun beforeAnyPathTheStretchIsStillAShape() {
        val frame = RunnerGlideFrame(latitude = 39.0, longitude = -120.0, atMillis = 0, fromMillis = 0)
        val layout = GlideLayout.of(frame, emptyList(), emptyList())
        assertEquals(0, layout.settled)
        assertEquals(0, layout.reached)
        assertEquals(2, layout.stretch(emptyList()).size)
    }

    @Test
    fun countsTimesAtOrBeforeAMoment() {
        assertEquals(0, GlideLayout.countAtOrBefore(times, -1))
        assertEquals(1, GlideLayout.countAtOrBefore(times, 0))
        assertEquals(3, GlideLayout.countAtOrBefore(times, 2_999))
        assertEquals(5, GlideLayout.countAtOrBefore(times, 10_000))
    }

    @Test
    fun aFrameReadsTheRuntimesShape() {
        val frame = RunnerGlideFrame.from(
            JSONObject("""{"latitude":39.1,"longitude":-120.2,"lineMeters":812.5,"recordedAt":"2026-08-15T12:30:00.500Z","fromRecordedAt":"2026-08-15T12:00:00.000Z"}""")
        )
        assertEquals(RunnerGlideFrame(39.1, -120.2, epochMillis("2026-08-15T12:30:00.500Z")!!, epochMillis("2026-08-15T12:00:00Z")!!), frame)
        assertEquals(500L, frame!!.atMillis % 1_000)
        // Before the first ping the runtime answers an empty object.
        assertNull(RunnerGlideFrame.from(JSONObject("{}")))
        assertNull(RunnerGlideFrame.from(null))
        assertNull(epochMillis("not a time"))
    }
}
