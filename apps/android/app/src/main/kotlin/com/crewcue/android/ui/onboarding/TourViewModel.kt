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
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
        stopTestIfRunning()
        run("onboardingTourSkip")
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
    }

    // MARK: Location test (Test tracking now)

    /** Test tracking now (or Try again): starts the test, then [onStarted] asks for location. */
    fun startLocationTest(onStarted: () -> Unit = {}) {
        viewModelScope.launch {
            val alreadyTracking = !isDev && withContext(Dispatchers.IO) {
                val session = (runCatching { raceDay.trackingSession() }.getOrNull() as? RuntimeResult.Success)?.result
                session?.optBoolean("active") == true && session.optText("roomId") == (roomId ?: context.activeRoomId)
            }
            trackingStarted = false
            saved[KEY_TRACKING_STARTED] = false
            step("start") { put("alreadyTracking", alreadyTracking) }
            onStarted()
            if (isDev) {
                // The dev tour sends nothing: the test plays its copy with Always and a ping.
                step("permission") { put("permission", "always") }
                delay(DEV_PING_DELAY_MS)
                step("pingSent")
            }
        }
    }

    /** What the location prompts answered: whenInUse, always or denied. */
    fun locationPermission(permission: String) {
        viewModelScope.launch {
            step("permission") { put("permission", permission) }
            val test = location ?: return@launch
            if (isDev || test.phase != "waitingForPing") return@launch
            if (!test.wasTracking && !trackingStarted) startTracking()
            pollLocationTest()
        }
    }

    /** On race morning: the test waits for race day, and a running test stops. */
    fun locationRaceMorning(step: String) {
        stopTestIfRunning()
        clearLocation()
        answer(step, outcome = card?.secondaryOutcome ?: "deferred")
    }

    /** Next after the test: its outcome (done after the ping). */
    fun locationNext(step: String) {
        val test = location?.test
        clearLocation()
        answer(step, test = test)
    }

    private fun clearLocation() {
        location = null
        saved.remove<String>(KEY_LOCATION)
    }

    private fun stopTestIfRunning() {
        val test = location ?: return
        if (isDev || test.wasTracking || !trackingStarted) return
        viewModelScope.launch { stopTracking() }
    }

    private suspend fun startTracking() {
        val room = roomId ?: context.activeRoomId ?: return
        val started = withContext(Dispatchers.IO) { runCatching { raceDay.startTrackingSession(room) }.getOrNull() }
        if (started !is RuntimeResult.Success) return
        trackingStarted = true
        saved[KEY_TRACKING_STARTED] = true
        RaceTrackingService.start(appContext)
    }

    private suspend fun stopTracking() {
        if (!trackingStarted) return
        trackingStarted = false
        saved[KEY_TRACKING_STARTED] = false
        withContext(Dispatchers.IO) { runCatching { raceDay.stopTrackingSession() } }
        RaceTrackingService.stop(appContext)
    }

    /**
     * Until the test ends: the clock ticks, Always chosen later counts, and the first ping this
     * phone gets to the server (read back from `pings/latest`, received after the test began)
     * ends it. With When In Use only, tracking stays on a little for the Always answer. Then
     * tracking stops unless it was on before. One loop at a time; nothing is cancelled mid-request.
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
                    if (locationAlways()) step("permission") { put("permission", "always") }
                    if (location?.isRunning == true) {
                        step("tick")
                        readPing()
                    } else {
                        step("read")
                    }
                }
                if (location?.stopsTracking == true) stopTracking()
            } finally {
                polling = false
            }
        }
    }

    private suspend fun readPing() {
        val test = location ?: return
        if (!test.isRunning) return
        val room = roomId ?: context.activeRoomId ?: return
        val result = withContext(Dispatchers.IO) { runCatching { raceDay.latestPing(room) }.getOrNull() }
        val answer = (result as? RuntimeResult.Success)?.result ?: return
        val ping = answer.optJSONObject("latest")?.optJSONObject("ping")
        val received = ping?.optText("receivedAt")?.let { runCatching { Instant.parse(it) }.getOrNull() }
        val started = runCatching { Instant.parse(test.startedAt) }.getOrNull()
        if (received != null && started != null && !received.isBefore(started)) {
            step("pingSent")
            return
        }
        if ((answer.optBoolean("offline") || !appContext.isOnline()) && pingQueued()) step("pingQueuedOffline")
    }

    private suspend fun pingQueued(): Boolean {
        val result = withContext(Dispatchers.IO) { runCatching { raceDay.listOutbox() }.getOrNull() }
        val rows = (result as? RuntimeResult.Success)?.result?.optJSONArray("operations") ?: return false
        return (0 until rows.length()).any { index ->
            val row = rows.optJSONObject(index)
            row?.optString("type") == "ping" && row.optString("status") == "pending"
        }
    }

    private suspend fun step(event: String, fill: JSONObject.() -> Unit = {}) {
        val previous = location?.test
        val result = withContext(Dispatchers.IO) { raceDay.locationTest(previous, event, fill) }
        val next = LocationTestAnswer.from((result as? RuntimeResult.Success)?.result) ?: return
        location = next
        saved[KEY_LOCATION] = (result as RuntimeResult.Success).result.toString()
    }

    // MARK: Ops

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
                if (location != null && nextCard?.step != "location") clearLocation()
            }
            uiState = nextCard?.let { TourUiState.Showing(it) } ?: TourUiState.Hidden
            checklist = SetupChecklistCard.from(answer.optJSONObject("checklist"))
            if (report && !isDev && state != null) onState?.invoke(state)
        }
    }

    companion object {
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
