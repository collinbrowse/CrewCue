package com.crewcue.android.ui.onboarding

import com.crewcue.android.ui.ShellTab
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
            OnboardingRouting.destination(loading, signedIn = true, hasActiveRoom = false)
        )
        assertEquals(
            OnboardingDestination.Shell,
            OnboardingRouting.destination(loadingWithRace, signedIn = true, hasActiveRoom = true)
        )
        // A stale tab-bar flag without a stored race still waits on the loader.
        assertEquals(
            OnboardingDestination.Onboarding,
            OnboardingRouting.destination(loadingWithRace, signedIn = true, hasActiveRoom = false)
        )
    }

    @Test
    fun theChooserAndRunnerSetupShowTheOnboardingRouteAndCrewGoesToTheJoinScreen() {
        assertEquals(OnboardingDestination.Onboarding, OnboardingRouting.destination(chooser, signedIn = false, hasActiveRoom = false))
        assertEquals(OnboardingDestination.Onboarding, OnboardingRouting.destination(setup, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.JoinCrew, OnboardingRouting.destination(crewJoin, signedIn = true, hasActiveRoom = false))
    }

    @Test
    fun theTeaserLeadsToTheReplayUntilNotNowOrAPurchaseMarksIt() {
        // The preview step: the replay and its paywall, after the teaser and after a relaunch.
        assertTrue(preview.isRacePreviewStep)
        assertEquals(OnboardingDestination.RacePreview, OnboardingRouting.destination(preview, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.RacePreview, OnboardingRouting.destination(preview, signedIn = true, hasActiveRoom = false))
        // Marked (Not now, still unpaid): the paywall step is the tab bar behind Unlock race.
        val unpaid = preview.copy(step = "paywall")
        assertFalse(unpaid.isRacePreviewStep)
        assertEquals(OnboardingDestination.Shell, OnboardingRouting.destination(unpaid, signedIn = true, hasActiveRoom = true))
        // Paid: past phase 2.
        assertEquals(OnboardingDestination.Shell, OnboardingRouting.destination(done, signedIn = true, hasActiveRoom = true))
    }

    @Test
    fun theRacePreviewRoutePlaysTheRunnersRaceOrTheDevLinksFixture() {
        assertEquals(
            RacePreviewSource.Race("ada", "r1"),
            OnboardingRouting.racePreviewSource(false, "success", null, userId = "ada", flow = preview, activeRoomId = "r9")
        )
        // No flow on the step yet: the session's race.
        assertEquals(
            RacePreviewSource.Race("ada", "r9"),
            OnboardingRouting.racePreviewSource(false, "success", null, userId = "ada", flow = null, activeRoomId = "r9")
        )
        // Signed out, or no race: nothing to play yet.
        assertNull(OnboardingRouting.racePreviewSource(false, "success", null, userId = null, flow = preview, activeRoomId = "r1"))
        assertNull(OnboardingRouting.racePreviewSource(false, "success", null, userId = "ada", flow = null, activeRoomId = null))
        // The dev link plays the fixture, its state and moment, signed in or out.
        val start = RacePreviewDevStart(4.0, paused = true)
        assertEquals(
            RacePreviewSource.Fixture("empty", start),
            OnboardingRouting.racePreviewSource(true, "empty", start, userId = null, flow = null, activeRoomId = null)
        )
        assertEquals(
            RacePreviewSource.Fixture("success", null),
            OnboardingRouting.racePreviewSource(true, "success", null, userId = "ada", flow = preview, activeRoomId = "r1")
        )
    }

    @Test
    fun theRoomSavedForAnOfflineReplayFollowsTheState() {
        assertEquals(ReplayRoomUpdate.KeepOnly("ada", "r1"), OnboardingRouting.replayRoomUpdate(preview, "ada", "r9"))
        assertEquals(ReplayRoomUpdate.KeepOnly("ada", "r9"), OnboardingRouting.replayRoomUpdate(preview.copy(roomId = null), "ada", "r9"))
        // Past the step some other way: paid elsewhere, the paywall step, another state.
        assertEquals(ReplayRoomUpdate.Clear, OnboardingRouting.replayRoomUpdate(done, "ada", "r1"))
        assertEquals(ReplayRoomUpdate.Clear, OnboardingRouting.replayRoomUpdate(preview.copy(step = "paywall"), "ada", "r1"))
        assertEquals(ReplayRoomUpdate.Clear, OnboardingRouting.replayRoomUpdate(chooser, "ada", null))
        // Nothing decided: no answer, the race list loading, still in setup, or signed out.
        assertEquals(ReplayRoomUpdate.Keep, OnboardingRouting.replayRoomUpdate(null, "ada", "r1"))
        assertEquals(ReplayRoomUpdate.Keep, OnboardingRouting.replayRoomUpdate(loadingWithRace, "ada", "r1"))
        assertEquals(ReplayRoomUpdate.Keep, OnboardingRouting.replayRoomUpdate(setup, "ada", "r1"))
        assertEquals(ReplayRoomUpdate.Keep, OnboardingRouting.replayRoomUpdate(done, null, "r1"))
    }

    @Test
    fun raceLockedAndDoneShowTheShellAndNoStateFallsBackByTheSession() {
        assertEquals(OnboardingDestination.Shell, OnboardingRouting.destination(locked, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.Shell, OnboardingRouting.destination(done, signedIn = true, hasActiveRoom = true))
        assertEquals(OnboardingDestination.Shell, OnboardingRouting.destination(null, signedIn = true, hasActiveRoom = false))
        assertEquals(OnboardingDestination.SignedOut, OnboardingRouting.destination(null, signedIn = false, hasActiveRoom = false))
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
        // The replay onboarding opened is onboarding's; the dev route's fixture replay isn't.
        assertTrue(OnboardingRouting.ownsScreen(false, false, RACE_PREVIEW_FEATURE, false))
        assertFalse(OnboardingRouting.ownsScreen(false, false, RACE_PREVIEW_FEATURE, false, racePreviewOpenedByLink = true))
        assertFalse(OnboardingRouting.ownsScreen(false, stateOverlay = true, featureId = RACE_PREVIEW_FEATURE, joinOpenedByOnboarding = false))
    }

    // client-core decides the access (RaceAccessTests.swift); these cover only the pane it draws.
    private val unpaidRunner = RaceAccess(unpaid = true, loadsRace = true, samplesLocation = false, gatesActions = true, lockedReason = null)
    private val lockedCrew = RaceAccess(
        unpaid = true, loadsRace = false, samplesLocation = false, gatesActions = false,
        lockedReason = "The runner hasn't unlocked this race yet."
    )
    private val unpaidCrew = lockedCrew.copy(lockedReason = null)
    private val paid = RaceAccess(unpaid = false, loadsRace = true, samplesLocation = true, gatesActions = false, lockedReason = null)

    @Test
    fun anUnpaidRunnerRaceShowsThePaywallOnlyOnceOpenedAndNeverOverProfile() {
        val closed = RaceGate.of(unpaidRunner, paywallOpen = false, onRaceTab = true)
        assertFalse(closed.showsPaywall)
        assertNull(closed.lockedReason)
        // The banner, Start tracking or chat send opened the paywall over the race tab, not Profile.
        assertTrue(RaceGate.of(unpaidRunner, paywallOpen = true, onRaceTab = true).showsPaywall)
        assertFalse(RaceGate.of(unpaidRunner, paywallOpen = true, onRaceTab = false).showsPaywall)
    }

    @Test
    fun aCrewMembersLockedRaceShowsClientCoresReasonAndElseThePaywallsBillingLine() {
        val gate = RaceGate.of(lockedCrew, paywallOpen = false, onRaceTab = true)
        assertEquals("The runner hasn't unlocked this race yet.", gate.lockedReason)
        assertFalse(gate.showsPaywall)
        // Profile keeps its own content.
        assertNull(RaceGate.of(lockedCrew, paywallOpen = false, onRaceTab = false).lockedReason)
        // Billing says unpaid before client-core names a reason: the paywall's billing line, as before.
        assertTrue(RaceGate.of(unpaidCrew, paywallOpen = false, onRaceTab = true).showsPaywall)
    }

    @Test
    fun aPaidRaceOrNoRaceDrawsTheTab() {
        // A stale paywallOpen never shows the paywall on a paid race.
        assertEquals(RaceGate(showsPaywall = false, lockedReason = null), RaceGate.of(paid, paywallOpen = true, onRaceTab = true))
        assertEquals(RaceGate(showsPaywall = false, lockedReason = null), RaceGate.of(RaceAccess.noRace, paywallOpen = true, onRaceTab = true))
    }

    @Test
    fun raceAccessReadsClientCoresAnswer() {
        val access = RaceAccess.from(
            org.json.JSONObject("""{"unpaid":true,"loadsRace":true,"samplesLocation":false,"gatesActions":true,"lockedReason":null}""")
        )
        assertEquals(unpaidRunner, access)
        assertNull(RaceAccess.from(org.json.JSONObject("{}")))
        assertNull(RaceAccess.from(null))
    }

    @Test
    fun billingRemembersThePaidReadSoAnOldPreviewStateCantGateIt() {
        var billing = RaceBilling()
        assertNull(billing.status("r1"))
        // A new race, then the purchase: paid, even before the race list says so.
        billing = billing.unpaid("r1")
        assertEquals("unpaid", billing.status("r1"))
        billing = billing.unlocked("r1")
        assertEquals("paid", billing.status("r1"))
        // A later read or a 402 (a refund) says unpaid again.
        billing = billing.read("r1", paid = false)
        assertEquals("unpaid", billing.status("r1"))
        billing = billing.read("r1", paid = true)
        assertEquals("paid", billing.status("r1"))
        // Another race's answer leaves this one's alone.
        billing = billing.unpaid("r2")
        assertEquals("paid", billing.status("r1"))
        assertEquals("unpaid", billing.status("r2"))
        assertNull(billing.status(null))
        assertNull(billing.status("r3"))
    }

    @Test
    fun aSignInGoesOnWithItsJoinElseWaitsForThisUsersState() {
        assertEquals(SignInNext.Join, OnboardingRouting.afterSignIn(pendingJoin = true, onJoinScreen = true))
        assertEquals(SignInNext.StayOnJoin, OnboardingRouting.afterSignIn(pendingJoin = false, onJoinScreen = true))
        // The guest's chooser or account step gives way to the loader, never flashes for the new account.
        assertEquals(SignInNext.OnboardingLoader, OnboardingRouting.afterSignIn(pendingJoin = false, onJoinScreen = false))
    }

    @Test
    fun thePaywallOpensOverARaceTabNeverProfile() {
        assertEquals(ShellTab.Map, OnboardingRouting.paywallTab(ShellTab.Profile))
        assertEquals(ShellTab.Chat, OnboardingRouting.paywallTab(ShellTab.Chat))
        assertEquals(ShellTab.Pace, OnboardingRouting.paywallTab(ShellTab.Pace))
    }

    @Test
    fun theStateGoesBackToClientCoreAsReadOnboardingAnsweredIt() {
        val json = locked.toJson()
        assertEquals(locked, OnboardingFlow.from(json))
        assertEquals("raceLocked", json.getString("flow"))
        assertTrue(json.isNull("phase"))
    }
}
