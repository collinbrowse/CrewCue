package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.optText
import com.crewcue.android.ui.ShellTab
import org.json.JSONObject

/** The onboarding route (client-core `Route`): the loader, the chooser and the runner's setup. */
const val SETUP_FEATURE = "onboarding-runner-setup"

/** What a sign-in does next ([OnboardingRouting.afterSignIn]). */
enum class SignInNext { Join, StayOnJoin, OnboardingLoader }

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
     * Where a sign-in lands. A join the person started goes on; a join screen keeps showing;
     * anything else waits on the loader until this user's onboarding state is read, so the guest's
     * chooser or signed-out account step never shows for the new account.
     */
    fun afterSignIn(pendingJoin: Boolean, onJoinScreen: Boolean): SignInNext = when {
        pendingJoin -> SignInNext.Join
        onJoinScreen -> SignInNext.StayOnJoin
        else -> SignInNext.OnboardingLoader
    }

    /**
     * The paywall opens over a race tab: the one on show, or Map when Profile is. A screen outside
     * the shell (the setup route, the teaser) opens the shell first.
     */
    fun paywallTab(selected: ShellTab): ShellTab = if (selected == ShellTab.Profile) ShellTab.Map else selected

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
 * client-core `RaceAccess` for the active race (the `raceAccess` op): whether it is unpaid, loads
 * its race-day model, samples location and gates actions, and a crew member's locked reason.
 */
data class RaceAccess(
    val unpaid: Boolean,
    val loadsRace: Boolean,
    val samplesLocation: Boolean,
    /** The Unlock race banner on Map, Pace and Chat; Start tracking and chat send open the paywall. */
    val gatesActions: Boolean,
    val lockedReason: String?
) {
    companion object {
        val noRace = RaceAccess(unpaid = false, loadsRace = false, samplesLocation = false, gatesActions = false, lockedReason = null)

        fun from(json: JSONObject?): RaceAccess? {
            json ?: return null
            if (!json.has("unpaid")) return null
            return RaceAccess(
                unpaid = json.optBoolean("unpaid"),
                loadsRace = json.optBoolean("loadsRace"),
                samplesLocation = json.optBoolean("samplesLocation"),
                gatesActions = json.optBoolean("gatesActions"),
                lockedReason = json.optText("lockedReason").ifBlank { null }
            )
        }
    }
}

/**
 * What the shell last read from billing, by race: `paid` or `unpaid`, or nothing yet. Only an
 * explicit read or a 402 says unpaid, and a failed read changes nothing.
 */
data class RaceBilling(val paidRoomId: String? = null, val unpaidRoomId: String? = null) {
    /** `paid`, `unpaid` or null for client-core's `raceAccess`. */
    fun status(roomId: String?): String? = when {
        roomId.isNullOrBlank() -> null
        paidRoomId == roomId -> "paid"
        unpaidRoomId == roomId -> "unpaid"
        else -> null
    }

    /** A billing read answered for [roomId]. */
    fun read(roomId: String, paid: Boolean): RaceBilling = if (paid) unlocked(roomId) else unpaid(roomId)

    /** A purchase or redemption unlocked [roomId]. */
    fun unlocked(roomId: String): RaceBilling =
        RaceBilling(paidRoomId = roomId, unpaidRoomId = unpaidRoomId.takeIf { it != roomId })

    /** A new race, a 402 `room_unpaid`, or a billing read said unpaid. */
    fun unpaid(roomId: String): RaceBilling =
        RaceBilling(paidRoomId = paidRoomId.takeIf { it != roomId }, unpaidRoomId = roomId)
}

/** Which pane the race tabs draw. Screen mapping only: client-core decides the [RaceAccess]. */
data class RaceGate(
    /** The paywall in place of the race tab. */
    val showsPaywall: Boolean,
    /** client-core's reason in place of the race tab (a crew member's `raceLocked`), else null. */
    val lockedReason: String?
) {
    companion object {
        fun of(access: RaceAccess, paywallOpen: Boolean, onRaceTab: Boolean): RaceGate {
            // The runner's paywall opens from the teaser, the banner or a gated action. A crew
            // member's unpaid race shows the paywall's billing line until client-core names a reason.
            val runnerPaywall = access.gatesActions && paywallOpen
            val crewPaywall = access.unpaid && !access.gatesActions && access.lockedReason == null
            val paywall = onRaceTab && (runnerPaywall || crewPaywall)
            return RaceGate(
                showsPaywall = paywall,
                lockedReason = access.lockedReason.takeIf { !paywall && onRaceTab }
            )
        }
    }
}
