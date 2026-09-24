package com.crewcue.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.AppRouter
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.ShellViewModelFactory

class MainActivity : ComponentActivity() {
    private val container = AppContainer()
    private val shellModel: ShellViewModel by viewModels {
        ShellViewModelFactory(container, intent?.dataString)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AppRouter(shellModel) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        shellModel.open(intent.dataString)
    }
}
