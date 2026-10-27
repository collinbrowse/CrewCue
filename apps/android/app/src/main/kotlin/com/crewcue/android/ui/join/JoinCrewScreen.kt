package com.crewcue.android.ui.join

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
        if (viewModel.session == null) {
            TextButton(
                onClick = viewModel::openSignedOut,
                modifier = Modifier.semantics { contentDescription = "Back" }
            ) {
                Text("Back", style = MaterialTheme.typography.labelLarge)
            }
        }
        ProductTitle("Join your crew", "Enter the 6-digit code from your crew.")
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
        val preview = viewModel.joinPreviewName
        if (!preview.isNullOrBlank()) {
            ProductCard(Modifier.padding(top = 16.dp)) {
                Text(preview, style = MaterialTheme.typography.titleMedium)
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
                modifier = Modifier.padding(top = 16.dp).semantics { contentDescription = status },
                color = colors.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Spacer(Modifier.height(18.dp))
        PrimaryButton(
            if (viewModel.session == null) "Sign in to join" else "Join",
            onClick = { viewModel.join(activity) },
            enabled = code.length == 6 && !viewModel.joinBusy,
            spoken = "Join",
            busy = viewModel.joining
        )
    }
}
