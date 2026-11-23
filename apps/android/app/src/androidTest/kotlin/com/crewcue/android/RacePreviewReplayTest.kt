package com.crewcue.android

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import com.crewcue.android.ui.map.RunnerGlideFrame
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The onboarding replay on the device's own Swift library (clients/behavior/onboarding-race-preview.md):
 * the dot glides along the course between pings and holds when paused, and the path chip counts pings.
 */
@RunWith(AndroidJUnit4::class)
class RacePreviewReplayTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val target get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun ok(result: RuntimeResult): JSONObject {
        assertTrue("$result", result is RuntimeResult.Success)
        return (result as RuntimeResult.Success).result
    }

    @Test
    fun theDotGlidesAlongTheCourseBetweenPingsAndHoldsWhenPaused() {
        val bridge = RaceDayBridge("http://127.0.0.1:9", SessionStore(target), AndroidLogger())
        val created = ok(bridge.demoRaceCreate(target.cacheDir.absolutePath, fixture = true))
        val replay = bridge.replay(created.getString("baseURL"), created.getString("viewerUserId"))
        try {
            ok(replay.demoRacePlay())
            // Two seconds of frames, as the Map samples them: lineMeters only ever grows, and takes
            // many more places than the pings that arrived, so the dot moves between pings.
            val meters = mutableListOf<Double>()
            var spent = 0L
            val until = SystemClock.uptimeMillis() + 2_000
            while (SystemClock.uptimeMillis() < until) {
                ok(replay.demoRaceTick())
                val start = SystemClock.elapsedRealtimeNanos()
                val runner = ok(replay.demoRaceRunner())
                spent += SystemClock.elapsedRealtimeNanos() - start
                if (runner.has("lineMeters")) meters += runner.getDouble("lineMeters")
                SystemClock.sleep(16)
            }
            val perCallMs = spent / 1e6 / meters.size.coerceAtLeast(1)
            Log.i("CrewCueGlide", "demoRaceRunner: ${meters.size} samples, %.3f ms each".format(perCallMs))
            assertTrue("${meters.size} samples", meters.size > 20)
            meters.zipWithNext().forEach { (a, b) -> assertTrue("$a then $b", b >= a) }
            val pings = ok(replay.demoRaceTick()).getInt("pathPings")
            val places = meters.distinct().size
            assertTrue("$places places for $pings pings", places > pings * 3)
            // Paused, the dot holds at that moment.
            ok(replay.demoRacePause())
            val held = RunnerGlideFrame.from(ok(replay.demoRaceRunner()))
            assertNotNull(held)
            SystemClock.sleep(400)
            assertEquals(held, RunnerGlideFrame.from(ok(replay.demoRaceRunner())))
        } finally {
            replay.demoRaceSkip()
        }
    }

    @Test
    fun thePathChipCountsThePingsNotThePointsAlongTheCourse() {
        SessionStore(target).clear()
        // 10 s in: ten pings while following and the first falling behind. 24 s: all 25.
        for ((at, pings) in listOf(10 to 11, 24 to 25)) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("crewcue://dev/onboarding-race-preview?at=$at&paused=1"))
                .setClass(target, MainActivity::class.java)
            ActivityScenario.launch<MainActivity>(intent).use {
                // A compact width shows the beat's view over the Map: pick the Map.
                compose.waitUntil(10_000) {
                    runCatching { compose.onNodeWithTag("crewcue.onboarding-race-preview.panel.map").assertExists() }.isSuccess
                }
                compose.onNodeWithTag("crewcue.onboarding-race-preview.panel.map").performClick()
                val label = "Runner path, $pings points"
                compose.waitUntil(15_000) {
                    runCatching {
                        compose.onNodeWithTag("crewcue.runner-track", useUnmergedTree = true)
                            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf(label)))
                    }.isSuccess
                }
                val node = compose.onNodeWithTag("crewcue.runner-track", useUnmergedTree = true).fetchSemanticsNode()
                assertEquals(listOf(label), node.config.getOrNull(SemanticsProperties.ContentDescription))
            }
        }
    }
}
