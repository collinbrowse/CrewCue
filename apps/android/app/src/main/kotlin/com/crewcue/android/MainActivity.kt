package com.crewcue.android

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.AppRouter
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.ShellViewModelFactory
import com.crewcue.android.ui.theme.CrewCueTheme

class MainActivity : ComponentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    private val shellModel: ShellViewModel by viewModels {
        ShellViewModelFactory(container, intent)
    }

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installMapLibre()
        installStream()
        setContent {
            CrewCueTheme {
                Box(Modifier.semantics { testTagsAsResourceId = true }) {
                    AppRouter(shellModel)
                }
            }
        }
    }

    private fun installMapLibre() {
        if (!BuildConfig.MAP_LIBRE) return
        runCatching {
            val type = Class.forName("com.crewcue.android.ui.map.MapLibreBootstrap")
            type.getMethod("install", Context::class.java).invoke(null, applicationContext)
        }
    }

    private fun installStream() {
        if (!BuildConfig.STREAM_CHAT) return
        runCatching {
            Class.forName("com.crewcue.android.ui.chat.StreamChatBootstrap")
                .getMethod("install")
                .invoke(null)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        shellModel.open(intent)
    }
}
