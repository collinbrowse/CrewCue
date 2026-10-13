package com.crewcue.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.auth.AuthSignInScreen
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
    Scaffold(
        modifier = Modifier
            .testTag("crewcue.app-shell")
            .semantics { contentDescription = "CrewCue" },
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                ShellTab.entries.forEach { tab ->
                    val selected = viewModel.selectedTab == tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = { viewModel.selectTab(tab) },
                        icon = { Icon(tabIcon(tab, selected), contentDescription = tab.title) },
                        label = { Text(tab.title) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    )
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            when (viewModel.selectedTab) {
                ShellTab.Profile -> {
                    if (viewModel.session == null) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        ProfileDestination(viewModel, Modifier.weight(1f))
                    }
                }
                ShellTab.Pace -> {
                    val roomId = viewModel.session?.roomId
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        PaceScreen(viewModel, roomId, Modifier.weight(1f))
                    }
                }
                ShellTab.Map -> {
                    val roomId = viewModel.session?.roomId
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        MapScreen(viewModel, roomId, "map-track", Modifier.weight(1f))
                    }
                }
                ShellTab.Chat -> {
                    val roomId = viewModel.session?.roomId
                    if (roomId.isNullOrBlank()) {
                        FeatureScreen(viewModel.uiState, Modifier.weight(1f))
                    } else {
                        ChatPane(viewModel, roomId, viewModel.chatPane, Modifier.weight(1f))
                    }
                }
                else -> FeatureScreen(viewModel.uiState, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FeatureHost(viewModel: ShellViewModel) {
    when (viewModel.uiState.screen.featureId) {
        "auth-sign-in" -> AuthSignInScreen(viewModel)
        "join-crew" -> JoinCrewScreen(viewModel)
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
        Text(screen.title, style = MaterialTheme.typography.headlineSmall)
        Text(
            screen.body,
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodyLarge
        )
        extra()
    }
}

@Composable
private fun ProfileDestination(viewModel: ShellViewModel, modifier: Modifier = Modifier) {
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
        else -> ProfileScreen(viewModel, modifier)
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
    onBack: (() -> Unit)? = viewModel::openChatThread
) {
    when (pane) {
        "prefs" -> ChatPrefsScreen(viewModel, roomId, onBack, modifier)
        "push" -> PushRegistrationScreen(viewModel, onBack, modifier)
        else -> ChatScreen(
            viewModel,
            roomId,
            onOpenAlerts = viewModel::openChatAlerts,
            onOpenPush = viewModel::openChatPush,
            modifier = modifier
        )
    }
}

private fun tabIcon(tab: ShellTab, selected: Boolean): ImageVector = when (tab) {
    ShellTab.Map -> if (selected) Icons.Filled.Explore else Icons.Outlined.Explore
    ShellTab.Pace -> if (selected) Icons.Filled.Timer else Icons.Outlined.Timer
    ShellTab.Chat -> if (selected) Icons.Filled.Chat else Icons.Outlined.Chat
    ShellTab.Profile -> if (selected) Icons.Filled.Person else Icons.Outlined.Person
}
