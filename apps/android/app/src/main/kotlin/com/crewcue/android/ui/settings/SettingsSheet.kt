package com.crewcue.android.ui.settings

import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.chat.ChatAlertsSection
import com.crewcue.android.ui.chat.PushSection
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.members.RoomMembersViewModel
import com.crewcue.android.ui.members.RoomMembersViewModelFactory
import com.crewcue.android.BuildConfig
import com.crewcue.android.ui.activity.ActivityImportSection
import com.crewcue.android.ui.strava.StravaSection
import com.crewcue.android.ui.theme.CrewListRow
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.SectionHeader
import com.crewcue.android.ui.theme.ToolSheet

/** Every app setting, reached from the top-bar gear on any tab. Settings deeplinks open it at their section. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ShellSettingsSheet(viewModel: ShellViewModel, onDismiss: () -> Unit) {
    val activity = LocalContext.current as? android.app.Activity
    val focus = viewModel.settingsFocus
    val roomId = viewModel.session?.roomId
    ToolSheet(title = "Settings", onDismiss = onDismiss) {
        SettingsNameSection(viewModel, roomId)
        if (!roomId.isNullOrBlank()) {
            ChatAlertsSection(viewModel, roomId, Modifier.focusedOn("chat-notification-prefs", focus))
        }
        PushSection(viewModel, requestOnAppear = focus == "push-registration", modifier = Modifier.focusedOn("push-registration", focus))
        if (viewModel.session?.role == "athlete") {
            TrackingIntervalSection(viewModel, Modifier.focusedOn("location-heartbeat", focus))
        }
        ActivityImportSection(viewModel, Modifier.focusedOn("activity-import", focus))
        // Strava is off in v1 (#652); the server routes stay for later.
        if (BuildConfig.STRAVA_ENABLED) {
            StravaSection(viewModel, Modifier.focusedOn("strava", focus))
        }
        ProductCard(Modifier.focusedOn("account-deletion", focus)) {
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
            DeleteAccountRow(viewModel) {
                onDismiss()
                viewModel.signOut(activity)
            }
        }
        Text(
            text = buildAnnotatedString {
                append("Pacing model built with race results from ")
                withLink(LinkAnnotation.Url("https://www.opensplittime.org")) { append("OpenSplitTime.org") }
                append(".")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/** The name your crew sees. It is stored on your membership in the current race. */
@Composable
private fun SettingsNameSection(shell: ShellViewModel, roomId: String?) {
    val session = shell.session
    ProductCard {
        SectionHeader("Profile")
        if (roomId.isNullOrBlank() || session == null) {
            Text("Join or create a race to set the name your crew sees.", style = MaterialTheme.typography.bodyMedium)
            return@ProductCard
        }
        val model: RoomMembersViewModel = viewModel(
            key = "members-$roomId",
            factory = RoomMembersViewModelFactory(shell.container.raceDay, roomId)
        )
        val context = LocalContext.current
        var draft by rememberSaveable(session.userId, roomId) { mutableStateOf(session.displayName.orEmpty()) }
        LaunchedEffect(roomId) { model.load(context.isOnline()) }
        // The roster holds the saved name; the session may not carry one.
        val saved = model.members.firstOrNull { it.userId == session.userId }?.displayName.orEmpty()
        LaunchedEffect(saved) { if (draft.isBlank() && saved.isNotBlank()) draft = saved }
        CrewTextField(
            value = draft,
            onValueChange = { draft = it },
            label = "Display name",
            modifier = Modifier.semantics { contentDescription = "Display name" }
        )
        PrimaryButton(
            "Save name",
            onClick = { model.saveName(session.userId, draft, context.isOnline(), shell::noteDisplayName) },
            modifier = Modifier.padding(top = 12.dp),
            enabled = !model.busy && draft.isNotBlank()
        )
        model.status?.let { line ->
            Text(line, modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = line })
        }
    }
}

/** Scrolls this section into view when the sheet opened for it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Modifier.focusedOn(featureId: String, focus: String?): Modifier {
    val requester = remember { BringIntoViewRequester() }
    LaunchedEffect(focus) {
        if (focus == featureId) requester.bringIntoView()
    }
    return bringIntoViewRequester(requester)
}

/** How often the runner's phone shares a position on race day. Saved on this device by client-core. */
@Composable
private fun TrackingIntervalSection(viewModel: ShellViewModel, modifier: Modifier = Modifier) {
    val raceDay = viewModel.container.raceDay
    var interval by remember { mutableStateOf(com.crewcue.android.ui.map.DEFAULT_TRACKING_INTERVAL_SECONDS) }
    var choices by remember { mutableStateOf(listOf(60, 120, 180, 300, 600)) }
    LaunchedEffect(Unit) {
        val result = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { raceDay.trackingSettings() }
        if (result is com.crewcue.android.data.RuntimeResult.Success) {
            interval = result.result.optInt("intervalSeconds", interval)
            result.result.optJSONArray("allowedIntervalSeconds")?.let { array ->
                choices = (0 until array.length()).map { array.optInt(it) }.filter { it > 0 }
            }
        }
    }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    ProductCard(modifier.semantics { contentDescription = "Location interval" }) {
        SectionHeader("Location interval")
        Text(
            "How often your phone shares your position with your crew during the race. Shorter uses more battery.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        androidx.compose.foundation.layout.FlowRow(
            modifier = Modifier.padding(top = 8.dp).testTag("crewcue.location-interval"),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)
        ) {
            choices.forEach { seconds ->
                androidx.compose.material3.FilterChip(
                    selected = seconds == interval,
                    onClick = {
                        interval = seconds
                        scope.launch(kotlinx.coroutines.Dispatchers.IO) { raceDay.setTrackingSettings(seconds) }
                    },
                    label = { Text("Every ${com.crewcue.android.ui.map.intervalLabel(seconds)}") }
                )
            }
        }
    }
}
