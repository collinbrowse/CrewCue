package com.crewcue.android.ui

import androidx.compose.animation.togetherWith
import com.crewcue.android.ui.theme.PillButton
import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.window.core.layout.WindowSizeClass
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.map.MapViewModel
import com.crewcue.android.ui.map.MapViewModelFactory
import com.crewcue.android.ui.map.captureLocation
import com.crewcue.android.ui.theme.CrewBackground
import com.crewcue.android.ui.theme.CrewListRow
import com.crewcue.android.ui.theme.CourseStripState
import com.crewcue.android.ui.theme.CrewTopBar
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.max
import com.crewcue.android.ui.theme.SectionHeader
import com.crewcue.android.ui.theme.ToolSheet
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.athlete.AthleteSetupScreen
import com.crewcue.android.ui.brandloader.BrandLoaderDemo
import com.crewcue.android.ui.billing.PaywallScreen
import com.crewcue.android.ui.billing.RedeemScreen
import com.crewcue.android.ui.auth.AuthSignInScreen
import com.crewcue.android.ui.notifications.NotificationPermissionScreen
import com.crewcue.android.ui.chat.ChatScreen
import com.crewcue.android.ui.incidents.IncidentsScreen
import com.crewcue.android.ui.join.JoinCrewScreen
import com.crewcue.android.ui.map.MapScreen
import com.crewcue.android.ui.members.RoomMembersScreen
import com.crewcue.android.ui.invite.InviteShareScreen
import com.crewcue.android.ui.outbox.OutboxScreen
import com.crewcue.android.ui.pace.PaceScreen
import com.crewcue.android.ui.profile.ProfileScreen
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.SecondaryButton
import com.crewcue.android.ui.settings.ShellSettingsSheet
import com.crewcue.android.ui.onboarding.OnboardingScreen
import com.crewcue.android.ui.onboarding.RACE_PREVIEW_FEATURE
import com.crewcue.android.ui.onboarding.RacePreviewRoute
import com.crewcue.android.ui.onboarding.RaceGate
import com.crewcue.android.ui.onboarding.RaceLockedPane
import com.crewcue.android.ui.onboarding.UnlockRaceBanner
import com.crewcue.android.ui.onboarding.CREW_TOUR_FEATURE
import com.crewcue.android.ui.onboarding.OnboardingTourViewModel
import com.crewcue.android.ui.onboarding.RUNNER_TOUR_FEATURE
import com.crewcue.android.ui.onboarding.SetupChecklistCard
import com.crewcue.android.ui.onboarding.SetupChecklistPanel
import com.crewcue.android.ui.onboarding.SetupChecklistRow
import com.crewcue.android.ui.onboarding.TourAnchors
import com.crewcue.android.ui.onboarding.TourContext
import com.crewcue.android.ui.onboarding.TourDevRoute
import com.crewcue.android.ui.onboarding.TourOverlayHost
import com.crewcue.android.ui.onboarding.tabAnchorTag
import com.crewcue.android.ui.onboarding.tourAnchor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalConfiguration
import com.crewcue.android.ui.chat.CrewPush
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ShellScreen(viewModel: ShellViewModel) {
    if (viewModel.showAppShell) {
        AppShell(viewModel)
    } else {
        FeatureHost(viewModel)
    }
}

