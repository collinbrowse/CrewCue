package com.crewcue.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private var url by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        url = intent?.dataString
        setContent { CrewCueRoot(url) { url } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        url = intent.dataString
    }
}

@Composable
private fun CrewCueRoot(url: String?, readUrl: () -> String?) {
    val current = readUrl() ?: url
    if (current == null || current.endsWith("dev/app-shell")) {
        AppShell()
    } else {
        FeatureScreen(url = current)
    }
}

@Composable
private fun AppShell() {
    Scaffold(
        modifier = Modifier.semantics { contentDescription = "crewcue.app-shell" },
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
        FeatureScreen(url = "crewcue://dev/map", modifier = Modifier.padding(padding))
    }
}

@Composable
fun FeatureScreen(url: String, modifier: Modifier = Modifier) {
    val screen = rememberScreen(url)
    val pocket = pocketLabel(screen.featureId)
    Column(modifier = modifier.fillMaxSize().padding(16.dp).semantics { contentDescription = screen.accessibilityIdentifier }) {
        Text(screen.accessibilityIdentifier)
        Text(screen.title)
        Text(screen.body)
        if (pocket != null) {
            Text(pocket)
        }
    }
}

private data class ScreenModel(
    val featureId: String,
    val accessibilityIdentifier: String,
    val title: String,
    val body: String
)

@Composable
private fun rememberScreen(url: String): ScreenModel {
    val json = ClientCoreBridge.featureScreenJsonForUrl(url)
    val obj = JSONObject(json)
    return ScreenModel(
        featureId = obj.getString("featureId"),
        accessibilityIdentifier = obj.getString("accessibilityIdentifier"),
        title = obj.getString("title"),
        body = obj.getString("body")
    )
}

private fun pocketLabel(featureId: String): String? = when (featureId) {
    "map-track", "map-checkpoint-pick", "map-navigate" -> "MapLibre"
    "chat-thread", "chat-notification-prefs" -> "Stream Chat"
    "auth-sign-in", "strava" -> "Auth0"
    else -> null
}
