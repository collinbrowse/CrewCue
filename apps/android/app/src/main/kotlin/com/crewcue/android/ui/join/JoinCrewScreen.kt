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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    val text = viewModel.inviteText
    // The line under the code repeats the prompt above it while nothing is typed: shown only once
    // it says something new.
    val status = viewModel.uiState.screen.body.takeUnless { code.isEmpty() && it == text.joinEmpty }.orEmpty()
    val labels = viewModel.onboardingText
    // System Back does what the top bar's control does, so the page is never a dead end.
    BackHandler(enabled = !viewModel.joining) { viewModel.closeJoin() }
    Column(Modifier.fillMaxSize().testTag("crewcue.join-crew").semantics { contentDescription = "Join crew" }) {
        if (viewModel.joinIsOnboardingStep) {
            // Onboarding's crew step: the same Back as every other onboarding step.
            com.crewcue.android.ui.theme.CrewBackBar(labels.back.ifBlank { "Back" }, "crewcue.join-crew.back", enabled = !viewModel.joining, onBack = viewModel::closeJoin)
        } else {
            // A page opened over the app: the X at the top right, back to where it was opened.
            com.crewcue.android.ui.theme.CrewCloseBar(labels.label("close").ifBlank { "Close" }, "crewcue.join-crew.close", enabled = !viewModel.joining, onClose = viewModel::closeJoin)
        }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 8.dp)
    ) {
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
        // A link, the share text or the bare code from the clipboard, read by client-core. Shown only
        // while the clipboard holds text (its description only: reading it would show Android's
        // pasted-from-clipboard notice on every visit).
        val clipboard = LocalClipboardManager.current
        val paste = viewModel.inviteText.pasteLabel
        if (rememberClipboardHasText()) TextButton(
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
        if (viewModel.joinWaitingForUnlock && status.isNotBlank()) {
            // Not an error: the code is right, the runner just hasn't unlocked the race yet.
            ProductCard(
                Modifier
                    .padding(top = 16.dp)
                    .testTag("crewcue.join-crew.waiting")
                    .semantics(mergeDescendants = true) { contentDescription = status }
            ) {
                Text(status, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
            }
        } else if (status.isNotBlank()) {
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
}

/**
 * The clipboard holds text (a code or a link could be in it), read from its description only,
 * again whenever the clipboard changes.
 */
@Composable
private fun rememberClipboardHasText(): Boolean {
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(android.content.ClipboardManager::class.java) }
    fun read(): Boolean {
        val description = manager?.primaryClipDescription ?: return false
        return manager.hasPrimaryClip() &&
            (description.hasMimeType(android.content.ClipDescription.MIMETYPE_TEXT_PLAIN) ||
                description.hasMimeType(android.content.ClipDescription.MIMETYPE_TEXT_HTML) ||
                description.hasMimeType(android.content.ClipDescription.MIMETYPE_TEXT_URILIST))
    }
    var hasText by remember(manager) { mutableStateOf(read()) }
    DisposableEffect(manager) {
        val listener = android.content.ClipboardManager.OnPrimaryClipChangedListener { hasText = read() }
        manager?.addPrimaryClipChangedListener(listener)
        onDispose { manager?.removePrimaryClipChangedListener(listener) }
    }
    // Copied in another app: read again when the screen comes back.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) hasText = read()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return hasText
}
