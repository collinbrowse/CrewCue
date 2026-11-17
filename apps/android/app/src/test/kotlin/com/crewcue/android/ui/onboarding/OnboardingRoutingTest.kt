package com.crewcue.android.ui.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingRoutingTest {
    private fun flow(
        flow: String,
        phase: String? = null,
        step: String? = null,
        roomId: String? = null,
        showsTabBar: Boolean = false,
        reason: String? = null
    ) = OnboardingFlow(flow, role = null, roomId = roomId, phase = phase, step = step, showsTabBar = showsTabBar, reason = reason)

    private val loading = flow("loading")
    private val loadingWithRace = flow("loading", roomId = "r1", showsTabBar = true)
    private val chooser = flow("chooser")
    private val setup = flow("runner", phase = "setup", step = "projectionTeaser", roomId = "r1")
    private val preview = flow("runner", phase = "preview", step = "preview", roomId = "r1", showsTabBar = true)
    private val crewJoin = flow("crew", phase = "join", step = "join")
    private val locked = flow("raceLocked", roomId = "r2", showsTabBar = true, reason = "The runner hasn't unlocked this race yet.")
    private val done = flow("done", roomId = "r1", showsTabBar = true)

    @Test
    fun theRouteDrawsTheLoaderUntilTheStateIsTheChooserOrASetupStep() {
        // The race list is unknown (loading) or not read yet (null): never the chooser.
        assertEquals(OnboardingContent.Loading, OnboardingRouting.content(null))
        assertEquals(OnboardingContent.Loading, OnboardingRouting.content(loading))
        assertEquals(OnboardingContent.Loading, OnboardingRouting.content(done))
        assertEquals(OnboardingContent.Chooser, OnboardingRouting.content(chooser))
        assertEquals(OnboardingContent.RunnerSetup, OnboardingRouting.content(setup))
    }

    @Test
    fun theDevLinkDrawsTheSetupForAStatePastItButStillWaitsForTheRaceList() {
        assertEquals(OnboardingContent.RunnerSetup, OnboardingRouting.content(done, openedByLink = true))
        assertEquals(OnboardingContent.RunnerSetup, OnboardingRouting.content(preview, openedByLink = true))
        assertEquals(OnboardingContent.Chooser, OnboardingRouting.content(chooser, openedByLink = true))
        assertEquals(OnboardingContent.Loading, OnboardingRouting.content(loading, openedByLink = true))
        assertEquals(OnboardingContent.Loading, OnboardingRouting.content(null, openedByLink = true))
    }

    @Test
    fun whileTheRaceListLoadsAStoredRaceKeepsTheShellAndANewUserSeesTheLoader() {
        assertEquals(
            OnboardingDestination.Onboarding,
            OnboardingRouting.destination(loading, previous = chooser, signedIn = true, hasActiveRoom = false)
        )
        assertEquals(
            OnboardingDestination.Shell(),
            OnboardingRouting.destination(loadingWithRace, previous = null, signedIn = true, hasActiveRoom = true)
        )
        // A stale tab-bar flag without a stored race still waits on the loader.
        assertEquals(
            OnboardingDestination.Onboarding,
            OnboardingRouting.destination(loadingWithRace, previous = null, signedIn = true, hasActiveRoom = false)
        )
    }

    @Test
    fun theChooserAndRunnerSetupShowTheOnboardingRouteAndCrewGoesToTheJoinScreen() {
        assertEquals(OnboardingDestination.Onboarding, OnboardingRouting.destination(chooser, null, signedIn = false, hasActiveRoom = false))
        assertEquals(OnboardingDestination.Onboarding, OnboardingRouting.destination(setup, chooser, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.JoinCrew, OnboardingRouting.destination(crewJoin, chooser, signedIn = true, hasActiveRoom = false))
    }

    @Test
    fun theTeaserLeadsToThePaywallButARelaunchInThePaywallPhaseOpensTheShell() {
        assertEquals(
            OnboardingDestination.Shell(openPaywall = true),
            OnboardingRouting.destination(preview, previous = setup, signedIn = true, hasActiveRoom = true)
        )
        assertEquals(
            OnboardingDestination.Shell(openPaywall = false),
            OnboardingRouting.destination(preview, previous = null, signedIn = true, hasActiveRoom = true)
        )
        assertEquals(
            OnboardingDestination.Shell(openPaywall = false),
            OnboardingRouting.destination(preview, previous = preview, signedIn = true, hasActiveRoom = true)
        )
    }

    @Test
    fun raceLockedAndDoneShowTheShellAndNoStateFallsBackByTheSession() {
        assertEquals(OnboardingDestination.Shell(), OnboardingRouting.destination(locked, null, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.Shell(), OnboardingRouting.destination(done, setup, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.Shell(), OnboardingRouting.destination(null, null, signedIn = true, hasActiveRoom = false))
        assertEquals(OnboardingDestination.SignedOut, OnboardingRouting.destination(null, null, signedIn = false, hasActiveRoom = false))
    }

    @Test
    fun onboardingMovesOnlyTheScreensItOwns() {
        assertTrue(OnboardingRouting.ownsScreen(showsShell = true, stateOverlay = false, featureId = "map-track", joinOpenedByOnboarding = false))
        assertTrue(OnboardingRouting.ownsScreen(false, false, SETUP_FEATURE, false))
        assertTrue(OnboardingRouting.ownsScreen(false, false, "auth-sign-in", false))
        assertTrue(OnboardingRouting.ownsScreen(false, false, "join-crew", joinOpenedByOnboarding = true))
        // A join link, a dev fixture or a ?state= overlay keeps showing.
        assertFalse(OnboardingRouting.ownsScreen(false, false, "join-crew", joinOpenedByOnboarding = false))
        assertFalse(OnboardingRouting.ownsScreen(false, false, "pace-estimate", false))
        assertFalse(OnboardingRouting.ownsScreen(false, stateOverlay = true, featureId = SETUP_FEATURE, joinOpenedByOnboarding = false))
        // The dev link to the setup route stays on it; a background state read doesn't bounce it.
        assertFalse(OnboardingRouting.ownsScreen(false, false, SETUP_FEATURE, false, setupOpenedByLink = true))
    }

    @Test
    fun anUnpaidRunnerRaceGetsTheBannerAndGatedActionsAndNeverSendsLocation() {
        val gate = RaceGate.of("r1", "athlete", unpaidRoomId = null, onboarding = preview, paywallOpen = false, onRaceTab = true)
        assertTrue(gate.unpaid)
        assertTrue(gate.gatesActions)
        // The teaser (course and finish) still loads; the phone never pings an unpaid race.
        assertTrue(gate.loadsRace)
        assertFalse(gate.samplesLocation)
        assertFalse(gate.showsPaywall)
        assertNull(gate.lockedReason)

        // The banner, Start tracking or chat send opened the paywall over the race tab, not Profile.
        assertTrue(RaceGate.of("r1", "athlete", null, preview, paywallOpen = true, onRaceTab = true).showsPaywall)
        assertFalse(RaceGate.of("r1", "athlete", null, preview, paywallOpen = true, onRaceTab = false).showsPaywall)

        // Billing alone (client-core's state for another race) also gates.
        val billing = RaceGate.of("r1", "athlete", unpaidRoomId = "r1", onboarding = done.copy(roomId = "r9"), paywallOpen = false, onRaceTab = true)
        assertTrue(billing.gatesActions)
        assertFalse(billing.samplesLocation)
    }

    @Test
    fun aCrewMembersLockedRaceShowsClientCoresReasonInTheShell() {
        val gate = RaceGate.of("r2", "crew_member", unpaidRoomId = null, onboarding = locked, paywallOpen = false, onRaceTab = true)
        assertTrue(gate.unpaid)
        assertEquals("The runner hasn't unlocked this race yet.", gate.lockedReason)
        // Crew features answer 402: no race-day reads, no gated actions, no paywall.
        assertFalse(gate.loadsRace)
        assertFalse(gate.gatesActions)
        assertFalse(gate.showsPaywall)
        // Profile keeps its own content.
        assertNull(RaceGate.of("r2", "crew_member", null, locked, paywallOpen = false, onRaceTab = false).lockedReason)
        // Billing says unpaid before client-core names a reason: the paywall's billing line, as before.
        assertTrue(RaceGate.of("r2", "crew_member", unpaidRoomId = "r2", onboarding = null, paywallOpen = false, onRaceTab = true).showsPaywall)
    }

    @Test
    fun aPaidRaceOrNoRaceIsNotGated() {
        val paid = RaceGate.of("r1", "athlete", unpaidRoomId = null, onboarding = done, paywallOpen = false, onRaceTab = true)
        assertFalse(paid.unpaid)
        assertFalse(paid.gatesActions)
        assertTrue(paid.loadsRace)
        assertTrue(paid.samplesLocation)
        assertFalse(paid.showsPaywall)
        // A stale paywallOpen never shows the paywall on a paid race.
        assertFalse(RaceGate.of("r1", "athlete", null, done, paywallOpen = true, onRaceTab = true).showsPaywall)

        val none = RaceGate.of(null, "athlete", unpaidRoomId = "r1", onboarding = preview, paywallOpen = true, onRaceTab = true)
        assertFalse(none.unpaid)
        assertFalse(none.loadsRace)
        assertFalse(none.showsPaywall)
        assertFalse(RaceGate.of("  ", "athlete", null, null, paywallOpen = true, onRaceTab = true).loadsRace)
    }
}
