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
import androidx.compose.runtime.Composable
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
fun AuthSignInScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
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
        Text(
            screen.body,
            modifier = Modifier.padding(top = 12.dp, bottom = 12.dp).semantics {
                contentDescription = screen.body
            },
            color = colors.onSurfaceVariant,
            fontSize = 15.sp
        )
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
