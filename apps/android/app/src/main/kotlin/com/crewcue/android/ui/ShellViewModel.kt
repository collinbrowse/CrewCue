package com.crewcue.android.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.BuildConfig
import com.crewcue.android.auth.AuthResult
import com.crewcue.android.billing.BillingInfo
import com.crewcue.android.billing.FakeStorePurchaser
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.DevRoutes
import com.crewcue.android.nav.InboundLink
import com.crewcue.android.ui.join.FAKE_REFERRER_EXTRA
import com.crewcue.android.ui.join.JOIN_CREW_FEATURE
import com.crewcue.android.ui.join.JoinResult
import com.crewcue.android.ui.join.JoinTone
import com.crewcue.android.ui.join.PendingInvite
import com.crewcue.android.ui.join.joiningLine
import com.crewcue.android.ui.invite.InviteText
import com.crewcue.android.session.DevSession
import com.crewcue.android.session.StoredSession
import com.crewcue.android.session.applyingJoin
import com.crewcue.android.ui.billing.BillingCopy
import com.crewcue.android.ui.onboarding.OnboardingDestination
import com.crewcue.android.ui.onboarding.OnboardingFlow
import com.crewcue.android.ui.onboarding.OnboardingRouting
import com.crewcue.android.ui.onboarding.OnboardingText
import com.crewcue.android.ui.onboarding.RACE_PREVIEW_FEATURE
import com.crewcue.android.ui.onboarding.RacePreviewDevStart
import com.crewcue.android.ui.onboarding.RacePreviewEffect
import com.crewcue.android.ui.onboarding.RacePreviewModels
import com.crewcue.android.ui.onboarding.RacePreviewSource
import com.crewcue.android.ui.onboarding.ReplayRoomUpdate
import com.crewcue.android.ui.onboarding.RaceAccess
import com.crewcue.android.ui.onboarding.RaceBilling
import com.crewcue.android.ui.onboarding.RunnerSetupEffect
import com.crewcue.android.ui.onboarding.SetupRaces
import com.crewcue.android.ui.onboarding.SignInNext
import com.crewcue.android.ui.onboarding.SETUP_FEATURE
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class StravaSignal(val id: Int = 0, val failed: Boolean = false)

/** One loaded race from client-core's `myRaces`. Role and display name differ per room. */
data class RaceChoice(
    val id: String,
    val name: String,
    val role: String,
    /** From client-core `RaceRole.label`, e.g. "Crew member". Never the wire value. */
    val roleLabel: String,
    val displayName: String?
)

enum class ShellTab(val title: String, val url: String) {
    Map("Map", "crewcue://dev/map"),
    Pace("Pace", "crewcue://dev/schedule-sheet"),
    Chat("Chat", "crewcue://dev/chat"),
    Profile("Profile", "crewcue://dev/profile")
}

data class UserFacingError(
    val code: String,
    val message: String,
    val retryable: Boolean
)

data class ScreenCopy(
    val featureId: String,
    val accessibilityIdentifier: String,
    val title: String,
    val body: String
)

sealed interface UiState {
    val screen: ScreenCopy

    data class Success(override val screen: ScreenCopy) : UiState
    data class Empty(override val screen: ScreenCopy) : UiState
    data class Error(override val screen: ScreenCopy, val failure: UserFacingError) : UiState
    data class Offline(override val screen: ScreenCopy, val failure: UserFacingError) : UiState

    companion object {
        fun from(screen: ScreenCopy, state: String): UiState = when (state) {
            "empty" -> Empty(screen)
            "error" -> Error(
                screen,
                UserFacingError(code = "error", message = screen.body, retryable = false)
            )
            "offline" -> Offline(
                screen,
                UserFacingError(code = "offline", message = screen.body, retryable = true)
            )
            else -> Success(screen)
        }
    }
}

