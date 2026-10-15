package com.crewcue.android.ui.settings

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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.chat.ChatAlertsSection
import com.crewcue.android.ui.chat.PushSection
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.members.RoomMembersViewModel
import com.crewcue.android.ui.members.RoomMembersViewModelFactory
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
        StravaSection(viewModel, Modifier.focusedOn("strava", focus))
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
