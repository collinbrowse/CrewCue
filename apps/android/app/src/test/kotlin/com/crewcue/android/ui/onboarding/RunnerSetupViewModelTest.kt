package com.crewcue.android.ui.onboarding

import androidx.lifecycle.SavedStateHandle
import com.crewcue.android.data.RuntimeResult
import java.time.LocalDate
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private fun ok(json: String): RuntimeResult = RuntimeResult.Success(JSONObject(json))

private val text = OnboardingText(
    courseSaveLimit = "You've changed the course a lot this hour. Try again in a bit.",
    startTimeDstGap = "That time doesn't exist on that date because of daylight saving. Pick another time.",
    setupError = "Couldn't save this step.",
    setupOffline = "Offline. Setup needs the network. Your answers stay on this phone until you reconnect."
)

private const val PREVIEW = """{"status":"previewed","line":[[-120.0,39.0],[-120.0,39.01]],
 "checkpoints":[{"id":"start","title":"Start","latitude":39.0,"longitude":-120.0,"distanceMetersFromStart":0},
  {"id":"aid-1","title":"Aid 1","latitude":39.005,"longitude":-120.0,"distanceMetersFromStart":550},
  {"id":"finish","title":"Finish","latitude":39.01,"longitude":-120.0,"distanceMetersFromStart":1100}],
 "elevation":[[0,1800],[1100,1830]],"plannedPaceSecondsPerKm":420}"""

private fun state(step: String, roomId: String? = null): JSONObject = JSONObject()
    .put("flow", "runner").put("phase", "setup").put("step", step).put("showsTabBar", false)
    .put("roomId", roomId ?: JSONObject.NULL)

private fun flow(step: String, roomId: String? = null): OnboardingFlow = OnboardingFlow.from(state(step, roomId))!!

/** Scripted client-core: every op answers from a queue (the last answer repeats) and is recorded. */
private class FakeRuntime : RunnerSetupRuntime {
    val calls = mutableListOf<String>()
    val marks = mutableListOf<Triple<String, String?, String?>>()
    val imports = mutableListOf<List<Any?>>()
    val historyModes = mutableListOf<String?>()
    var created: Triple<String, String, String?>? = null
    val answers = mutableMapOf<String, ArrayDeque<RuntimeResult>>()

    fun answer(op: String, vararg results: RuntimeResult) {
        answers[op] = ArrayDeque(results.toList())
    }

    private fun next(op: String, fallback: RuntimeResult): RuntimeResult {
        calls += op
        val queue = answers[op] ?: return fallback
        return if (queue.size > 1) queue.removeFirst() else queue.firstOrNull() ?: fallback
    }

    override fun markStep(step: String, outcome: String?, roomId: String?): RuntimeResult {
        marks += Triple(step, outcome, roomId)
        return next("markStep", RuntimeResult.Success(JSONObject().put("state", state("next", roomId))))
    }

    override fun createRoom(name: String, userId: String, creatorName: String?): RuntimeResult {
        created = Triple(name, userId, creatorName)
        return next("createRoom", ok("""{"id":"room-1"}"""))
    }

    override fun gpxPreview(roomId: String, fileName: String, gpxXml: String): RuntimeResult = next("gpxPreview", ok(PREVIEW))

    override fun raceStartInput(fields: RaceStartFields): RuntimeResult =
        next(
            "raceStartInput",
            ok("""{"raceStartAt":"2026-08-15T12:30:00.000Z","problem":null,"message":null,"dateLabel":"Aug 15, 2026","timeLabel":"6:30 AM"}""")
        )

    override fun importCourse(roomId: String, fileName: String, gpxXml: String, raceStartAt: String, plannedPaceSecondsPerKm: Double?): RuntimeResult {
        imports += listOf(roomId, fileName, gpxXml, raceStartAt, plannedPaceSecondsPerKm)
        return next("importCourse", ok("""{"status":"saved"}"""))
    }

    override fun loadEstimate(roomId: String): RuntimeResult =
        next(
            "loadEstimate",
            ok(
                """{"hasEstimate":true,"expectedFinishAt":"2026-08-15T22:02:00.000Z","finishAt":"2026-08-15T22:10:00.000Z",
                "summary":"Finish 9:40:00 · 4:10 PM","finishClock":"4:10 PM","offline":false}"""
            )
        )