@Composable
private fun AppShell(viewModel: ShellViewModel) {
    val roomId = viewModel.session?.roomId
    // client-core decides the race's access from billing and the onboarding state; this only picks the pane.
    val access = viewModel.raceAccess()
    val gate = RaceGate.of(access, paywallOpen = viewModel.paywallOpen, onRaceTab = viewModel.selectedTab != ShellTab.Profile)
    val race = if (roomId.isNullOrBlank() || !access.loadsRace) null else rememberRaceDay(viewModel, roomId, sampleLocation = access.samplesLocation)
    val unlockBanner = viewModel.onboardingText.unpaidBanner
    val unlockExpiry = viewModel.unpaidExpiry()
    // Start tracking and chat send open the paywall on an unpaid race.
    val onLocked: (() -> Unit)? = if (access.gatesActions) viewModel::openPaywall else null
    if (!roomId.isNullOrBlank()) {
        LaunchedEffect(roomId) { viewModel.checkBilling(roomId) }
    }
    val tour = rememberTour(viewModel)
    val anchors = remember { TourAnchors() }
    CrewBackground(
        Modifier
            .fillMaxSize()
            .testTag("crewcue.app-shell")
            .semantics { contentDescription = "CrewCue" }
    ) {
        val paywallRoom = roomId?.takeIf { gate.showsPaywall }
        val lockedReason = gate.lockedReason
        CrewNavigationSuite(
            selected = viewModel.selectedTab,
            chatUnread = viewModel.chatUnread,
            onSelect = viewModel::selectTab,
            anchors = anchors
        ) { rail ->
            Box(Modifier.fillMaxSize()) {
                // On a phone the pill floats over the content; beside a rail nothing sits under it.
                val tabBarSpace = if (rail) 0.dp else TAB_BAR_SPACE
                val onMap = viewModel.selectedTab == ShellTab.Map && race != null && paywallRoom == null && lockedReason == null
                // Map and Pace show the runner's course progress in the top bar (client-core's readout
                // from the athlete's pings). Chat and Profile don't.
                val raceTab = viewModel.selectedTab == ShellTab.Map || viewModel.selectedTab == ShellTab.Pace
                val courseStrip = race?.readout?.takeIf { raceTab && paywallRoom == null && lockedReason == null }?.let { readout ->
                    readout.courseStripLabel?.let { CourseStripState(readout.progressFraction, it, readout.courseStripSpoken ?: it) }
                }
                // The bar grows with the strip and with the font scale: content starts under its real height.
                val density = LocalDensity.current
                var barHeight by remember { mutableStateOf(0.dp) }
                val topSpace = max(TOP_BAR_SPACE, barHeight + 8.dp)
                Column(
                    Modifier
                        .fillMaxSize()
                        .then(if (onMap) Modifier else Modifier.statusBarsPadding().padding(top = topSpace))
                        .padding(bottom = if (onMap) 0.dp else tabBarSpace)
                ) {
                    if (paywallRoom != null) {
                        PaywallScreen(
                            viewModel,
                            paywallRoom,
                            onContinue = { viewModel.noteUnlocked(paywallRoom) },
                            Modifier.weight(1f),
                            // The runner's paywall closes back to where it was opened; a crew member's
                            // unpaid race shows it in place of the tab, with nothing to close.
                            onClose = if (viewModel.paywallOpen) viewModel::closePaywall else null
                        )
                    } else if (lockedReason != null) {
                        RaceLockedPane(lockedReason, Modifier.weight(1f))
                    } else when (viewModel.selectedTab) {
                        ShellTab.Profile -> {
                            if (viewModel.session == null) {
                                FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                            } else {
                                ProfileDestination(viewModel, Modifier.weight(1f), race)
                            }
                        }
                        ShellTab.Pace -> {
                            if (roomId.isNullOrBlank()) {
                                NoRaceScreen(viewModel, Modifier.weight(1f))
                            } else {
                                if (onLocked != null) UnlockRaceBanner(unlockBanner, onLocked, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), expiry = unlockExpiry)
                                PaceScreen(viewModel, roomId, Modifier.weight(1f), viewModel.paceFocus, race)
                            }
                        }
                        ShellTab.Map -> {
                            if (roomId.isNullOrBlank()) {
                                NoRaceScreen(viewModel, Modifier.weight(1f))
                            } else {
                                MapScreen(
                                    viewModel,
                                    roomId,
                                    "map-track",
                                    Modifier.weight(1f),
                                    bottomInset = max(tabBarSpace, 16.dp),
                                    topInset = topSpace + 4.dp,
                                    onLocked = onLocked,
                                    toolRequest = viewModel.mapToolRequest,
                                    startLineRequest = viewModel.startLineRequest,
                                    onStartLineShown = viewModel::startLineShown,
                                    topCard = tour?.checklist?.takeIf { tour.card == null }?.let { checklist ->
                                        { SetupChecklistSlot(viewModel, tour, checklist) }
                                    }
                                )
                            }
                        }
                        ShellTab.Chat -> {
                            if (roomId.isNullOrBlank()) {
                                NoRaceScreen(viewModel, Modifier.weight(1f))
                            } else {
                                if (onLocked != null) UnlockRaceBanner(unlockBanner, onLocked, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), expiry = unlockExpiry)
                                ChatPane(viewModel, roomId, Modifier.weight(1f), race = race, onLocked = onLocked)
                            }
                        }
                    }
                }
                // The map is full-bleed under the top bar, so its banner floats below that bar.
                if (onLocked != null && onMap) {
                    UnlockRaceBanner(
                        unlockBanner,
                        onLocked,
                        Modifier
                            .align(Alignment.TopCenter)
                            .statusBarsPadding()
                            .padding(top = topSpace + 48.dp)
                            .padding(horizontal = 16.dp),
                        expiry = unlockExpiry
                    )
                }
                CrewTopBar(
                    title = viewModel.topBarTitle,
                    onSettings = { viewModel.openSettings() },
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .statusBarsPadding()
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .onSizeChanged { barHeight = with(density) { it.height.toDp() } },
                    courseStrip = courseStrip
                )
            }
        }
        // The tour's coach marks, over a race the person can use (not the paywall or a locked race).
        if (tour != null && paywallRoom == null && lockedReason == null && !viewModel.showsSettings) {
            TourOverlayHost(
                tour = tour,
                anchors = anchors,
                onSelectTab = { tab -> if (viewModel.selectedTab != tab) viewModel.selectTab(tab) },
                onStartLine = viewModel::showStartLine
            )
        }
    }
    if (viewModel.showsSettings) {
        ShellSettingsSheet(viewModel, onDismiss = viewModel::closeSettings)
    }
    if (viewModel.showsRaceChooser) {
        RaceChooserSheet(viewModel)
    }
}

