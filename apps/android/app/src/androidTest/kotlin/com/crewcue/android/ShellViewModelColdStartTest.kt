package com.crewcue.android

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.di.AppContainer
import com.crewcue.android.session.SessionStore
import com.crewcue.android.ui.ShellTab
import com.crewcue.android.ui.ShellViewModel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A cold launch whose intent opens a tab other than Pace (an agent proof's dev link, a push tap)
 * builds the model with that route. `init` opens the intent, so every property it touches must
 * already be initialized; `mapToolRequest` once wasn't and the launch crashed.
 */
@RunWith(AndroidJUnit4::class)
class ShellViewModelColdStartTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val target get() = instrumentation.targetContext

    @Before
    fun signedOut() {
        SessionStore(target).clear()
    }

    @After
    fun clearDevSession() {
        SessionStore(target).clear()
    }

    private fun coldStart(entry: String): ShellViewModel {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(entry))
            .putExtra("devSession", "1")
            .putExtra("userId", "cold-start-user")
            .putExtra("role", "runner")
            .putExtra("token", "dev-token")
            .putExtra("roomId", "cold-start-room")
        var model: ShellViewModel? = null
        instrumentation.runOnMainSync { model = ShellViewModel(AppContainer(target), intent) }
        return checkNotNull(model)
    }

    @Test
    fun aColdMapLinkOpensTheMapTab() {
        val model = coldStart("crewcue://dev/map")
        assertTrue(model.showAppShell)
        assertEquals(ShellTab.Map, model.selectedTab)
        assertNull(model.mapToolRequest)
    }

    @Test
    fun aColdProfileLinkOpensTheProfileTab() {
        val model = coldStart("crewcue://dev/profile")
        assertTrue(model.showAppShell)
        assertEquals(ShellTab.Profile, model.selectedTab)
        assertEquals("profile", model.profilePane)
    }
}
