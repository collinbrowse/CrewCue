package com.crewcue.android.ui.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** The replay route (client-core `Route`), the onboarding preview step's screen. */
const val RACE_PREVIEW_FEATURE = "onboarding-race-preview"

/** Root test tag of the replay (clients/behavior/onboarding-race-preview.md). */
const val RACE_PREVIEW_TAG = "crewcue.onboarding-race-preview"

/** Root test tag of the paywall that ends the replay. */
const val ONBOARDING_PAYWALL_TAG = "crewcue.onboarding-paywall"

fun racePreviewTag(part: String): String = "$RACE_PREVIEW_TAG.$part"

fun onboardingPaywallTag(part: String): String = "$ONBOARDING_PAYWALL_TAG.$part"

/** client-core `DemoRaceBeat` names. */
object ReplayBeats {
    const val FOLLOWING = "following"
    const val FALLING_BEHIND = "fallingBehind"
    const val DEAD_ZONE = "deadZone"
    const val CREW_CHAT = "crewChat"
}

/** Where the replay's race comes from. */
sealed interface RacePreviewSource {
    /** Which replay: another key starts over, the same one carries on where it was. */
    val key: String

    /** Onboarding: the runner's own race. */
    data class Race(val userId: String, val roomId: String) : RacePreviewSource {
        override val key: String get() = "race|$userId|$roomId"
    }

    /**
     * `crewcue://dev/onboarding-race-preview`: `DemoRaceFixture` with no API. [state] (`?state=`)
     * shows that checklist state on the real screen, Skip included; [start] is the link's
     * `?at=&paused=` (debug builds only).
     */
    data class Fixture(val state: String = STATE_SUCCESS, val start: RacePreviewDevStart? = null) : RacePreviewSource {
        override val key: String get() = "fixture|$state|${start?.key.orEmpty()}"
    }

    companion object {
        const val STATE_SUCCESS = "success"
    }
}

/**
 * `crewcue://dev/onboarding-race-preview?at=<seconds>&paused=1`: the fixture replay opens [atSeconds]
 * in, at the step, beat, caption and view it would have reached playing, and with [paused] it holds
 * there (Back from the paywall too, at the start). Tests read each beat this way instead of racing
 * the 25 s clock. The onboarding flow never has one.
 */
data class RacePreviewDevStart(val atSeconds: Double, val paused: Boolean) {
    val key: String get() = "$atSeconds|$paused"

    companion object {
        /** Null when the link sets neither. */
        fun parse(url: String?): RacePreviewDevStart? {
            val query = url?.substringAfter('?', missingDelimiterValue = "").orEmpty()
            if (query.isEmpty()) return null
            var at: Double? = null
            var paused: Boolean? = null
            for (pair in query.split('&')) {
                val bits = pair.split('=', limit = 2)
                if (bits.size != 2) continue
                when (bits[0]) {
                    "at" -> bits[1].toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }?.let { at = it }
                    "paused" -> paused = bits[1] == "1" || bits[1] == "true"
                }
            }
            if (at == null && paused == null) return null
            return RacePreviewDevStart(at ?: 0.0, paused ?: false)
        }
    }
}

enum class RacePreviewStage { Replay, Paywall }

/** client-core `FeatureState` for the replay, plus loading: a replay that can't start shows its state with Skip. */
enum class RacePreviewStatus {
    Loading, Playing, Empty, Error, Offline;

    companion object {
        /** client-core's checklist state (`DemoRace.unavailableState`, or the dev route's `?state=`). */
        fun of(state: String?): RacePreviewStatus = when (state) {
            "empty" -> Empty
            "offline" -> Offline
            else -> Error
        }
    }
}

/** The view a compact width shows: it follows the beats, and the strip can pick another. */
enum class ReplayPanel {
    Map, Pace, Chat;

    companion object {
        /** Map shows the dot moving and Last update (following, dead zone), Pace the finish slipping, Chat the crew message. */
        fun forBeat(beat: String): ReplayPanel = when (beat) {
            ReplayBeats.FALLING_BEHIND -> Pace
            ReplayBeats.CREW_CHAT -> Chat
            else -> Map
        }
    }
}

