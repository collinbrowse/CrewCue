package com.crewcue.android.ui

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
import com.crewcue.android.ui.theme.CrewTopBar
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
import com.crewcue.android.ui.auth.AuthSignInScreen
import com.crewcue.android.ui.notifications.NotificationPermissionScreen
import com.crewcue.android.ui.chat.ChatPrefsScreen
import com.crewcue.android.ui.chat.ChatScreen
import com.crewcue.android.ui.chat.PushRegistrationScreen
import com.crewcue.android.ui.incidents.IncidentsScreen
import com.crewcue.android.ui.join.JoinCrewScreen
import com.crewcue.android.ui.map.MapScreen
import com.crewcue.android.ui.members.RoomMembersScreen
import com.crewcue.android.ui.outbox.OutboxScreen
import com.crewcue.android.ui.pace.PaceScreen
import com.crewcue.android.ui.profile.ProfileScreen
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.strava.StravaScreen

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
    var showsSettings by remember { mutableStateOf(false) }
    val roomId = viewModel.session?.roomId
    val race = if (roomId.isNullOrBlank()) null else rememberRaceDay(viewModel, roomId)
    CrewBackground(
        Modifier
            .fillMaxSize()
            .testTag("crewcue.app-shell")
            .semantics { contentDescription = "CrewCue" }
    ) {
        val onMap = viewModel.selectedTab == ShellTab.Map && race != null
        Column(
            Modifier
                .fillMaxSize()
                .then(if (onMap) Modifier else Modifier.statusBarsPadding().padding(top = TOP_BAR_SPACE))
                .padding(bottom = if (onMap) 0.dp else TAB_BAR_SPACE)
        ) {
            when (viewModel.selectedTab) {
                ShellTab.Profile -> {
                    if (viewModel.session == null) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        ProfileDestination(viewModel, Modifier.weight(1f), race)
                    }
                }
                ShellTab.Pace -> {
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        PaceScreen(viewModel, roomId, Modifier.weight(1f), viewModel.paceFocus, race)
                    }
                }
                ShellTab.Map -> {
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        MapScreen(viewModel, roomId, "map-track", Modifier.weight(1f), bottomInset = TAB_BAR_SPACE)
                    }
                }
                ShellTab.Chat -> {
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        ChatPane(viewModel, roomId, viewModel.chatPane, Modifier.weight(1f), race = race)
                    }
                }
            }
        }
        CrewTopBar(
            onSettings = { showsSettings = true },
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 4.dp)
        )
        CrewTabBar(
            selected = viewModel.selectedTab,
            chatUnread = viewModel.chatUnread,
            onSelect = viewModel::selectTab,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        )
    }
    if (showsSettings) {
        ShellSettingsSheet(viewModel, onDismiss = { showsSettings = false })
    }
}

/** Space the floating top bar and tab bar take over scrolling content. */
private val TOP_BAR_SPACE = 72.dp
private val TAB_BAR_SPACE = 96.dp

/** Course, schedule, and location feed readouts on every tab, so they load with the shell. */
@Composable
private fun rememberRaceDay(viewModel: ShellViewModel, roomId: String): MapViewModel {
    val role = viewModel.session?.role.orEmpty()
    val race: MapViewModel = viewModel(
        key = "map-$roomId-$role",
        factory = MapViewModelFactory(viewModel.container.raceDay, roomId, role)
    )
    val context = LocalContext.current
    LaunchedEffect(roomId, role) {
        race.load()
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) captureLocation(context, race)
    }
    return race
}

/** Floating pill tab bar. The active tab is a filled primary capsule. */
@Composable
private fun CrewTabBar(
    selected: ShellTab,
    chatUnread: Int,
    onSelect: (ShellTab) -> Unit,
    modifier: Modifier = Modifier
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
                        .padding(vertical = 8.dp)
                        .semantics {
                            contentDescription = if (tab == ShellTab.Chat && chatUnread > 0) {
                                "${tab.title}, $chatUnread unread"
                            } else {
                                tab.title
                            }
                        },
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    BadgedBox(
                        badge = {
                            if (tab == ShellTab.Chat && chatUnread > 0) Badge { Text(chatUnread.toString()) }
                        }
                    ) {
                        Icon(tabIcon(tab, active), contentDescription = null, tint = ink)
                    }
                    Text(
                        tab.title.uppercase(),
                        modifier = Modifier.padding(top = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = ink
                    )
                }
            }
        }
    }
}

