package com.crewcue.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.theme.ProductTitle

/** Shown instead of the app when a release build was made without its server or sign-in settings. */
@Composable
fun ConfigurationErrorScreen(problem: String) {
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 24.dp, vertical = 64.dp)
            .testTag("crewcue.configuration-error")
    ) {
        ProductTitle(
            title = "CrewCue can't start",
            subtitle = "$problem Install the latest version of the app."
        )
    }
}
