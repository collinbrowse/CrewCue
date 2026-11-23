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
import kotlinx.coroutines.test.advanceTimeBy
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
    raceNameMissing = "Add a race name to continue.",
    labels = mapOf("readingCourse" to "Reading your course…", "courseSaved" to "Course saved"),
    setupError = "Couldn't save this step.",
    setupOffline = "Offline. Setup needs the network. Your answers stay on this phone until you reconnect."
)

private const val SAVED_START = "2026-08-15T12:30:00.000Z"
private const val MOVED_START = "2026-08-15T13:00:00.000Z"
private const val COURSE_XML = "<gpx/>"

/** The race list's row for setup's race, as `myRaces` answers it. */
private fun raceRow(id: String = "room-1", name: String = "Western States 2026", hasCourse: Boolean = true, raceStartAt: String? = SAVED_START) =
    JSONObject().put("id", id).put("name", name).put("role", "athlete").put("hasCourse", hasCourse)
        .put("raceStartAt", raceStartAt ?: JSONObject.NULL)

/**
 * A draft on a phone that went through setup up to the history step: the race, its name, the
 * course file it holds and saved, and the start the race saved.
 */
private fun savedDraft(
    courseXml: String = COURSE_XML,
    savedCourseXml: String = COURSE_XML,
    courseUnsaved: Boolean = false
) = RunnerSetupDraft(
    roomId = "room-1",
    displayName = "Ada",
    raceName = "Canyons 2027",
    courseFileName = "route.gpx",
    courseConfirmed = true,
    plannedPaceSecondsPerKm = 420.0,
    start = RaceStartFields(2026, 8, 15, 6, 30, "America/Denver"),
    courseUnsaved = courseUnsaved,
    savedRaceStartAt = SAVED_START,
    courseFingerprint = FakeSetupSteps.fingerprint(courseXml),
    savedCourseFingerprint = FakeSetupSteps.fingerprint(savedCourseXml)
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
    /** What `suggestedDisplayName` was asked, and client-core's answer (scripted; the rule is Swift's). */
    val suggestions = mutableListOf<Pair<String?, String?>>()
    var suggest: (String?, String?) -> String? = { name, _ -> name?.trim() }

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

    /** The race's start read back into fields (client-core's conversion; scripted here). */
    val fieldsAsked = mutableListOf<Pair<String, String>>()
    override fun raceStartFields(raceStartAt: String, timeZone: String): RuntimeResult {
        fieldsAsked += raceStartAt to timeZone
        return RuntimeResult.Success(RaceStartFields(2026, 8, 15, 6, 30, timeZone).toJson())
    }

    val startSaves = mutableListOf<Pair<String, String>>()
    override fun updateRaceStart(roomId: String, raceStartAt: String): RuntimeResult {
        startSaves += roomId to raceStartAt
        return next("updateRaceStart", ok("""{"status":"saved","raceStartAt":"$raceStartAt"}"""))
    }

    /** `runnerSetupStep`: the RunnerSetupSteps rules, answered by [FakeSetupSteps]. Not in [calls]. */
    val decisions = mutableListOf<String>()
    override fun setupStep(decision: String, input: JSONObject): RuntimeResult {
        decisions += decision
        return FakeSetupSteps.answer(decision, input)
    }

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

    override fun suggestedDisplayName(name: String?, email: String?): String? {
        suggestions += name to email
        return suggest(name, email)
    }

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
    fun aSessionNameClientCoreRefusesNeverReachesTheNameCrewSee() = runTest(dispatcher) {
        // A session saved before email names were dropped: client-core says it is no name.
        runtime.suggest = { _, _ -> null }
        val model = model(name = "pat.runner@example.com")
        model.sync(flow(SetupSteps.ACCOUNT))
        assertEquals(listOf("pat.runner@example.com" to null as String?), runtime.suggestions)
        assertEquals("", model.draft.displayName)
        // Account done elsewhere: the race is created without the email as the creator's name.
        model.sync(flow(SetupSteps.COURSE))
        model.updateRaceName("Canyons 2027")
        model.chooseCourse("route.gpx", "<gpx/>", online = true)
        assertEquals(Triple("Canyons 2027", "ada", null as String?), runtime.created)
    }

    @Test
    fun aTypedNameIsKeptWithoutAskingClientCore() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(displayName = "Ada R"))
        runtime.suggest = { _, _ -> null }
        val model = model(name = "ada@example.com")
        assertEquals("Ada R", model.draft.displayName)
        assertTrue(runtime.suggestions.isEmpty())
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
        model.updateRaceName("Western States 2026")
        model.chooseCourse("States course.gpx", "<gpx/>", online = true)
        // The typed name, never the course file's.
        assertEquals(Triple("Western States 2026", "ada", "Ada"), runtime.created)
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
        model.goBack()
        assertEquals(SetupSteps.COURSE, model.step)
        assertTrue(model.isReviewing)
    }

    @Test
    fun offlineCourseKeepsTheFileAndTheStep() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        model.updateRaceName("Canyons 2027")
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
        model.updateRaceName("Canyons 2027")
        model.chooseCourse("route.gpx", "<gpx/>", online = false)
        // A new state while offline creates nothing on its own.
        model.sync(flow(SetupSteps.COURSE))
        assertNull(runtime.created)
        model.retry(online = true)
        assertEquals("Canyons 2027", runtime.created?.first)
        assertNotNull(model.preview)
        assertEquals(SetupStatus.Ready, model.status)
    }

    @Test
    fun aGoneRaceWithNoNameAsksForOneAndTryAgainWaitsForIt() = runTest(dispatcher) {
        // A draft from before race names: the race is gone and nothing names it.
        drafts.save("ada", RunnerSetupDraft(roomId = "gone", courseFileName = "route.gpx"))
        drafts.course = "<gpx/>"
        runtime.answer("gpxPreview", RuntimeResult.Failure("Race room not found", offline = false, status = 404), ok(PREVIEW))
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        // Never named after its course file: the step asks for a name, with the field open.
        assertEquals(text.raceNameMissing, (model.status as SetupStatus.Failed).failure.message)
        assertNull(model.roomId)
        assertFalse(model.raceNameLocked)
        assertTrue(model.courseNeedsRetry)
        assertFalse(model.canRetry)
        model.retry(online = true)
        assertNull(runtime.created)
        model.updateRaceName("Canyons 2027")
        assertTrue(model.canRetry)
        model.retry(online = true)
        assertEquals("Canyons 2027", runtime.created?.first)
        assertEquals("room-1", model.roomId)
        assertNotNull(model.preview)
    }

    @Test
    fun aGoneRaceIsMadeAgainWithTheRaceListsName() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "gone", courseFileName = "route.gpx"))
        drafts.course = "<gpx/>"
        runtime.answer("gpxPreview", RuntimeResult.Failure("Race room not found", offline = false, status = 404), ok(PREVIEW))
        val model = model()
        // No name typed on this phone; the race list still names the race this setup had.
        model.sync(flow(SetupSteps.COURSE), JSONArray().put(raceRow(id = "gone", hasCourse = false, raceStartAt = null)), racesVersion = 1)
        assertEquals("Western States 2026", runtime.created?.first)
        assertEquals("room-1", model.roomId)
        assertNotNull(model.preview)
        assertEquals("Western States 2026", model.shownRaceName)
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
        model.continueStart(online = true)
        assertEquals(listOf(listOf<Any?>("room-1", "route.gpx", "<gpx/>", "2026-08-15T12:30:00.000Z", 420.0)), runtime.imports)
        // The first plan, with all history, attached for the teaser.
        assertEquals(listOf<String?>(null), runtime.historyModes)
        assertTrue(effects.contains(RunnerSetupEffect.RacesChanged))
        // On to the history step at once, which runs again because the save dropped the estimate.
        assertEquals(SetupSteps.HISTORY, model.step)
        assertEquals(SAVED_START, model.draft.savedRaceStartAt)
        assertEquals(false, model.draft.courseUnsaved)
        assertTrue(model.draft.historyRedo)
        // Back to the start time and Continue with nothing changed: no second upload.
        model.goBack()
        assertEquals(SetupSteps.START_TIME, model.step)
        model.continueStart(online = true)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertEquals(1, runtime.imports.size)
        assertTrue(runtime.startSaves.isEmpty())
    }

    @Test
    fun offlineStartTimeKeepsTheStepAndQueuedCountsAsOffline() = runTest(dispatcher) {
        val model = startTimeModel()
        model.continueStart(online = false)
        assertTrue(model.status is SetupStatus.Offline)
        assertTrue(runtime.imports.isEmpty())
        runtime.answer("importCourse", ok("""{"status":"queued","id":"op-1"}"""))
        model.continueStart(online = true)
        assertTrue(model.status is SetupStatus.Offline)
        assertEquals(SetupSteps.START_TIME, model.step)
        assertNull(model.draft.uploadedStartAt)
    }

    @Test
    fun theCourseSaveLimitShowsTheSharedCopy() = runTest(dispatcher) {
        runtime.answer("importCourse", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        val model = startTimeModel()
        model.continueStart(online = true)
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
        model.continueStart(online = true)
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
        model.continueStart(online = true)
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
    fun anOfflineComparisonKeepsTheStepAndContinueAttachesFirst() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1"))
        // The import went in, then the network dropped: client-core answers ok with the plan this
        // phone cached and no comparison. Nothing was attached.
        runtime.answer("computeEstimate", ok("""{"hasEstimate":true,"finishAt":"2026-08-15T22:18:00.000Z","offline":true}"""))
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.importHistory("run.fit", "AAAA", online = true)
        assertTrue(model.historyImported)
        assertFalse(model.draft.historyAttached)
        assertNull(model.draft.historyLine)
        assertNull(model.comparison)
        assertEquals(text.setupOffline, (model.status as SetupStatus.Offline).failure.message)
        // Continue attaches the plan with all history first; still offline, the step stays unmarked.
        model.finishHistory()
        assertEquals(listOf(HISTORY_COMPARE, null), runtime.historyModes)
        assertTrue(runtime.marks.isEmpty())
        assertTrue(model.status is SetupStatus.Offline)
        // Back online: attached, then marked.
        runtime.answer("computeEstimate", ok("""{"hasEstimate":true,"finishAt":"2026-08-15T22:18:00.000Z","offline":false}"""))
        model.finishHistory()
        assertEquals(listOf(Triple(SetupSteps.HISTORY, "done", null as String?)), runtime.marks)
    }

    @Test
    fun anOfflineSkipStaysOnTheStepWithoutTheColdStart() = runTest(dispatcher) {
        runtime.answer("computeEstimate", ok("""{"hasEstimate":true,"finishAt":"2026-08-15T22:18:00.000Z","offline":true}"""))
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.skipHistory()
        assertEquals(listOf<String?>(HISTORY_NONE), runtime.historyModes)
        assertTrue(runtime.marks.isEmpty())
        assertEquals(text.setupOffline, (model.status as SetupStatus.Offline).failure.message)
    }

    @Test
    fun aSecondImportWhoseComparisonFailsClearsTheFirstLine() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1"))
        runtime.answer(
            "computeEstimate",
            ok("""{"hasEstimate":true,"finishAt":"2026-08-15T21:50:00.000Z","comparison":"Finish 3:50 PM instead of 4:18 PM","offline":false}"""),
            RuntimeResult.Failure("Couldn't compute the estimate.", offline = false, status = 500)
        )
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        model.importHistory("run.fit", "AAAA", online = true)
        assertEquals("Finish 3:50 PM instead of 4:18 PM", model.comparison)
        assertTrue(model.draft.historyAttached)
        model.importHistory("run2.fit", "AAAA", online = true)
        // The first file's line described a plan this import replaced.
        assertNull(model.comparison)
        assertNull(model.draft.historyLine)
        assertFalse(model.draft.historyAttached)
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
        first.updateRaceName("Canyons 2027")
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

    // MARK: race name

    @Test
    fun theRaceNameComesFirstAndGatesTheCourseFile() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE))
        assertFalse(model.raceNameLocked)
        assertFalse(model.canChooseCourse)
        // Choose course file waits for the name: nothing is created, nothing held.
        model.chooseCourse("States course.gpx", "<gpx/>", online = true)
        assertNull(runtime.created)
        assertNull(model.draft.courseFileName)
        // Kept in the setup draft as it is typed, on disk too, so a relaunch keeps it.
        model.updateRaceName("  Canyons 2027 ")
        assertEquals("  Canyons 2027 ", model.draft.raceName)
        assertEquals("  Canyons 2027 ", drafts.draft?.raceName)
        assertTrue(model.canChooseCourse)
        model.chooseCourse("States course.gpx", "<gpx/>", online = true)
        assertEquals("Canyons 2027", runtime.created?.first)
        // Read-only once the race exists: the API has no rename.
        assertTrue(model.raceNameLocked)
        model.updateRaceName("Renamed")
        assertEquals("Canyons 2027", model.shownRaceName)
        assertEquals("Canyons 2027", drafts.draft?.raceName)
    }

    @Test
    fun aTypedRaceNameSurvivesARelaunch() = runTest(dispatcher) {
        val first = model()
        first.sync(flow(SetupSteps.COURSE))
        first.updateRaceName("Canyons 2027")
        // A new launch: nothing in SavedStateHandle, only the draft on disk.
        val relaunched = model()
        relaunched.sync(flow(SetupSteps.COURSE))
        assertEquals("Canyons 2027", relaunched.draft.raceName)
        assertTrue(relaunched.canChooseCourse)
    }

    // MARK: Back

    @Test
    fun backFromTheFirstStepLeavesSetupOnlyBeforeARaceExists() = runTest(dispatcher) {
        val model = model()
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.ACCOUNT))
        assertTrue(model.showsBack)
        model.updateName("Ada R")
        model.goBack()
        assertEquals(listOf<RunnerSetupEffect>(RunnerSetupEffect.LeaveSetup), effects.filter { it == RunnerSetupEffect.LeaveSetup })
        // The name typed stays for when the runner picks the runner's setup again.
        assertEquals("Ada R", model.draft.displayName)

        // Signed out, too: Back is the way to the chooser.
        val guest = model(userId = null, name = null)
        val guestEffects = effectsOf(guest)
        guest.sync(flow(SetupSteps.ACCOUNT))
        assertTrue(guest.showsBack)
        guest.goBack()
        assertTrue(guestEffects.contains(RunnerSetupEffect.LeaveSetup))
    }

    @Test
    fun backFromTheCourseKeepsTheTypedRaceNameAcrossProcessDeath() = runTest(dispatcher) {
        val saved = SavedStateHandle()
        val model = model(saved)
        model.sync(flow(SetupSteps.COURSE))
        model.updateRaceName("Canyons 2027")
        model.goBack()
        assertEquals(SetupSteps.ACCOUNT, model.step)
        assertTrue(model.isReviewing)
        // No race yet: Back still shows here, for the chooser.
        assertTrue(model.showsBack)
        val restored = model(saved, initialFlow = flow(SetupSteps.COURSE))
        assertEquals(SetupSteps.ACCOUNT, restored.step)
        assertEquals("Canyons 2027", restored.draft.raceName)
        // Continue on the account step opens the course again, the name as typed.
        restored.sync(flow(SetupSteps.COURSE))
        restored.saveAccount()
        assertEquals(SetupSteps.COURSE, restored.step)
        assertFalse(restored.isReviewing)
        assertEquals("Canyons 2027", restored.draft.raceName)
    }

    @Test
    fun backOpensEachStepBeforeWithEverythingKeptAndContinueWalksBackWithoutSaving() = runTest(dispatcher) {
        drafts.save("ada", savedDraft())
        drafts.course = COURSE_XML
        val model = model()
        val effects = effectsOf(model)
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"))
        assertEquals(SetupSteps.HISTORY, model.step)
        assertFalse(model.isReviewing)
        assertTrue(model.showsBack)

        model.goBack()
        assertEquals(SetupSteps.START_TIME, model.step)
        assertTrue(model.isReviewing)
        assertEquals(RaceStartFields(2026, 8, 15, 6, 30, "America/Denver"), model.start)
        model.goBack()
        assertEquals(SetupSteps.COURSE, model.step)
        assertTrue(model.raceNameLocked)
        assertEquals("Canyons 2027", model.shownRaceName)
        assertEquals("route.gpx", model.shownCourseFileName)
        model.goBack()
        assertEquals(SetupSteps.ACCOUNT, model.step)
        assertEquals("Ada", model.draft.displayName)
        // The race exists: no way back to the chooser from here.
        assertFalse(model.showsBack)
        model.goBack()
        assertEquals(SetupSteps.ACCOUNT, model.step)
        assertFalse(effects.contains(RunnerSetupEffect.LeaveSetup))

        // Continue opens the next step, one at a time, until setup is back where it was.
        model.saveAccount()
        assertEquals(SetupSteps.COURSE, model.step)
        assertTrue(model.isReviewing)
        assertEquals(CourseContinue.Confirm, model.courseAction)
        model.continueCourse(online = true)
        assertEquals(SetupSteps.START_TIME, model.step)
        assertEquals(StartTimeContinue.MoveOn, model.startAction)
        model.continueStart(online = true)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertFalse(model.isReviewing)
        // Nothing changed, so nothing was saved again.
        assertTrue(runtime.imports.isEmpty())
        assertTrue(runtime.startSaves.isEmpty())
        assertFalse(effects.contains(RunnerSetupEffect.RacesChanged))
    }

    // MARK: a reviewed step's Continue

    /** Setup on the teaser, then Back to [step]. */
    private fun reviewing(step: String, draft: RunnerSetupDraft = savedDraft(), course: String? = COURSE_XML): RunnerSetupViewModel {
        drafts.save("ada", draft)
        drafts.course = course
        val model = model()
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        while (model.step != step) model.goBack()
        return model
    }

    @Test
    fun aStartOnlyChangeIsSavedWithPatchRaceStart() = runTest(dispatcher) {
        val model = reviewing(SetupSteps.START_TIME)
        val effects = effectsOf(model)
        runtime.answer("raceStartInput", ok("""{"raceStartAt":"$MOVED_START","problem":null,"message":null}"""))
        model.updateStart(RaceStartFields(2026, 8, 15, 7, 0, "America/Denver"))
        assertEquals(StartTimeContinue.SaveStart, model.startAction)
        model.continueStart(online = true)
        assertEquals(listOf("room-1" to MOVED_START), runtime.startSaves)
        // The start alone: no course file goes up, and the estimate moved with the start.
        assertTrue(runtime.imports.isEmpty())
        assertEquals(MOVED_START, model.draft.savedRaceStartAt)
        assertFalse(model.draft.historyRedo)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertTrue(model.isReviewing)
        assertTrue(effects.contains(RunnerSetupEffect.RacesChanged))
        // The reviewed history step keeps the race's estimate: Continue, no new estimate, no mark.
        assertTrue(model.historyShowsContinue)
        val estimates = runtime.historyModes.size
        model.finishHistory()
        assertEquals(estimates, runtime.historyModes.size)
        assertTrue(runtime.marks.none { it.first == SetupSteps.HISTORY })
        assertEquals(SetupSteps.TEASER, model.step)
    }

    @Test
    fun aStartSaveOverTheLimitShowsTheCourseSaveCopy() = runTest(dispatcher) {
        val model = reviewing(SetupSteps.START_TIME)
        runtime.answer("raceStartInput", ok("""{"raceStartAt":"$MOVED_START","problem":null,"message":null}"""))
        runtime.answer("updateRaceStart", RuntimeResult.Failure("Too many requests", offline = false, status = 429))
        model.updateStart(RaceStartFields(2026, 8, 15, 7, 0, "America/Denver"))
        model.continueStart(online = true)
        assertEquals(text.courseSaveLimit, (model.status as SetupStatus.Failed).failure.message)
        assertEquals(SetupSteps.START_TIME, model.step)
        assertEquals(SAVED_START, model.draft.savedRaceStartAt)
    }

    @Test
    fun aNewFileAfterBackGoesUpWithTheStartAndTheHistoryRunsAgain() = runTest(dispatcher) {
        val model = reviewing(SetupSteps.COURSE)
        val other = "<gpx><trk/></gpx>"
        model.chooseCourse("other.gpx", other, online = true)
        // It replaced the course once it previewed; it isn't saved until the start time.
        assertEquals("other.gpx", model.draft.courseFileName)
        assertEquals(true, model.draft.courseUnsaved)
        assertTrue(runtime.imports.isEmpty())
        model.continueCourse(online = true)
        assertEquals(SetupSteps.START_TIME, model.step)
        assertEquals(StartTimeContinue.SaveCourse, model.startAction)
        model.continueStart(online = true)
        assertEquals(listOf(listOf<Any?>("room-1", "other.gpx", other, SAVED_START, 420.0)), runtime.imports)
        assertTrue(runtime.startSaves.isEmpty())
        // The save dropped the estimate: the reviewed history step computes one again on Continue.
        assertEquals(SetupSteps.HISTORY, model.step)
        assertTrue(model.isReviewing)
        assertTrue(model.draft.historyRedo)
        val estimates = runtime.historyModes.size
        model.finishHistory()
        assertEquals(estimates + 1, runtime.historyModes.size)
        assertEquals(Triple(SetupSteps.HISTORY, "done", null as String?), runtime.marks.last())
        assertFalse(model.draft.historyRedo)
        assertEquals(SetupSteps.TEASER, model.step)
    }

    @Test
    fun theSameFilePickedAgainChangesNothing() = runTest(dispatcher) {
        val model = reviewing(SetupSteps.COURSE)
        val previews = runtime.calls.count { it == "gpxPreview" }
        model.chooseCourse("route copy.gpx", "\n$COURSE_XML\n", online = true)
        assertEquals(previews, runtime.calls.count { it == "gpxPreview" })
        assertEquals("route.gpx", model.draft.courseFileName)
        assertEquals(false, model.draft.courseUnsaved)
    }

    @Test
    fun aRelaunchReopensTheStepWithAFilePickedAfterBackAndTheSavedCoursePickedAgainIsNotSavedTwice() = runTest(dispatcher) {
        // Back on the course, another file picked and confirmed, then the app was closed.
        val other = "<gpx><trk/></gpx>"
        drafts.save("ada", savedDraft(courseXml = other, courseUnsaved = true))
        drafts.course = other
        val model = model()
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"))
        // The start time, where that file is saved with the start.
        assertEquals(SetupSteps.START_TIME, model.step)
        assertTrue(model.isReviewing)
        assertEquals(StartTimeContinue.SaveCourse, model.startAction)
        // Back to the course: the race's own course picked again isn't uploaded a second time.
        model.goBack()
        model.chooseCourse("route.gpx", COURSE_XML, online = true)
        assertEquals(false, model.draft.courseUnsaved)
        model.continueCourse(online = true)
        assertEquals(StartTimeContinue.MoveOn, model.startAction)
        model.continueStart(online = true)
        assertTrue(runtime.imports.isEmpty())
        assertEquals(SetupSteps.HISTORY, model.step)
    }

    @Test
    fun cancelAfterAnUnreadableFileKeepsTheCourseFromBefore() = runTest(dispatcher) {
        val model = reviewing(SetupSteps.COURSE)
        val before = model.preview
        assertNotNull(before)
        // The course from before is on the map.
        model.noteCourseMapReady()
        runtime.answer("gpxPreview", RuntimeResult.Failure("Couldn't read this GPX file.", offline = false, status = 400))
        model.chooseCourse("broken.gpx", "<nope/>", online = true)
        assertTrue(model.status is SetupStatus.Failed)
        assertTrue(model.courseNeedsRetry)
        assertTrue(model.canCancelCourse)
        assertEquals("broken.gpx", model.shownCourseFileName)
        // No loader over a failed preview: the error and Try again.
        assertFalse(model.courseLoading)
        model.cancelPendingCourse()
        assertEquals(SetupStatus.Ready, model.status)
        assertFalse(model.canCancelCourse)
        assertEquals("route.gpx", model.shownCourseFileName)
        assertEquals("route.gpx", model.draft.courseFileName)
        assertEquals(COURSE_XML, drafts.course)
        assertEquals(before, model.preview)
        assertEquals(CourseContinue.Confirm, model.courseAction)
    }

    @Test
    fun aPhoneWithoutTheFileShowsCourseSavedAndUploadsNothing() = runTest(dispatcher) {
        // Signed in on another phone: no draft, no file. The race list has the course and start.
        val model = model()
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"), JSONArray().put(raceRow()), racesVersion = 1)
        // The start time shows the race's saved start, in this phone's zone.
        assertEquals(listOf(SAVED_START to "America/Denver"), runtime.fieldsAsked)
        assertEquals(RaceStartFields(2026, 8, 15, 6, 30, "America/Denver"), model.start)
        assertEquals(SAVED_START, model.draft.savedRaceStartAt)
        model.goBack()
        assertEquals(SetupSteps.START_TIME, model.step)
        assertEquals(StartTimeContinue.MoveOn, model.startAction)
        model.goBack()
        assertEquals(SetupSteps.COURSE, model.step)
        assertTrue(model.showsCourseSaved)
        assertEquals("Western States 2026", model.shownRaceName)
        assertTrue(model.raceNameLocked)
        model.continueCourse(online = true)
        assertEquals(SetupSteps.START_TIME, model.step)
        model.continueStart(online = true)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertTrue(runtime.imports.isEmpty())
        assertTrue(runtime.startSaves.isEmpty())
        assertEquals(0, runtime.calls.count { it == "gpxPreview" })
    }

    @Test
    fun aRelaunchChecksAgainOnEachFreshRaceListUntilItReopensAStep() = runTest(dispatcher) {
        // A course save after the history step dropped its estimate, then the app was closed.
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1", displayName = "Ada", historyRedo = true))
        val model = model()
        // The cached list still has the history step open: nothing behind it to reopen.
        model.sync(flow(SetupSteps.HISTORY, roomId = "room-1"), JSONArray(), racesVersion = 1)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertFalse(model.isReviewing)
        // The fresh list has setup on the teaser: the history step opens again.
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"), JSONArray(), racesVersion = 2)
        assertEquals(SetupSteps.HISTORY, model.step)
        assertTrue(model.isReviewing)
        assertTrue(model.historyShowsContinue)
        // Continue computes the estimate the save dropped; the next list reopens nothing.
        model.finishHistory()
        assertEquals(SetupSteps.TEASER, model.step)
        model.sync(flow(SetupSteps.TEASER, roomId = "room-1"), JSONArray(), racesVersion = 3)
        assertEquals(SetupSteps.TEASER, model.step)
    }

    // MARK: the course loader

    @Test
    fun theLoaderCoversAPickedPreviewUntilItsMapIsReadyAtMostEightSeconds() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        assertFalse(model.courseLoading)
        model.chooseCourse("route.gpx", COURSE_XML, online = true)
        assertNotNull(model.preview)
        assertTrue(model.courseLoading)
        assertEquals("Reading your course…", model.courseLoadingCaption)
        advanceTimeBy(RunnerSetupViewModel.MAP_WAIT_MS - 1)
        assertTrue(model.courseLoading)
        advanceTimeBy(2)
        assertFalse(model.courseLoading)
        assertNull(model.courseLoadingCaption)
    }

    @Test
    fun theMapsFirstFullFrameEndsTheWait() = runTest(dispatcher) {
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        model.chooseCourse("route.gpx", COURSE_XML, online = true)
        assertTrue(model.courseLoading)
        model.noteCourseMapReady()
        assertFalse(model.courseLoading)
        // Another file, another course: its own wait again.
        runtime.answer("gpxPreview", ok(PREVIEW.replace("39.01]", "39.02]")))
        model.chooseCourse("other.gpx", "<gpx><trk/></gpx>", online = true)
        assertTrue(model.courseLoading)
        assertEquals("Reading your course…", model.courseLoadingCaption)
    }

    @Test
    fun aPreviewRestoredAfterARelaunchWaitsWithNoCaption() = runTest(dispatcher) {
        drafts.save("ada", RunnerSetupDraft(roomId = "room-1", displayName = "Ada", raceName = "Canyons 2027", courseFileName = "route.gpx"))
        drafts.course = COURSE_XML
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        assertNotNull(model.preview)
        assertTrue(model.courseLoading)
        // Spoken "Loading": no "Reading your course…" for a file read before the relaunch.
        assertNull(model.courseLoadingCaption)
        model.noteCourseMapReady()
        assertFalse(model.courseLoading)
    }

    @Test
    fun aFailedPreviewShowsTheErrorWithNoLoader() = runTest(dispatcher) {
        runtime.answer("gpxPreview", RuntimeResult.Failure("Couldn't read this GPX file.", offline = false, status = 400))
        val model = model()
        model.sync(flow(SetupSteps.COURSE, roomId = "room-1"))
        model.chooseCourse("route.gpx", COURSE_XML, online = true)
        assertTrue(model.status is SetupStatus.Failed)
        assertFalse(model.courseLoading)
        assertNull(model.courseLoadingCaption)
        assertTrue(model.courseNeedsRetry)
    }

    private fun <T> assertNotNullAnd(value: T?): T {
        assertNotNull(value)
        return value!!
    }
}
