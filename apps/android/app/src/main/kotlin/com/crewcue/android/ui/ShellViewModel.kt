package com.crewcue.android.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.auth.AuthResult
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.DevRoutes
import com.crewcue.android.session.DevSession
import com.crewcue.android.session.StoredSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
    private var racesJob: Job? = null

    fun noteChatUnread(count: Int) {
        chatUnread = count
    }

    private var opened = false
    private var pendingJoin = false
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
    }

    override fun onCleared() {
        container.raceDay.onSessionExpired = null
        super.onCleared()
    }

    /** Keeps only this account's files on the device (#538). */
    private fun adoptStorage(userId: String) {
        if (userId.isBlank()) return
        viewModelScope.launch(Dispatchers.IO) { container.raceDay.adoptUser(userId) }
    }

    /** Load the user's races. Client-core picks the active room; the stored one wins while still listed. */
    fun loadRaces() {
        val current = session ?: return
        racesJob?.cancel()
        racesLoading = true
        racesJob = viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { container.raceDay.myRaces(current.roomId) }
            } finally {
                if (coroutineContext[Job] == racesJob) racesLoading = false
            }
            if (session?.userId != current.userId) return@launch
            when (result) {
                is RuntimeResult.Failure -> {
                    racesMessage = if (result.offline) "Offline. Showing your last race." else "Couldn't load your races."
                }
                is RuntimeResult.Success -> {
                    val rows = result.result.optJSONArray("races")
                    val loaded = buildList {
                        for (index in 0 until (rows?.length() ?: 0)) {
                            val row = rows?.optJSONObject(index) ?: continue
                            add(
                                RaceChoice(
                                    id = row.optString("id"),
                                    name = row.optString("name"),
                                    role = row.optString("role"),
                                    roleLabel = row.optString("roleLabel"),
                                    displayName = row.optString("displayName").trim().ifBlank { null }
                                )
                            )
                        }
                    }
                    races = loaded
                    racesMessage = if (loaded.isEmpty()) "No races yet." else ""
                    val activeId = result.result.optString("activeRoomId").takeUnless {
                        result.result.isNull("activeRoomId") || it.isBlank()
                    }
                    val active = loaded.firstOrNull { it.id == activeId }
                    when {
                        active != null && (active.id != session?.roomId || active.role != session?.role) -> apply(active)
                        active == null && session?.roomId != null -> {
                            container.sessionStore.update { it.copy(roomId = null) }
                            session = container.sessionStore.current()
                        }
                    }
                }
            }
        }
    }

    /** Switch every tab to another loaded race. */
    fun selectRace(roomId: String) {
        if (roomId == session?.roomId) return
        val race = races.firstOrNull { it.id == roomId } ?: return
        apply(race)
    }

    private fun apply(race: RaceChoice) {
        container.sessionStore.update {
            it.copy(roomId = race.id, role = race.role.ifBlank { it.role }, displayName = race.displayName)
        }
        session = container.sessionStore.current()
        profilePane = "profile"
    }

    fun open(intent: Intent?) {
        captureDevSession(intent)
        val url = intent?.dataString
        if (isStravaReturn(url)) {
            opened = true
            presentStravaReturn(url.orEmpty())
            return
        }
        if (opened && isOAuthCallback(url)) return
        opened = true
        val feature = DevRoutes.featureId(url)
        val state = if (url == null) "success" else queryState(url)
        when {
            feature == "app-shell" && state == "success" -> showShell(ShellTab.Map)
            feature != null && url != null -> openLinkedFeature(feature, url)
            container.sessionStore.current() != null -> showShell(ShellTab.Map)
            else -> showSignedOut()
        }
    }

    fun selectTab(tab: ShellTab) {
        if (tab == ShellTab.Profile) profilePane = "profile"
        if (tab == ShellTab.Pace) paceFocus = "schedule-sheet"
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

    fun openJoinCrew() {
        showFixture("crewcue://dev/join-crew")
    }

    fun openSignedOut() {
        showSignedOut()
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
        pendingJoin = false
        closeSettings()
        showSignedOut()
        if (authActivity != null) {
            container.authGateway.signOut(authActivity) { }
        }
    }

    fun updateInviteCode(raw: String) {
        if (uiState.screen.featureId != "join-crew") return
        val next = raw.filter { it.isDigit() }.take(6)
        inviteCode = next
        joinPreviewName = null
        joinMembership = null
        previewJob?.cancel()
        if (next.length < 6) {
            joinBusy = false
            joining = false
            if (next.isEmpty()) {
                replaceBody("Enter an invite code.", kind = "empty")
            }
            return
        }
        joinBusy = true
        previewJob = viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.raceDay.previewJoin(next) }
            if (inviteCode != next) return@launch
            joinBusy = false
            joining = false
            when (result) {
                is RuntimeResult.Success -> {
                    val name = result.result.optString("roomName").trim()
                    joinPreviewName = name.ifBlank { null }
                    joinMembership = null
                    replaceBody("Invite code ready for preview.", kind = "success")
                }
                is RuntimeResult.Failure -> {
                    joinPreviewName = null
                    joinMembership = null
                    if (result.offline) {
                        replaceBody("Offline. Invite preview needs the network.", kind = "offline")
                    } else {
                        replaceBody("That invite code was not found.", kind = "error")
                    }
                }
            }
        }
    }

    fun join(activity: Activity?) {
        if (inviteCode.length != 6) return
        if (session == null) {
            pendingJoin = true
            signIn(activity)
            return
        }
        performJoin()
    }

    private fun captureDevSession(intent: Intent?) {
        val request = DevSession.parse(intent) ?: return
        val stored = StoredSession(
            userId = request.userId,
            role = request.role.ifBlank { "crew_member" },
            token = request.token,
            displayName = request.displayName?.trim()?.ifBlank { null },
            roomId = request.roomId ?: session?.roomId,
            fromAuth0 = false
        )
        container.sessionStore.save(stored)
        session = stored
        adoptStorage(stored.userId)
        loadRaces()
    }

    private fun applyAuthResult(result: AuthResult) {
        signInConnection = null
        when (result) {
            is AuthResult.Success -> {
                val stored = StoredSession(
                    userId = result.userId,
                    role = session?.role?.ifBlank { "crew_member" } ?: "crew_member",
                    token = result.accessToken,
                    displayName = result.displayName,
                    roomId = session?.roomId,
                    fromAuth0 = true
                )
                container.sessionStore.save(stored)
                session = stored
                adoptStorage(stored.userId)
                loadRaces()
                if (pendingJoin) {
                    pendingJoin = false
                    performJoin()
                } else if (!showAppShell && uiState.screen.featureId == "join-crew") {
                    return
                } else {
                    showShell(ShellTab.Map)
                }
            }
            is AuthResult.Failure -> applyAuthFailure(result)
        }
    }

    private fun applyAuthFailure(result: AuthResult.Failure) {
        signInConnection = null
        pendingJoin = false
        if (!showAppShell && uiState.screen.featureId == "join-crew") {
            replaceBody(result.message, kind = if (result.offline) "offline" else "error")
            return
        }
        val body = when {
            result.offline -> "Offline. Can't reach Auth0."
            result.message == "Sign-in isn't configured." -> result.message
            else -> "Sign-in failed."
        }
        showSignedOut(bodyOverride = body, failure = !result.offline, offline = result.offline)
    }

    private fun performJoin() {
        val code = inviteCode
        if (code.length != 6) return
        joinBusy = true
        joining = true
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.raceDay.join(code) }
            if (inviteCode != code) return@launch
            joinBusy = false
            joining = false
            when (result) {
                is RuntimeResult.Success -> {
                    val roomId = result.result.optJSONObject("room")?.optString("id").orEmpty()
                    if (roomId.isNotBlank()) {
                        container.sessionStore.update { it.copy(roomId = roomId) }
                        session = container.sessionStore.current()
                        loadRaces()
                    }
                    val roomName = result.result.optJSONObject("room")?.optString("name").orEmpty().trim()
                    val name = joinPreviewName ?: roomName.takeIf { it.isNotEmpty() }
                    joinPreviewName = name
                    joinMembership = if (name.isNullOrBlank()) "Joined." else "Joined $name."
                    replaceBody("Invite code ready for preview.", kind = "success")
                }
                is RuntimeResult.Failure -> {
                    if (result.offline) {
                        replaceBody("Offline. Invite preview needs the network.", kind = "offline")
                    } else {
                        replaceBody("That invite code was not found.", kind = "error")
                    }
                }
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
            "profile" -> ShellTab.Profile
            else -> null
        }
        if (signedIn && !hasStateQuery(url) && tabRoot != null) {
            selectTab(tabRoot)
            return
        }
        showFixture(url)
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
            "gpx-import"
        )
    }

    private fun showShell(tab: ShellTab) {
        previewJob?.cancel()
        joinBusy = false
        joining = false
        stateOverlay = false
        showAppShell = true
        selectedTab = tab
        val screen = load(tab.url)
        uiState = UiState.Success(screen)
        routeId = "app-shell"
    }

    private fun showFixture(url: String) {
        previewJob?.cancel()
        stateOverlay = hasStateQuery(url)
        inviteCode = ""
        joinPreviewName = null
        joinMembership = null
        joinBusy = false
        joining = false
        showAppShell = false
        val state = queryState(url)
        val screen = load(url)
        profilePane = profilePaneFor(screen.featureId)
        uiState = UiState.from(screen, state)
        routeId = "${screen.featureId}?state=$state"
    }

    private fun showSignedOut(
        bodyOverride: String? = null,
        failure: Boolean = false,
        offline: Boolean = false
    ) {
        previewJob?.cancel()
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
        "room-members" -> "members"
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
        val settingsFeatures = setOf("chat-notification-prefs", "push-registration", "strava")

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
