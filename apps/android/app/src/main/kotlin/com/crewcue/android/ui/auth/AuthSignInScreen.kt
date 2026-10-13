package com.crewcue.android.ui.auth

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.FeatureScreen
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity

@Composable
fun AuthSignInScreen(viewModel: ShellViewModel) {
    val activity = LocalContext.current.findActivity()
    FeatureScreen(state = viewModel.uiState, showPocket = false) {
        Button(
            onClick = { viewModel.signIn(activity) },
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .semantics { contentDescription = "Sign in" }
        ) {
            Text("Sign in")
        }
    }
}