class ShellViewModel(
    internal val container: AppContainer,
    launchIntent: Intent?
) : ViewModel() {
    var uiState by mutableStateOf<UiState>(UiState.Success(placeholder))
        private set
    var showAppShell by mutableStateOf(false)
        private set
    var routeId by mutableStateOf("auth-sign-in?state=success")
        private set
    var selectedTab by mutableStateOf(ShellTab.Map)
        private set
    var inviteCode by mutableStateOf("")
        private set
    var joinPreviewName by mutableStateOf<String?>(null)
        private set
    /** client-core's "You're joining Ana's race: …" for the code on show, once its preview answers. */
    var joinPreviewLine by mutableStateOf<String?>(null)
        private set
    /** client-core's "Western States 100, 1 member, active" under it (`InviteCopy.previewLine`). */
    var joinPreviewDetail by mutableStateOf<String?>(null)
        private set
    /**
     * The join screen shows a saved invite (a link, the Play referrer, or a code kept through
     * sign-in), so it offers Not now, which forgets it.
     */
    var joinHasInvite by mutableStateOf(false)
        private set
    /** The saved invite on show; a code typed over it saves as `typed`. */
    private var shownInvite: PendingInvite? = null
    var joinMembership by mutableStateOf<String?>(null)
        private set
    var joinBusy by mutableStateOf(false)
        private set
    /** A join request is in flight, as opposed to a code preview. */
    var joining by mutableStateOf(false)
        private set
    /** The connection whose button started the current sign-in; empty for the plain Sign in button. */
    var signInConnection by mutableStateOf<String?>(null)
        private set
    var session by mutableStateOf(container.sessionStore.current())
        private set
    var stateOverlay by mutableStateOf(false)
        private set
    var profilePane by mutableStateOf("profile")
        private set
    var stravaSignal by mutableStateOf(StravaSignal())
        private set
    /** The settings sheet opens over any tab. [settingsFocus] is the section to scroll to. */
    var showsSettings by mutableStateOf(false)
        private set
    var settingsFocus by mutableStateOf<String?>(null)
        private set
    var paceFocus by mutableStateOf("schedule-sheet")
        private set
    var chatUnread by mutableStateOf(0)
        private set
    /** Every race the user belongs to. `session.roomId` is the active one; every tab follows it. */
    var races by mutableStateOf<List<RaceChoice>>(emptyList())
        private set
    var racesMessage by mutableStateOf("")
        private set
    var racesLoading by mutableStateOf(false)
        private set
    /** The last billing read by race. With the onboarding state it decides [raceAccess]. */
    var billing by mutableStateOf(RaceBilling())
        private set
    /** The shell shows the paywall in place of Map, Pace, and Chat until a tab is picked. */
    var paywallOpen by mutableStateOf(false)
        private set
    /**
     * The race preview route on show was opened by a link (`crewcue://dev/onboarding-race-preview`,
     * debug builds): it plays `DemoRaceFixture`, and a state read in the background never moves it.
     */
    var racePreviewFromLink by mutableStateOf(false)
        private set
    /** That link's `?state=` and `?at=&paused=`; a second link while it shows starts that one. */
    private var racePreviewDevState by mutableStateOf("success")
    private var racePreviewDevStart by mutableStateOf<RacePreviewDevStart?>(null)
    /**
     * The race preview route's models, one replay per flow whichever NavHost entry draws the route
     * ([RacePreviewModels]). They end where the shell leaves the route: [showShell],
     * [showSignedOut] (sign-out included) and [showFixture] for any other screen.
     */
    val racePreview = RacePreviewModels()
    /** client-core's onboarding state for this user and active race; null until the first read. */
    var onboarding by mutableStateOf<OnboardingFlow?>(null)
        private set
    /** The last `myRaces` rows, sent back to `readOnboarding`. Null while this user's list is unknown. */
    private var raceRows: JSONArray? = null
    /** Counts race lists `myRaces` answered, so the runner's setup tells a fresh list from the cached one. */
    private var racesVersion = 0
    /** The race list [onboarding] was read with: the runner's setup reads its own race's row. */
    var onboardingRaces by mutableStateOf(SetupRaces(null, 0))
        private set
    private var onboardingTicket = 0
    /** The join screen on show was opened by the crew choice, so a new state may move on from it. */
    private var joinFromOnboarding = false
    /**
     * The setup route on show was opened by a link (the debug dev route), not by onboarding: a
     * background state read doesn't move it, and it draws the runner's setup whatever the state.
     */
    var setupFromLink by mutableStateOf(false)
        private set
    /**
     * The last race-list read failed ([racesFailedOffline]: offline). With nothing saved to decide
     * from, the onboarding loader says so and offers a retry instead of waiting forever.
     */
    var racesFailed by mutableStateOf(false)
        private set
    var racesFailedOffline by mutableStateOf(false)
        private set
    /** Sign-up from the runner's account step failed (shared copy), shown under that step. */
    var setupAuthFailure by mutableStateOf<String?>(null)
        private set
    private var racesJob: Job? = null
    private var racesTicket = 0

    /** Shared onboarding strings, read once from client-core. */
    /** Shared invite strings (`InviteCopy`), read once from client-core. */
    val inviteText: InviteText by lazy {
        InviteText.from((container.raceDay.inviteCopy() as? RuntimeResult.Success)?.result?.optJSONObject("copy"))
    }

    /** The last join answered 409 `crew_limit_reached`: the line under the code is the race-full one. */
    var joinRaceFull by mutableStateOf(false)
        private set

    val onboardingText: OnboardingText by lazy {
        val copy = (container.raceDay.onboardingCopy() as? RuntimeResult.Success)?.result
        OnboardingText.from(
            copy,
            success = checklistCopy(SETUP_FEATURE, "success"),
            empty = checklistCopy(SETUP_FEATURE, "empty"),
            error = checklistCopy(SETUP_FEATURE, "error"),
            offline = checklistCopy(SETUP_FEATURE, "offline")
        )
    }

    fun noteChatUnread(count: Int) {
        chatUnread = count
    }

    private var opened = false
    private var previewJob: Job? = null

    init {
        container.raceDay.onSessionExpired = { rejectedToken ->
            viewModelScope.launch(Dispatchers.Main) {
                // Only the session that sent the request can expire; a late 401 for an old one is ignored.
                if (session?.token == rejectedToken) signOut(null)
            }
        }
        session?.let { adoptStorage(it.userId) }
        open(launchIntent)
        if (racesJob == null) loadRaces()
        checkInstallReferrer(launchIntent?.getStringExtra(FAKE_REFERRER_EXTRA))
    }

    /**
     * First launch after an install from the join page's Play link: the referrer carries the
     * invite (`crewcue_join=<code>`). It becomes the pending join, unless one is saved already (a
     * link the person opened wins), and shows on the join screen when onboarding owns the screen.
     */
    private fun checkInstallReferrer(fakeReferrer: String?) {
        val check = container.installReferrerCheck(fakeReferrer)
        viewModelScope.launch {
            val code = withContext(Dispatchers.IO) {
                val referrer = check.firstReferrer() ?: return@withContext null
                val code = container.raceDay.inviteCode(referrer) ?: return@withContext null
                if (PendingInvite.from(container.raceDay.readPendingJoin()) != null) return@withContext null
                PendingInvite.from(container.raceDay.savePendingJoin(code, PendingInvite.SOURCE_REFERRER))?.code
            } ?: return@launch
            val owns = OnboardingRouting.ownsScreen(
                showAppShell,
                stateOverlay,
                uiState.screen.featureId,
                joinOpenedByOnboarding = joinFromOnboarding,
                setupOpenedByLink = setupFromLink,
                racePreviewOpenedByLink = racePreviewFromLink
            )
            if (owns && !joinHasInvite) showJoinInvite(PendingInvite(code, PendingInvite.SOURCE_REFERRER))
        }
    }

    override fun onCleared() {
        container.raceDay.onSessionExpired = null
        racePreview.end()
        super.onCleared()
    }

    /** Keeps only this account's files on the device (#538). */
    private fun adoptStorage(userId: String) {
        if (userId.isBlank()) return
        viewModelScope.launch(Dispatchers.IO) { container.raceDay.adoptUser(userId) }
    }

    /**
     * Load the user's races. The room they are on now stays active while the server still lists it.
     * Onboarding then reads its state with the new list; [forceOnboarding] lets that state change the
     * screen even when onboarding didn't put it there (a race just created or picked).
     */
    fun loadRaces(forceOnboarding: Boolean = false) {
        val current = session ?: return
        val ticket = ++racesTicket
        racesJob?.cancel()
        racesLoading = true
        racesJob = viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { container.raceDay.myRaces(current.roomId) }
            } finally {
                if (ticket == racesTicket) racesLoading = false
            }
            if (ticket != racesTicket || session?.userId != current.userId) return@launch
            when (result) {
                is RuntimeResult.Failure -> {
                    racesMessage = if (result.offline) "Offline. Showing your last race." else "Couldn't load your races."
                    racesFailed = true
                    racesFailedOffline = result.offline
                    // The saved list (if any) still decides; with none the state stays loading.
                    refreshOnboarding(forceOnboarding)
                }
                is RuntimeResult.Success -> {
                    racesFailed = false
                    racesFailedOffline = false
                    val rows = result.result.optJSONArray("races")
                    raceRows = rows ?: JSONArray()
                    racesVersion++
                    val loaded = buildList {
                        for (index in 0 until (rows?.length() ?: 0)) {
                            val row = rows?.optJSONObject(index) ?: continue
                            add(
                                RaceChoice(
                                    id = row.optString("id"),
                                    name = row.optString("name"),
                                    role = row.optString("role"),
                                    roleLabel = row.optString("roleLabel"),
                                    displayName = row.optText("displayName").trim().ifBlank { null }
                                )
                            )
                        }
                    }
                    races = loaded
                    racesMessage = if (loaded.isEmpty()) "No races yet." else ""
                    pendingChatRoomId?.let { pending ->
                        pendingChatRoomId = null
                        if (loaded.any { it.id == pending }) openChat(pending)
                    }
                    val activeId = result.result.optString("activeRoomId").takeUnless {
                        result.result.isNull("activeRoomId") || it.isBlank()
                    }
                    val active = activeRaceAfterRefresh(loaded, session?.roomId, activeId)
                    when {
                        active != null && (active.id != session?.roomId || active.role != session?.role) -> apply(active)
                        active == null && session?.roomId != null -> {
                            container.sessionStore.update { it.copy(roomId = null) }
                            session = container.sessionStore.current()
                        }
                    }
                    refreshOnboarding(forceOnboarding)
                }
            }
        }
    }

    private var accessCache: Pair<List<Any?>, RaceAccess>? = null

    /**
     * client-core `RaceAccess` for the active race, from its billing and the onboarding state. Read
     * again only when one of those, the race or the role changes, so a frame never waits on it.
     */
    fun raceAccess(): RaceAccess {
        val roomId = session?.roomId?.takeIf { it.isNotBlank() } ?: return RaceAccess.noRace
        val role = session?.role
        val status = billing.status(roomId)
        val flow = onboarding
        val key = listOf(roomId, role, status, flow)
        accessCache?.let { (cached, access) -> if (cached == key) return access }
        val result = container.raceDay.raceAccess(roomId, role, status, flow?.toJson())
        // Unreachable unless the bridge itself failed: draw the race and let the server refuse what it must.
        val access = RaceAccess.from((result as? RuntimeResult.Success)?.result)
            ?: return RaceAccess(unpaid = false, loadsRace = true, samplesLocation = true, gatesActions = false, lockedReason = null)
        accessCache = key to access
        return access
    }

    /** The race list and active race that every onboarding call sends client-core. */
    fun onboardingRaceContext(): Pair<JSONArray?, String?> = raceRows to session?.roomId

    /**
     * Reads the onboarding state for this user, race list and active race, then routes by it.
     * Without [force], the state moves the screen only from screens onboarding owns (see [applyOnboarding]).
     */
    fun refreshOnboarding(force: Boolean = false) {
        val ticket = ++onboardingTicket
        val (rows, active) = onboardingRaceContext()
        val user = session?.userId
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.raceDay.readOnboarding(rows, active) }
            if (ticket != onboardingTicket || session?.userId != user) return@launch
            applyOnboarding(OnboardingFlow.from((result as? RuntimeResult.Success)?.result?.optJSONObject("state")), force)
        }
    }

    /**
     * A state `markOnboardingStep` answered for a step the runner just finished on the setup
     * route, so it moves the screen on even from a route a link opened.
     */
    fun noteOnboardingState(state: JSONObject) {
        onboardingTicket++
        applyOnboarding(OnboardingFlow.from(state), force = true)
    }

    /** The chooser: "I'm running a race" or "I'm crewing for someone". */
    fun chooseOnboarding(choice: String) {
        val (rows, active) = onboardingRaceContext()
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                container.raceDay.markOnboardingStep(null, null, null, choice, rows, active)
            }
            val state = (result as? RuntimeResult.Success)?.result?.optJSONObject("state") ?: return@launch
            onboardingTicket++
            applyOnboarding(OnboardingFlow.from(state), force = true)
        }
    }

    /**
     * Back from the runner's first setup step, while no race exists: forget only the runner pick
     * (every marked step stays) and show the chooser again. A setup the dev link opened leaves for
     * the app's own launch, as sign-in's Back does.
     */
    fun leaveRunnerSetup() {
        val fromLink = setupFromLink
        viewModelScope.launch {
            withContext(Dispatchers.IO) { container.raceDay.resetOnboarding(choiceOnly = true) }
            if (fromLink) {
                setupFromLink = false
                routeEntry()
            } else {
                refreshOnboarding(force = true)
            }
        }
    }

    /** What the runner's setup asks for (see [RunnerSetupEffect]). */
    fun onSetupEffect(effect: RunnerSetupEffect) {
        when (effect) {
            is RunnerSetupEffect.StateChanged -> noteOnboardingState(effect.state)
            is RunnerSetupEffect.RoomCreated -> {
                // The setup's own race: active and the runner's, still behind the setup screens.
                container.sessionStore.update { it.copy(roomId = effect.roomId, role = "athlete") }
                session = container.sessionStore.current()
                billing = billing.unpaid(effect.roomId)
                loadRaces()
            }
            is RunnerSetupEffect.DisplayNameChosen -> {
                container.sessionStore.update { it.copy(displayName = effect.name) }
                session = container.sessionStore.current()
            }
            RunnerSetupEffect.RacesChanged -> loadRaces()
            RunnerSetupEffect.OpenPaywall -> openPaywall()
            RunnerSetupEffect.LeaveSetup -> leaveRunnerSetup()
        }
    }

    /** The Unlock race banner, a gated action (start tracking, chat send), or a 402 `room_unpaid`. */
    fun openPaywall() {
        val roomId = session?.roomId ?: return
        billing = billing.unpaid(roomId)
        paywallOpen = true
        if (!showAppShell) showShell(OnboardingRouting.paywallTab(selectedTab))
    }

    /**
     * Routes by client-core's onboarding state. Onboarding owns the shell, its own routes, the
     * sign-in screen and a join screen it opened; any other screen (a dev fixture, a link) keeps
     * showing unless [force].
     */
    private fun applyOnboarding(next: OnboardingFlow?, force: Boolean) {
        onboarding = next
        onboardingRaces = SetupRaces(raceRows, racesVersion)
        syncReplayRoom(next)
        val owns = OnboardingRouting.ownsScreen(
            showAppShell,
            stateOverlay,
            uiState.screen.featureId,
            joinOpenedByOnboarding = joinFromOnboarding,
            setupOpenedByLink = setupFromLink,
            racePreviewOpenedByLink = racePreviewFromLink
        )
        if (!force && !owns) return
        val destination = OnboardingRouting.destination(
            next,
            signedIn = session != null,
            hasActiveRoom = !session?.roomId.isNullOrBlank()
        )
        when (destination) {
            OnboardingDestination.SignedOut -> showSignedOut()
            OnboardingDestination.Onboarding -> showOnboarding()
            OnboardingDestination.JoinCrew -> if (uiState.screen.featureId != JOIN_CREW_FEATURE || showAppShell) {
                // A saved invite (a link, the referrer, a code kept through sign-in) shows filled in.
                val saved = PendingInvite.from(container.raceDay.readPendingJoin())
                if (saved != null) {
                    showJoinInvite(saved)
                } else {
                    showFixture("crewcue://dev/join-crew")
                    joinFromOnboarding = true
                }
            }
            OnboardingDestination.RacePreview -> showRacePreview()
            OnboardingDestination.Shell -> showShellIfHidden()
        }
    }

    /** The room body saved for an offline replay follows the state ([OnboardingRouting.replayRoomUpdate]). */
    private fun syncReplayRoom(next: OnboardingFlow?) {
        val update = OnboardingRouting.replayRoomUpdate(next, session?.userId, session?.roomId)
        if (update == ReplayRoomUpdate.Keep) return
        viewModelScope.launch(Dispatchers.IO) {
            when (update) {
                is ReplayRoomUpdate.KeepOnly -> container.replayRooms.keepOnly(update.userId, update.roomId)
                ReplayRoomUpdate.Clear -> container.replayRooms.clear()
                ReplayRoomUpdate.Keep -> Unit
            }
        }
    }

    private fun showOnboarding() {
        if (!showAppShell && uiState.screen.featureId == SETUP_FEATURE && !stateOverlay) return
        showFixture("crewcue://dev/$SETUP_FEATURE")
    }

    /** Runner phase 2: the replay on the runner's race, then its paywall (`RacePreviewRoute`). */
    private fun showRacePreview() {
        if (!showAppShell && uiState.screen.featureId == RACE_PREVIEW_FEATURE && !stateOverlay && !racePreviewFromLink) return
        paywallOpen = false
        showFixture("crewcue://dev/$RACE_PREVIEW_FEATURE")
    }

    /**
     * The replay the race preview route plays: the dev link's fixture, or the runner's race on the
     * replay step. Null while that race isn't known.
     */
    fun racePreviewSource(): RacePreviewSource? = OnboardingRouting.racePreviewSource(
        openedByLink = racePreviewFromLink,
        devState = racePreviewDevState,
        devStart = racePreviewDevStart,
        userId = session?.userId,
        flow = onboarding?.takeIf { it.isRacePreviewStep },
        activeRoomId = session?.roomId
    )

    /** What the replay's paywall asks for (see [RacePreviewEffect]). */
    fun onRacePreviewEffect(effect: RacePreviewEffect) {
        when (effect) {
            is RacePreviewEffect.Finished -> {
                effect.purchasedRoomId?.let { roomId ->
                    // The server's billing read said paid: no Unlock race banner, whatever the
                    // race list still says until it loads again.
                    billing = billing.unlocked(roomId)
                    paywallOpen = false
                }
                val state = effect.state
                if (state != null) noteOnboardingState(state) else refreshOnboarding(force = true)
                if (effect.purchasedRoomId != null) loadRaces(forceOnboarding = true)
            }
            RacePreviewEffect.LeftDevRoute -> {
                // The dev route's Not now: the app's own launch.
                racePreviewFromLink = false
                routeEntry()
            }
        }
    }

    private fun showShellIfHidden() {
        if (!showAppShell) showShell(ShellTab.Map)
    }

    /** A chat push this race list has not loaded yet; applied after [loadRaces]. */
    private var pendingChatRoomId: String? = null

    /** A tapped chat notification: switch to that race and show its chat. */
    fun openChat(roomId: String) {
        if (session == null) return
        if (roomId != session?.roomId) {
            if (races.none { it.id == roomId }) {
                pendingChatRoomId = roomId
                loadRaces()
                return
            }
            selectRace(roomId)
        }
        showShell(ShellTab.Chat)
    }

    /** Switch every tab to another loaded race. */
    fun selectRace(roomId: String) {
        if (roomId == session?.roomId) return
        val race = races.firstOrNull { it.id == roomId } ?: return
        apply(race)
        // A race of the runner's that isn't set up yet goes back behind its setup screens.
        refreshOnboarding(force = true)
    }

    private fun apply(race: RaceChoice) {
        container.sessionStore.update {
            it.copy(roomId = race.id, role = race.role.ifBlank { it.role }, displayName = race.displayName)
        }
        session = container.sessionStore.current()
        profilePane = "profile"
    }

    fun open(intent: Intent?) {
        val devSignIn = captureDevSession(intent)
        captureWebhookDelay(intent)
        val url = intent?.dataString
        if (BuildConfig.STRAVA_ENABLED && isStravaReturn(url)) {
            opened = true
            presentStravaReturn(url.orEmpty())
            return
        }
        if (opened && isOAuthCallback(url)) return
        opened = true
        // Invite links open in every build; fixture routes only in debug builds.
        val link = DevRoutes.inbound(
            url,
            inviteCode = container.raceDay::inviteCode,
            isJoinLink = container.raceDay::isJoinLink
        )
        if (link is InboundLink.Join) {
            openInviteLink(link.code)
            return
        }
        if (link == InboundLink.JoinWithoutCode) {
            openJoinWithoutCode()
            return
        }
        val feature = (link as? InboundLink.Feature)?.id
        // A debug dev session with no route stands in for a sign-in: a confirmed invite joins, as after Auth0.
        if (devSignIn && feature == null && joinPendingInvite()) return
        val state = if (url == null) "success" else queryState(url)
        when {
            feature == "app-shell" && state == "success" ->
                if (container.sessionStore.current() != null) showShell(ShellTab.Map) else showSignedOut()
            feature != null && url != null -> openLinkedFeature(feature, url)
            else -> routeEntry()
        }
    }

    /**
     * The first screen, from client-core's onboarding state. The read is local (the saved progress
     * and race list), so it runs before the first frame: nothing flashes, and a screen restored after
     * process death keeps its saved state. While the race list is unknown the state is loading, so
     * an existing user never sees the chooser before their races; a stored race keeps the shell.
     */
    private fun routeEntry() {
        val read = runCatching { container.raceDay.readOnboarding(raceRows, session?.roomId) }.getOrNull()
        onboardingTicket++
        applyOnboarding(OnboardingFlow.from((read as? RuntimeResult.Success)?.result?.optJSONObject("state")), force = true)
    }

    fun selectTab(tab: ShellTab) {
        if (tab == ShellTab.Profile) profilePane = "profile"
        if (tab == ShellTab.Pace) paceFocus = "schedule-sheet"
        paywallOpen = false
        showShell(tab)
    }

    fun openSettings(focus: String? = null) {
        settingsFocus = focus
        showsSettings = true
    }

    fun closeSettings() {
        showsSettings = false
        settingsFocus = null
    }

    fun openRoomMembers() {
        if (session?.roomId.isNullOrBlank()) return
        profilePane = "members"
    }

    fun openIncidents() {
        if (session?.roomId.isNullOrBlank()) return
        profilePane = "incidents"
    }

    /** Room members → Invite crew (the runner's invite link and code). */
    fun openInviteShare() {
        if (session?.roomId.isNullOrBlank()) return
        profilePane = "invite"
    }

    /** A join link whose code didn't read: the join screen, offering Paste or typing the code. */
    private fun openJoinWithoutCode() {
        showFixture("crewcue://dev/join-crew")
        joinFromOnboarding = true
        replaceBody(inviteText.linkWithoutCode, kind = "empty")
    }

    /** Paste invite code: a join link, the share text or the bare code, read by client-core. */
    fun pasteInvite(text: String?) {
        if (joining) return
        val code = text?.let { container.raceDay.pastedInviteCode(it) }
        if (code == null) {
            replaceBody(inviteText.pasteNoCode, kind = "error")
            return
        }
        updateInviteCode(code)
    }

    fun openJoinCrew() {
        showFixture("crewcue://dev/join-crew")
    }

    /**
     * An invite link (the join page or `crewcue://join/<code>`): its code becomes the device's
     * pending join, kept through sign-up, and the join screen shows it with the race's preview.
     * Signed in, Join (or Not now) is the person's; signed out, sign-in joins it.
     */
    private fun openInviteLink(code: String) {
        val saved = PendingInvite.from(container.raceDay.savePendingJoin(code, PendingInvite.SOURCE_LINK))
        showJoinInvite(saved ?: PendingInvite(code, PendingInvite.SOURCE_LINK))
    }

    /** The join screen, filled in with [invite] and owned by onboarding so a join moves on from it. */
    private fun showJoinInvite(invite: PendingInvite) {
        if (showAppShell || stateOverlay || uiState.screen.featureId != JOIN_CREW_FEATURE) {
            showFixture("crewcue://dev/join-crew")
        }
        joinFromOnboarding = true
        joinHasInvite = true
        shownInvite = invite
        if (inviteCode != invite.code || joinPreviewName == null) updateInviteCode(invite.code)
    }

    /**
     * The join screen's Back (signed out) or Not now (a saved invite, signed in): the person gave
     * up on this invite, so it is forgotten and the app's own launch shows.
     */
    fun leaveJoin() {
        if (joining) return
        // The code and its confirmation: the same link later shows the preview again.
        container.raceDay.giveUpInvite()
        joinHasInvite = false
        shownInvite = null
        if (session == null) showSignedOut() else routeEntry()
    }

    fun openSignedOut() {
        showSignedOut()
    }

    /**
     * Sign-in's Back. Signed out, it opens the app's own launch (the chooser, or the step a saved
     * pick resumes) however sign-in opened: the chooser, join's Back, a dev link or sign-out. The
     * onboarding state is only read, never reset. Not while Auth0 is working.
     */
    fun leaveSignIn() {
        val leaves = OnboardingRouting.leavesSignIn(
            signedIn = session != null,
            showsShell = showAppShell,
            featureId = uiState.screen.featureId,
            authWorking = signInConnection != null
        )
        if (leaves) routeEntry()
    }

    fun openProfileHome() {
        profilePane = "profile"
    }

    fun noteDisplayName(userId: String, displayName: String) {
        val current = session ?: return
        if (current.userId != userId) return
        container.sessionStore.update { it.copy(displayName = displayName) }
        session = container.sessionStore.current()
        val roomId = current.roomId ?: return
        races = races.map { if (it.id == roomId) it.copy(displayName = displayName) else it }
    }

    fun signIn(activity: Activity?, connection: String? = null, signUp: Boolean = false) {
        if (activity == null) {
            applyAuthFailure(AuthResult.Failure("Sign-in failed.", offline = false))
            return
        }
        if (!container.authGateway.isConfigured) {
            applyAuthFailure(AuthResult.Failure("Sign-in isn't configured.", offline = false))
            return
        }
        signInConnection = connection.orEmpty()
        setupAuthFailure = null
        container.authGateway.signIn(activity, connection, signUp) { result ->
            viewModelScope.launch { applyAuthResult(result) }
        }
    }

    fun adoptRoom(roomId: String) {
        if (roomId.isBlank()) return
        container.sessionStore.update { it.copy(roomId = roomId, role = "athlete") }
        session = container.sessionStore.current()
        loadRaces()
    }

    /**
     * A race the runner just created from Profile. New rooms are unpaid and have no course, so the
     * runner's setup comes first; its state arrives with the new race list.
     */
    fun adoptCreatedRoom(roomId: String) {
        if (roomId.isBlank()) return
        container.sessionStore.update { it.copy(roomId = roomId, role = "athlete") }
        session = container.sessionStore.current()
        billing = billing.unpaid(roomId)
        onboarding = null
        onboardingTicket++
        showOnboarding()
        loadRaces(forceOnboarding = true)
    }

    /** Reads the active room's billing. Only an explicit "unpaid" gates the race; a failed read never does. */
    fun checkBilling(roomId: String) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.raceDay.billing(roomId) }
            if (session?.roomId != roomId || result !is RuntimeResult.Success) return@launch
            // A paid read wins over an onboarding state that still says preview (a race list
            // that failed to load after the purchase), so the banner goes and pings resume.
            billing = billing.read(roomId, paid = BillingInfo.from(result.result).isPaid)
        }
    }

    /** The paywall's "Continue to race" after a purchase or redemption unlocked [roomId]. */
    fun noteUnlocked(roomId: String) {
        billing = billing.unlocked(roomId)
        paywallOpen = false
        showShell(ShellTab.Map)
        loadRaces()
    }

    /** Billing checklist copy owned by client-core, read from its fixture screens. */
    fun billingCopy(): BillingCopy = BillingCopy(
        purchaseError = checklistCopy("billing-purchase", "error"),
        purchaseOffline = checklistCopy("billing-purchase", "offline"),
        redeemSuccess = checklistCopy("billing-redeem", "success"),
        redeemEmpty = checklistCopy("billing-redeem", "empty"),
        redeemError = checklistCopy("billing-redeem", "error"),
        redeemOffline = checklistCopy("billing-redeem", "offline")
    )

    private fun checklistCopy(feature: String, state: String): String = load("crewcue://dev/$feature?state=$state").body

    /** Debug only: `?webhookDelay=<seconds>` (or a `webhookDelay` extra) delays the fake store's webhook. */
    private fun captureWebhookDelay(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val fake = container.storePurchaser as? FakeStorePurchaser ?: return
        val raw = intent?.data?.getQueryParameter("webhookDelay")
            ?: intent?.extras?.let { extras ->
                extras.getString("webhookDelay") ?: extras.getInt("webhookDelay", -1).takeIf { it >= 0 }?.toString()
            }
            ?: return
        fake.webhookDelaySeconds = raw.toDoubleOrNull()?.coerceIn(0.0, 600.0) ?: 0.0
    }

    fun signOut(activity: Activity?) {
        val authActivity = activity?.takeIf {
            session?.fromAuth0 == true && container.authGateway.isConfigured
        }
        container.sessionStore.clear()
        session = null
        // The store already deleted the files; this closes any open outbox so a late write can't recreate them.
        viewModelScope.launch(Dispatchers.IO) { container.raceDay.wipeUserData() }
        racesJob?.cancel()
        races = emptyList()
        racesMessage = ""
        racesLoading = false
        racesFailed = false
        racesFailedOffline = false
        raceRows = null
        onboarding = null
        onboardingTicket++
        paywallOpen = false
        billing = RaceBilling()
        accessCache = null
        // Progress stays in client-core's onboarding store; this phone's half-typed setup goes.
        viewModelScope.launch(Dispatchers.IO) { container.runnerSetupDrafts.clear() }
        // The room saved for an offline replay lives outside the user's storage root: it goes too.
        // The replay itself ends with its route (showSignedOut ends [racePreview]).
        viewModelScope.launch(Dispatchers.IO) { container.replayRooms.clear() }
        closeSettings()
        showSignedOut()
        if (authActivity != null) {
            container.authGateway.signOut(authActivity) { }
        }
    }

    fun updateInviteCode(raw: String) {
        if (uiState.screen.featureId != "join-crew") return
        val next = raw.filter { it.isDigit() }.take(6)
        if (joining) return
        joinRaceFull = false
        inviteCode = next
        joinPreviewName = null
        joinPreviewLine = null
        joinPreviewDetail = null
        joinMembership = null
        previewJob?.cancel()
        if (next.length < 6) {
            joinBusy = false
            if (next.isEmpty()) {
                replaceBody(inviteText.joinEmpty, kind = "empty")
            }
            return
        }
        joinBusy = true
        previewJob = viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.raceDay.previewJoin(next) }
            if (inviteCode != next) return@launch
            when (result) {
                is RuntimeResult.Success -> {
                    val name = result.result.optString("roomName").trim()
                    joinPreviewName = name.ifBlank { null }
                    joinPreviewLine = joiningLine(result.result)
                    joinPreviewDetail = result.result.optText("previewLine").trim().ifBlank { null }
                }
                is RuntimeResult.Failure -> {
                    joinPreviewName = null
                    joinPreviewLine = null
                    joinPreviewDetail = null
                }
            }
            // A join started meanwhile owns the busy state and the line under the code.
            if (joining) return@launch
            joinBusy = false
            joinMembership = null
            when {
                result is RuntimeResult.Success -> replaceBody(inviteText.joinReady, kind = "success")
                (result as RuntimeResult.Failure).offline ->
                    replaceBody(inviteText.joinPreviewOffline, kind = "offline")
                else -> replaceBody(inviteText.joinNotFound, kind = "error")
            }
        }
    }

    /**
     * Join: the code becomes the device's pending join (`PendingJoin`), then client-core joins it.
     * Signed out, sign-in comes first and keeps the code through sign-up; the join runs as soon as
     * the new session exists ([applyAuthResult]).
     */
    fun join(activity: Activity?) {
        val code = inviteCode
        if (code.length != 6 || joining) return
        val source = shownInvite?.takeIf { it.code == code }?.source ?: PendingInvite.SOURCE_TYPED
        val saved = PendingInvite.from(container.raceDay.savePendingJoin(code, source))
        if (saved == null) {
            replaceBody(JoinResult.FAILED, kind = "error")
            return
        }
        shownInvite = saved
        joinHasInvite = true
        if (session == null) {
            // Sign up to join: confirmed, so the sign-in right after it joins this code.
            container.raceDay.confirmInvite(code)
            signIn(activity, signUp = true)
            return
        }
        resolveInvite()
    }

    /**
     * True when the intent signed a new user in (debug builds) right after Sign up to join: the
     * guest's confirmed invite joins, as after an Auth0 sign-in.
     */
    private fun captureDevSession(intent: Intent?): Boolean {
        val request = DevSession.parse(intent) ?: return false
        val newUser = session?.userId != request.userId
        val confirmed = newUser && session == null && confirmedInviteForSignIn()
        val stored = StoredSession(
            userId = request.userId,
            role = request.role.ifBlank { "crew_member" },
            token = request.token,
            displayName = request.displayName?.trim()?.ifBlank { null },
            // Another user's dev session must not land in the previous user's race.
            roomId = request.roomId ?: session?.takeIf { it.userId == request.userId }?.roomId,
            fromAuth0 = false
        )
        // Another user's race list must not decide this user's onboarding.
        if (session?.userId != stored.userId) raceRows = null
        container.sessionStore.save(stored)
        session = stored
        adoptStorage(stored.userId)
        loadRaces()
        return confirmed
    }

    /**
     * The guest's pending code was confirmed (Sign up to join) within client-core's lifetime. A link
     * opened and left, or a confirmation from long ago, never joins whoever signs in next.
     */
    private fun confirmedInviteForSignIn(): Boolean =
        PendingInvite.from(container.raceDay.confirmedInviteForSignIn()) != null

    /**
     * After a sign-in: a code saved signed out (a link, the referrer, or Sign in to join) is this
     * user's now, and joins without another tap. False when nothing is pending.
     */
    private fun joinPendingInvite(): Boolean {
        val invite = PendingInvite.from(container.raceDay.readPendingJoin()) ?: return false
        showJoinInvite(invite)
        resolveInvite()
        return true
    }

    private fun applyAuthResult(result: AuthResult) {
        signInConnection = null
        when (result) {
            is AuthResult.Success -> {
                // Read signed out, before this account's first onboarding read adopts the guest's.
                val confirmed = confirmedInviteForSignIn()
                val stored = StoredSession(
                    userId = result.userId,
                    role = session?.role?.ifBlank { "crew_member" } ?: "crew_member",
                    token = result.accessToken,
                    displayName = result.displayName,
                    roomId = session?.roomId,
                    fromAuth0 = true
                )
                // A new account's race list is unknown until myRaces answers.
                raceRows = null
                container.sessionStore.save(stored)
                session = stored
                adoptStorage(stored.userId)
                loadRaces()
                val onJoinScreen = !showAppShell && uiState.screen.featureId == JOIN_CREW_FEATURE
                when (OnboardingRouting.afterSignIn(confirmed, onJoinScreen = onJoinScreen)) {
                    SignInNext.Join -> joinPendingInvite()
                    SignInNext.StayOnJoin -> return
                    SignInNext.OnboardingLoader -> {
                        // Onboarding decides once the races load: setup, the chooser, or the shell.
                        onboarding = null
                        showOnboarding()
                        refreshOnboarding(force = true)
                    }
                }
            }
            is AuthResult.Failure -> applyAuthFailure(result)
        }
    }

    private fun applyAuthFailure(result: AuthResult.Failure) {
        signInConnection = null
        // A failed sign-in keeps the pending code: the join screen still shows it to try again.
        if (!showAppShell && uiState.screen.featureId == JOIN_CREW_FEATURE) {
            replaceBody(result.message, kind = if (result.offline) "offline" else "error")
            return
        }
        // The runner's account step keeps its place; the failure shows under the step.
        if (!showAppShell && uiState.screen.featureId == SETUP_FEATURE && !stateOverlay) {
            setupAuthFailure = if (result.offline) onboardingText.setupOffline else onboardingText.setupError
            return
        }
        val body = when {
            result.offline -> "Offline. Can't reach Auth0."
            result.message == "Sign-in isn't configured." -> result.message
            else -> "Sign-in failed."
        }
        showSignedOut(bodyOverride = body, failure = !result.offline, offline = result.offline)
    }

    /**
     * Joins the signed-in user's pending code through client-core (`resolvePendingJoin`): it tells
     * a new seat from one the user already had, and keeps the code for a retry when the race is
     * full or locked, or the network is down. A join moves the session to that race; onboarding
     * then moves on from the join screen.
     */
    private fun resolveInvite() {
        val user = session?.userId ?: return
        val code = inviteCode
        val race = joinPreviewName
        joinBusy = true
        joining = true
        viewModelScope.launch {
            val outcome = JoinResult.from(withContext(Dispatchers.IO) { container.raceDay.resolvePendingJoin() })
            joinBusy = false
            joining = false
            joinRaceFull = outcome.outcome == "raceFull"
            if (session?.userId != user) return@launch
            val roomId = outcome.roomId
            if (roomId != null) {
                container.sessionStore.update { it.applyingJoin(roomId, outcome.role) }
                session = container.sessionStore.current()
                // A newer link opened while this join was out stays pending: its screen comes next.
                val next = outcome.next
                if (next == null) {
                    joinHasInvite = false
                    shownInvite = null
                } else if (next.code != inviteCode && uiState.screen.featureId == JOIN_CREW_FEATURE) {
                    showJoinInvite(next)
                }
                loadRaces()
            }
            if (uiState.screen.featureId != JOIN_CREW_FEATURE) return@launch
            if (inviteCode != code) {
                // Another code is on show (a link arrived mid-join): say what the earlier one did.
                joinMembership = if (roomId != null) {
                    container.raceDay.inviteJoinLine(race, null, null)
                } else {
                    container.raceDay.inviteJoinLine(null, code, outcome.message ?: JoinResult.FAILED)
                }
                return@launch
            }
            if (roomId != null) {
                // A new seat, or client-core's "You're already in this race."
                val name = joinPreviewName
                joinMembership = outcome.message ?: if (name.isNullOrBlank()) "Joined." else "Joined $name."
                replaceBody(inviteText.joinReady, kind = "success")
                return@launch
            }
            joinMembership = null
            val line = outcome.message ?: JoinResult.FAILED
            when (outcome.tone) {
                JoinTone.Success -> replaceBody(line, kind = "success")
                JoinTone.Offline -> replaceBody(line, kind = "offline")
                JoinTone.Error -> replaceBody(line, kind = "error")
            }
        }
    }

    private fun openLinkedFeature(feature: String, url: String) {
        val signedIn = container.sessionStore.current() != null
        if (signedIn && !hasStateQuery(url) && feature in settingsFeatures) {
            showShell(selectedTab)
            openSettings(feature)
            return
        }
        if (signedIn && !hasStateQuery(url) && isPaceFeature(feature)) {
            paceFocus = feature
            showShell(ShellTab.Pace)
            return
        }
        val tabRoot = when (feature) {
            "map-track" -> ShellTab.Map
            "chat-thread" -> ShellTab.Chat
            "profile", "race-delete" -> ShellTab.Profile
            else -> null
        }
        if (signedIn && !hasStateQuery(url) && tabRoot != null) {
            selectTab(tabRoot)
            return
        }
        showFixture(url)
        // The live setup route renders client-core's onboarding state, so read it now. A link
        // (the debug dev route) keeps the route on screen: only the person's own choices in it
        // move on from it.
        if (feature == SETUP_FEATURE && !hasStateQuery(url)) {
            setupFromLink = true
            refreshOnboarding()
        }
        // The dev route plays the real replay on DemoRaceFixture, in the link's `?state=`; its
        // `?at=&paused=` opens it at a fixed moment (debug builds only; links open no fixture otherwise).
        if (feature == RACE_PREVIEW_FEATURE) {
            racePreviewFromLink = true
            racePreviewDevState = queryState(url)
            racePreviewDevStart = if (BuildConfig.DEBUG) RacePreviewDevStart.parse(url) else null
        }
    }

    private fun isPaceFeature(feature: String): Boolean {
        return feature in setOf(
            "schedule-sheet",
            "cold-start",
            "pace-estimate",
            "crew-sheet-export",
            "outbox-status",
            "check-in",
            "course-settings",
            "gpx-import",
            "pace-stop-edit",
            "live-eta"
        )
    }

    private fun showShell(tab: ShellTab) {
        previewJob?.cancel()
        racePreview.end()
        joinBusy = false
        joining = false
        stateOverlay = false
        joinFromOnboarding = false
        setupFromLink = false
        racePreviewFromLink = false
        showAppShell = true
        selectedTab = tab
        val screen = load(tab.url)
        uiState = UiState.Success(screen)
        routeId = "app-shell"
    }

    private fun showFixture(url: String) {
        previewJob?.cancel()
        stateOverlay = hasStateQuery(url)
        joinFromOnboarding = false
        setupFromLink = false
        racePreviewFromLink = false
        inviteCode = ""
        joinPreviewName = null
        joinPreviewLine = null
        joinPreviewDetail = null
        joinRaceFull = false
        joinHasInvite = false
        shownInvite = null
        joinMembership = null
        joinBusy = false
        joining = false
        showAppShell = false
        val state = queryState(url)
        val screen = load(url)
        // Another race preview (a dev link's state) carries on in the same models, which start it over.
        if (OnboardingRouting.leavesRacePreview(screen.featureId)) racePreview.end()
        profilePane = profilePaneFor(screen.featureId)
        uiState = UiState.from(screen, state)
        routeId = "${screen.featureId}?state=$state"
        // The fixture body is the preview copy; nothing has been typed yet.
        if (screen.featureId == "join-crew" && !stateOverlay) {
            replaceBody(inviteText.joinEmpty, kind = "empty")
        }
    }

    private fun showSignedOut(
        bodyOverride: String? = null,
        failure: Boolean = false,
        offline: Boolean = false
    ) {
        previewJob?.cancel()
        racePreview.end()
        stateOverlay = false
        showAppShell = false
        profilePane = "profile"
        val loaded = load("crewcue://dev/auth-signed-out")
        val screen = if (bodyOverride == null) loaded else loaded.copy(body = bodyOverride)
        uiState = when {
            offline -> UiState.Offline(screen, UserFacingError("offline", screen.body, true))
            failure -> UiState.Error(screen, UserFacingError("error", screen.body, false))
            else -> UiState.Success(screen)
        }
        val state = when {
            offline -> "offline"
            failure -> "error"
            else -> "success"
        }
        routeId = "auth-sign-in?state=$state"
    }

    private fun replaceBody(body: String, kind: String) {
        val screen = uiState.screen.copy(body = body)
        uiState = when (kind) {
            "empty" -> UiState.Empty(screen)
            "error" -> UiState.Error(screen, UserFacingError("error", body, false))
            "offline" -> UiState.Offline(screen, UserFacingError("offline", body, true))
            else -> UiState.Success(screen)
        }
    }

    private fun load(url: String): ScreenCopy = decode(container.featureScreenJson(url))

    private fun decode(json: String): ScreenCopy {
        return try {
            val obj = JSONObject(json)
            ScreenCopy(
                featureId = obj.getString("featureId"),
                accessibilityIdentifier = obj.getString("accessibilityIdentifier"),
                title = obj.getString("title"),
                body = obj.getString("body")
            )
        } catch (_: Exception) {
            placeholder
        }
    }

    private fun hasStateQuery(url: String): Boolean {
        val query = url.substringAfter('?', missingDelimiterValue = "")
        if (query.isEmpty()) return false
        return query.split('&').any { pair ->
            pair.substringBefore('=') == "state"
        }
    }

    private fun queryState(url: String): String {
        val query = url.substringAfter('?', missingDelimiterValue = "")
        if (query.isEmpty()) return "success"
        for (pair in query.split('&')) {
            val bits = pair.split('=', limit = 2)
            if (bits.size == 2 && bits[0] == "state") return bits[1]
        }
        return "success"
    }

    private fun presentStravaReturn(url: String) {
        session = container.sessionStore.current()
        if (session == null) {
            showSignedOut()
            return
        }
        stravaSignal = StravaSignal(stravaSignal.id + 1, stravaQueryFailed(url))
        showShell(selectedTab)
        openSettings("strava")
    }

    private fun profilePaneFor(featureId: String): String = when (featureId) {
        "room-members", "billing-upgrade" -> "members"
        "invite-share" -> "invite"
        "readouts-incidents" -> "incidents"
        else -> "profile"
    }

    private fun isStravaReturn(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val path = url.substringBefore('?').trimEnd('/')
        return path.equals("crewcue://strava", ignoreCase = true)
    }

    private fun stravaQueryFailed(url: String): Boolean {
        val query = url.substringAfter('?', missingDelimiterValue = "")
        if (query.isEmpty()) return false
        for (pair in query.split('&')) {
            val bits = pair.split('=', limit = 2)
            if (bits.size == 2 && bits[0] == "error" && bits[1].isNotBlank()) return true
        }
        return false
    }

    private fun isOAuthCallback(url: String?): Boolean {
        if (url.isNullOrBlank() || DevRoutes.featureId(url) != null) return false
        val path = url.substringBefore('?')
        return path.contains("/callback") || path.startsWith("crewcue://strava")
    }

    private companion object {
        /** Settings live in the settings sheet, not on a tab. */
        val settingsFeatures = setOf("chat-notification-prefs", "push-registration", "strava", "activity-import", "account-deletion")

        val placeholder = ScreenCopy(
            featureId = "app-shell",
            accessibilityIdentifier = "crewcue.app-shell",
            title = "CrewCue",
            body = ""
        )
    }

}

class ShellViewModelFactory(
    private val container: AppContainer,
    private val launchIntent: Intent?
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ShellViewModel(container, launchIntent) as T
    }
}
