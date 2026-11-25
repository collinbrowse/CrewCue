package com.crewcue.android.ui.auth

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.brand.CairnShakeLoader
import com.crewcue.android.ui.brand.CourseProfile
import com.crewcue.android.ui.brand.CourseProfileArt
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

/**
 * Signed out: Auth0 sign-in or sign-up, or join a crew with a code. Back (the top bar's arrow and
 * system Back) opens the app's own launch, the chooser, however this screen opened.
 */
@Composable
fun AuthSignInScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
    // Starts on Sign in each time the screen opens; a fold or rotation keeps the person's pick.
    var signingUp by rememberSaveable { mutableStateOf(false) }
    val screen = viewModel.uiState.screen
    val working = viewModel.signInConnection
    val signedOut = viewModel.session == null
    // Always taken while signed out, so Back never closes the app from here; while Auth0 works it
    // does nothing (ShellViewModel.leaveSignIn).
    BackHandler(enabled = signedOut) { viewModel.leaveSignIn() }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag(screen.accessibilityIdentifier)
            .semantics { contentDescription = "Signed out" }
    ) {
        if (signedOut) SignInTopBar(enabled = working == null, onBack = viewModel::leaveSignIn)
        SignInContent(viewModel, activity, screen.body, signingUp, working, onToggle = { signingUp = !signingUp }, Modifier.weight(1f))
    }
}

/** The standard top app bar with only the navigation arrow, over the page's own ground. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SignInTopBar(enabled: Boolean, onBack: () -> Unit) {
    TopAppBar(
        title = {},
        navigationIcon = {
            IconButton(
                onClick = onBack,
                enabled = enabled,
                modifier = Modifier.testTag("crewcue.auth-sign-in.back")
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        },
        // The route already sits below the status bar (FeatureHost).
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
    )
}

@Composable
private fun SignInContent(
    viewModel: ShellViewModel,
    activity: Activity?,
    status: String,
    signingUp: Boolean,
    working: String?,
    onToggle: () -> Unit,
    modifier: Modifier
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = CrewSpace.margin, vertical = CrewSpace.margin),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)
    ) {
        Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
            CourseProfileArt(
                Modifier
                    .fillMaxHeight()
                    .aspectRatio(CourseProfile.ASPECT_RATIO)
                    .clip(MaterialTheme.shapes.medium)
                    .semantics { contentDescription = "Course profile with a runner on it" }
            )
        }
        Text("Welcome to CrewCue", style = MaterialTheme.typography.displaySmall, color = colors.onSurface)
        Text(
            "Find your crew and run race day together.",
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurfaceVariant
        )
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
            onClick = onToggle,
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
