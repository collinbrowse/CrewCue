package com.crewcue.android.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.R
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.brand.CairnShakeLoader
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.theme.CrewSpace
import com.crewcue.android.ui.theme.GhostButton
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.LocalCrewExtras
import com.crewcue.android.ui.theme.PrimaryButton

/** Light-grey pill with a leading icon, the DESIGN.md social auth treatment. */
@Composable
private fun AuthProviderButton(
    label: String,
    icon: ImageVector,
    working: Boolean,
    busy: Boolean,
    onClick: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Button(
        onClick = onClick,
        enabled = !working,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .semantics { contentDescription = label },
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.surfaceContainerHigh,
            contentColor = colors.onSurface,
            disabledContainerColor = if (busy) colors.surfaceContainerHigh else colors.surfaceContainerHigh.copy(alpha = 0.5f),
            disabledContentColor = if (busy) colors.onSurface else colors.onSurface.copy(alpha = 0.4f)
        )
    ) {
        if (busy) {
            CairnShakeLoader(modifier = Modifier.size(20.dp), onLight = !LocalCrewExtras.current.dark)
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun AuthSignInScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
    var signingUp by remember { mutableStateOf(false) }
    val screen = viewModel.uiState.screen
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag(screen.accessibilityIdentifier)
            .semantics { contentDescription = "Signed out" }
            .verticalScroll(rememberScrollState())
            .padding(horizontal = CrewSpace.margin, vertical = CrewSpace.margin),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)
    ) {
        Image(
            painter = painterResource(R.drawable.onboarding_runner),
            contentDescription = "Trail runner illustration",
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp),
            contentScale = ContentScale.Fit
        )
        Text("Welcome to CrewCue", style = MaterialTheme.typography.displaySmall, color = colors.onSurface)
        Text(
            "Find your crew and run race day together.",
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurfaceVariant
        )
        val status = screen.body
        val showStatus = status.isNotBlank() &&
            status != "Signed out. Auth0 is the sign-in pocket." &&
            status != "No session."
        if (showStatus) {
            Text(
                status,
                modifier = Modifier.semantics { contentDescription = status },
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
        }
        Kicker(if (signingUp) "Create an account" else "Sign in")
        val working = viewModel.signInConnection
        AuthProviderButton("Continue with Apple", Icons.Outlined.PhoneIphone, working != null, working == "apple") {
            viewModel.signIn(activity, "apple", signingUp)
        }
        AuthProviderButton("Continue with Google", Icons.Outlined.Language, working != null, working == "google-oauth2") {
            viewModel.signIn(activity, "google-oauth2", signingUp)
        }
        AuthProviderButton(
            "Continue with email",
            Icons.Outlined.Email,
            working != null,
            working == "Username-Password-Authentication"
        ) {
            viewModel.signIn(activity, "Username-Password-Authentication", signingUp)
        }
        PrimaryButton(
            "Sign in",
            onClick = { viewModel.signIn(activity) },
            enabled = working == null,
            busy = working == ""
        )
        TextButton(
            onClick = { signingUp = !signingUp },
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .semantics {
                    contentDescription = if (signingUp) "Already have an account? Sign in" else "Need an account? Sign up"
                }
        ) {
            Text(
                if (signingUp) "Already have an account? Sign in" else "Need an account? Sign up",
                style = MaterialTheme.typography.labelLarge
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f), color = colors.outlineVariant)
            Text("or", modifier = Modifier.padding(horizontal = 12.dp), color = colors.onSurfaceVariant)
            HorizontalDivider(Modifier.weight(1f), color = colors.outlineVariant)
        }
        GhostButton("Join your crew with a code", onClick = viewModel::openJoinCrew)
    }
}