    override fun computeEstimate(roomId: String, historyMode: String?): RuntimeResult {
        historyModes += historyMode
        return next(
            "computeEstimate",
            ok("""{"hasEstimate":true,"expectedFinishAt":"2026-08-15T22:10:00.000Z","finishAt":"2026-08-15T22:18:00.000Z","offline":false}""")
        )
    }

    override fun importActivity(fileName: String, contentBase64: String): RuntimeResult =
        next("importActivity", ok("""{"status":"saved","message":"Imported FIT · 8.0 km"}"""))

    override fun loadRoom(roomId: String): RuntimeResult = next("loadRoom", ok(PREVIEW))

    override fun loadSchedule(roomId: String): RuntimeResult =
        next("loadSchedule", ok("""{"sheet":{"roomId":"room-1","raceStartAt":"2026-08-15T12:30:00.000Z","stops":[],"locked":{"checkpointIds":["aid-1"]}}}"""))

    override fun timeline(sheet: JSONObject?, checkpoints: JSONArray, elevation: JSONArray?): RuntimeResult = next(
        "timeline",
        ok(
            """{"timeline":[
              {"checkpointId":"start","state":"current","kicker":"CP1 — START","title":"Start","distanceToLabel":"0.0 MI","isFinish":false,"clockArrivalAt":"2026-08-15T12:30:00.000Z"},
              {"checkpointId":"finish","state":"projected","kicker":"CP2","title":"Finish","distanceToLabel":"0.7 MI","isFinish":true,"clockArrivalAt":"2026-08-15T22:10:00.000Z","clockLabel":"16:10"}]}"""
        )
    )
}

private class MemoryDrafts : RunnerSetupDraftStore {
    var owner: String? = null
    var draft: RunnerSetupDraft? = null
    var course: String? = null
    var cleared = false

