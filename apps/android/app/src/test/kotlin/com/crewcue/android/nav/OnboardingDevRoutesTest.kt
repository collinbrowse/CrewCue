package com.crewcue.android.nav

import com.crewcue.android.ui.onboarding.SETUP_FEATURE
import com.crewcue.android.ui.onboarding.SETUP_TAG
import com.crewcue.android.ui.onboarding.RACE_PREVIEW_FEATURE
import com.crewcue.android.ui.onboarding.RACE_PREVIEW_TAG
import com.crewcue.android.ui.onboarding.ReplayText
import com.crewcue.android.ui.onboarding.onboardingPaywallTag
import com.crewcue.android.ui.onboarding.racePreviewTag
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

    @Test
    fun theRacePreviewRouteIsTheChecklistsWithStableTags() {
        assertEquals(RACE_PREVIEW_FEATURE, DevRoutes.featureId("crewcue://dev/onboarding-race-preview?at=4&paused=1"))
        assertNull(DevRoutes.inboundFeatureId("crewcue://dev/onboarding-race-preview", enabled = false))
        val checklist = File("../../../clients/behavior/onboarding-race-preview.md")
        assertTrue(checklist.readText().contains("- $RACE_PREVIEW_TAG"))
        assertTrue(checklist.readText().contains("crewcue://dev/$RACE_PREVIEW_FEATURE"))
        // The device tests and proofs find these.
        assertEquals("crewcue.onboarding-race-preview.skip", racePreviewTag("skip"))
        assertEquals("crewcue.onboarding-race-preview.play-pause", racePreviewTag("play-pause"))
        assertEquals("crewcue.onboarding-race-preview.caption", racePreviewTag("caption"))
        assertEquals("crewcue.onboarding-paywall.not-now", onboardingPaywallTag("not-now"))
        assertEquals("crewcue.onboarding-paywall.back", onboardingPaywallTag("back"))
        assertEquals("crewcue.onboarding-paywall.runner-plus-one", ReplayText.RUNNER_PLUS_ONE_TAG)
        assertEquals("crewcue.onboarding-paywall.full-crew", ReplayText.FULL_CREW_TAG)
    }
}
