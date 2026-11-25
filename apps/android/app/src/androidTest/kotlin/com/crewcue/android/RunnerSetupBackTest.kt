package com.crewcue.android

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.di.AppContainer
import com.crewcue.android.session.SessionStore
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.onboarding.BACK_TAG
import com.crewcue.android.ui.onboarding.SetupSteps
import com.crewcue.android.ui.onboarding.setupTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The runner setup's Back on its first step (clients/behavior/onboarding-runner-setup.md), the
 * part that runs with no network: signed out, the account step's top bar arrow and system Back
 * return to the chooser, and the app stays open. The steps after it need a signed-in race list,
 * so their Back (entries kept, a reviewed step's Continue) is covered by RunnerSetupViewModelTest.
 */
@RunWith(AndroidJUnit4::class)
class RunnerSetupBackTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val target get() = instrumentation.targetContext

    private val chooser = setupTag("chooser")
    private val runner = setupTag("chooser.runner")
    private val account = setupTag("step.${SetupSteps.ACCOUNT}")

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

    /**
     * System Back, sent once the activity's window has focus. On a slow emulator the key can
     * otherwise go to a window that hasn't taken focus yet (or a system dialog) and be lost.
     */
    private fun pressSystemBack(scenario: ActivityScenario<MainActivity>) {
        compose.waitUntil(15_000) {
            var focused = false
            scenario.onActivity { focused = it.hasWindowFocus() }
            focused
        }
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
    }

    /** The setup route on show is the dev link's (ShellViewModel.setupFromLink). */
    private fun setupOpenedByLink(scenario: ActivityScenario<MainActivity>): Boolean {
        var opened = false
        scenario.onActivity { activity -> opened = ViewModelProvider(activity)[ShellViewModel::class.java].setupFromLink }
        return opened
    }

    private fun openTheAccountStep() {
        waitFor(runner)
        // CI's emulator screen is short: the chooser's buttons can sit below the fold.
        compose.onNodeWithTag(runner, useUnmergedTree = true).performScrollTo().performClick()
        waitFor(account)
    }

    @Test
    fun theAccountStepsArrowAndSystemBackReturnToTheChooser() {
        ActivityScenario.launch<MainActivity>(Intent(target, MainActivity::class.java)).use { scenario ->
            waitFor(chooser)
            openTheAccountStep()
            // The top app bar's arrow, spoken "Back". It sits above the scroll, so no scrolling.
            compose.onNodeWithTag(BACK_TAG).assertContentDescriptionEquals("Back")
            compose.onNodeWithTag(BACK_TAG, useUnmergedTree = true).performClick()
            waitFor(chooser)
            // System Back does the same, and the app stays open.
            openTheAccountStep()
            pressSystemBack(scenario)
            waitFor(chooser)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }

    @Test
    fun backFromTheDevLinksAccountStepOpensTheAppsOwnLaunch() {
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("crewcue://dev/onboarding-runner-setup"))
            .setClass(target, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(link).use { scenario ->
            // Signed out with no pick, the link's route opens on the chooser; the runner pick
            // opens setup on the account step, and Back leaves it for the app's own launch.
            waitFor(chooser)
            assertTrue(setupOpenedByLink(scenario))
            openTheAccountStep()
            compose.onNodeWithTag(BACK_TAG, useUnmergedTree = true).performClick()
            waitFor(chooser)
            // Not the link's route any more: only the app's own launch (the shell's routeEntry)
            // lets go of it. Back without the link keeps the route and shows the same chooser.
            assertFalse(setupOpenedByLink(scenario))
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }
}
