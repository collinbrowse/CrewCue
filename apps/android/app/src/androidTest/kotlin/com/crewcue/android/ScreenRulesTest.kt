package com.crewcue.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.optText
import com.crewcue.android.logging.AndroidLogger
import com.crewcue.android.session.SessionStore
import com.crewcue.android.ui.members.MemberPermissions
import com.crewcue.android.ui.onboarding.BridgeRunnerSetupRuntime
import com.crewcue.android.ui.onboarding.CoursePick
import com.crewcue.android.ui.onboarding.SetupDecisions
import com.crewcue.android.ui.onboarding.SetupSteps
import com.crewcue.android.ui.onboarding.StartTimeContinue
import com.crewcue.android.ui.pace.PaceViewModel
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Screen rules that must match the API and the behavior checklists. */
@RunWith(AndroidJUnit4::class)
class ScreenRulesTest {
    @Test
    fun onlyTheAthleteMayRemoveMembers() {
        assertTrue(MemberPermissions.mayRemoveMembers("ada", "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers("ben", "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers(null, "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers("ada", null))
        assertTrue(MemberPermissions.mayRemove("ada", "ada", "ben"))
        assertFalse(MemberPermissions.mayRemove("ada", "ada", "ada"))
        assertFalse(MemberPermissions.mayRemove("ben", "ada", "carl"))
        assertFalse(MemberPermissions.mayRemove("ada", "ada", null))
    }

    @Test
    fun crewSeeAHistoryBackedEstimateWithoutLoadingHistory() {
        val summary = "History-backed pace\nFinish 4:51:59 · 7:03 AM"
        // Crew never load history, so usableHistoryCount is 0 for them.
        assertEquals(summary to null, PaceViewModel.estimateCopy(true, false, 0, summary))
        assertEquals(PaceViewModel.COLD_START to summary, PaceViewModel.estimateCopy(true, true, 0, summary))
        assertEquals(PaceViewModel.COLD_START to null, PaceViewModel.estimateCopy(false, false, 0, null))
        assertEquals(PaceViewModel.ESTIMATE_EMPTY to null, PaceViewModel.estimateCopy(false, false, 2, null))
    }

    @Test
    fun crewSheetWithoutAScheduleIsAnErrorNotEmpty() {
        assertEquals(PaceViewModel.EXPORT_ERROR, PaceViewModel.exportCopy(empty = true, scheduleOffline = false, scheduleFailed = true))
        assertEquals(PaceViewModel.EXPORT_EMPTY, PaceViewModel.exportCopy(empty = true, scheduleOffline = false, scheduleFailed = false))
        assertEquals(PaceViewModel.EXPORT_OFFLINE, PaceViewModel.exportCopy(empty = false, scheduleOffline = true, scheduleFailed = false))
        assertEquals(PaceViewModel.EXPORT_SUCCESS, PaceViewModel.exportCopy(empty = false, scheduleOffline = false, scheduleFailed = false))
    }

    /** The Swift library on the device answers client-core `SuggestedDisplayName`, as Auth0 sign-in uses it. */
    @Test
    fun theEmailIsNeverTheNameCrewSee() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bridge = RaceDayBridge("http://127.0.0.1:9", SessionStore(context), AndroidLogger())
        assertNull(bridge.suggestedDisplayName("pat.runner@example.com", "pat.runner@example.com"))
        assertNull(bridge.suggestedDisplayName("Pat.Runner", "pat.runner@example.com"))
        assertNull(bridge.suggestedDisplayName("pat@work", null))
        assertNull(bridge.suggestedDisplayName(null, "pat@example.com"))
        assertEquals("Pat Runner", bridge.suggestedDisplayName("  Pat Runner ", "pat.runner@example.com"))
        assertEquals("Pat Runner", bridge.suggestedDisplayName("Pat Runner", null))
    }

    /**
     * The Swift library on the device answers the runner setup's step rules (client-core
     * `RunnerSetupSteps`, the `runnerSetupStep` op) that the JVM tests can only fake.
     */
    @Test
    fun theRunnerSetupsStepRulesComeFromClientCore() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bridge = RaceDayBridge("http://127.0.0.1:9", SessionStore(context), AndroidLogger())
        val steps = SetupDecisions(BridgeRunnerSetupRuntime(bridge) { null to null })
        val reviewed = steps.navigation(SetupSteps.HISTORY, SetupSteps.COURSE, raceExists = true)
        assertEquals(SetupSteps.COURSE, reviewed.shown)
        assertEquals(SetupSteps.ACCOUNT, reviewed.previous)
        assertFalse(steps.navigation(SetupSteps.HISTORY, SetupSteps.ACCOUNT, raceExists = true).canGoBack)
        assertTrue(steps.navigation(SetupSteps.ACCOUNT, null, raceExists = false).canGoBack)
        assertEquals("Canyons 2027", steps.newRaceName("  Canyons 2027 ", "Western States"))
        assertNull(steps.newRaceName(" ", null))
        val fingerprint = steps.courseFingerprint("<gpx/>")
        assertEquals(CoursePick.Unchanged, steps.coursePick(fingerprint!!, held = fingerprint, saved = null))
        assertEquals(
            StartTimeContinue.MoveOn,
            steps.startTimeContinue(
                reviewing = true,
                editedThisVisit = false,
                courseUnsaved = false,
                courseSavedOnRace = true,
                holdsCourseFile = false,
                start = "2026-08-15T12:30:00.000Z",
                savedStart = "2026-08-15T12:30:00.000Z"
            )
        )
        assertEquals(SetupSteps.HISTORY, steps.resumeStep(SetupSteps.TEASER, false, false, false, estimateDropped = true))
    }

    @Test
    fun jsonNullTextIsBlank() {
        val row = JSONObject("""{"displayName":null,"name":"Ada"}""")
        assertEquals("", row.optText("displayName"))
        assertEquals("", row.optText("missing"))
        assertEquals("Ada", row.optText("name"))
    }
}
