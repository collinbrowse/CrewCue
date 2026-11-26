package com.crewcue.android.ui.onboarding

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import com.crewcue.android.ui.chat.CrewPush
import com.crewcue.android.ui.invite.InviteShare
import com.crewcue.android.ui.invite.shareInviteIntent
import com.crewcue.android.ui.map.RaceTrackingService
import com.crewcue.android.ui.map.isOnline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** What the tour shows (client-core `OnboardingTour`): no card, or the current one. */
sealed interface TourUiState {
    data object Hidden : TourUiState
    data class Showing(val card: TourCard) : TourUiState
}

/** The race list and active race the real tour reads with, as the shell sends `readOnboarding`. */
data class TourContext(val races: JSONArray?, val activeRoomId: String?)

/**
 * The tab-bar tour and the Map's setup checklist. client-core decides the card, every outcome, the
 * location test and the checklist (`RuntimeOnboardingTour.swift`); this runs the platform side:
 * the permission answers, tracking for the location test, the invite share and push registration.
 *
 * [devRole] (runner or crew) plays the dev route's tour on the example race: nothing is saved or
 * sent, and the answers live in [saved] so a fold, rotation or process death keeps the card.
 * Without it the tour is the signed-in user's, saved by client-core, so a relaunch resumes it.
 */