/** Space the floating top bar and tab bar take over scrolling content. */
private val TOP_BAR_SPACE = 72.dp
internal val TAB_BAR_SPACE = 96.dp

/**
 * The shell's tabs, by window width: the floating pill [CrewTabBar] over [content] at compact
 * width, a navigation rail beside it at medium and expanded widths. [content] learns which, so
 * it leaves room under the pill only when the pill is there. Each rail item carries the same
 * `crewcue.tab.*` tag and tour anchor as the pill's tab, so a coach mark rings the rail item.
 */
@Composable
internal fun CrewNavigationSuite(
    selected: ShellTab,
    chatUnread: Int,
    onSelect: (ShellTab) -> Unit,
    anchors: TourAnchors?,
    content: @Composable (rail: Boolean) -> Unit
) {
    val rail = currentWindowAdaptiveInfo().windowSizeClass
        .isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    val colors = MaterialTheme.colorScheme
    NavigationSuiteScaffold(
        navigationSuiteItems = {
            ShellTab.entries.forEach { tab ->
                val active = tab == selected
                item(
                    selected = active,
                    onClick = { onSelect(tab) },
                    icon = { Icon(tabIcon(tab, active), contentDescription = null) },
                    label = { TabLabel(tab) },
                    badge = if (tab == ShellTab.Chat && chatUnread > 0) {
                        { Badge { Text(chatUnread.toString()) } }
                    } else {
                        null
                    },
                    modifier = Modifier
                        .testTag(tabAnchorTag(tab))
                        .tourAnchor(anchors, tabAnchorTag(tab))
                        .semantics { contentDescription = tabDescription(tab, chatUnread) }
                )
            }
        },
        layoutType = if (rail) NavigationSuiteType.NavigationRail else NavigationSuiteType.None,
        navigationSuiteColors = NavigationSuiteDefaults.colors(
            navigationRailContainerColor = colors.surfaceContainerLowest
        ),
        containerColor = Color.Transparent,
        contentColor = colors.onBackground
    ) {
        Box(Modifier.fillMaxSize()) {
            content(rail)
            if (!rail) {
                CrewTabBar(
                    selected = selected,
                    chatUnread = chatUnread,
                    onSelect = onSelect,
                    anchors = anchors,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
        }
    }
}

private fun tabDescription(tab: ShellTab, chatUnread: Int): String =
    if (tab == ShellTab.Chat && chatUnread > 0) "${tab.title}, $chatUnread unread" else tab.title

/** One line at any font scale: "PROFILE" wrapped at 200%. */
@Composable
private fun TabLabel(tab: ShellTab, modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    Text(
        tab.title.uppercase(),
        modifier = modifier,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
        softWrap = false
    )
}

/**
 * Course, schedule, and location feed readouts on every tab, so they load with the shell. Without
 * [sampleLocation] (an unpaid race) the athlete's phone sends no position sample.
 */
@Composable
private fun rememberRaceDay(viewModel: ShellViewModel, roomId: String, sampleLocation: Boolean): MapViewModel {
    val role = viewModel.session?.role.orEmpty()
    val race: MapViewModel = viewModel(
        key = "map-$roomId-$role",
        factory = MapViewModelFactory(viewModel.container.raceDay, roomId, role)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId, role, sampleLocation) {
        race.load()
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (granted && sampleLocation) captureLocation(context, race)
    }
    return race
}

/**
 * Floating pill tab bar. The active tab is a filled primary capsule. Each tab is tagged
 * `crewcue.tab.*` and reports its frame to [anchors], so a tour card rings the real control.
 */
@Composable
internal fun CrewTabBar(
    selected: ShellTab,
    chatUnread: Int,
    onSelect: (ShellTab) -> Unit,
    modifier: Modifier = Modifier,
    anchors: TourAnchors? = null
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = CircleShape,
        color = colors.surfaceContainerLowest,
        shadowElevation = 8.dp
    ) {
        Row(Modifier.padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            ShellTab.entries.forEach { tab ->
                val active = tab == selected
                val ink = if (active) colors.onPrimary else colors.onSurfaceVariant
                Column(
                    Modifier
                        .weight(1f)
                        .clip(CircleShape)
                        .background(if (active) colors.primary else Color.Transparent)
                        .selectable(selected = active, role = Role.Tab) { onSelect(tab) }
                        .testTag(tabAnchorTag(tab))
                        .tourAnchor(anchors, tabAnchorTag(tab))
                        .padding(vertical = 8.dp)
                        .semantics { contentDescription = tabDescription(tab, chatUnread) },
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    BadgedBox(
                        badge = {
                            if (tab == ShellTab.Chat && chatUnread > 0) Badge { Text(chatUnread.toString()) }
                        }
                    ) {
                        Icon(tabIcon(tab, active), contentDescription = null, tint = ink)
                    }
                    TabLabel(tab, Modifier.padding(top = 2.dp), ink)
                }
            }
        }
    }
}

/** Standalone routes outside the tab shell: page ground plus system bar insets. */
@Composable
private fun FeatureHost(viewModel: ShellViewModel) {
    val featureId = viewModel.uiState.screen.featureId
    val fullBleed = featureId in setOf("map-track", "map-checkpoint-pick", "map-navigate", "runner-track", RUNNER_TOUR_FEATURE, CREW_TOUR_FEATURE)
    CrewBackground(
        Modifier
            .fillMaxSize()
            .then(if (fullBleed) Modifier else Modifier.statusBarsPadding())
    ) {
        FeatureRoute(viewModel)
    }
}

@Composable
private fun FeatureRoute(viewModel: ShellViewModel) {
    when (viewModel.uiState.screen.featureId) {
        "auth-sign-in" -> AuthSignInScreen(viewModel)
        "join-crew" -> JoinCrewScreen(viewModel)
        "athlete-setup" -> {
            if (viewModel.stateOverlay) FeatureScreen(viewModel.uiState) else AthleteSetupScreen(viewModel)
        }
        "onboarding-notifications" -> {
            if (viewModel.stateOverlay) FeatureScreen(viewModel.uiState) else NotificationPermissionScreen()
        }
        // The chooser and the runner's setup, driven by client-core's onboarding state.
        "onboarding-runner-setup" -> {
            if (viewModel.stateOverlay) FeatureScreen(viewModel.uiState) else OnboardingScreen(viewModel)
        }
        // Runner phase 2: the race-day replay and its paywall. The dev route plays DemoRaceFixture,
        // its `?state=` shown on the real screen with Skip.
        RACE_PREVIEW_FEATURE -> RacePreviewRoute(viewModel)
        // The tab-bar tours on the example race, with no API: nothing is saved or sent.
        RUNNER_TOUR_FEATURE, CREW_TOUR_FEATURE -> {
            if (viewModel.stateOverlay) {
                FeatureScreen(viewModel.uiState)
            } else {
                TourDevRoute(viewModel, if (viewModel.uiState.screen.featureId == CREW_TOUR_FEATURE) "crew" else "runner")
            }
        }
        "billing-purchase", "billing-redeem" -> {
            val roomId = viewModel.session?.roomId
            when {
                roomId.isNullOrBlank() || viewModel.stateOverlay -> FeatureScreen(viewModel.uiState)
                viewModel.uiState.screen.featureId == "billing-redeem" ->
                    RedeemScreen(viewModel, roomId, onContinue = { viewModel.noteUnlocked(roomId) })
                else -> PaywallScreen(viewModel, roomId, onContinue = { viewModel.noteUnlocked(roomId) }, onClose = viewModel::closePaywall)
            }
        }
        "profile", "race-delete", "room-members", "readouts-incidents", "billing-upgrade", "invite-share" -> {
            if (viewModel.session != null && !viewModel.stateOverlay && profileDestinationReady(viewModel)) {
                ProfileDestination(viewModel)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "map-track", "map-checkpoint-pick", "map-navigate", "location-heartbeat", "runner-track" -> {
            val roomId = viewModel.session?.roomId
            if (!roomId.isNullOrBlank() && !viewModel.stateOverlay) {
                MapScreen(viewModel, roomId, viewModel.uiState.screen.featureId)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "outbox-status" -> {
            if (viewModel.session != null && !viewModel.stateOverlay) {
                OutboxScreen(viewModel)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "chat-thread" -> {
            val roomId = viewModel.session?.roomId
            if (!roomId.isNullOrBlank() && !viewModel.stateOverlay) {
                ChatPane(viewModel, roomId)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "brand-loader" -> FeatureScreen(viewModel.uiState) { BrandLoaderDemo(viewModel.uiState.screen.title) }
        else -> FeatureScreen(viewModel.uiState)
    }
}

/**
 * Map, Pace, and Chat need a race. With none yet, point at the two ways to get one; with races
 * but none active (the active one was deleted), list them too: the person picks.
 */
@Composable
private fun NoRaceScreen(viewModel: ShellViewModel, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag("crewcue.no-race")
    ) {
        ProductCard {
            val races = viewModel.races
            Text(if (races.isEmpty()) "No race yet" else "Choose a race", style = MaterialTheme.typography.headlineSmall)
            RaceChoices(
                races = races,
                onSelect = viewModel::selectRace,
                onCreate = { viewModel.selectTab(ShellTab.Profile) },
                onJoin = viewModel::openJoinCrew,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

@Composable
fun FeatureScreen(
    state: UiState,
    modifier: Modifier = Modifier,
    showPocket: Boolean = true,
    extra: @Composable () -> Unit = {}
) {
    val screen = state.screen
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag(screen.accessibilityIdentifier)
            .semantics { contentDescription = screen.title }
    ) {
        val carded = screen.featureId == "athlete-setup" || screen.featureId == "onboarding-notifications"
        if (carded) {
            ProductCard {
                Text(screen.title, style = MaterialTheme.typography.headlineSmall)
                Text(
                    screen.body,
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        } else {
            Text(screen.title, style = MaterialTheme.typography.headlineSmall)
            Text(
                screen.body,
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodyLarge
            )
        }
        extra()
    }
}

@Composable
private fun ProfileDestination(viewModel: ShellViewModel, modifier: Modifier = Modifier, race: MapViewModel? = null) {
    val roomId = viewModel.session?.roomId
    // A page opened from Profile goes back with system Back too (Invite to Room members, the
    // others to Profile), never out of the app.
    androidx.activity.compose.BackHandler(enabled = viewModel.profilePane != "profile") {
        if (viewModel.profilePane == "invite") viewModel.openRoomMembers() else viewModel.openProfileHome()
    }
    // Pages come in from the right over Profile and go back the same way.
    androidx.compose.animation.AnimatedContent(
        targetState = viewModel.profilePane,
        transitionSpec = {
            val deeper = profileDepth(targetState) > profileDepth(initialState)
            val width: (Int) -> Int = { if (deeper) it else -it }
            (androidx.compose.animation.slideInHorizontally(initialOffsetX = width) togetherWith
                androidx.compose.animation.slideOutHorizontally(targetOffsetX = { -width(it) }))
        },
        modifier = modifier,
        label = "profile-pane"
    ) { pane ->
        ProfilePane(viewModel, pane, roomId, race)
    }
}

/** How deep a Profile pane sits: Profile, then Room members and Incidents, then Invite. */
private fun profileDepth(pane: String): Int = when (pane) {
    "invite" -> 2
    "members", "incidents", "race-pass" -> 1
    else -> 0
}

@Composable
private fun ProfilePane(viewModel: ShellViewModel, pane: String, roomId: String?, race: MapViewModel?) {
    val modifier = Modifier.fillMaxSize()
    when (pane) {
        "members" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                RoomMembersScreen(viewModel, roomId, viewModel::openProfileHome, modifier)
            }
        }
        "invite" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                InviteShareScreen(viewModel, roomId, viewModel::openRoomMembers, modifier)
            }
        }
        "incidents" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                IncidentsScreen(viewModel.container.raceDay, roomId, viewModel::openProfileHome, modifier)
            }
        }
        "race-pass" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                // Profile's Race Pass row: the race's Race Pass page, its X back to Profile.
                PaywallScreen(
                    viewModel,
                    roomId,
                    onContinue = {
                        viewModel.noteUnlocked(roomId)
                        viewModel.openProfileHome()
                    },
                    modifier,
                    onClose = viewModel::openProfileHome
                )
            }
        }
        else -> ProfileScreen(viewModel, modifier, race)
    }
}

private fun profileDestinationReady(viewModel: ShellViewModel): Boolean {
    val needsRoom = viewModel.profilePane in setOf("members", "incidents", "invite", "race-pass")
    if (!needsRoom) return true
    return !viewModel.session?.roomId.isNullOrBlank()
}

@Composable
private fun ChatPane(
    viewModel: ShellViewModel,
    roomId: String,
    modifier: Modifier = Modifier,
    race: MapViewModel? = null,
    onLocked: (() -> Unit)? = null
) {
    ChatScreen(
        viewModel,
        roomId,
        race = race,
        modifier = modifier,
        onLocked = onLocked
    )
}

private fun tabIcon(tab: ShellTab, selected: Boolean): ImageVector = when (tab) {
    ShellTab.Map -> if (selected) Icons.Filled.Explore else Icons.Outlined.Explore
    ShellTab.Pace -> if (selected) Icons.Filled.Timer else Icons.Outlined.Timer
    ShellTab.Chat -> if (selected) Icons.AutoMirrored.Filled.Chat else Icons.AutoMirrored.Outlined.Chat
    ShellTab.Profile -> if (selected) Icons.Filled.Person else Icons.Outlined.Person
}

/**
 * The signed-in user's tour and setup checklist for the active race (client-core decides both),
 * read again whenever the onboarding state, the race list or the race changes. Null signed out.
 */
@Composable
private fun rememberTour(viewModel: ShellViewModel): OnboardingTourViewModel? {
    val session = viewModel.session ?: return null
    val context = LocalContext.current
    val tour: OnboardingTourViewModel = viewModel(
        key = "tour-${session.userId}",
        factory = OnboardingTourViewModel.factory(viewModel.container.raceDay, context, devRole = null)
    )
    tour.onState = viewModel::noteOnboardingState
    val (rows, active) = viewModel.onboardingRaceContext()
    LaunchedEffect(viewModel.onboarding, viewModel.onboardingRaces, active) {
        if (!active.isNullOrBlank()) tour.refresh(TourContext(rows, active))
    }
    // Permissions changed in Settings: the checklist reads them again.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle, tour) {
        var started = false
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                if (started) tour.refresh() else started = true
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return tour
}

/** The setup checklist under the Map's top bar; opening an item goes where it says and marks it. */
@Composable
private fun SetupChecklistSlot(viewModel: ShellViewModel, tour: OnboardingTourViewModel, checklist: SetupChecklistCard) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { CrewPush.refreshIfAllowed(context, viewModel.container.raceDay) } }
                tour.refresh()
            }
        }
    }
    fun open(row: SetupChecklistRow) {
        when (row.opens) {
            "inviteShare" -> {
                viewModel.selectTab(ShellTab.Profile)
                viewModel.openInviteShare()
            }
            "paceStopEdit" -> viewModel.openPaceStopEdit()
            "mapCheckpointPick" -> viewModel.openMapTool("pick")
            "mapTracking" -> viewModel.openMapTool("location")
            "notifications" -> if (android.os.Build.VERSION.SDK_INT >= 33 && !CrewPush.notificationsAllowed(context)) {
                notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        tour.openChecklistItem(row.kind)
    }
    SetupChecklistPanel(
        checklist = checklist,
        onOpen = ::open,
        onHide = tour::hideChecklist,
        // Open, the list scrolls in this much of the window, so the top bar and the map stay.
        maxHeight = LocalConfiguration.current.screenHeightDp.dp * 0.4f,
        modifier = Modifier.padding(bottom = 8.dp)
    )
}
