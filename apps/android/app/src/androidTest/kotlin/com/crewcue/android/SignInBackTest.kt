package com.crewcue.android

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.di.AppContainer
import com.crewcue.android.session.SessionStore
import com.crewcue.android.ui.onboarding.setupTag
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Sign-in's Back (clients/behavior/auth-sign-in.md): the top bar's arrow and system Back open the
 * chooser, with the onboarding state kept, however sign-in opened; the chooser opens it on Sign in.
 */
@RunWith(AndroidJUnit4::class)
class SignInBackTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val target get() = instrumentation.targetContext

    private val chooser = setupTag("chooser")
    private val signIn = "crewcue.auth-signed-out"
    private val back = "crewcue.auth-sign-in.back"

    @Before
    fun signedOutGuest() {
        SessionStore(target).clear()
        // A pick left by another test would resume its step instead of the chooser.
        AppContainer(target).raceDay.resetOnboarding()
    }

    private fun waitFor(tag: String) {
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag(tag, useUnmergedTree = true).assertExists() }.isSuccess
        }
    }

    private fun openSignInFromTheChooser() {
        waitFor(setupTag("chooser.sign-in"))
        compose.onNodeWithTag(setupTag("chooser.sign-in"), useUnmergedTree = true).performScrollTo().performClick()
        waitFor(signIn)
    }

    @Test
    fun backFromSignInReturnsToTheChooser() {
        ActivityScenario.launch<MainActivity>(Intent(target, MainActivity::class.java)).use { scenario ->
            waitFor(chooser)
            openSignInFromTheChooser()
            // Switched to sign-up, then Back: the chooser opens sign-in on Sign in again.
            // CI's emulator screen is short: the toggle sits below the fold, under the top bar's Back.
            compose.onNodeWithText("Need an account? Sign up").performScrollTo().performClick()
            compose.onNodeWithText("CREATE AN ACCOUNT").assertExists()
            compose.onNodeWithTag(back, useUnmergedTree = true).performClick()
            waitFor(chooser)
            openSignInFromTheChooser()
            compose.onNodeWithText("Need an account? Sign up").assertExists()
            compose.onNodeWithText("CREATE AN ACCOUNT").assertDoesNotExist()
            // System Back does the same, and the app stays open.
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            waitFor(chooser)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }

    @Test
    fun backFromASignInWithNoChooserBehindItOpensTheChooser() {
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("crewcue://dev/auth-signed-out"))
            .setClass(target, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(link).use { scenario ->
            waitFor(signIn)
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            waitFor(chooser)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }
}
