package com.crewcue.android.ui.onboarding

/** The onboarding route (client-core `Route`): the loader, the chooser and the runner's setup. */
const val SETUP_FEATURE = "onboarding-runner-setup"

/** What the onboarding route draws for a state. */
enum class OnboardingContent { Loading, Chooser, RunnerSetup }

/** Where the shell goes for a new onboarding state. */
sealed interface OnboardingDestination {
    /** The tab bar. [openPaywall]: the runner just finished the teaser, so the paywall comes first. */
    data class Shell(val openPaywall: Boolean = false) : OnboardingDestination
    data object SignedOut : OnboardingDestination
    /** The onboarding route ([OnboardingContent] picks what it draws). */
    data object Onboarding : OnboardingDestination
    /** The existing join screen, for the crew choice. */
    data object JoinCrew : OnboardingDestination
}

/**
 * The shell's onboarding decisions, kept out of Compose and the ViewModel so the JVM tests cover
 * them. client-core decides the state; this only maps it to a screen.
 */
object OnboardingRouting {
    /**
     * The chooser or the setup when the state names them, else the loader, so the chooser never
     * flashes while races load. A route a link opened (the debug dev route, [openedByLink]) draws
     * the setup for a state that has moved past it, instead of a loader that never ends.
     */
    fun content(flow: OnboardingFlow?, openedByLink: Boolean = false): OnboardingContent = when {
        flow?.isChooser == true -> OnboardingContent.Chooser
        flow?.isRunnerSetup == true -> OnboardingContent.RunnerSetup
        flow == null || flow.isLoading -> OnboardingContent.Loading
        openedByLink -> OnboardingContent.RunnerSetup
        else -> OnboardingContent.Loading
    }

    /**
     * [previous] is the state on show before [next]. [hasActiveRoom]: the session has a stored
     * race, which keeps the tab bar while the race list loads.
     */
    fun destination(
        next: OnboardingFlow?,
        previous: OnboardingFlow?,
        signedIn: Boolean,
        hasActiveRoom: Boolean
    ): OnboardingDestination = when {
        // client-core couldn't answer: the shell when signed in, as before onboarding.
        next == null -> if (signedIn) OnboardingDestination.Shell() else OnboardingDestination.SignedOut
        next.isLoading ->
            if (next.showsTabBar && hasActiveRoom) OnboardingDestination.Shell() else OnboardingDestination.Onboarding
        next.isChooser || next.isRunnerSetup -> OnboardingDestination.Onboarding
        next.isCrewJoin -> OnboardingDestination.JoinCrew
        // Phase 2 (replay and paywall) comes later: the paywall follows the teaser.
        next.isRunnerPreview -> OnboardingDestination.Shell(openPaywall = previous?.isRunnerSetup == true)
        // done, raceLocked (the shell shows the reason), the tours.
        else -> OnboardingDestination.Shell()
    }

    /**
     * A state read in the background moves the screen only from screens onboarding owns: the
     * shell, its own route, the sign-in screen and a join screen it opened. A dev fixture, a state
     * overlay or a screen a link opened keeps showing; the person's own choices there still route.
     */
    fun ownsScreen(
        showsShell: Boolean,
        stateOverlay: Boolean,
        featureId: String?,
        joinOpenedByOnboarding: Boolean,
        setupOpenedByLink: Boolean = false
    ): Boolean {
        if (showsShell) return true
        if (stateOverlay) return false
        return when (featureId) {
            SETUP_FEATURE -> !setupOpenedByLink
            "auth-sign-in" -> true
            "join-crew" -> joinOpenedByOnboarding
            else -> false
        }
    }
}

/**
 * How the race tabs treat the active race's payment. Billing (`unpaidRoomId`) or client-core's
 * state (the runner's paywall phase, a crew member's `raceLocked`) can say unpaid.
 */
data class RaceGate(
    val unpaid: Boolean,
    /** Load the race-day model (course, schedule, feed). Not for a crew member's unpaid race, whose reads answer 402. */
    val loadsRace: Boolean,
    /** The athlete's phone sends location samples. Never for an unpaid race, which takes no pings. */
    val samplesLocation: Boolean,
    /** The Unlock race banner on Map, Pace and Chat; Start tracking and chat send open the paywall. */
    val gatesActions: Boolean,
    /** The paywall in place of the race tab. */
    val showsPaywall: Boolean,
    /** client-core's reason in place of the race tab (a crew member's `raceLocked`), else null. */
    val lockedReason: String?
) {
    companion object {
        private val open = RaceGate(
            unpaid = false, loadsRace = false, samplesLocation = false,
            gatesActions = false, showsPaywall = false, lockedReason = null
        )

        fun of(
            roomId: String?,
            role: String?,
            unpaidRoomId: String?,
            onboarding: OnboardingFlow?,
            paywallOpen: Boolean,
            onRaceTab: Boolean
        ): RaceGate {
            val room = roomId?.takeIf { it.isNotBlank() } ?: return open
            val flow = onboarding?.takeIf { it.roomId == room }
            val unpaid = unpaidRoomId == room || flow?.isRunnerPreview == true || flow?.isRaceLocked == true
            val runner = role == "athlete"
            val reason = flow?.takeIf { it.isRaceLocked }?.reason?.takeIf { it.isNotBlank() }
            // The runner's paywall opens from the teaser, the banner or a gated action. A crew
            // member's unpaid race shows the paywall's billing line until client-core names a reason.
            val paywall = unpaid && onRaceTab && ((runner && paywallOpen) || (!runner && reason == null))
            return RaceGate(
                unpaid = unpaid,
                // The runner reads an unpaid race's teaser (course and finish), but never pings it.
                loadsRace = runner || !unpaid,
                samplesLocation = !unpaid,
                gatesActions = unpaid && runner,
                showsPaywall = paywall,
                lockedReason = reason.takeIf { !paywall && onRaceTab && !runner }
            )
        }
    }
}
