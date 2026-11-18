package com.crewcue.android.nav

import com.crewcue.android.ui.onboarding.SETUP_FEATURE
import com.crewcue.android.ui.onboarding.SETUP_TAG
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingDevRoutesTest {
    @Test
    fun onboardingScaffoldRoutesResolve() {
        assertEquals("onboarding-runner-setup", DevRoutes.featureId("crewcue://dev/onboarding-runner-setup"))
        assertEquals("onboarding-race-preview", DevRoutes.featureId("crewcue://dev/onboarding-race-preview?state=empty"))
    }

    @Test
    fun runnerSetupRouteResolvesForEveryChecklistState() {
        for (state in listOf("success", "empty", "error", "offline")) {
            assertEquals("onboarding-runner-setup", DevRoutes.featureId("crewcue://dev/onboarding-runner-setup?state=$state"))
        }
        assertEquals("onboarding-runner-setup", DevRoutes.featureId("crewcue://dev/onboarding-runner-setup/"))
        assertNull(DevRoutes.featureId("crewcue://dev/onboarding-chooser"))
        // The shell's onboarding routing shows and owns this route id.
        assertEquals(SETUP_FEATURE, DevRoutes.featureId("crewcue://dev/onboarding-runner-setup"))
    }

    @Test
    fun releaseBuildsOpenNoSetupFixtureFromALink() {
        assertNull(DevRoutes.inboundFeatureId("crewcue://dev/onboarding-runner-setup", enabled = false))
        assertEquals("onboarding-runner-setup", DevRoutes.inboundFeatureId("crewcue://dev/onboarding-runner-setup", enabled = true))
    }

    @Test
    fun theRootTagIsTheChecklistLabel() {
        // Unit tests run from apps/android/app; the checklist is the parity source of truth.
        val checklist = File("../../../clients/behavior/onboarding-runner-setup.md")
        assertTrue(checklist.exists())
        assertTrue(checklist.readText().contains("- $SETUP_TAG"))
        assertEquals("crewcue.onboarding-runner-setup", SETUP_TAG)
    }
}
