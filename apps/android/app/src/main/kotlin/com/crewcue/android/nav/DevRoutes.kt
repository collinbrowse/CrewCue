package com.crewcue.android.nav

import com.crewcue.android.BuildConfig

/**
 * Path table matches client-core `Route.featureId`. Fixture deeplinks stay on these ids.
 */
object DevRoutes {
    private val featureByPath = mapOf(
        "dev/hello" to "hello",
        "dev/schedule-sheet" to "schedule-sheet",
        "dev/cold-start" to "cold-start",
        "dev/pace-estimate" to "pace-estimate",
        "dev/crew-sheet-export" to "crew-sheet-export",
        "dev/outbox" to "outbox-status",
        "dev/auth-signed-out" to "auth-sign-in",
        "dev/join-crew" to "join-crew",
        "dev/athlete-setup" to "athlete-setup",
        "dev/onboarding-notifications" to "onboarding-notifications",
        "dev/check-in" to "check-in",
        "dev/course-settings" to "course-settings",
        "dev/pace-stop-edit" to "pace-stop-edit",
        "dev/readouts-incidents" to "readouts-incidents",
        "dev/gpx-import-progress" to "gpx-import",
        "dev/map" to "map-track",
        "dev/map-checkpoint-pick" to "map-checkpoint-pick",
        "dev/map-navigate" to "map-navigate",
        "dev/location-heartbeat" to "location-heartbeat",
        "dev/runner-track" to "runner-track",
        "dev/live-eta" to "live-eta",
        "dev/chat" to "chat-thread",
        "dev/chat-notification-prefs" to "chat-notification-prefs",
        "dev/push-registration" to "push-registration",
        "dev/profile" to "profile",
        "dev/room-members" to "room-members",
        "dev/activity-import" to "activity-import",
        "dev/run-share-import" to "run-share-import",
        "dev/account-deletion" to "account-deletion",
        "dev/race-delete" to "race-delete",
        "dev/app-shell" to "app-shell",
        "dev/loader" to "brand-loader",
        "dev/billing-purchase" to "billing-purchase",
        "dev/billing-upgrade" to "billing-upgrade",
        "dev/billing-redeem" to "billing-redeem",
        "dev/onboarding-runner-setup" to "onboarding-runner-setup",
        "dev/onboarding-race-preview" to "onboarding-race-preview",
        "dev/race-rename" to "race-rename",
        "dev/course-locked" to "course-locked",
        "dev/invite-share" to "invite-share",
        "dev/join-link" to "join-link",
        "dev/onboarding-runner-tour" to "onboarding-runner-tour",
        "dev/onboarding-crew" to "onboarding-crew"
    ) + (if (BuildConfig.STRAVA_ENABLED) mapOf("dev/strava" to "strava") else emptyMap())

    /** Feature for a link from outside the app. Release builds open no fixture routes from links. */
    fun inboundFeatureId(url: String?, enabled: Boolean = BuildConfig.DEBUG): String? =
        if (enabled) featureId(url) else null

    /**
     * What a link from outside the app opens. Crew invite links (the join page's https link and
     * `crewcue://join/<code>`) open in every build; fixture routes only when [enabled] (debug).
     * [inviteCode] is client-core's `InviteLink` parser, so Kotlin never reads a link itself.
     */
    fun inbound(
        url: String?,
        enabled: Boolean = BuildConfig.DEBUG,
        inviteCode: (String) -> String?,
        isJoinLink: (String) -> Boolean = { false }
    ): InboundLink? {
        if (url.isNullOrBlank()) return null
        if (mayBeInvite(url)) {
            inviteCode(url)?.let { return InboundLink.Join(it) }
            // A join link that lost its code still opens the join screen, to paste or type it.
            if (isJoinLink(url)) return InboundLink.JoinWithoutCode
        }
        return inboundFeatureId(url, enabled)?.let { InboundLink.Feature(it) }
    }

    /** Only https links and `crewcue://join` go to the parser: a fixture route never is an invite. */
    private fun mayBeInvite(url: String): Boolean {
        val lower = url.trim().lowercase()
        return lower.startsWith("https://") || lower.startsWith("crewcue://join")
    }

    fun featureId(url: String?): String? {
        if (url.isNullOrBlank() || !url.startsWith("crewcue://")) return null
        val path = url.substringBefore('?').removePrefix("crewcue://").trim('/')
        return featureByPath[path]
    }
}

/** A link from outside the app ([DevRoutes.inbound]). */
sealed interface InboundLink {
    /** A crew invite: its 6-digit code goes to client-core's pending join. */
    data class Join(val code: String) : InboundLink
    /** The join page or `crewcue://join` with no code that reads: the join screen asks for it. */
    data object JoinWithoutCode : InboundLink
    /** A fixture route (debug builds). */
    data class Feature(val id: String) : InboundLink
}
