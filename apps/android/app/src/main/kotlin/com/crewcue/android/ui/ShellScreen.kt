package com.crewcue.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.brandloader.BrandLoaderDemo

@Composable
fun ShellScreen(viewModel: ShellViewModel) {
    if (viewModel.showAppShell) {
        AppShell(viewModel.uiState)
    } else {
        val state = viewModel.uiState
        FeatureScreen(state) {
            if (state.screen.featureId == "brand-loader") {
                BrandLoaderDemo(state.screen.title)
            }
        }
    }
}

@Composable
private fun AppShell(content: UiState) {
    Scaffold(
        modifier = Modifier
            .testTag("crewcue.app-shell")
            .semantics { contentDescription = "CrewCue" },
        bottomBar = {
            NavigationBar {
                listOf("Map", "Pace", "Chat", "Profile").forEach { title ->
                    NavigationBarItem(
                        selected = title == "Map",
                        onClick = {},
                        icon = {},
                        label = { Text(title) }
                    )
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            Text("crewcue.app-shell")
            FeatureScreen(content)
        }
    }
}

@Composable
fun FeatureScreen(
    state: UiState,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit = {}
) {
    val screen = state.screen
    val pocket = pocketLabel(screen.featureId)
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag(screen.accessibilityIdentifier)
            .semantics { contentDescription = screen.title }
    ) {
        Text(screen.accessibilityIdentifier)
        Text(screen.title)
        Text(screen.body)
        if (pocket != null) {
            Text(pocket)
        }
        content()
    }
}

private fun pocketLabel(featureId: String): String? = when (featureId) {
    "map-track", "map-checkpoint-pick", "map-navigate" -> "MapLibre"
    "chat-thread", "chat-notification-prefs" -> "Stream Chat"
    "auth-sign-in", "strava" -> "Auth0"
    else -> null
}
