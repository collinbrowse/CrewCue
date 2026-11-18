package com.crewcue.android.ui.onboarding

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.crewcue.android.data.RuntimeResult
import kotlin.math.floor
import kotlin.math.min
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The room body `GET /race-rooms/:roomId` answered, as the runtime hands it back to save. */
private val ROOM_BODY = JSONObject("""{"room":{"id":"room-1","name":"Tahoe 50K"},"permissions":{}}""")
private val SAVED_BODY = JSONObject("""{"room":{"id":"room-1","name":"Saved Tahoe 50K"},"permissions":{}}""")

/**
 * client-core's replay runtime, scripted on the test clock: the 25 s `DemoRacePlayer` (50 steps
 * half a second apart; beats at 10, 14 and 20 s) behind `demoRaceCreate` and its controls.
 */
private class FakeReplayRuntime(private val now: () -> Long) : RacePreviewRuntime {
    val creates = mutableListOf<ReplayRoom>()
    val controls = mutableListOf<Pair<ReplayControl, String>>()
    val seeks = mutableListOf<Pair<String, Double>>()
    val marks = mutableListOf<Pair<String, String>>()
    /** Answers for a create, by kind; the default is a replay. */
    var readFails: RuntimeResult.Failure? = null
    var savedFails: RuntimeResult.Failure? = null
    var fixtureFails: RuntimeResult.Failure? = null
    var markAnswer: RuntimeResult = RuntimeResult.Success(
        JSONObject().put("state", JSONObject().put("flow", "runner").put("phase", "preview").put("step", "paywall").put("roomId", "room-1"))
    )
    private val players = mutableMapOf<String, Player>()
    private var made = 0

    private inner class Player {
        var banked = 0.0
        var since: Long? = null
        var step = 0
        var finished = false

        fun elapsed(): Double = min(DURATION, banked + (since?.let { (now() - it) / 1000.0 } ?: 0.0))
    }

    val live: Set<String> get() = players.filterValues { !it.finished }.keys

    override fun create(room: ReplayRoom): RuntimeResult {
        creates += room
        when (room) {
            is ReplayRoom.Read -> readFails
            is ReplayRoom.Saved -> savedFails
            ReplayRoom.Fixture -> fixtureFails
        }?.let { return it }
        // One replay at a time: creating one retires the earlier one.
        players.values.forEach { it.finished = true }
        made += 1
        val base = "https://r$made.demo.invalid"
        val player = Player()
        players[base] = player
        val result = JSONObject()
            .put("baseURL", base)
            .put("viewerUserId", if (room == ReplayRoom.Fixture) "runner-fixture" else "ada")
            .put("roomId", if (room == ReplayRoom.Fixture) "room-fixture-replay" else "room-1")
            .put("durationSeconds", DURATION)
            .put("stepSeconds", STEP)
            // The finish the replay starts from: the one passed in, else the plan's.
            .put("finishEtaAt", (room as? ReplayRoom.Saved)?.finishEtaAt ?: PLAN_FINISH)
            .put("snapshot", snapshot(player, changed = false))
        if (room is ReplayRoom.Read) result.put("room", ROOM_BODY)
        return RuntimeResult.Success(result)
    }

    override fun control(baseUrl: String, control: ReplayControl): RuntimeResult {
        controls += control to baseUrl
        val player = players[baseUrl]?.takeIf { !it.finished }
            ?: return RuntimeResult.Failure("The race-day replay has ended.", offline = false)
        var changed = false
        when (control) {
            ReplayControl.Play -> if (player.since == null) player.since = now()
            ReplayControl.Pause -> player.since?.let {
                player.banked = player.elapsed()
                player.since = null
            }
            ReplayControl.Tick -> {
                val elapsed = player.elapsed()
                val step = if (elapsed >= DURATION) STEPS - 1 else floor(elapsed / STEP).toInt()
                changed = step > player.step || elapsed >= DURATION
                player.step = step
                if (elapsed >= DURATION) {
                    player.finished = true
                    player.banked = DURATION
                    player.since = null
                }
            }
            ReplayControl.Skip -> {
                player.finished = true
                changed = true
            }
        }
        return RuntimeResult.Success(snapshot(player, changed))
    }

