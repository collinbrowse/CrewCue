package com.crewcue.android.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.crewcue.android.R
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity

@Composable
private fun AuthProviderButton(label: String, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .semantics { contentDescription = label },
        shape = RoundedCornerShape(24.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.primaryContainer,
            contentColor = colors.onPrimaryContainer
        )
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.Bold)
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
            .padding(horizontal = 22.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Image(
            painter = painterResource(R.drawable.onboarding_runner),
            contentDescription = "Trail runner illustration",
            modifier = Modifier
                .fillMaxWidth()
                .height(196.dp),
            contentScale = ContentScale.Fit
        )
        Text(
            "Welcome to CrewCue",
            modifier = Modifier.padding(top = 8.dp),
            color = colors.onSurface,
            fontSize = 28.sp,
            fontWeight = FontWeight.ExtraBold
        )
        Text(
            "Find your crew and run race day together.",
            modifier = Modifier.padding(top = 10.dp),
            color = colors.onSurfaceVariant,
            fontSize = 17.sp,
            fontWeight = FontWeight.Medium
        )
        val status = screen.body
        val showStatus = status.isNotBlank() &&
            status != "Signed out. Auth0 is the sign-in pocket." &&
            status != "No session."
        if (showStatus) {
            Text(
                status,
                modifier = Modifier.padding(top = 12.dp, bottom = 12.dp).semantics {
                    contentDescription = status
                },
                color = colors.onSurfaceVariant,
                fontSize = 15.sp
            )
        } else {
            Spacer(Modifier.height(12.dp))
        }
        Text(
            if (signingUp) "Create an account" else "Sign in",
            color = colors.onSurfaceVariant,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(12.dp))
        AuthProviderButton("Continue with Apple") { viewModel.signIn(activity, "apple", signingUp) }
        Spacer(Modifier.height(12.dp))
        AuthProviderButton("Continue with Google") { viewModel.signIn(activity, "google-oauth2", signingUp) }
        Spacer(Modifier.height(12.dp))
        AuthProviderButton("Continue with email") {
            viewModel.signIn(activity, "Username-Password-Authentication", signingUp)
        }
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { viewModel.signIn(activity) },
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .semantics { contentDescription = "Sign in" },
            shape = RoundedCornerShape(24.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.primaryContainer,
                contentColor = colors.onPrimaryContainer
            )
        ) {
            Text("Sign in", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
        TextButton(
            onClick = { signingUp = !signingUp },
            modifier = Modifier.semantics {
                contentDescription = if (signingUp) "Already have an account? Sign in" else "Need an account? Sign up"
            }
        ) {
            Text(
                if (signingUp) "Already have an account? Sign in" else "Need an account? Sign up",
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Spacer(
                Modifier
                    .weight(1f)
                    .height(1.dp)
                    .padding(end = 12.dp)
            )
            Text("or", color = colors.onSurfaceVariant, fontSize = 14.sp)
            Spacer(
                Modifier
                    .weight(1f)
                    .height(1.dp)
                    .padding(start = 12.dp)
            )
        }
        OutlinedButton(
            onClick = viewModel::openJoinCrew,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .semantics { contentDescription = "Join your crew with a code" },
            shape = RoundedCornerShape(24.dp)
        ) {
            Text("Join your crew with a code", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
