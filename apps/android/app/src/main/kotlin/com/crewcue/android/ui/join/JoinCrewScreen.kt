package com.crewcue.android.ui.join

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.FeatureScreen
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.UiState
import com.crewcue.android.ui.findActivity

@Composable
fun JoinCrewScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
    val code = viewModel.inviteCode
    val state = viewModel.uiState
    val showEmptyHint = code.isEmpty() &&
        state is UiState.Success &&
        state.screen.body != "Enter an invite code."
    FeatureScreen(state = state) {
        OutlinedTextField(
            value = code,
            onValueChange = viewModel::updateInviteCode,
            label = { Text("Invite code") },
            supportingText = if (showEmptyHint) {
                { Text("Enter an invite code.") }
            } else {
                null
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Invite code" }
        )
        val preview = viewModel.joinPreviewName
        if (!preview.isNullOrBlank()) {
            Text(
                preview,
                modifier = Modifier
                    .padding(top = 12.dp)
                    .semantics { contentDescription = preview }
            )
        }
        val membership = viewModel.joinMembership
        if (!membership.isNullOrBlank()) {
            Text(
                membership,
                modifier = Modifier
                    .padding(top = 12.dp)
                    .semantics { contentDescription = membership }
            )
        }
        if (viewModel.session == null) {
            TextButton(
                onClick = viewModel::openSignedOut,
                modifier = Modifier.padding(top = 8.dp).semantics { contentDescription = "Back" }
            ) {
                Text("Back")
            }
        }
        Button(
            onClick = { viewModel.join(activity) },
            enabled = code.length == 6 && !viewModel.joinBusy,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Join" }
        ) {
            Text(if (viewModel.session == null) "Sign in to join" else "Join")
        }
    }
}