    override fun seek(baseUrl: String, seconds: Double): RuntimeResult {
        seeks += baseUrl to seconds
        val player = players[baseUrl]?.takeIf { !it.finished }
            ?: return RuntimeResult.Failure("The race-day replay has ended.", offline = false)
        if (seconds > player.elapsed() && seconds < DURATION) {
            player.banked = seconds
            if (player.since != null) player.since = now()
            player.step = floor(seconds / STEP).toInt()
        }
        return RuntimeResult.Success(snapshot(player, changed = true))
    }

    override fun markPreview(outcome: String, roomId: String): RuntimeResult {
        marks += outcome to roomId
        return markAnswer
    }

    private fun snapshot(player: Player, changed: Boolean): JSONObject {
        val seconds = player.step * STEP
        val beat = when {
            seconds < 10 -> ReplayBeats.FOLLOWING
            seconds < 14 -> ReplayBeats.FALLING_BEHIND
            seconds < 20 -> ReplayBeats.DEAD_ZONE
            else -> ReplayBeats.CREW_CHAT
        }
        val number = listOf(ReplayBeats.FOLLOWING, ReplayBeats.FALLING_BEHIND, ReplayBeats.DEAD_ZONE, ReplayBeats.CREW_CHAT).indexOf(beat) + 1
        return JSONObject()
            .put("progress", if (player.finished) 1.0 else player.elapsed() / DURATION)
            .put("beat", beat)
            .put("beatNumber", number)
            .put("beatLabel", "$number of 4")
            .put("caption", "caption $beat")
            .put("stepIndex", player.step)
            .put("playing", !player.finished && player.since != null)
            .put("finished", player.finished)
            .put("skipped", false)
            .put("changed", changed)
    }

    companion object {
        const val PLAN_FINISH = "2026-08-15T20:15:00.000Z"
        const val DURATION = 25.0
        const val STEP = 0.5
        const val STEPS = 50
    }
}

private class MemoryRooms : ReplayRoomStore {
    var saved: Triple<String, String, JSONObject>? = null
    var cleared = 0

    override fun load(userId: String, roomId: String): JSONObject? =
        saved?.takeIf { it.first == userId && it.second == roomId }?.third

    override fun save(userId: String, roomId: String, room: JSONObject) {
        saved = Triple(userId, roomId, room)
    }

    override fun keepOnly(userId: String, roomId: String) {
        if (saved?.first != userId || saved?.second != roomId) saved = null
    }

    override fun clear() {
        cleared += 1
        saved = null
    }
}

/** Stands in for a replay view's model, to see the replay's store cleared. */
private class ProbeModel : ViewModel() {
    var cleared = false

    public override fun onCleared() {
        cleared = true
    }
}

private val race = RacePreviewSource.Race(userId = "ada", roomId = "room-1")