/** One `DemoRaceSnapshot` from the runtime. */
data class ReplaySnapshot(
    /** 0 at the start, 1 once finished or skipped. */
    val progress: Double,
    val beat: String,
    /** "2 of 4", shared copy. */
    val beatLabel: String,
    val caption: String,
    val stepIndex: Int,
    val playing: Boolean,
    val finished: Boolean,
    val changed: Boolean
) {
    companion object {
        fun from(json: JSONObject?): ReplaySnapshot? {
            json ?: return null
            val beat = json.optText("beat").ifBlank { return null }
            return ReplaySnapshot(
                progress = json.optDouble("progress", 0.0).takeIf { it.isFinite() } ?: 0.0,
                beat = beat,
                beatLabel = json.optText("beatLabel"),
                caption = json.optText("caption"),
                stepIndex = json.optInt("stepIndex", 0),
                playing = json.optBoolean("playing"),
                finished = json.optBoolean("finished"),
                changed = json.optBoolean("changed")
            )
        }
    }
}

/**
 * One replay on screen: its runtime base URL and the store its Map, Pace and Chat models live in.
 * The store is cleared when the replay ends, so those models stop and let go of the runtime.
 */
class RacePreviewReplay(
    val baseUrl: String,
    /** The runtime's `viewerUserId`: the user the replay's ops speak for. */
    val viewerUserId: String,
    val roomId: String,
    val durationSeconds: Double,
    val stepSeconds: Double
) {
    val models = ViewModelStore()

    companion object {
        fun from(created: JSONObject): RacePreviewReplay? {
            val baseUrl = created.optText("baseURL").ifBlank { return null }
            val duration = created.optDouble("durationSeconds", Double.NaN).takeIf { it.isFinite() && it > 0 } ?: return null
            val step = created.optDouble("stepSeconds", Double.NaN).takeIf { it.isFinite() && it > 0 } ?: DEFAULT_STEP_SECONDS
            return RacePreviewReplay(
                baseUrl = baseUrl,
                viewerUserId = created.optText("viewerUserId"),
                roomId = created.optText("roomId"),
                durationSeconds = duration,
                stepSeconds = step
            )
        }

        /** client-core `DemoRaceScript.stepSeconds`, until the runtime says. */
        const val DEFAULT_STEP_SECONDS = 0.5
    }
}

/**
 * The race preview flow's models: the one [RacePreviewViewModel] (key [RACE_PREVIEW_MODEL_KEY]) and
 * its paywall's billing. The shell holds them, not a NavHost entry: AppRouter keeps an entry per
 * route and each draws the shell's current screen, so while the route changes (the frame before it
 * navigates, then the crossfade) two entries compose the race preview at once. Resolved here, both
 * get the same replay: one room read, one `demoRaceCreate`, nothing retiring the replay on screen.
 * The shell calls [end] where it leaves the route.
 */
class RacePreviewModels : ViewModelStoreOwner {
    override val viewModelStore: ViewModelStore = ViewModelStore()

    /** The flow is over: its replay ends (`RacePreviewViewModel.onCleared`); the next one starts fresh. */
    fun end() = viewModelStore.clear()
}

/** The flow's replay model in [RacePreviewModels]. */
const val RACE_PREVIEW_MODEL_KEY = "onboarding-race-preview.replay"

/** What the replay asks the shell to do. The shell owns the session, the race list and the routes. */
sealed interface RacePreviewEffect {
    /**
     * Not now or a purchase marked the preview step: route by [state] (`markOnboardingStep`'s
     * answer; null if it couldn't answer, so read the state again). [purchasedRoomId]: the
     * purchase unlocked that race, so it opens with no Unlock race banner and the race list is read again.
     */
    data class Finished(val state: JSONObject?, val purchasedRoomId: String? = null) : RacePreviewEffect

    /** The dev route's Not now: the app's own launch. */
    data object LeftDevRoute : RacePreviewEffect
}

/**
 * Runner onboarding phase 2 (clients/behavior/onboarding-race-preview.md): about 25 s of race day on
 * the runner's own course, played in the real Map, Pace and Chat views, then the paywall.
 *
 * The replay runs on its own client-core runtime (`demoRaceCreate`): a separate base URL with a
 * scripted transport and clock, no outbox and no token, and its own temporary directory. The views'
 * models are built on a second bridge on that base URL with no role, so they offer no edit and never
 * upload, recompute or track. Progress on every readout comes from the scripted runner pings the
 * replay's `GET .../pings/latest` answers, never from this phone's GPS.
 *
 * The clock (the runtime's player), the beat, the stage and the view live here, not in a composable,
 * so a fold, a resize or a rotation carries on from the same moment; [SavedStateHandle] keeps them
 * across process death, and a new runtime then seeks to that moment. A relaunch replays from the start.
 * There is one per flow, in [RacePreviewModels], whichever NavHost entry draws the route.
 */
