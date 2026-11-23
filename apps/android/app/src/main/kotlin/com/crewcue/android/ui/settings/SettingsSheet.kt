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
import com.crewcue.android.ui.theme.CompactTextField
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.RowDivider
import com.crewcue.android.ui.theme.SettingRow
import com.crewcue.android.ui.theme.SettingsGroup
import com.crewcue.android.ui.theme.ToolSheet
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.Alignment

/** Every app setting, reached from the top-bar gear on any tab. Settings deeplinks open it at their section. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ShellSettingsSheet(viewModel: ShellViewModel, onDismiss: () -> Unit) {
    val activity = LocalContext.current as? android.app.Activity
    val focus = viewModel.settingsFocus
    val roomId = viewModel.session?.roomId
    ToolSheet(title = "Settings", onDismiss = onDismiss) {
        SettingsGroup("Profile") {
            SettingsNameSection(viewModel, roomId)
        }
        SettingsGroup("Notifications", Modifier.focusedOn("push-registration", focus)) {
            PushSection(viewModel, requestOnAppear = focus == "push-registration")
            if (!roomId.isNullOrBlank()) {
                RowDivider()
                ChatAlertsSection(viewModel, roomId, Modifier.focusedOn("chat-notification-prefs", focus))
            }
        }
        if (viewModel.session?.role == "athlete") {
            SettingsGroup("Race day", Modifier.focusedOn("location-heartbeat", focus)) {
                TrackingIntervalSection(viewModel)
            }
        }
        SettingsGroup("Pace estimate", Modifier.focusedOn("activity-import", focus)) {
            ActivityImportSection(viewModel)
            // Strava is off in v1 (#652); the server routes stay for later.
            if (BuildConfig.STRAVA_ENABLED) {
                RowDivider()
                StravaSection(viewModel, Modifier.focusedOn("strava", focus))
            }
        }
        SettingsGroup("Account", Modifier.focusedOn("account-deletion", focus)) {
            SettingRow(
                Icons.AutoMirrored.Outlined.Logout,
                "Sign out",
                modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Sign out" },
                hint = "Your races and runs stay saved to your account.",
                tint = MaterialTheme.colorScheme.error,
                titleColor = MaterialTheme.colorScheme.error,
                onClick = {
                    onDismiss()
                    viewModel.signOut(activity)
                }
            )
            RowDivider()
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
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 8.dp)
        )
    }
}

/** The name your crew sees. It is stored on your membership in the current race. */
@Composable
private fun SettingsNameSection(shell: ShellViewModel, roomId: String?) {
    val session = shell.session
    if (roomId.isNullOrBlank() || session == null) {
        SettingRow(Icons.Outlined.Person, "Name your crew sees", hint = "Join or create a race to set it.")
        return
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
    SettingRow(
        Icons.Outlined.Person,
        "Name your crew sees",
        hint = model.status ?: "Shown on your chat messages and in this race's crew list.",
        below = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = "Display name",
                    modifier = Modifier.weight(1f)
                )
                PillButton(
                    "Save",
                    onClick = { model.saveName(session.userId, draft, context.isOnline(), shell::noteDisplayName) },
                    prominent = true,
                    enabled = !model.busy && draft.isNotBlank(),
                    spoken = "Save name"
                )
            }
        }
    )
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
    var open by remember { mutableStateOf(false) }
    SettingRow(
        Icons.Outlined.MyLocation,
        "Share my location every",
        modifier = modifier.semantics(mergeDescendants = false) { contentDescription = "Location interval" },
        hint = "Your crew's mile and ETA come from these. Shorter uses more battery.",
        trailing = {
            Box(Modifier.testTag("crewcue.location-interval")) {
                PillButton(
                    com.crewcue.android.ui.map.intervalLabel(interval),
                    onClick = { open = true },
                    spoken = "Every ${com.crewcue.android.ui.map.intervalLabel(interval)}"
                )
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    choices.forEach { seconds ->
                        DropdownMenuItem(
                            text = { Text("Every ${com.crewcue.android.ui.map.intervalLabel(seconds)}") },
                            onClick = {
                                open = false
                                interval = seconds
                                scope.launch(kotlinx.coroutines.Dispatchers.IO) { raceDay.setTrackingSettings(seconds) }
                            }
                        )
                    }
                }
            }
        }
    )
}