/** Notifications and account, reached from the top-bar gear. */
@Composable
private fun ShellSettingsSheet(viewModel: ShellViewModel, onDismiss: () -> Unit) {
    val activity = LocalContext.current as? android.app.Activity
    ToolSheet(title = "Settings", onDismiss = onDismiss) {
        ProductCard {
            SectionHeader("Notifications")
            CrewListRow(Icons.Outlined.Notifications, "Chat notifications", onClick = {
                onDismiss()
                viewModel.selectTab(ShellTab.Chat)
                viewModel.openChatAlerts()
            })
            CrewListRow(Icons.Outlined.PhoneAndroid, "Push registration", onClick = {
                onDismiss()
                viewModel.selectTab(ShellTab.Chat)
                viewModel.openChatPush()
            })
        }
        ProductCard {
            SectionHeader("Account")
            CrewListRow(
                Icons.AutoMirrored.Outlined.Logout,
                "Sign out",
                onClick = {
                    onDismiss()
                    viewModel.signOut(activity)
                },
                tint = MaterialTheme.colorScheme.error,
                titleColor = MaterialTheme.colorScheme.error
            )
        }
    }
}

/** Standalone routes outside the tab shell: page ground plus system bar insets. */
@Composable
private fun FeatureHost(viewModel: ShellViewModel) {
    val featureId = viewModel.uiState.screen.featureId
    val fullBleed = featureId in setOf("map-track", "map-checkpoint-pick", "map-navigate")
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
        "profile", "strava", "room-members", "readouts-incidents" -> {
            if (viewModel.session != null && !viewModel.stateOverlay && profileDestinationReady(viewModel)) {
                ProfileDestination(viewModel)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "map-track", "map-checkpoint-pick", "map-navigate", "location-heartbeat" -> {
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
        "push-registration" -> {
            if (viewModel.session != null && !viewModel.stateOverlay) {
                PushRegistrationScreen(viewModel, onBack = null)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        "chat-thread", "chat-notification-prefs" -> {
            val roomId = viewModel.session?.roomId
            if (!roomId.isNullOrBlank() && !viewModel.stateOverlay) {
                val pane = when (viewModel.uiState.screen.featureId) {
                    "chat-notification-prefs" -> "prefs"
                    "push-registration" -> "push"
                    else -> viewModel.chatPane
                }
                val back = if (viewModel.uiState.screen.featureId == "chat-thread") {
                    viewModel::openChatThread
                } else {
                    null
                }
                ChatPane(viewModel, roomId, pane, onBack = back)
            } else {
                FeatureScreen(viewModel.uiState)
            }
        }
        else -> FeatureScreen(viewModel.uiState)
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
    when (viewModel.profilePane) {
        "strava" -> StravaScreen(viewModel, viewModel::openProfileHome, modifier)
        "members" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                RoomMembersScreen(viewModel, roomId, viewModel::openProfileHome, modifier)
            }
        }
        "incidents" -> {
            if (roomId.isNullOrBlank()) {
                ProfileScreen(viewModel, modifier)
            } else {
                IncidentsScreen(viewModel.container.raceDay, roomId, viewModel::openProfileHome, modifier)
            }
        }
        else -> ProfileScreen(viewModel, modifier, race)
    }
}

private fun profileDestinationReady(viewModel: ShellViewModel): Boolean {
    val needsRoom = viewModel.profilePane == "members" || viewModel.profilePane == "incidents"
    if (!needsRoom) return true
    return !viewModel.session?.roomId.isNullOrBlank()
}

@Composable
private fun ChatPane(
    viewModel: ShellViewModel,
    roomId: String,
    pane: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = viewModel::openChatThread,
    race: MapViewModel? = null
) {
    when (pane) {
        "prefs" -> ChatPrefsScreen(viewModel, roomId, onBack, modifier)
        "push" -> PushRegistrationScreen(viewModel, onBack, modifier)
        else -> ChatScreen(
            viewModel,
            roomId,
            race = race,
            modifier = modifier
        )
    }
}

private fun tabIcon(tab: ShellTab, selected: Boolean): ImageVector = when (tab) {
    ShellTab.Map -> if (selected) Icons.Filled.Explore else Icons.Outlined.Explore
    ShellTab.Pace -> if (selected) Icons.Filled.Timer else Icons.Outlined.Timer
    ShellTab.Chat -> if (selected) Icons.AutoMirrored.Filled.Chat else Icons.AutoMirrored.Outlined.Chat
    ShellTab.Profile -> if (selected) Icons.Filled.Person else Icons.Outlined.Person
}
