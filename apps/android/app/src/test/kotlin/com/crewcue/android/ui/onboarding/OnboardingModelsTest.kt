package com.crewcue.android.ui.onboarding

import com.crewcue.android.ui.map.TimelineRow
import java.io.File
import java.util.Locale
import kotlin.io.path.createTempDirectory
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingModelsTest {
    @Test
    fun theRacesZoneIsNamedOnlyWhenItIsntThePhones() {
        assertEquals("Pacific Time", raceZoneLabel("America/Los_Angeles", "America/Denver", Locale.US))
        assertNull(raceZoneLabel("America/Denver", "America/Denver", Locale.US))
        // An id the platform can't name stays as it is.
        assertEquals("Nowhere/Land", raceZoneLabel("Nowhere/Land", "America/Denver", Locale.US))
    }

    @Test
    fun aCoursePreviewCarriesClientCoresSummary() {
        val with = CoursePreview.from(JSONObject("""{"line":[],"checkpoints":[],"summary":"31.1 mi · 4 checkpoints"}"""))
        assertEquals("31.1 mi · 4 checkpoints", with.summary)
        assertNull(CoursePreview.from(JSONObject("""{"line":[],"checkpoints":[],"summary":""}""")).summary)
        assertNull(CoursePreview.from(JSONObject("""{"line":[],"checkpoints":[]}""")).summary)
    }

    @Test
    fun onboardingStateParsesTheFlowsTheShellRoutesBy() {
        val loading = OnboardingFlow.from(JSONObject("""{"flow":"loading","role":null,"roomId":null,"phase":null,"step":null,"showsTabBar":false}"""))!!
        assertTrue(loading.isLoading)
        assertFalse(loading.isChooser)
        assertNull(loading.roomId)

        val setup = OnboardingFlow.from(JSONObject("""{"flow":"runner","role":"runner","roomId":"r1","phase":"setup","step":"course","showsTabBar":false}"""))!!
        assertTrue(setup.isRunnerSetup)
        assertEquals("course", setup.step)
        assertEquals("r1", setup.roomId)

        val preview = OnboardingFlow.from(JSONObject("""{"flow":"runner","phase":"preview","step":"preview","showsTabBar":true}"""))!!
        assertTrue(preview.isRunnerPreview)
        assertFalse(preview.isRunnerSetup)

        val locked = OnboardingFlow.from(JSONObject("""{"flow":"raceLocked","role":"crew","roomId":"r2","showsTabBar":true,"reason":"The runner hasn't unlocked this race yet."}"""))!!
        assertTrue(locked.isRaceLocked)
        assertEquals("The runner hasn't unlocked this race yet.", locked.reason)

        assertTrue(OnboardingFlow.from(JSONObject("""{"flow":"crew","phase":"join","step":"join"}"""))!!.isCrewJoin)
        assertTrue(OnboardingFlow.from(JSONObject("""{"flow":"chooser"}"""))!!.isChooser)
        assertNull(OnboardingFlow.from(JSONObject("{}")))
        assertNull(OnboardingFlow.from(null))
    }

    @Test
    fun onboardingTextReadsTheSharedCopyAndLabels() {
        val copy = JSONObject(
            """{"chooserRunner":"I'm running a race","chooserCrew":"I'm crewing for someone","unpaidBanner":"Unlock race",
            "courseSaveLimit":"limit","startTimeDstGap":"gap","stepTitles":{"course":"Your course"},
            "stepExplanations":{"course":"Add your course file."},"labels":{"continueStep":"Continue"}}"""
        )
        val text = OnboardingText.from(copy, "s", "e", "x", "o")
        assertEquals("I'm running a race", text.chooserRunner)
        assertEquals("Unlock race", text.unpaidBanner)
        assertEquals("Your course", text.title("course"))
        assertEquals("Add your course file.", text.explanation("course"))
        assertEquals("Continue", text.label("continueStep"))
        assertEquals("", text.label("missing"))
        assertEquals("x", text.setupError)
        assertEquals("o", text.setupOffline)
    }

    private fun row(id: String, finish: Boolean = false) = TimelineRow(
        checkpointId = id, state = "projected", kicker = "", title = id.uppercase(), clockArrivalAt = "2026-08-15T12:00:00.000Z",
        cutoffAt = null, cutoffStatus = null, distanceToLabel = "", isFinish = finish
    )

    @Test
    fun teaserRowsAreTheStartThenEveryLockedCheckpointThenTheFinish() {
        val rows = TeaserRow.build(listOf(row("start"), row("finish", finish = true)), listOf("aid-1", "aid-2"), mapOf("aid-1" to "Aid 1"))
        assertEquals(listOf("start", "aid-1", "aid-2", "finish"), rows.map { it.checkpointId })
        assertEquals(TeaserRow.Locked("aid-1", "Aid 1"), rows[1])
        assertEquals(TeaserRow.Locked("aid-2", "aid-2"), rows[2])
        assertTrue(rows[3] is TeaserRow.Open)

        // A timeline built from the course lists the locked checkpoints too; they become locked rows.
        val fromCourse = TeaserRow.build(listOf(row("start"), row("aid-1"), row("finish", finish = true)), listOf("aid-1"), emptyMap())
        assertEquals(listOf("start", "aid-1", "finish"), fromCourse.map { it.checkpointId })
        assertEquals(TeaserRow.Locked("aid-1", "AID-1"), fromCourse[1])

        assertEquals(emptyList<TeaserRow>(), TeaserRow.build(emptyList(), emptyList(), emptyMap()))
    }

    @Test
    fun lockedIdsComeFromTheScheduleSheet() {
        val schedule = JSONObject("""{"sheet":{"stops":[],"locked":{"checkpointIds":["a","b",""]}}}""")
        assertEquals(listOf("a", "b"), TeaserRow.lockedIds(schedule))
        assertEquals(emptyList<String>(), TeaserRow.lockedIds(JSONObject("""{"sheet":{"stops":[]}}""")))
        assertEquals(emptyList<String>(), TeaserRow.lockedIds(null))
    }

    @Test
    fun theDraftRoundTripsThroughSavedState() {
        val draft = RunnerSetupDraft(
            roomId = "r1", displayName = "Ada", courseFileName = "route.gpx", courseConfirmed = true,
            plannedPaceSecondsPerKm = 420.0, start = RaceStartFields(2026, 8, 15, 6, 30, "America/Denver"),
            savedRaceStartAt = "2026-08-15T12:30:00.000Z", historyLine = "Finish 9:42 AM instead of 10:15 AM", historyAttached = true
        )
        assertEquals(draft, RunnerSetupDraft.from(draft.toJson()))
        // A draft from a build that kept the start the course last uploaded with still reads.
        assertEquals(draft, RunnerSetupDraft.from(JSONObject(draft.toJson()).put("uploadedStartAt", "2026-08-15T12:30:00.000Z").toString()))
        assertEquals(RunnerSetupDraft(), RunnerSetupDraft.from(RunnerSetupDraft().toJson()))
        assertNull(RunnerSetupDraft.from("not json"))
        assertNull(RunnerSetupDraft.from(null))
    }

    @Test
    fun courseAndStartTimeAreLocalUntilTheUploadReachesTheServer() {
        val draft = RunnerSetupDraft(roomId = "r1", courseFileName = "route.gpx", courseConfirmed = true)
        assertEquals(SetupSteps.START_TIME, RunnerSetupViewModel.visibleStep(SetupSteps.COURSE, draft, courseOnDevice = true, roomId = "r1"))
        // Without the file on this phone, or before the race exists, it's the course step again.
        assertEquals(SetupSteps.COURSE, RunnerSetupViewModel.visibleStep(SetupSteps.COURSE, draft, courseOnDevice = false, roomId = "r1"))
        assertEquals(SetupSteps.COURSE, RunnerSetupViewModel.visibleStep(SetupSteps.START_TIME, draft, courseOnDevice = true, roomId = null))
        assertEquals(SetupSteps.COURSE, RunnerSetupViewModel.visibleStep(SetupSteps.COURSE, draft.copy(courseConfirmed = false), true, "r1"))
        assertEquals(SetupSteps.HISTORY, RunnerSetupViewModel.visibleStep(SetupSteps.HISTORY, draft, true, "r1"))
        assertNull(RunnerSetupViewModel.visibleStep(null, draft, true, "r1"))
    }

    @Test
    fun coursePreviewReadsLineCheckpointsAndElevation() {
        val preview = CoursePreview.from(
            JSONObject(
                """{"line":[[-120.0,39.0],[-120.0,39.01],["x",1]],"checkpoints":[{"id":"a","latitude":39.0,"longitude":-120.0},{"id":"","latitude":1,"longitude":1}],
                "elevation":[[0,1800],[1100,1830]],"plannedPaceSecondsPerKm":0}"""
            )
        )
        assertEquals(2, preview.line.size)
        assertEquals(listOf("a"), preview.checkpoints.map { it.id })
        assertEquals("a", preview.checkpoints[0].title)
        assertEquals(listOf(0.0 to 1800.0, 1100.0 to 1830.0), preview.elevation)
        assertNull(preview.plannedPaceSecondsPerKm)
        assertFalse(preview.isEmpty)
        assertEquals(1, preview.checkpointJson().length())
        assertEquals(2, preview.elevationJson().length())
    }

    @Test
    fun theFileDraftStoreKeepsOneUsersSetup() {
        val dir = createTempDirectory("runner-setup").toFile()
        val store = FileRunnerSetupDraftStore(File(dir, "runner-setup"))
        store.save("ada", RunnerSetupDraft(roomId = "r1", courseFileName = "route.gpx"))
        assertTrue(store.writeCourse("ada", "<gpx/>"))
        assertEquals("r1", store.load("ada")?.roomId)
        assertEquals("<gpx/>", store.readCourse("ada"))
        // Another account on the phone never reads Ada's setup, and replaces it.
        assertNull(store.load("bob"))
        assertNull(store.readCourse("bob"))
        store.save("bob", RunnerSetupDraft(displayName = "Bob"))
        assertNull(store.readCourse("bob"))
        assertNull(store.load("ada"))
        store.clear()
        assertNull(store.load("bob"))
        dir.deleteRecursively()
    }

    @Test
    fun tagsAreStableAndUnderTheRootTag() {
        assertEquals("crewcue.onboarding-runner-setup", SETUP_TAG)
        assertEquals("crewcue.onboarding-runner-setup.course.choose", setupTag("course.choose"))
    }

    @Test
    fun theRacePassAndReplayCopyComeFromClientCore() {
        val copy = JSONObject(
            """{"racePassTitle":"Race Pass","racePassSubtitle":"Unlock this race for you and your crew.",
            "courseUnreadable":"We couldn't find a route in that file.","courseUploadFailed":"Your course didn't upload.",
            "beatFocus":{"following":"Look at the dot on the map.","crewChat":"Look at the newest message in Chat.","deadZone":""},
            "labels":{"close":"Close","courseUploaded":"Course uploaded"}}"""
        )
        val text = OnboardingText.from(copy, "s", "e", "x", "o")
        assertEquals("Race Pass", text.racePassTitle)
        assertEquals("Unlock this race for you and your crew.", text.racePassSubtitle)
        assertEquals("We couldn't find a route in that file.", text.courseUnreadable)
        assertEquals("Your course didn't upload.", text.courseUploadFailed)
        assertEquals("Close", text.label("close"))
        assertEquals("Course uploaded", text.label("courseUploaded"))
        // Where to look, by beat; a blank line is dropped.
        assertEquals("Look at the dot on the map.", text.replay.focus["following"])
        assertEquals("Look at the newest message in Chat.", text.replay.focus["crewChat"])
        assertFalse(text.replay.focus.containsKey("deadZone"))
        // The beat each line is about decides which view gets the ring.
        assertEquals(ReplayPanel.Chat, ReplayPanel.forBeat("crewChat"))
        assertEquals(ReplayPanel.Map, ReplayPanel.forBeat("deadZone"))
    }
}
