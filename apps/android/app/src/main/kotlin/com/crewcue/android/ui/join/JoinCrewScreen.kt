package com.crewcue.android.ui.join

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle

@Composable
fun JoinCrewScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
    val code = viewModel.inviteCode
    val colors = MaterialTheme.colorScheme
    val status = viewModel.uiState.screen.body
    Column(
        Modifier
            .fillMaxSize()
            .testTag("crewcue.join-crew")
            .semantics { contentDescription = "Join crew" }
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp)
    ) {
        // Signed out: Back. Signed in over a saved invite: Not now. Both forget the invite.
        val leave = when {
            viewModel.session == null -> "Back"
            viewModel.joinHasInvite -> "Not now"
            else -> null
        }
        // System Back does what the Back / Not now button does: it gives the invite up.
        BackHandler(enabled = leave != null && !viewModel.joining) { viewModel.leaveJoin() }
        if (leave != null) {
            TextButton(
                onClick = viewModel::leaveJoin,
                enabled = !viewModel.joining,
                modifier = Modifier
                    .testTag("crewcue.join-crew.leave")
                    .semantics { contentDescription = leave }
            ) {
                Text(leave, style = MaterialTheme.typography.labelLarge)
            }
        }
        val text = viewModel.inviteText
        ProductTitle(text.joinTitle, text.joinPrompt)
        OutlinedTextField(
            value = code,
            onValueChange = viewModel::updateInviteCode,
            label = { Text("Invite code") },
            singleLine = true,
            textStyle = MaterialTheme.typography.headlineMedium.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            ),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            shape = MaterialTheme.shapes.small,
            modifier = Modifier
                .padding(top = 18.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Invite code" }
        )
        // A link, the share text or the bare code from the clipboard, read by client-core.
        val clipboard = LocalClipboardManager.current
        val paste = viewModel.inviteText.pasteLabel
        TextButton(
            onClick = { viewModel.pasteInvite(clipboard.getText()?.text) },
            enabled = !viewModel.joining,
            modifier = Modifier
                .padding(top = 4.dp)
                .testTag("crewcue.join-crew.paste")
                .semantics { contentDescription = paste }
        ) {
            Text(paste, style = MaterialTheme.typography.labelLarge)
        }
        // "You're joining Sam's race" before sign-up (client-core), with the race's name.
        val line = viewModel.joinPreviewLine
        val race = viewModel.joinPreviewDetail ?: viewModel.joinPreviewName
        if (!line.isNullOrBlank() || !race.isNullOrBlank()) {
            val spoken = listOfNotNull(line, race).joinToString(". ")
            ProductCard(
                Modifier
                    .padding(top = 12.dp)
                    .testTag("crewcue.join-crew.preview")
                    .semantics(mergeDescendants = true) { contentDescription = spoken }
            ) {
                if (!line.isNullOrBlank()) Text(line, style = MaterialTheme.typography.titleMedium)
                if (!race.isNullOrBlank()) {
                    Text(race, style = MaterialTheme.typography.bodyLarge, color = colors.onSurfaceVariant)
                }
            }
        }
        val membership = viewModel.joinMembership
        if (!membership.isNullOrBlank()) {
            Text(
                membership,
                modifier = Modifier.padding(top = 12.dp).semantics { contentDescription = membership },
                color = colors.onSurface,
                fontWeight = FontWeight.SemiBold
            )
        }
        if (status.isNotBlank()) {
            Text(
                status,
                modifier = Modifier
                    .padding(top = 16.dp)
                    .then(if (viewModel.joinRaceFull) Modifier.testTag("crewcue.join-crew.race-full") else Modifier)
                    .semantics { contentDescription = status },
                color = colors.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
        // Signed out, the button keeps the code and opens sign-up; the join runs once signed in.
        if (viewModel.session == null) {
            Text(
                viewModel.inviteText.signUpToJoinDetail,
                modifier = Modifier.padding(top = 16.dp),
                color = colors.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Spacer(Modifier.height(18.dp))
        PrimaryButton(
            if (viewModel.session == null) text.signUpToJoin else text.joinButton,
            onClick = { viewModel.join(activity) },
            enabled = code.length == 6 && !viewModel.joinBusy,
            spoken = "Join",
            busy = viewModel.joining
        )
    }
}