class OnboardingTourViewModel(
    private val raceDay: RaceDayBridge,
    private val appContext: Context,
    private val saved: SavedStateHandle,
    private val devRole: String?
) : ViewModel() {
    var uiState by mutableStateOf<TourUiState>(TourUiState.Hidden)
        private set
    var checklist by mutableStateOf<SetupChecklistCard?>(null)
        private set
    /** The location test on the location card, null before it starts. */
    var location by mutableStateOf(LocationTestAnswer.from(saved.get<String>(KEY_LOCATION)?.let(::JSONObject)))
        private set
    /** The invites card's Share invite was used: its second button now reads Next and saves done. */
    var inviteShared by mutableStateOf(saved.get<Boolean>(KEY_INVITE_SHARED) ?: false)
        private set
    var busy by mutableStateOf(false)
        private set
    /** The card's buttons and line for this phone now (`tourCardView`), null until read. */
    var buttons by mutableStateOf<TourButtons?>(null)
        private set
    /** The tour lines not on a card, read off the main thread once. */
    var text by mutableStateOf(TourText())
        private set

    /** A real tour answer's new onboarding state, for the shell to route by. */
    var onState: ((JSONObject) -> Unit)? = null
    /** The race the tour's state is for (the location test tracks it, the invite shares it). */
    private var roomId: String? = null
    private var context = TourContext(null, null)
    private var dev: JSONObject? = devRole?.let { role ->
        saved.get<String>(KEY_DEV)?.let(::JSONObject) ?: JSONObject().put("role", role).put("answers", JSONObject())
    }
    private var polling = false
    private var trackingStarted = saved.get<Boolean>(KEY_TRACKING_STARTED) ?: false
    /** One location-test step at a time, so the poll loop and the prompts' answers don't race. */
    private val testMutex = Mutex()
    /** Bumped when a test ends or starts again: a step answered for an older test is dropped. */
    private var testGeneration = 0

    val isDev: Boolean get() = devRole != null
    val card: TourCard? get() = (uiState as? TourUiState.Showing)?.card

    init {
        viewModelScope.launch {
            val copy = withContext(Dispatchers.IO) { runCatching { raceDay.onboardingTourCopy() }.getOrNull() }
            text = TourText.from((copy as? RuntimeResult.Success)?.result)
        }
        // A test that was running when the process died goes on (tracking resumes from its session).
        if (location?.isRunning == true || location?.waitsForAlways == true) pollLocationTest()
    }

    fun notificationsAllowed(): Boolean = CrewPush.notificationsAllowed(appContext)

    fun locationAlways(): Boolean {
        if (!fineGranted()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }

    fun fineGranted(): Boolean = granted(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(appContext, permission) == PackageManager.PERMISSION_GRANTED

    /** Reads the card and the checklist. [next] is the shell's race list and active race. */
    fun refresh(next: TourContext = context) {
        context = next
        run("onboardingTour", report = false)
    }

    /** The card's answer: [outcome], or the notification prompt's, or the location test's. */
    fun answer(step: String, outcome: String? = null, notificationsAllowed: Boolean? = null, test: JSONObject? = null) {
        run("onboardingTourAnswer") {
            put("step", step)
            if (outcome != null) put("outcome", outcome)
            if (notificationsAllowed != null) put("notificationsAllowed", notificationsAllowed)
            if (test != null) put("locationTest", test)
        }
    }

    fun skipTour() {
        viewModelScope.launch {
            testMutex.withLock { endTestLocked(stop = true) }
            run("onboardingTourSkip")
        }
    }

    fun openChecklistItem(kind: String) = run("setupChecklistOpen") { put("item", kind) }

    fun hideChecklist() = run("setupChecklistHide")

    /** The permission prompt answered: registers this phone for push (not in the dev tour), then saves. */
    fun notificationsAnswered(step: String, allowed: Boolean) {
        viewModelScope.launch {
            if (allowed && !isDev) withContext(Dispatchers.IO) { runCatching { CrewPush.refreshIfAllowed(appContext, raceDay) } }
            answer(step, notificationsAllowed = allowed)
        }
    }

    /** Share invite: the race's invite from client-core, as the share sheet's intent (null when it can't load). */
    suspend fun inviteIntent(title: String): Intent? {
        if (isDev) return null
        val room = roomId ?: context.activeRoomId ?: return null
        busy = true
        val result = withContext(Dispatchers.IO) { runCatching { raceDay.inviteShare(room) }.getOrNull() }
        busy = false
        val share = InviteShare.from((result as? RuntimeResult.Success)?.result)
        return if (share.shareable) shareInviteIntent(share, title) else null
    }

    fun noteInviteShared() {
        inviteShared = true
        saved[KEY_INVITE_SHARED] = true
        refreshView()
    }

    // MARK: Location test (Test tracking now)

    /**
     * Test tracking now (or Try again): client-core starts the test from this phone's tracking
     * session (another race's tracking blocks it; an unknown session counts as tracking on) and
     * the latest ping the API already has (the baseline), then [onStarted] asks for location.
     */
    fun startLocationTest(onStarted: () -> Unit = {}) {
        viewModelScope.launch {
            testMutex.withLock {
                endTestLocked(stop = true)
                val room = roomId ?: context.activeRoomId
                val session = if (isDev) JSONObject().put("active", false) else withContext(Dispatchers.IO) {
                    (runCatching { raceDay.trackingSession() }.getOrNull() as? RuntimeResult.Success)?.result
                }
                val latest = if (isDev || room == null) null else withContext(Dispatchers.IO) {
                    (runCatching { raceDay.latestPing(room) }.getOrNull() as? RuntimeResult.Success)?.result?.optJSONObject("latest")
                }
                stepLocked("start", allowStart = true) {
                    if (room != null) put("roomId", room)
                    if (session != null) put("session", session)
                    if (latest != null) put("latest", latest)
                }
            }
            if (location?.blocked == true) return@launch
            onStarted()
            if (isDev) {
                // The dev tour sends nothing: the test plays its copy with Always and a ping.
                step("permission") { put("permission", "always") }
                delay(DEV_PING_DELAY_MS)
                step("pingSent")
            }
        }
    }

    /**
     * What the location prompts answered: whenInUse, always or denied. With location allowed,
     * tracking (the session and the foreground service) starts here, with the app in front, and
     * only then [onTracking] runs: the screen asks for background location after it, since on
     * Android 11+ that request opens Settings and a service can't start from the background.
     */
    fun locationPermission(permission: String, onTracking: () -> Unit = {}) {
        viewModelScope.launch {
            step("permission") { put("permission", permission) }
            val test = location ?: return@launch
            if (isDev || test.phase != "waitingForPing") return@launch
            if (!test.wasTracking && !trackingStarted) {
                val startedAt = startTracking() ?: return@launch
                // The session is now marked as the test's, so the shell's one-off sample waits;
                // one taken just before is older than this, so it can't end the test either.
                step("trackingStarted") { put("startedAt", startedAt) }
            }
            onTracking()
            pollLocationTest()
        }
    }

    /** On race morning: the test waits for race day; tracking the test started stops. */
    fun locationRaceMorning(step: String, outcome: String?) {
        viewModelScope.launch {
            testMutex.withLock { endTestLocked(stop = true) }
            answer(step, outcome = outcome ?: "deferred")
        }
    }

    /** Next after the test: its outcome (done after the ping); tracking the test started stops. */
    fun locationNext(step: String) {
        viewModelScope.launch {
            val test = testMutex.withLock {
                val ended = location?.test
                endTestLocked(stop = true)
                ended
            }
            answer(step, test = test)
        }
    }

    /**
     * Ends the test: a new generation, so a step still on its way is dropped, and the tracking
     * the test started (never tracking that was on before it) stops. Call with [testMutex] held.
     */
    private suspend fun endTestLocked(stop: Boolean) {
        testGeneration += 1
        location = null
        saved.remove<String>(KEY_LOCATION)
        refreshView()
        if (stop) stopTracking()
    }

    /** Starts the test's tracking session and service; answers the session's `startedAt`, null when it failed. */
    private suspend fun startTracking(): String? {
        val room = roomId ?: context.activeRoomId ?: return null
        val started = withContext(Dispatchers.IO) { runCatching { raceDay.startTrackingSession(room, test = true) }.getOrNull() }
        if (started !is RuntimeResult.Success) return null
        trackingStarted = true
        saved[KEY_TRACKING_STARTED] = true
        RaceTrackingService.start(appContext)
        return started.result.optText("startedAt")
    }

    /** Stops tracking only when this test started it. */
    private suspend fun stopTracking() {
        if (!trackingStarted) return
        trackingStarted = false
        saved[KEY_TRACKING_STARTED] = false
        val stopped = withContext(Dispatchers.IO) { stopTestSession(raceDay) }
        if (stopped) RaceTrackingService.stop(appContext)
    }

    /**
     * Until the test ends: Always chosen later counts, and each poll hands client-core the latest
     * ping (or offline); a ping newer than the baseline ends the test. With When In Use only,
     * tracking stays on a little for the Always answer. Then tracking stops unless it was on
     * before. One loop at a time; it never steps from a cleared test, and nothing is cancelled
     * mid-request.
     */
    private fun pollLocationTest() {
        if (polling || isDev) return
        polling = true
        viewModelScope.launch {
            try {
                while (true) {
                    val test = location ?: break
                    if (!test.isRunning && !test.waitsForAlways) break
                    delay(POLL_MS)
                    if (location == null) break
                    if (locationAlways()) step("permission") { put("permission", "always") }
                    if (location?.isRunning == true) poll() else step("read")
                }
                testMutex.withLock { if (location?.stopsTracking == true) stopTracking() }
            } finally {
                polling = false
            }
        }
    }

    private suspend fun poll() {
        val room = roomId ?: context.activeRoomId ?: return
        val result = withContext(Dispatchers.IO) { runCatching { raceDay.latestPing(room) }.getOrNull() }
        val answer = (result as? RuntimeResult.Success)?.result
        val offline = answer?.optBoolean("offline") == true || !appContext.isOnline()
        val latest = answer?.optJSONObject("latest")
        step("poll") {
            if (latest != null) put("latest", latest)
            if (offline) put("offline", true)
        }
    }

    private suspend fun step(event: String, fill: JSONObject.() -> Unit = {}) {
        testMutex.withLock { stepLocked(event, allowStart = false, fill) }
    }

    /** One `locationTest` op. Never from a cleared test, and dropped if the test ended meanwhile. */
    private suspend fun stepLocked(event: String, allowStart: Boolean, fill: JSONObject.() -> Unit) {
        val previous = location?.test
        if (previous == null && !allowStart) return
        val generation = testGeneration
        val result = withContext(Dispatchers.IO) { runCatching { raceDay.locationTest(previous, event, fill) }.getOrNull() }
        if (generation != testGeneration) return
        val next = LocationTestAnswer.from((result as? RuntimeResult.Success)?.result) ?: return
        location = next
        saved[KEY_LOCATION] = (result as RuntimeResult.Success).result.toString()
        refreshView()
    }

    override fun onCleared() {
        // The screen went away mid-test: stop the tracking the test started, outside this scope.
        if (trackingStarted) {
            trackingStarted = false
            val bridge = raceDay
            val context = appContext
            CoroutineScope(Dispatchers.IO + NonCancellable).launch {
                if (stopTestSession(bridge)) RaceTrackingService.stop(context)
            }
        }
        super.onCleared()
    }

    // MARK: Ops

    /** The card's buttons and line for this phone now (client-core `OnboardingTour.view`). */
    fun refreshView() {
        val shown = card ?: run {
            buttons = null
            return
        }
        val test = location?.test?.takeIf { shown.step == "location" }
        val shared = inviteShared
        viewModelScope.launch {
            val notificationsOn = notificationsAllowed()
            val result = withContext(Dispatchers.IO) {
                runCatching { raceDay.tourCardView(shown.step, shown.role, notificationsOn, shared, test) }.getOrNull()
            }
            if (card?.step != shown.step) return@launch
            buttons = TourButtons.from((result as? RuntimeResult.Success)?.result)
        }
    }

    private fun run(op: String, report: Boolean = true, fill: JSONObject.() -> Unit = {}) {
        viewModelScope.launch {
            busy = true
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    raceDay.tour(op, context.races, context.activeRoomId, dev, notificationsAllowed(), locationAlways(), fill)
                }.getOrNull()
            }
            busy = false
            val answer = (result as? RuntimeResult.Success)?.result ?: return@launch
            answer.optJSONObject("dev")?.let {
                dev = it
                saved[KEY_DEV] = it.toString()
            }
            val state = answer.optJSONObject("state")
            roomId = state?.optText("roomId")?.ifBlank { null } ?: roomId
            val nextCard = TourCard.from(answer.optJSONObject("card"))
            if (nextCard?.step != card?.step) {
                // A new card starts fresh: a share or a test belonged to the card before it.
                if (inviteShared && nextCard?.step != "invites") {
                    inviteShared = false
                    saved[KEY_INVITE_SHARED] = false
                }
                if (location != null && nextCard?.step != "location") testMutex.withLock { endTestLocked(stop = true) }
                buttons = null
            }
            uiState = nextCard?.let { TourUiState.Showing(it) } ?: TourUiState.Hidden
            checklist = SetupChecklistCard.from(answer.optJSONObject("checklist"))
            refreshView()
            if (report && !isDev && state != null) onState?.invoke(state)
        }
    }

    companion object {
        /**
         * Stops the saved session only while it is still the test's: a Start tracking for race
         * day meanwhile saved an unmarked session over it, which the test must leave running.
         * Answers whether it stopped (or there was nothing left to stop).
         */
        private fun stopTestSession(raceDay: RaceDayBridge): Boolean {
            val session = (runCatching { raceDay.trackingSession() }.getOrNull() as? RuntimeResult.Success)?.result
            if (session?.optBoolean("active") == true && !session.optBoolean("test")) return false
            runCatching { raceDay.stopTrackingSession() }
            return true
        }

        private const val KEY_DEV = "tour.dev"
        private const val KEY_LOCATION = "tour.locationTest"
        private const val KEY_INVITE_SHARED = "tour.inviteShared"
        private const val KEY_TRACKING_STARTED = "tour.trackingStarted"
        private const val POLL_MS = 2_000L
        private const val DEV_PING_DELAY_MS = 1_200L

        fun factory(raceDay: RaceDayBridge, appContext: Context, devRole: String?) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T =
                OnboardingTourViewModel(raceDay, appContext.applicationContext, extras.createSavedStateHandle(), devRole) as T
        }
    }
}
