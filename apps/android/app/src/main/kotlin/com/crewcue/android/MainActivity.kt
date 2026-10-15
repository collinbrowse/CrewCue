package com.crewcue.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.AppRouter
import com.crewcue.android.ui.brand.LaunchSplash
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.ShellViewModelFactory

class MainActivity : ComponentActivity() {
    private val container = AppContainer()
    private val shellModel: ShellViewModel by viewModels {
        ShellViewModelFactory(container, intent?.dataString)
    }

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The theme paints the launch colour until the first frame; screens draw on white.
        window.setBackgroundDrawableResource(android.R.color.white)
        // Dev deeplink launches go straight to their fixture.
        val playSplash = savedInstanceState == null && intent?.data == null
        setContent {
            var showSplash by rememberSaveable { mutableStateOf(playSplash) }
            Box(Modifier.semantics { testTagsAsResourceId = true }) {
                AppRouter(shellModel)
                if (showSplash) {
                    LaunchSplash { showSplash = false }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        shellModel.open(intent.dataString)
    }
}