class RacePreviewViewModel(
    private val runtime: RacePreviewRuntime,
    private val rooms: ReplayRoomStore,
    private val savedState: SavedStateHandle,
    /** Teardown that outlives this model (ending the runtime from [onCleared]). */
    private val background: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {
    private val effectQueue = Channel<RacePreviewEffect>(Channel.UNLIMITED)
    val effects: Flow<RacePreviewEffect> = effectQueue.receiveAsFlow()

    var stage by mutableStateOf(savedState.get<String>(KEY_STAGE)?.let(::stageOf) ?: RacePreviewStage.Replay)
        private set
    var status by mutableStateOf(RacePreviewStatus.Loading)
        private set
    var beat by mutableStateOf(savedState.get<String>(KEY_BEAT) ?: ReplayBeats.FOLLOWING)
        private set
    var beatLabel by mutableStateOf("")
        private set
    var caption by mutableStateOf("")
        private set
    /** 0 to 1 through the replay. */
    var progress by mutableDoubleStateOf(0.0)
        private set
    var playing by mutableStateOf(false)
        private set
    var pausedByUser by mutableStateOf(savedState.get<Boolean>(KEY_PAUSED) == true)
        private set
    /** Offline, the replay plays from the room saved on this phone. */
    var fromSavedRace by mutableStateOf(false)
        private set
    var panel by mutableStateOf(savedState.get<String>(KEY_PANEL)?.let(::panelOf) ?: ReplayPanel.Map)
        private set
    /** The replay playing now, null while it loads or when it can't play. */
    var replay by mutableStateOf<RacePreviewReplay?>(null)
        private set
    /** The step on screen: each new one reads the runner again (the Map model's refresh). */
    var stepIndex by mutableIntStateOf(0)
        private set
    /** Not now or a purchase is marking the step. */
    var finishing by mutableStateOf(false)
        private set
    var source: RacePreviewSource? = null
        private set

    /** The room body this flow read: Back from the paywall replays it without a second read. */
    private var roomBody: JSONObject? = null
    /** The finish this flow's first replay started from (the plan's): a replay again starts there too. */
    private var roomFinish: String? = null
    private var generation = 0
    private var starting: Job? = null
    private var loop: Job? = null
    /**
     * The screens showing the flow in the foreground ([setWatched]): it may play while there is one.
     * During a route change two NavHost entries draw the route at once, so one leaving never
     * pauses the other's.
     */
    private val watchers = mutableSetOf<Any>()
    private val watched: Boolean get() = watchers.isNotEmpty()
    /** Watched and not paused by the person: the paused loop waits on this instead of polling. */
    private val wantsPlay = MutableStateFlow(false)
    /** One create at a time, so an older one can't retire (`demoRaceCreate`) a newer replay. */
    private val createGate = Mutex()
    /** Play, pause and ticks reach the runtime in the order they were asked for. */
    private val controlGate = Mutex()

    // MARK: Showing

    /**
     * The flow is on screen for [next]. The same source carries on where it was and starts nothing:
     * the paywall stays, a replay playing or starting keeps its moment, and one that couldn't play
     * keeps its Empty, Error or Offline state (Skip, then Back, plays it again). Another source
     * starts over. After process death the saved stage, moment and pause come back for the same source.
     */
    fun show(next: RacePreviewSource) {
        val current = source
        if (current?.key == next.key) return
        val restoring = current == null && savedState.get<String>(KEY_SOURCE) == next.key
        if (current != null) {
            reset()
            // Another race (or the dev fixture): the last race's saved room goes with its flow.
            if (current is RacePreviewSource.Race) forgetRoomsBut(next as? RacePreviewSource.Race)
        }
        source = next
        savedState[KEY_SOURCE] = next.key
        if (restoring) {
            if (stage == RacePreviewStage.Paywall) return
            begin(atSeconds = savedState.get<Double>(KEY_SECONDS), paused = pausedByUser, restoring = true)
            return
        }
        stage = RacePreviewStage.Replay
        begin(atSeconds = devStart()?.atSeconds, paused = devStart()?.paused == true)
    }

    /**
     * The screen [by] shows the flow in the foreground ([value]), or no longer does: the replay
     * pauses while nobody sees it. Each screen drawing the route passes its own [by].
     */
    fun setWatched(value: Boolean, by: Any = this) {
        val was = watched
        if (value) watchers += by else watchers -= by
        if (watched != was) applyPlayback()
    }

    // MARK: Controls

    fun togglePlay() {
        if (replay == null || status != RacePreviewStatus.Playing) return
        pausedByUser = !pausedByUser
        persist()
        applyPlayback()
    }

    /** The compact strip: Map, Pace or Chat. The next beat moves it on again. */
    fun selectPanel(next: ReplayPanel) {
        panel = next
        persist()
    }

    /** Always available: ends the replay and opens the paywall. */
    fun skip() {
        if (finishing) return
        endSession()
        stage = RacePreviewStage.Paywall
        persist()
    }

    /** Back from the paywall (the button, system or predictive back): the replay again from its start. */
    fun replayFromStart() {
        if (source == null || finishing) return
        stage = RacePreviewStage.Replay
        // The dev route's paused start stays paused, at the first beat.
        begin(atSeconds = null, paused = devStart()?.paused == true)
    }

    /** Not now: the race stays unpaid behind the Unlock race banner, the step is skipped. */
    fun notNow() {
        when (val current = source) {
            is RacePreviewSource.Race -> finishWith(OUTCOME_SKIPPED, current, purchased = false)
            is RacePreviewSource.Fixture -> {
                endSession()
                effectQueue.trySend(RacePreviewEffect.LeftDevRoute)
            }
            null -> Unit
        }
    }

    /** The paywall's purchase unlocked the race (the server's billing read says paid): the step is done. */
    fun purchased() {
        val current = source as? RacePreviewSource.Race ?: return
        finishWith(OUTCOME_DONE, current, purchased = true)
    }

    /**
     * The shell left the route ([RacePreviewModels.end]): the flow finished, the person signed out
     * (the shell clears the saved room with the rest of the user's data), or the state moved on.
     * The replay's runtime ends, and so does the saved moment: the next flow starts from the top.
     * Process death never clears a model, so the saved moment is still there for a restore.
     */
    override fun onCleared() {
        endSession()
        SAVED_KEYS.forEach { savedState.remove<Any>(it) }
    }

    // MARK: Replay

    private fun devStart(): RacePreviewDevStart? = (source as? RacePreviewSource.Fixture)?.start

    /** [atSeconds]: the dev route's or a restored moment; null plays from the beginning. */
    private fun begin(atSeconds: Double?, paused: Boolean, restoring: Boolean = false) {
        endSession()
        val ticket = generation
        status = RacePreviewStatus.Loading
        progress = 0.0
        fromSavedRace = false
        pausedByUser = paused
        beatLabel = ""
        caption = ""
        stepIndex = 0
        // A restored replay keeps its beat and view until the runtime reaches the same moment.
        if (!restoring) {
            beat = ReplayBeats.FOLLOWING
            panel = ReplayPanel.Map
        }
        persist(seconds = atSeconds ?: 0.0)
        starting = viewModelScope.launch { start(ticket, atSeconds?.takeIf { it > 0 }) }
    }

    private sealed interface Created {
        data class Ready(val json: JSONObject, val fromSaved: Boolean, val body: JSONObject?) : Created
        data class Unavailable(val status: RacePreviewStatus) : Created
    }

    private suspend fun start(ticket: Int, atSeconds: Double?) {
        val current = source ?: return
        val known = roomBody?.let { KnownRoom(it, roomFinish) }
        try {
            createGate.withLock {
                // Not cancellable, and on Main between the runtime calls: a runtime made for a
                // replay that is gone by then (another begin, an end, onCleared) is ended here,
                // never lost, and one still wanted is always installed.
                withContext(NonCancellable) { install(ticket, current, known, atSeconds) }
            }
        } finally {
            if (ticket == generation) starting = null
        }
    }

    /** The room body this flow read, and the finish its first replay started from. */
    private class KnownRoom(val body: JSONObject, val finishEtaAt: String?)

    private suspend fun install(ticket: Int, current: RacePreviewSource, known: KnownRoom?, atSeconds: Double?) {
        val created = withContext(io) { create(current, known) }
        val made = (created as? Created.Ready)?.let { RacePreviewReplay.from(it.json) }
        if (ticket != generation) {
            made?.let(::end)
            return
        }
        when (created) {
            is Created.Unavailable -> status = created.status
            is Created.Ready -> {
                if (made == null) {
                    status = RacePreviewStatus.Error
                    return
                }
                created.body?.let { body ->
                    if (roomBody !== body) roomFinish = created.json.optText("finishEtaAt").ifBlank { null }
                    roomBody = body
                }
                var snapshot = ReplaySnapshot.from(created.json.optJSONObject("snapshot"))
                if (atSeconds != null) {
                    // Before the views read the replay, so their first read is at that moment.
                    val seeked = controlGate.withLock { withContext(io) { runtime.seek(made.baseUrl, atSeconds) } }
                    ReplaySnapshot.from((seeked as? RuntimeResult.Success)?.result)?.let { snapshot = it }
                }
                if (ticket != generation) {
                    end(made)
                    return
                }
                fromSavedRace = created.fromSaved
                replay = made
                snapshot?.let { apply(it, made) }
                status = RacePreviewStatus.Playing
                applyPlayback()
                loop = viewModelScope.launch { run(ticket) }
            }
        }
    }

    /** The race's body: this flow's, else `GET /race-rooms/:roomId` once (saved for offline), else offline the one saved on this phone. Blocks. */
    private fun create(current: RacePreviewSource, known: KnownRoom?): Created = when (current) {
        is RacePreviewSource.Fixture ->
            if (current.state != RacePreviewSource.STATE_SUCCESS) {
                Created.Unavailable(RacePreviewStatus.of(current.state))
            } else {
                ready(runtime.create(ReplayRoom.Fixture), fromSaved = false, body = null)
            }
        is RacePreviewSource.Race -> {
            if (known != null) {
                ready(runtime.create(ReplayRoom.Saved(current.roomId, known.body, known.finishEtaAt)), fromSaved = false, body = known.body)
            } else {
                when (val read = runtime.create(ReplayRoom.Read(current.roomId))) {
                    is RuntimeResult.Success -> {
                        val body = read.result.optJSONObject("room")
                        if (body != null) rooms.save(current.userId, current.roomId, body)
                        Created.Ready(read.result, fromSaved = false, body = body)
                    }
                    is RuntimeResult.Failure -> {
                        val unavailable = statusOf(read)
                        val saved = if (unavailable == RacePreviewStatus.Offline) rooms.load(current.userId, current.roomId) else null
                        if (saved != null) {
                            ready(runtime.create(ReplayRoom.Saved(current.roomId, saved)), fromSaved = true, body = null)
                        } else {
                            Created.Unavailable(unavailable)
                        }
                    }
                }
            }
        }
    }

    private fun ready(result: RuntimeResult, fromSaved: Boolean, body: JSONObject?): Created = when (result) {
        is RuntimeResult.Success -> Created.Ready(result.result, fromSaved, body)
        is RuntimeResult.Failure -> Created.Unavailable(statusOf(result))
    }

    private fun statusOf(failure: RuntimeResult.Failure): RacePreviewStatus =
        RacePreviewStatus.of(failure.state ?: if (failure.offline) "offline" else "error")

    /** Ticks the runtime to the end, waking for each step; the paywall follows the last one. */
    private suspend fun run(ticket: Int) {
        while (ticket == generation) {
            val current = replay ?: return
            val result = controlGate.withLock { withContext(io) { runtime.control(current.baseUrl, ReplayControl.Tick) } }
            if (ticket != generation) return
            val snapshot = ReplaySnapshot.from((result as? RuntimeResult.Success)?.result)
            if (snapshot == null) {
                // The runtime ended under the replay (another one replaced it): it can't go on.
                endSession()
                status = RacePreviewStatus.Error
                return
            }
            if (snapshot.changed) apply(snapshot, current)
            if (snapshot.finished) {
                // Played to the end: the paywall follows.
                skip()
                return
            }
            when {
                snapshot.playing -> delay(millisToNextStep(snapshot.progress, current))
                // Paused by the person, or nobody sees it: nothing moves, so nothing is asked of
                // the runtime until Play or the screen comes back.
                !wantsPlay.value -> wantsPlay.first { it }
                // Play is asked for and hasn't reached the runtime yet.
                else -> delay(PLAY_PENDING_MILLIS)
            }
        }
    }

    private fun apply(snapshot: ReplaySnapshot, current: RacePreviewReplay) {
        progress = snapshot.progress
        playing = snapshot.playing
        stepIndex = snapshot.stepIndex
        beatLabel = snapshot.beatLabel
        caption = snapshot.caption
        if (snapshot.beat != beat) {
            beat = snapshot.beat
            panel = ReplayPanel.forBeat(snapshot.beat)
        }
        persist(seconds = snapshot.progress * current.durationSeconds)
    }

    /** Plays unless the person paused or nobody sees it. */
    private fun applyPlayback() {
        val play = watched && !pausedByUser
        val current = replay
        if (current == null || status != RacePreviewStatus.Playing) {
            wantsPlay.value = play
            return
        }
        viewModelScope.launch {
            val result = controlGate.withLock {
                withContext(io) { runtime.control(current.baseUrl, if (play) ReplayControl.Play else ReplayControl.Pause) }
            }
            if (replay !== current) return@launch
            ReplaySnapshot.from((result as? RuntimeResult.Success)?.result)?.let { playing = it.playing }
        }
        // After the control is queued, so a loop that wakes for it ticks behind it.
        wantsPlay.value = play
    }

    /**
     * Not now or a purchase: the replay ends, the step is marked, and the room saved for it goes.
     * The shell then routes by the state client-core answers; until it does, the paywall stays.
     */
    private fun finishWith(outcome: String, race: RacePreviewSource.Race, purchased: Boolean) {
        if (finishing) return
        finishing = true
        endSession()
        viewModelScope.launch {
            val marked = withContext(io) {
                val result = runtime.markPreview(outcome, race.roomId)
                rooms.clear()
                result
            }
            roomBody = null
            roomFinish = null
            finishing = false
            val state = (marked as? RuntimeResult.Success)?.result?.optJSONObject("state")
            effectQueue.trySend(RacePreviewEffect.Finished(state, purchasedRoomId = race.roomId.takeIf { purchased }))
        }
    }

    /** Ends the replay: the runtime stops (its directory goes), the views' models let go of it. */
    private fun endSession() {
        generation += 1
        starting?.cancel()
        starting = null
        loop?.cancel()
        loop = null
        val ended = replay
        replay = null
        playing = false
        ended?.let(::end)
    }

    private fun end(ended: RacePreviewReplay) {
        ended.models.clear()
        background.launch(io) { runtime.control(ended.baseUrl, ReplayControl.Skip) }
    }

    /** Back to nothing shown; the source stays. */
    private fun reset() {
        endSession()
        stage = RacePreviewStage.Replay
        status = RacePreviewStatus.Loading
        beat = ReplayBeats.FOLLOWING
        beatLabel = ""
        caption = ""
        progress = 0.0
        panel = ReplayPanel.Map
        pausedByUser = false
        fromSavedRace = false
        stepIndex = 0
        roomBody = null
        roomFinish = null
        persist(seconds = 0.0)
    }

    /** The room saved on this phone is [next]'s, or none. */
    private fun forgetRoomsBut(next: RacePreviewSource.Race?) {
        background.launch(io) {
            if (next != null) rooms.keepOnly(next.userId, next.roomId) else rooms.clear()
        }
    }

    private fun persist(seconds: Double? = null) {
        savedState[KEY_STAGE] = stage.name
        savedState[KEY_BEAT] = beat
        savedState[KEY_PANEL] = panel.name
        savedState[KEY_PAUSED] = pausedByUser
        if (seconds != null) savedState[KEY_SECONDS] = seconds
    }

    companion object {
        const val OUTCOME_DONE = "done"
        const val OUTCOME_SKIPPED = "skipped"
        /** Play is asked for but the runtime still says paused: how soon the loop looks again. */
        const val PLAY_PENDING_MILLIS = 250L
        private const val KEY_SOURCE = "race-preview.source"
        private const val KEY_STAGE = "race-preview.stage"
        private const val KEY_SECONDS = "race-preview.seconds"
        private const val KEY_PAUSED = "race-preview.paused"
        private const val KEY_PANEL = "race-preview.panel"
        private const val KEY_BEAT = "race-preview.beat"
        private val SAVED_KEYS = listOf(KEY_SOURCE, KEY_STAGE, KEY_SECONDS, KEY_PAUSED, KEY_PANEL, KEY_BEAT)

        private fun stageOf(name: String): RacePreviewStage? = RacePreviewStage.entries.firstOrNull { it.name == name }

        private fun panelOf(name: String): ReplayPanel? = ReplayPanel.entries.firstOrNull { it.name == name }

        /** Wakes for the next step, or the end. */
        fun millisToNextStep(progress: Double, replay: RacePreviewReplay): Long {
            val elapsed = progress * replay.durationSeconds
            val next = (floor(elapsed / replay.stepSeconds) + 1) * replay.stepSeconds
            val seconds = min(next, replay.durationSeconds) - elapsed
            return max(MIN_WAKE_MILLIS, (seconds * 1000).toLong())
        }

        private const val MIN_WAKE_MILLIS = 20L
    }
}
