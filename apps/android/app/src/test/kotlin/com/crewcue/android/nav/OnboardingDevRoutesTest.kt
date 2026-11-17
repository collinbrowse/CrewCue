package com.crewcue.android.nav

import org.junit.Assert.assertEquals
import org.junit.Test

class OnboardingDevRoutesTest {
    @Test
    fun onboardingScaffoldRoutesResolve() {
        assertEquals("onboarding-runner-setup", DevRoutes.featureId("crewcue://dev/onboarding-runner-setup"))
        assertEquals("onboarding-race-preview", DevRoutes.featureId("crewcue://dev/onboarding-race-preview?state=empty"))
    }
}
