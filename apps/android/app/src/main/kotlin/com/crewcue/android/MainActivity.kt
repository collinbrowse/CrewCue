package com.crewcue.android

import android.content.Context
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
import com.auth0.android.provider.WebAuthProvider
import com.crewcue.android.crash.CrashReporting
import com.crewcue.android.di.AppContainer
import com.crewcue.android.nav.AppRouter
import com.crewcue.android.ui.ConfigurationErrorScreen
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.ShellViewModelFactory
import com.crewcue.android.nav.DevRoutes
import com.crewcue.android.ui.activity.SharedRunImportSheet
import com.crewcue.android.ui.activity.SharedRunImportViewModel
import com.crewcue.android.ui.activity.SharedRunImportViewModelFactory
import com.crewcue.android.ui.brand.LaunchSplash
import com.crewcue.android.ui.chat.CrewPush
import com.crewcue.android.ui.theme.CrewCueTheme
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    /**
     * A fresh launch, not a restore after process death or a launch from Recents: only then is the
     * launch intent's link (an invite, a dev route) opened. Set before [shellModel] is first read.
     */
    private var freshLaunch = true
    private val shellModel: ShellViewModel by viewModels {
        ShellViewModelFactory(container, intent.takeIf { freshLaunch })
    }
    private val sharedRunImport: SharedRunImportViewModel by viewModels {
        SharedRunImportViewModelFactory(container.raceDay)
    }

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        freshLaunch = savedInstanceState == null &&
            ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0
        CrashReporting.start(applicationContext)
        container.authConfig.problem?.let { problem ->
            setContent { CrewCueTheme { ConfigurationErrorScreen(problem) } }
            return
        }
        // The theme paints the launch colour until the first frame; screens draw on white.
        window.setBackgroundDrawableResource(android.R.color.white)
        installMapLibre()
        // A demo replay killed mid-play leaves its folder in the cache directory; sweep it at launch.
        lifecycleScope.launch(Dispatchers.IO) { container.cleanDemoRacesOnce() }
        CrewPush.ensureChannel(applicationContext)
        // Only on a fresh launch: folding or rotating recreates the activity with the same intent.
        if (savedInstanceState == null) CrewPush.chatRoomFrom(intent)?.let { shellModel.openChat(it) }
        if (container.sessionStore.current() != null) {
            lifecycleScope.launch(Dispatchers.IO) { CrewPush.refreshIfAllowed(applicationContext, container.raceDay) }
        }
        // A run file shared or opened in CrewCue (run-share-import). Not on recreation: the sheet's
        // state lives in its ViewModel.
        if (savedInstanceState == null) receiveRunShare(intent)
        // Dev deeplink launches go straight to their fixture.
        val playSplash = savedInstanceState == null && intent?.data == null
        setContent {
            var showSplash by rememberSaveable { mutableStateOf(playSplash) }
            CrewCueTheme {
                Box(Modifier.semantics { testTagsAsResourceId = true }) {
                    AppRouter(shellModel)
                    SharedRunImportSheet(sharedRunImport)
                    if (showSplash) {
                        LaunchSplash { showSplash = false }
                    }
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (container.authConfig.problem != null) return
        // Auth0 returns to crewcue://auth, which this activity's bare-scheme filter catches
        // before the SDK's RedirectActivity (that one only listens on the tenant host).
        if (intent.data?.host == AUTH_REDIRECT_HOST && WebAuthProvider.resume(intent)) return
        CrewPush.chatRoomFrom(intent)?.let {
            shellModel.openChat(it)
            return
        }
        val runShareLink = intent.dataString?.let { DevRoutes.inboundFeatureId(it) } == "run-share-import"
        // The dev link carries a dev session the shell must read first; a shared file doesn't move the shell.
        if (runShareLink) shellModel.open(intent)
        if (receiveRunShare(intent)) return
        shellModel.open(intent)
    }

    /**
     * A shared (SEND) or opened (VIEW) run file, or the debug link
     * `crewcue://dev/run-share-import?file=<name>` (a file in the app's files folder). Answers
     * whether the intent was one of these.
     */
    private fun receiveRunShare(intent: Intent?): Boolean {
        val uri = SharedRunImportViewModel.sharedUri(intent)
        val devLink = intent?.dataString?.takeIf { DevRoutes.inboundFeatureId(it) == "run-share-import" }
        if (uri == null && devLink == null) return false
        // The shell reads a dev session from the launch intent; touch it first so the session is known.
        val signedIn = shellModel.session != null || container.sessionStore.current() != null
        lifecycleScope.launch {
            if (uri != null) {
                val (name, path) = withContext(Dispatchers.IO) { SharedRunImportViewModel.copyShared(applicationContext, uri) }
                sharedRunImport.receive(name, path, signedIn)
                return@launch
            }
            val name = android.net.Uri.parse(devLink).getQueryParameter("file")
            if (name == null) {
                sharedRunImport.showTip()
                return@launch
            }
            val file = java.io.File(filesDir, name)
            sharedRunImport.receive(name, file.takeIf { it.canRead() }?.absolutePath, signedIn)
        }
        return true
    }

    private companion object {
        const val AUTH_REDIRECT_HOST = "auth"
    }
}