    override fun load(userId: String): RunnerSetupDraft? = draft.takeIf { owner == userId }
    override fun save(userId: String, draft: RunnerSetupDraft) {
        owner = userId
        this.draft = draft
    }
    override fun readCourse(userId: String): String? = course.takeIf { owner == userId }
    override fun writeCourse(userId: String, gpxXml: String): Boolean {
        course = gpxXml
        return true
    }
    override fun clear() {
        cleared = true
        draft = null
        course = null
        owner = null
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class RunnerSetupViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val runtime = FakeRuntime()
    private val drafts = MemoryDrafts()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun model(
        saved: SavedStateHandle = SavedStateHandle(),
        userId: String? = "ada",
        name: String? = "Ada",
        store: RunnerSetupDraftStore = drafts,
        initialFlow: OnboardingFlow? = null,
        io: CoroutineDispatcher = dispatcher
    ) = RunnerSetupViewModel(
        runtime, store, saved, userId, name, text,
        deviceZone = "America/Denver", today = LocalDate.of(2026, 8, 1), initialFlow = initialFlow, io = io
    )

    private fun TestScope.effectsOf(model: RunnerSetupViewModel): MutableList<RunnerSetupEffect> {
        val seen = mutableListOf<RunnerSetupEffect>()
        backgroundScope.launch(dispatcher) { model.effects.collect { seen += it } }
        return seen
    }

    @Test
    fun accountSavesTheNameThenMarksTheStep() = runTest(dispatcher) {
        val model = model(name = "Ada L")
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.ACCOUNT))
        assertEquals(SetupSteps.ACCOUNT, model.step)
        assertEquals("Ada L", model.draft.displayName)
        model.updateName("  Ada  ")
        model.saveAccount()
        assertEquals(listOf(Triple(SetupSteps.ACCOUNT, "done", null as String?)), runtime.marks)
        assertEquals(RunnerSetupEffect.DisplayNameChosen("Ada"), effects[0])
        assertTrue(effects[1] is RunnerSetupEffect.StateChanged)
    }

    @Test
    fun signedOutAccountSavesNothing() = runTest(dispatcher) {
        val model = model(userId = null, name = null)
        model.sync(flow(SetupSteps.ACCOUNT))
        model.updateName("Ada")
        model.saveAccount()
        assertTrue(runtime.marks.isEmpty())
        assertNull(drafts.draft)
    }

    @Test
    fun courseCreatesTheRaceWithTheCreatorNameThenPreviewsOnTheMap() = runTest(dispatcher) {
        val model = model()
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.COURSE))
        model.chooseCourse("Western States.gpx", "<gpx/>", online = true)
        assertEquals(Triple("Western States", "ada", "Ada"), runtime.created)
        assertEquals(listOf("createRoom", "gpxPreview"), runtime.calls.filter { it != "raceStartInput" })
        assertTrue(effects.contains(RunnerSetupEffect.RoomCreated("room-1")))
        assertEquals("room-1", model.roomId)
        val preview = assertNotNullAnd(model.preview)
        assertEquals(3, preview.checkpoints.size)
        assertEquals(2, preview.elevation.size)
        assertEquals(420.0, model.draft.plannedPaceSecondsPerKm)
        // The preview is still the course step until the runner moves on.
        assertEquals(SetupSteps.COURSE, model.step)
        model.confirmCourse()
        assertEquals(SetupSteps.START_TIME, model.step)
        model.backToCourse()
        assertEquals(SetupSteps.COURSE, model.step)
    }

    @Test
    fun offlineCourseKeepsTheFileAndTheStep() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        model.chooseCourse("route.gpx", "<gpx/>", online = false)
        assertTrue(model.status is SetupStatus.Offline)
        assertEquals(text.setupOffline, (model.status as SetupStatus.Offline).failure.message)
        assertNull(runtime.created)
        assertEquals("<gpx/>", drafts.course)
        assertEquals("route.gpx", model.draft.courseFileName)
        assertEquals(SetupSteps.COURSE, model.step)
    }

    @Test
    fun tryAgainAfterAnOfflinePickCreatesTheRaceAndPreviews() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        model.chooseCourse("route.gpx", "<gpx/>", online = false)
        // A new state while offline creates nothing on its own.
        model.sync(flow(SetupSteps.COURSE))
        assertNull(runtime.created)
        model.retry(online = true)
        assertEquals("route", runtime.created?.first)
        assertNotNull(model.preview)
        assertEquals(SetupStatus.Ready, model.status)
    }

    @Test
    fun aGoneRaceIsForgottenSoTheNextTryCreatesOne() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "gone", courseFileName = "route.gpx"))
        drafts.course = "<gpx/>"
        runtime.answer("gpxPreview", RuntimeResult.Failure("Race room not found", offline = false, status = 404), ok(PREVIEW))
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        assertTrue(model.status is SetupStatus.Failed)
        assertNull(model.roomId)
        model.retry(online = true)
        assertEquals("room-1", model.roomId)
        assertNotNull(model.preview)
    }

    @Test
    fun anUnreadableFileFailsWithoutARequest() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        model.chooseCourse("big.gpx", null, online = true)
        assertEquals(text.setupError, (model.status as SetupStatus.Failed).failure.message)
        assertNull(runtime.created)
    }

    @Test
    fun aRelaunchResumesTheStartTimeFromTheSavedCourse() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1", displayName = "Ada", courseFileName = "route.gpx", courseConfirmed = true))
        drafts.course = "<gpx/>"
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        assertEquals(SetupSteps.START_TIME, model.step)
        // The map preview is drawn again from the file on this phone.
        assertTrue("gpxPreview" in runtime.calls)
        assertNotNull(model.preview)
        assertNull(runtime.created)
    }

    @Test
    fun aDraftForAnotherRaceIsDropped() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "old-room", displayName = "Ada", courseFileName = "route.gpx", courseConfirmed = true))
        drafts.course = "<gpx/>"
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-2"))
        assertEquals(SetupSteps.COURSE, model.step)
        assertNull(model.draft.courseFileName)
        assertEquals("Ada", model.draft.displayName)
        assertEquals("room-2", model.roomId)
    }

    @Test
    fun startTimeDefaultsToTheDeviceZoneAndClientCoreConvertsAndLabels() = runTest(dispatcher) {
        val model = model()
        assertEquals(RaceStartFields(2026, 8, 2, 6, 0, "America/Denver"), model.start)
        assertEquals("2026-08-15T12:30:00.000Z", model.startInstant)
        assertNull(model.startProblem)
        // The pickers show client-core's labels, not a Kotlin formatter's.
        assertEquals("Aug 15, 2026", model.startDateLabel)
        assertEquals("6:30 AM", model.startTimeLabel)
    }

    @Test
    fun aNewPickHoldsContinueUntilClientCoreAnswersForIt() = runTest(dispatcher) {
        val slow = StandardTestDispatcher(testScheduler)
        val model = model(io = slow)
        advanceUntilIdle()
        assertEquals("2026-08-15T12:30:00.000Z", model.startInstant)
        runtime.answer("raceStartInput", ok("""{"raceStartAt":"2026-09-12T12:00:00.000Z","problem":null,"message":null}"""))
        model.updateStart(RaceStartFields(2026, 9, 12, 6, 0, "America/Denver"))
        // The old instant is gone at once: Continue can't upload it for the new fields.
        assertNull(model.startInstant)
        assertNull(model.startProblem)
        advanceUntilIdle()
        assertEquals("2026-09-12T12:00:00.000Z", model.startInstant)
    }

    @Test
    fun theDaylightSavingMessageShowsOnlyForTheGap() = runTest(dispatcher) {
        runtime.answer(
            "raceStartInput",
            ok("""{"raceStartAt":null,"problem":"daylightSavingGap","message":"${text.startTimeDstGap}"}""")
        )
        val model = model()
        model.updateStart(RaceStartFields(2026, 3, 8, 2, 30, "America/Denver"))
        assertEquals(text.startTimeDstGap, model.startProblem)
        assertNull(model.startInstant)

        runtime.answer("raceStartInput", ok("""{"raceStartAt":null,"problem":"invalidDate","message":null}"""))
        model.updateStart(RaceStartFields(2026, 2, 30, 9, 0, "America/Denver"))
        assertNull(model.startProblem)
        assertNull(model.startInstant)
    }

    private fun startTimeModel(): RunnerSetupViewModel {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1", courseFileName = "route.gpx", courseConfirmed = true, plannedPaceSecondsPerKm = 420.0))
        drafts.course = "<gpx/>"
        return model().also { it.sync(flow(SetupSteps.COURSE, roomId = "room-1")) }
    }

    @Test
    fun theStartTimeUploadsTheCourseWithRaceStartAtThenEstimates() = runTest(dispatcher) {
        val model = startTimeModel()
        val effects = effectsOf(model)
        model.saveStart(online = true)
        assertEquals(listOf(listOf<Any?>("room-1", "route.gpx", "<gpx/>", "2026-08-15T12:30:00.000Z", 420.0)), runtime.imports)
        // The first plan, with all history, attached for the teaser.
        assertEquals(listOf<String?>(null), runtime.historyModes)
        assertTrue(effects.contains(RunnerSetupEffect.RacesChanged))
        // A second tap with the same start only asks for the race list again.
        model.saveStart(online = true)
        assertEquals(1, runtime.imports.size)
        assertEquals(2, effects.count { it == RunnerSetupEffect.RacesChanged })
    }

    @Test
    fun offlineStartTimeKeepsTheStepAndQueuedCountsAsOffline() = runTest(dispatcher) {
        val model = startTimeModel()
        model.saveStart(online = false)
        assertTrue(model.status is SetupStatus.Offline)
        assertTrue(runtime.imports.isEmpty())
        runtime.answer("importCourse", ok("""{"status":"queued","id":"op-1"}"""))
        model.saveStart(online = true)
        assertTrue(model.status is SetupStatus.Offline)
        assertEquals(SetupSteps.START_TIME, model.step)
        assertNull(model.draft.uploadedStartAt)
    }

    @Test
    fun theCourseSaveLimitShowsTheSharedCopy() = runTest(dispatcher) {
        runtime.answer("importCourse", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = startTimeModel()
        model.saveStart(online = true)
        val failed = model.status as SetupStatus.Failed
        assertEquals(text.courseSaveLimit, failed.failure.message)
        assertTrue(failed.failure.retryable)
    }

    @Test
    fun aPreviewLimitIsACourseSaveAndShowsTheSameCopy() = runTest(dispatcher) {
        runtime.answer("gpxPreview", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        model.chooseCourse("route.gpx", "<gpx/>", online = true)
        assertEquals(text.courseSaveLimit, (model.status as SetupStatus.Failed).failure.message)
    }

    @Test
    fun theEstimatorLimitAfterASavedStartLeavesTheStepAlone() = runTest(dispatcher) {
        runtime.answer("computeEstimate", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = startTimeModel()
        val effects = effectsOf(model)
        model.saveStart(online = true)
        // The course and start saved; the teaser computes the plan again later.
        assertEquals(SetupStatus.Ready, model.status)
        assertTrue(effects.contains(RunnerSetupEffect.RacesChanged))
    }

    @Test
    fun aCourseMismatchClientCoreCouldNotRecoverFromStaysSilent() = runTest(dispatcher) {
        // client-core already computed and attached once more (PlanOfRecord); the app doesn't loop.
        runtime.answer(
            "computeEstimate",
            RuntimeResult.Failure("The estimate was computed for another course.", offline = false, status = 400, code = "course_mismatch")
        )
        val model = startTimeModel()
        val effects = effectsOf(model)
        model.saveStart(online = true)
        assertEquals(1, runtime.calls.count { it == "computeEstimate" })
        assertEquals(SetupStatus.Ready, model.status)
        assertTrue(effects.contains(RunnerSetupEffect.RacesChanged))
    }

    @Test
    fun roomUnpaidOpensThePaywall() = runTest(dispatcher) {
        runtime.answer("gpxPreview", RuntimeResult.Failure("Race not unlocked", offline = false, status = 402, code = "room_unpaid"))
        val model = model()
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        model.chooseCourse("route.gpx", "<gpx/>", online = true)
        assertTrue(effects.contains(RunnerSetupEffect.OpenPaywall))
        assertEquals(SetupStatus.Ready, model.status)
    }

    @Test
    fun historyShowsTheComparisonAndHidesItWhenClientCoreSaysNull() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1"))
        runtime.answer(
            "computeEstimate",
            ok("""{"hasEstimate":true,"finishAt":"2026-08-15T21:50:00.000Z","comparison":"Finish 3:50 PM instead of 4:18 PM"}"""),
            ok("""{"hasEstimate":true,"finishAt":"2026-08-15T21:50:00.000Z","comparison":null}""")
        )
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        assertFalse(model.historyImported)
        model.importHistory("run.fit", "AAAA", online = true)
        assertEquals("Imported FIT · 8.0 km", model.historyMessage)
        // client-core's line, on the race's clock (the shared comparison iOS shows too).
        assertEquals("Finish 3:50 PM instead of 4:18 PM", model.comparison)
        assertEquals(listOf<String?>(HISTORY_COMPARE), runtime.historyModes)
        assertTrue(model.historyImported)
        assertTrue(model.draft.historyAttached)

        model.importHistory("run2.fit", "AAAA", online = true)
        assertNull(model.comparison)
        // Continue keeps the plan the comparison attached.
        model.finishHistory()
        assertEquals(2, runtime.historyModes.size)
        assertEquals(Triple(SetupSteps.HISTORY, "done", null as String?), runtime.marks.last())
    }

    @Test
    fun aRelaunchOnHistoryKeepsTheImportAndRebuildsTheComparison() = runTest(dispatcher) {
        drafts.save(
            "ada",
            RunnerSetupDraft(
                roomId = "room-1", historyImported = true, historyAttached = true,
                historyLine = "Finish 3:50 PM instead of 4:18 PM"
            )
        )
        // A new launch: nothing in SavedStateHandle, only the draft on disk.
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        assertTrue(model.historyImported)
        assertEquals("Finish 3:50 PM instead of 4:18 PM", model.comparison)
        assertTrue(runtime.historyModes.isEmpty())
        // Continue (done), never Skip, for history that went in.
        model.finishHistory()
        assertEquals(Triple(SetupSteps.HISTORY, "done", null as String?), runtime.marks.last())
    }

    @Test
    fun aRefusedHistoryFileShowsClientCoresMessageAndKeepsSkip() = runTest(dispatcher) {
        runtime.answer("importActivity", ok("""{"status":"error","message":"Couldn't read this FIT file. Export it again and retry."}"""))
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.importHistory("run.fit", "AAAA", online = true)
        assertEquals("Couldn't read this FIT file. Export it again and retry.", model.historyMessage)
        assertFalse(model.historyImported)
        assertNull(model.comparison)
        assertEquals(0, runtime.calls.count { it == "computeEstimate" })
    }

    @Test
    fun skipAttachesAColdStartAndContinueThePlanWithHistoryThenEachMarks() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.skipHistory()
        model.finishHistory()
        // Skip: no history at all, even after an import. Continue with nothing attached yet: all of it.
        assertEquals(listOf(HISTORY_NONE, null), runtime.historyModes)
        assertEquals(
            listOf(Triple(SetupSteps.HISTORY, "skipped", null as String?), Triple(SetupSteps.HISTORY, "done", null as String?)),
            runtime.marks
        )
    }

    @Test
    fun aSkipWhoseColdStartFailsStaysOnTheStep() = runTest(dispatcher) {
        runtime.answer("computeEstimate", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.skipHistory()
        assertTrue(runtime.marks.isEmpty())
        assertEquals(text.setupError, (model.status as SetupStatus.Failed).failure.message)
    }

    @Test
    fun theTeaserShowsTheFinishWithEveryAidStationLocked() = runTest(dispatcher) {
        val model = model()
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        val teaser = assertNotNullAnd(model.teaser)
        assertEquals("2026-08-15T22:10:00.000Z", teaser.finishAt)
        // The finish row's client-core clock, the same one the summary writes.
        assertEquals("16:10", teaser.finishClock)
        assertEquals("16:10", (teaser.rows.last() as TeaserRow.Open).row.clockLabel)
        assertEquals(listOf("start", "aid-1", "finish"), teaser.rows.map { it.checkpointId })
        assertEquals(TeaserRow.Locked("aid-1", "Aid 1"), teaser.rows[1])
        // The map's elevation comes from the route geometry the room answered.
        assertEquals(2, model.preview?.elevation?.size)
        model.finishTeaser()
        assertEquals(Triple(SetupSteps.TEASER, "done", "room-1"), runtime.marks.last())
        assertTrue(drafts.cleared)
        assertTrue(effects.any { it is RunnerSetupEffect.StateChanged })
    }

    @Test
    fun theTeaserComputesAPlanWhenTheRaceHasNone() = runTest(dispatcher) {
        runtime.answer("loadEstimate", ok("""{"hasEstimate":false,"offline":false}"""))
        val model = model()
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        assertEquals(1, runtime.calls.count { it == "computeEstimate" })
        assertNotNull(model.teaser)
    }

    @Test
    fun theTeaserEstimatorLimitIsAPlainFailureNotTheCourseCopy() = runTest(dispatcher) {
        runtime.answer("loadEstimate", ok("""{"hasEstimate":false,"offline":false}"""))
        runtime.answer("computeEstimate", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = model()
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        // The runner never changed the course here: no course-limit copy (as on iOS).
        val failed = model.status as SetupStatus.Failed
        assertEquals(text.setupError, failed.failure.message)
        assertTrue(failed.failure.retryable)
        assertNull(model.teaser)
    }

    @Test
    fun theTeaserFallsBackToThePlansFinishClock() = runTest(dispatcher) {
        runtime.answer("timeline", ok("""{"timeline":[]}"""))
        val model = model()
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        assertEquals("4:10 PM", model.teaser?.finishClock)
        // The race's finish (the schedule's), never the estimate's own moving-time finish.
        assertEquals("2026-08-15T22:10:00.000Z", model.teaser?.finishAt)
    }

    @Test
    fun theStepDraftAndOpenPickerSurviveProcessDeath() = runTest(dispatcher) {
        val saved = SavedStateHandle()
        val first = model(saved)
        first.sync(flow(SetupSteps.COURSE))
        first.chooseCourse("route.gpx", "<gpx/>", online = true)
        first.confirmCourse()
        first.updateStart(RaceStartFields(2026, 9, 12, 5, 0, "America/Los_Angeles"))
        first.openDialog(RunnerSetupViewModel.DIALOG_ZONE)
        first.updateZoneFilter("Los")
        // A new process: only the saved state and the course file. No draft on disk, so the draft
        // and the picker can only come back from SavedStateHandle.
        val disk = MemoryDrafts().apply {
            owner = "ada"
            course = "<gpx/>"
        }
        val restored = model(saved, store = disk, initialFlow = flow(SetupSteps.COURSE, roomId = "room-1"))
        // The resumed step draws before the first sync, never the account step first.
        assertEquals(SetupSteps.START_TIME, restored.step)
        assertEquals(RaceStartFields(2026, 9, 12, 5, 0, "America/Los_Angeles"), restored.start)
        assertEquals("room-1", restored.draft.roomId)
        assertEquals(RunnerSetupViewModel.DIALOG_ZONE, restored.dialog)
        assertEquals("Los", restored.zoneFilter)
        restored.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        assertEquals(SetupSteps.START_TIME, restored.step)
        restored.closeDialog()
        assertNull(model(saved, store = disk).dialog)
    }

    @Test
    fun aResumeDrawsTheStateItOpenedWith() = runTest(dispatcher) {
        val model = model(initialFlow = flow(SetupSteps.HISTORY, roomId = "room-1"))
        assertEquals(SetupSteps.HISTORY, model.step)
        assertEquals("room-1", model.roomId)
        // Without a state the step is unknown (the screen shows its loader), never the account step.
        assertNull(model().step)
    }

    private fun <T> assertNotNullAnd(value: T?): T {
        assertNotNull(value)
        return value!!
    }
}
