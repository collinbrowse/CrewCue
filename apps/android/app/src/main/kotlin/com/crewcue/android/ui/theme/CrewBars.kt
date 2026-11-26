package com.crewcue.android.ui.theme

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag

/**
 * Onboarding's one Back: the standard top app bar with only its navigation arrow, over the page's
 * own ground, the same on every step (runner setup, the paywall after the replay, the crew's join
 * step). System Back and the predictive back gesture should do what it does ([onBack]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CrewBackBar(label: String, tag: String, enabled: Boolean = true, onBack: () -> Unit) {
    TopAppBar(
        title = {},
        navigationIcon = {
            IconButton(onClick = onBack, enabled = enabled, modifier = Modifier.testTag(tag)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = label)
            }
        },
        // The route already sits below the status bar (FeatureHost).
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
    )
}

/**
 * A page opened over the flow (Race Pass, Join your crew): the same top app bar with an X as its
 * only action, at the top right. It returns to wherever the page was opened from, so the page is
 * never a dead end.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CrewCloseBar(label: String, tag: String, enabled: Boolean = true, onClose: () -> Unit) {
    TopAppBar(
        title = {},
        actions = {
            IconButton(onClick = onClose, enabled = enabled, modifier = Modifier.testTag(tag)) {
                Icon(Icons.Filled.Close, contentDescription = label)
            }
        },
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
    )
}
