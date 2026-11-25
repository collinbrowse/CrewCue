package com.crewcue.android.ui.activity

import com.crewcue.android.BuildConfig
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.nav.DevRoutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.json.JSONObject
import org.junit.Test

class ActivityImportTest {
    @Test
    fun stravaIsOffAndHasNoDevRoute() {
        assertFalse(BuildConfig.STRAVA_ENABLED)
        assertNull(DevRoutes.featureId("crewcue://dev/strava"))
    }

    @Test
    fun activityImportHasADevRoute() {
        assertEquals("activity-import", DevRoutes.featureId("crewcue://dev/activity-import?state=error"))
    }

    @Test
    fun bridgeFailuresMapToChecklistCopy() {
        assertEquals(ACTIVITY_IMPORT_OFFLINE, ActivityImportViewModel.messageFor(RuntimeResult.Failure("x", offline = true)))
        assertEquals(ACTIVITY_IMPORT_ERROR, ActivityImportViewModel.messageFor(RuntimeResult.Failure("x", offline = false)))
    }

    @Test
    fun importedRunsReadClientCoreLabelsNewestFirst() {
        val json = JSONObject(
            """
            {"offline":false,"countLabel":"2 runs imported","items":[
              {"id":"a","source":"gpx_upload","recordedAt":"2026-05-10T12:00:00.000Z","summary":"x",
               "sourceLabel":"GPX","dateLabel":"May 10, 2026","distanceLabel":"10.0 mi","durationLabel":"1:40:00","paceLabel":"10'00\" / mi"},
              {"id":"b","source":"fit_upload","recordedAt":"2026-06-01T08:00:00.000Z","summary":"y",
               "sourceLabel":"FIT","dateLabel":"Jun 1, 2026"}
            ]}
            """.trimIndent()
        )
        val runs = ImportedRun.parseList(json)
        assertEquals(listOf("b", "a"), ImportedRun.newestFirst(runs).map { it.id })
        val gpx = runs.first { it.id == "a" }
        assertEquals("May 10, 2026", gpx.dateLabel)
        assertEquals("GPX", gpx.sourceLabel)
        assertEquals("10.0 mi · 1:40:00", gpx.totalsLabel)
        assertEquals("10'00\" / mi", gpx.paceLabel)
        val bare = runs.first { it.id == "b" }
        assertNull(bare.distanceLabel)
        assertNull(bare.paceLabel)
        assertEquals("", bare.totalsLabel)
    }

    @Test
    fun namedRunsShowTheirNameOverTheDate() {
        val named = ImportedRun.parse(
            JSONObject(
                """{"id":"a","recordedAt":"2026-05-10T12:00:00.000Z","sourceLabel":"GPX","dateLabel":"May 10, 2026",
                "name":"Morning Run","titleLabel":"Morning Run","subtitleDateLabel":"May 10, 2026"}"""
            )
        )!!
        assertEquals("Morning Run", named.titleLabel)
        assertEquals("May 10, 2026 · GPX", named.subtitleLabel)
        val dated = ImportedRun.parse(
            JSONObject("""{"id":"b","recordedAt":"2026-06-01T08:00:00.000Z","sourceLabel":"FIT","dateLabel":"Jun 1, 2026","titleLabel":"Jun 1, 2026"}""")
        )!!
        assertNull(dated.name)
        assertEquals("Jun 1, 2026", dated.titleLabel)
        assertEquals("FIT", dated.subtitleLabel)
        // An older runtime without titleLabel still titles by date.
        val legacy = ImportedRun.parse(JSONObject("""{"id":"c","recordedAt":"2026-06-02T08:00:00.000Z","sourceLabel":"TCX","dateLabel":"Jun 2, 2026"}"""))!!
        assertEquals("Jun 2, 2026", legacy.titleLabel)
    }

    @Test
    fun countLabelFallbackMatchesClientCore() {
        assertEquals("No runs imported yet", ActivityImportViewModel.countLabelFallback(0))
        assertEquals("1 run imported", ActivityImportViewModel.countLabelFallback(1))
        assertEquals("12 runs imported", ActivityImportViewModel.countLabelFallback(12))
    }
}