@OptIn(ExperimentalCoroutinesApi::class)
class RacePreviewViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val rooms = MemoryRooms()
    private lateinit var runtime: FakeReplayRuntime

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        runtime = FakeReplayRuntime { dispatcher.scheduler.currentTime }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /** Every model's store a test made, cleared when its body ends. */
    private val stores = mutableListOf<ViewModelStore>()

    /**
     * [runTest] on the test clock. Each model's store is cleared when the body ends, as the route
     * going away does, so no replay a test left playing or waiting keeps work on Main.
     */
    private fun replayTest(body: suspend TestScope.() -> Unit) = runTest(dispatcher) {
        try {
            body()
        } finally {
            stores.forEach { it.clear() }
        }
    }

    /** The model in a store of its own, so a test can clear it as a route going away does. */
    private fun TestScope.model(
        saved: SavedStateHandle = SavedStateHandle(),
        store: ViewModelStore = ViewModelStore(),
        io: CoroutineDispatcher = dispatcher,
        background: CoroutineScope = backgroundScope
    ): RacePreviewViewModel {
        stores += store
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                RacePreviewViewModel(runtime, rooms, saved, background, io = io) as T
        }
        return ViewModelProvider(store, factory)[RacePreviewViewModel::class.java]
    }

    /**
     * The flow's one replay model as a NavHost entry asks for it (`rememberRacePreviewModel`): in
     * the shell's [RacePreviewModels], its saved state the activity's [saved] across flows.
     */
    private fun TestScope.replayModel(flow: RacePreviewModels, saved: SavedStateHandle): RacePreviewViewModel {
        stores += flow.viewModelStore
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                RacePreviewViewModel(runtime, rooms, saved, backgroundScope, io = dispatcher) as T
        }
        return ViewModelProvider(flow, factory)[RACE_PREVIEW_MODEL_KEY, RacePreviewViewModel::class.java]
    }

    private fun TestScope.effectsOf(model: RacePreviewViewModel): MutableList<RacePreviewEffect> {
        val seen = mutableListOf<RacePreviewEffect>()
        // Unconfined: each effect lands at once, however the test drives the clock.
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.effects.collect { seen += it } }
        return seen
    }

    /** Shown and watched: the replay plays from its start. */
    private fun TestScope.playing(model: RacePreviewViewModel, source: RacePreviewSource = race): RacePreviewViewModel {
        model.setWatched(true)
        model.show(source)
        runCurrent()
        return model
    }

    private fun ViewModelStore.probe(): ProbeModel {
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ProbeModel() as T
        }
        return ViewModelProvider(this, factory)[ProbeModel::class.java]
    }

    @Test
    fun theReplayPlaysTheRunnersOwnRaceThroughTheFourBeatsThenThePaywall() = replayTest {
        val model = playing(model())
        // Read once from the API, and saved for an offline replay.
        assertEquals(listOf<ReplayRoom>(ReplayRoom.Read("room-1")), runtime.creates)
        assertEquals("ada" to "room-1", rooms.saved?.let { it.first to it.second })
        assertEquals(RacePreviewStatus.Playing, model.status)
        val replay = assertNotNullAnd(model.replay)
        assertEquals("ada", replay.viewerUserId)
        assertTrue(model.playing)
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        assertEquals(ReplayPanel.Map, model.panel)

        advanceTimeBy(5_100)
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        assertEquals("1 of 4", model.beatLabel)
        assertEquals(10, model.stepIndex)
        // Beat 2: the finish slips later; compact follows to Pace.
        advanceTimeBy(7_000)
        assertEquals(ReplayBeats.FALLING_BEHIND, model.beat)
        assertEquals("2 of 4", model.beatLabel)
        assertEquals("caption fallingBehind", model.caption)
        assertEquals(ReplayPanel.Pace, model.panel)
        // Beat 3: the dead zone, back on the Map for Last update.
        advanceTimeBy(4_000)
        assertEquals(ReplayBeats.DEAD_ZONE, model.beat)
        assertEquals(ReplayPanel.Map, model.panel)
        // Beat 4: the crew message, in Chat.
        advanceTimeBy(6_000)
        assertEquals(ReplayBeats.CREW_CHAT, model.beat)
        assertEquals("4 of 4", model.beatLabel)
        assertEquals(ReplayPanel.Chat, model.panel)
        // The end opens the paywall, and the runtime is gone.
        advanceTimeBy(4_000)
        runCurrent()
        assertEquals(RacePreviewStage.Paywall, model.stage)
        assertNull(model.replay)
        assertTrue(runtime.live.isEmpty())
    }

    @Test
    fun skipEndsTheReplayAndItsViewsAndOpensThePaywall() = replayTest {
        val model = playing(model())
        val replay = assertNotNullAnd(model.replay)
        val views = replay.models.probe()
        advanceTimeBy(3_000)
        model.skip()
        runCurrent()
        assertEquals(RacePreviewStage.Paywall, model.stage)
        assertNull(model.replay)
        assertTrue(views.cleared)
        assertTrue(runtime.controls.contains(ReplayControl.Skip to replay.baseUrl))
        assertTrue(runtime.live.isEmpty())
        // Nothing more is asked of it.
        val asked = runtime.controls.size
        advanceTimeBy(10_000)
        assertEquals(asked, runtime.controls.size)
    }

    @Test
    fun backFromThePaywallReplaysFromTheStartWithoutASecondRead() = replayTest {
        val model = playing(model())
        advanceTimeBy(12_100)
        assertEquals(ReplayBeats.FALLING_BEHIND, model.beat)
        model.skip()
        runCurrent()
        model.replayFromStart()
        runCurrent()
        assertEquals(RacePreviewStage.Replay, model.stage)
        assertEquals(RacePreviewStatus.Playing, model.status)
        // The body this flow read, played again from the same finish: no second GET
        // /race-rooms/:roomId and no second schedule read for the plan's finish.
        assertEquals(
            listOf(ReplayRoom.Read("room-1"), ReplayRoom.Saved("room-1", ROOM_BODY, FakeReplayRuntime.PLAN_FINISH)),
            runtime.creates
        )
        assertFalse(model.fromSavedRace)
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        assertEquals(ReplayPanel.Map, model.panel)
        assertEquals(0.0, model.progress, 0.01)
        assertTrue(model.playing)
    }

    @Test
    fun playPauseHoldsTheClockAndTheBeatUntilPlayAgain() = replayTest {
        val model = playing(model())
        advanceTimeBy(4_100)
        model.togglePlay()
        runCurrent()
        assertTrue(model.pausedByUser)
        assertFalse(model.playing)
        val replay = assertNotNullAnd(model.replay)
        assertEquals(ReplayControl.Pause to replay.baseUrl, runtime.controls.last { it.first != ReplayControl.Tick })
        val held = model.progress
        advanceTimeBy(20_000)
        assertEquals(held, model.progress, 0.0)
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        model.togglePlay()
        runCurrent()
        assertFalse(model.pausedByUser)
        assertTrue(model.playing)
        advanceTimeBy(6_500)
        assertEquals(ReplayBeats.FALLING_BEHIND, model.beat)
    }

    @Test
    fun theReplayPausesWhileNobodySeesItAndCarriesOnAfter() = replayTest {
        val model = playing(model())
        advanceTimeBy(2_100)
        model.setWatched(false)
        runCurrent()
        assertFalse(model.playing)
        assertFalse(model.pausedByUser)
        val held = model.progress
        advanceTimeBy(30_000)
        assertEquals(held, model.progress, 0.0)
        model.setWatched(true)
        runCurrent()
        assertTrue(model.playing)
    }

    @Test
    fun pausedOrUnseenTheReplayAsksNothingOfTheRuntimeUntilItPlaysAgain() = replayTest {
        val model = playing(model())
        advanceTimeBy(3_100)
        model.togglePlay()
        // The loop sees the pause at its next step, then waits for Play.
        advanceTimeBy(1_000)
        val paused = runtime.controls.size
        advanceTimeBy(60_000)
        assertEquals("nothing asked while paused", paused, runtime.controls.size)
        model.togglePlay()
        runCurrent()
        assertTrue(model.playing)
        advanceTimeBy(2_000)
        assertTrue("the loop ticks again", runtime.controls.count { it.first == ReplayControl.Tick } > 0)
        assertTrue(runtime.controls.size > paused + 2)
        // Nobody sees it (the app in the background): the same.
        model.setWatched(false)
        advanceTimeBy(1_000)
        val unseen = runtime.controls.size
        advanceTimeBy(60_000)
        assertEquals("nothing asked while unseen", unseen, runtime.controls.size)
        model.setWatched(true)
        runCurrent()
        assertTrue(model.playing)
        advanceTimeBy(1_000)
        assertTrue(runtime.controls.size > unseen + 1)
        assertEquals(RacePreviewStatus.Playing, model.status)
    }

    @Test
    fun twoEntriesDrawingTheRouteShareOneReplayThatKeepsPlaying() = replayTest {
        // The activity's saved state, which outlives every NavHost entry and every flow.
        val saved = SavedStateHandle()
        val flow = RacePreviewModels()
        // The teaser's Continue: the entry leaving (for its last frames and the crossfade) and the
        // entry arriving both draw the race preview route, each asking for the flow's model.
        val leaving = replayModel(flow, saved)
        val arriving = replayModel(flow, saved)
        assertSame(leaving, arriving)
        val leavingScreen = Any()
        val arrivingScreen = Any()
        leaving.setWatched(true, by = leavingScreen)
        leaving.show(race)
        arriving.setWatched(true, by = arrivingScreen)
        arriving.show(race)
        runCurrent()
        // One room read, one replay: nothing retires the one on screen.
        assertEquals(listOf<ReplayRoom>(ReplayRoom.Read("room-1")), runtime.creates)
        assertEquals(RacePreviewStatus.Playing, arriving.status)
        assertTrue(arriving.playing)
        // The leaving entry stops and goes; the arriving one's replay plays on.
        leaving.setWatched(false, by = leavingScreen)
        runCurrent()
        assertTrue(arriving.playing)
        advanceTimeBy(12_100)
        assertEquals(RacePreviewStatus.Playing, arriving.status)
        assertEquals(ReplayBeats.FALLING_BEHIND, arriving.beat)
        assertEquals(1, runtime.creates.size)
        assertEquals(1, runtime.live.size)
        // The shell leaves the route: the flow's replay ends with its views, and its moment goes.
        val replay = assertNotNullAnd(arriving.replay)
        val views = replay.models.probe()
        flow.end()
        runCurrent()
        assertTrue(views.cleared)
        assertTrue(runtime.controls.contains(ReplayControl.Skip to replay.baseUrl))
        assertTrue(runtime.live.isEmpty())
        assertTrue(saved.keys().none { it.startsWith("race-preview.") })
        // The next flow on the same race starts from the top, not from the last flow's moment.
        val next = replayModel(flow, saved)
        assertNotSame(arriving, next)
        playing(next)
        assertEquals(RacePreviewStage.Replay, next.stage)
        assertEquals(ReplayBeats.FOLLOWING, next.beat)
        assertTrue(runtime.seeks.isEmpty())
        assertEquals(RacePreviewStatus.Playing, next.status)
    }

    @Test
    fun notNowMarksThePreviewSkippedForgetsTheSavedRoomAndRoutes() = replayTest {
        val model = playing(model())
        val effects = effectsOf(model)
        model.skip()
        runCurrent()
        model.notNow()
        advanceUntilIdle()
        assertEquals(listOf(RacePreviewViewModel.OUTCOME_SKIPPED to "room-1"), runtime.marks)
        assertNull(rooms.saved)
        val finished = effects.single() as RacePreviewEffect.Finished
        assertNull(finished.purchasedRoomId)
        assertEquals("paywall", finished.state?.optString("step"))
        // The paywall stays until the shell routes away; nothing plays.
        assertEquals(RacePreviewStage.Paywall, model.stage)
        assertTrue(runtime.live.isEmpty())
        assertFalse(model.finishing)
    }

    @Test
    fun aPurchaseMarksThePreviewDoneAndTellsTheShellWhichRaceItUnlocked() = replayTest {
        val model = playing(model())
        val effects = effectsOf(model)
        model.skip()
        runCurrent()
        model.purchased()
        // A second unlocked read while marking changes nothing.
        model.purchased()
        advanceUntilIdle()
        assertEquals(listOf(RacePreviewViewModel.OUTCOME_DONE to "room-1"), runtime.marks)
        assertNull(rooms.saved)
        val finished = effects.single() as RacePreviewEffect.Finished
        assertEquals("room-1", finished.purchasedRoomId)
        assertNotNull(finished.state)
    }

    @Test
    fun aMarkThatCantAnswerStillFinishesSoTheShellReadsTheStateAgain() = replayTest {
        runtime.markAnswer = RuntimeResult.Failure("Request failed", offline = false)
        val model = playing(model())
        val effects = effectsOf(model)
        model.skip()
        model.notNow()
        advanceUntilIdle()
        assertEquals(RacePreviewEffect.Finished(state = null, purchasedRoomId = null), effects.single())
    }

    @Test
    fun offlineItPlaysTheRaceSavedOnThisPhoneWithTheOfflineCopy() = replayTest {
        rooms.save("ada", "room-1", SAVED_BODY)
        runtime.readFails = RuntimeResult.Failure("The Internet connection appears to be offline.", offline = true, state = "offline")
        val model = playing(model())
        assertEquals(listOf(ReplayRoom.Read("room-1"), ReplayRoom.Saved("room-1", SAVED_BODY)), runtime.creates)
        assertEquals(RacePreviewStatus.Playing, model.status)
        assertTrue(model.fromSavedRace)
        assertNotNull(model.replay)
    }

    @Test
    fun offlineWithNothingSavedShowsTheOfflineStateWithSkip() = replayTest {
        runtime.readFails = RuntimeResult.Failure("offline", offline = true, state = "offline")
        val model = playing(model())
        assertEquals(RacePreviewStatus.Offline, model.status)
        assertNull(model.replay)
        // Another race's body never plays for this one.
        rooms.save("ada", "room-2", SAVED_BODY)
        model.skip()
        assertEquals(RacePreviewStage.Paywall, model.stage)
        assertEquals(listOf<ReplayRoom>(ReplayRoom.Read("room-1")), runtime.creates)
    }

    @Test
    fun emptyAndErrorAreTheStatesClientCoreNames() = replayTest {
        runtime.readFails = RuntimeResult.Failure("The replay needs a course with at least two checkpoints.", offline = false, state = "empty")
        assertEquals(RacePreviewStatus.Empty, playing(model()).status)
        runtime.readFails = RuntimeResult.Failure("Race room not found", offline = false, status = 404, state = "error")
        assertEquals(RacePreviewStatus.Error, playing(model(store = ViewModelStore())).status)
        // An answer without a state (an older runtime) is Error, or Offline when it says so.
        runtime.readFails = RuntimeResult.Failure("Request failed", offline = false)
        assertEquals(RacePreviewStatus.Error, playing(model(store = ViewModelStore())).status)
        // An offline saved body that won't play is the state client-core names for it.
        rooms.save("ada", "room-1", SAVED_BODY)
        runtime.readFails = RuntimeResult.Failure("offline", offline = true, state = "offline")
        runtime.savedFails = RuntimeResult.Failure("no course", offline = false, state = "empty")
        assertEquals(RacePreviewStatus.Empty, playing(model(store = ViewModelStore())).status)
    }

    @Test
    fun processDeathBringsBackTheStageTheMomentTheBeatAndThePause() = replayTest {
        val saved = SavedStateHandle()
        val first = playing(model(saved))
        advanceTimeBy(12_100)
        first.togglePlay()
        first.selectPanel(ReplayPanel.Chat)
        runCurrent()
        // The process goes; the saved state comes back in a new model.
        val restored = SavedStateHandle(saved.keys().associateWith { saved.get<Any?>(it) })
        val second = model(restored, store = ViewModelStore())
        assertEquals(ReplayBeats.FALLING_BEHIND, second.beat)
        assertEquals(ReplayPanel.Chat, second.panel)
        assertTrue(second.pausedByUser)
        playing(second)
        val replay = assertNotNullAnd(second.replay)
        // A new runtime, moved to the moment the first had reached; the person's pick and pause stay.
        assertEquals(12.0, runtime.seeks.single().second, 0.1)
        assertEquals(replay.baseUrl, runtime.seeks.single().first)
        assertEquals(ReplayBeats.FALLING_BEHIND, second.beat)
        assertEquals(ReplayPanel.Chat, second.panel)
        assertTrue(second.pausedByUser)
        assertFalse(second.playing)
        advanceTimeBy(10_000)
        assertEquals(ReplayBeats.FALLING_BEHIND, second.beat)
    }

    @Test
    fun processDeathOnThePaywallKeepsThePaywallWithNoReplay() = replayTest {
        val saved = SavedStateHandle()
        val first = playing(model(saved))
        first.skip()
        runCurrent()
        val restored = SavedStateHandle(saved.keys().associateWith { saved.get<Any?>(it) })
        val second = playing(model(restored, store = ViewModelStore()))
        assertEquals(RacePreviewStage.Paywall, second.stage)
        assertNull(second.replay)
        assertEquals(1, runtime.creates.size)
    }

    @Test
    fun aRelaunchReplaysFromTheStart() = replayTest {
        playing(model())
        advanceTimeBy(16_000)
        // A cold start has no saved state: beat 1, no seek.
        val relaunched = playing(model(SavedStateHandle(), store = ViewModelStore()))
        assertEquals(ReplayBeats.FOLLOWING, relaunched.beat)
        assertEquals(RacePreviewStage.Replay, relaunched.stage)
        assertTrue(runtime.seeks.isEmpty())
    }

    @Test
    fun theRouteGoingAwayEndsTheRuntimeAndItsViews() = replayTest {
        val store = ViewModelStore()
        val model = playing(model(store = store))
        val replay = assertNotNullAnd(model.replay)
        val views = replay.models.probe()
        // Sign-out, the flow finishing or the state moving on pops the route: its store clears.
        store.clear()
        runCurrent()
        assertTrue(views.cleared)
        assertTrue(runtime.controls.contains(ReplayControl.Skip to replay.baseUrl))
        assertTrue(runtime.live.isEmpty())
        // The saved room stays: an offline relaunch can still play it.
        assertNotNull(rooms.saved)
    }

    @Test
    fun aRuntimeMadeForAReplayThatIsAlreadyGoneIsEnded() = replayTest {
        // The runtime's thread runs only when this test says, so the create can be caught mid-way.
        val ioScheduler = TestCoroutineScheduler()
        val io = StandardTestDispatcher(ioScheduler)
        // The teardown runs on the runtime's thread too, outside the test scope's own scheduler.
        val model = model(io = io, background = CoroutineScope(SupervisorJob() + io))
        model.setWatched(true)
        model.show(race)
        runCurrent()
        assertTrue("the create hasn't run yet", runtime.creates.isEmpty())
        // The person skips while the create is under way; then it finishes.
        model.skip()
        ioScheduler.runCurrent()
        assertEquals(1, runtime.live.size)
        runCurrent()
        ioScheduler.runCurrent()
        assertEquals(RacePreviewStage.Paywall, model.stage)
        assertNull(model.replay)
        assertTrue("the runtime made for the gone replay was ended", runtime.live.isEmpty())
        // A later replay is never retired by it.
        model.replayFromStart()
        runCurrent()
        ioScheduler.runCurrent()
        runCurrent()
        ioScheduler.runCurrent()
        runCurrent()
        assertEquals(RacePreviewStatus.Playing, model.status)
        assertEquals(1, runtime.live.size)
    }

    @Test
    fun anotherRaceStartsOverAndForgetsTheLastRacesRoom() = replayTest {
        val model = playing(model())
        val first = assertNotNullAnd(model.replay)
        advanceTimeBy(8_000)
        val other = RacePreviewSource.Race(userId = "ada", roomId = "room-2")
        model.show(other)
        runCurrent()
        assertTrue(runtime.controls.contains(ReplayControl.Skip to first.baseUrl))
        assertEquals(ReplayRoom.Read("room-2"), runtime.creates.last())
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        // room-1's saved body went; room-2's read saved its own.
        assertEquals("room-2", rooms.saved?.second)
        // The same source again carries on where it is.
        val creates = runtime.creates.size
        model.show(other)
        runCurrent()
        assertEquals(creates, runtime.creates.size)
    }

    @Test
    fun theDevRoutePlaysTheFixtureWithNoApiAtTheLinksMomentAndHoldsThere() = replayTest {
        val source = RacePreviewSource.Fixture(start = RacePreviewDevStart(atSeconds = 12.0, paused = true))
        val model = playing(model(), source)
        assertEquals(listOf<ReplayRoom>(ReplayRoom.Fixture), runtime.creates)
        assertEquals(12.0, runtime.seeks.single().second, 0.0)
        assertEquals(ReplayBeats.FALLING_BEHIND, model.beat)
        assertEquals("2 of 4", model.beatLabel)
        assertEquals(ReplayPanel.Pace, model.panel)
        assertTrue(model.pausedByUser)
        assertFalse(model.playing)
        advanceTimeBy(30_000)
        assertEquals(ReplayBeats.FALLING_BEHIND, model.beat)
        // Back from the paywall: the start, still paused.
        model.skip()
        model.replayFromStart()
        runCurrent()
        assertEquals(ReplayBeats.FOLLOWING, model.beat)
        assertTrue(model.pausedByUser)
        assertEquals(1, runtime.seeks.size)
        // The fixture never saves or forgets a real race's room.
        assertNull(rooms.saved)
        assertEquals(0, rooms.cleared)
    }

    @Test
    fun theDevRoutesStateShowsOnTheRealScreenAndNotNowLeavesIt() = replayTest {
        for (state in listOf("empty", "error", "offline")) {
            val model = playing(model(store = ViewModelStore()), RacePreviewSource.Fixture(state = state))
            assertEquals(RacePreviewStatus.of(state), model.status)
            assertNull(model.replay)
        }
        assertTrue(runtime.creates.isEmpty())
        val model = playing(model(store = ViewModelStore()), RacePreviewSource.Fixture())
        val effects = effectsOf(model)
        model.skip()
        model.notNow()
        runCurrent()
        assertEquals(listOf<RacePreviewEffect>(RacePreviewEffect.LeftDevRoute), effects)
        assertTrue(runtime.marks.isEmpty())
    }

    @Test
    fun theLoopWakesForTheNextHalfSecondStep() {
        val replay = RacePreviewReplay("https://r.demo.invalid", "ada", "room-1", durationSeconds = 25.0, stepSeconds = 0.5)
        assertEquals(500L, RacePreviewViewModel.millisToNextStep(0.0, replay))
        assertEquals(300L, RacePreviewViewModel.millisToNextStep(0.2 / 25.0, replay))
        assertEquals(20L, RacePreviewViewModel.millisToNextStep(24.999 / 25.0, replay))
    }

    @Test
    fun theDevLinkNamesItsMomentAndPause() {
        assertEquals(RacePreviewDevStart(4.0, paused = true), RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview?at=4&paused=1"))
        assertEquals(RacePreviewDevStart(12.5, paused = false), RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview?state=success&at=12.5"))
        assertEquals(RacePreviewDevStart(0.0, paused = true), RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview?paused=true"))
        assertNull(RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview"))
        assertNull(RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview?state=empty"))
        assertNull(RacePreviewDevStart.parse("crewcue://dev/onboarding-race-preview?at=-3"))
    }

    @Test
    fun aSnapshotReadsTheRuntimesShape() {
        val snapshot = ReplaySnapshot.from(
            JSONObject("""{"progress":0.48,"beat":"fallingBehind","beatNumber":2,"beatLabel":"2 of 4","caption":"c","stepIndex":24,"playing":true,"finished":false,"changed":true}""")
        )
        assertEquals(ReplaySnapshot(0.48, ReplayBeats.FALLING_BEHIND, "2 of 4", "c", 24, playing = true, finished = false, changed = true), snapshot)
        assertNull(ReplaySnapshot.from(JSONObject("{}")))
        assertNull(ReplaySnapshot.from(null))
        assertNull(RacePreviewReplay.from(JSONObject("""{"durationSeconds":25}""")))
    }

    private fun <T> assertNotNullAnd(value: T?): T {
        assertNotNull(value)
        return value!!
    }
}
