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
        "dev/chat" to "chat-thread",
        "dev/chat-notification-prefs" to "chat-notification-prefs",
        "dev/push-registration" to "push-registration",
        "dev/profile" to "profile",
        "dev/room-members" to "room-members",
        "dev/strava" to "strava",
        "dev/app-shell" to "app-shell",
        "dev/loader" to "brand-loader"
    )

    /** Feature for a link from outside the app. Release builds open no fixture routes from links. */
    fun inboundFeatureId(url: String?, enabled: Boolean = BuildConfig.DEBUG): String? =
        if (enabled) featureId(url) else null

    fun featureId(url: String?): String? {
        if (url.isNullOrBlank() || !url.startsWith("crewcue://")) return null
        val path = url.substringBefore('?').removePrefix("crewcue://").trim('/')
        return featureByPath[path]
    }
}
