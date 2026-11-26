package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.optText
import com.crewcue.android.ui.ShellTab
import org.json.JSONObject

// The tab-bar tour (clients/behavior/onboarding-runner-tour.md, onboarding-crew.md). Every value
// here is parsed from client-core's tour ops; Kotlin decides no card, outcome or copy.

/** Root tag of the runner tour's coach mark overlay. */
const val RUNNER_TOUR_TAG = "crewcue.onboarding-runner-tour"
/** Root tag of the crew tour's coach mark overlay. */
const val CREW_TOUR_TAG = "crewcue.onboarding-crew"
const val TOUR_PRIMARY_TAG = "crewcue.onboarding.tour.primary"
const val TOUR_SECONDARY_TAG = "crewcue.onboarding.tour.secondary"
const val TOUR_SKIP_TAG = "crewcue.onboarding.tour.skip"
const val TOUR_EXAMPLE_TAG = "crewcue.onboarding.tour.example"
const val TOUR_LOCATION_STATUS_TAG = "crewcue.onboarding.tour.location-status"
const val TOUR_INVITE_STATUS_TAG = "crewcue.onboarding.tour.invite-status"
const val TOUR_NOTIFICATIONS_STATUS_TAG = "crewcue.onboarding.tour.notifications-status"
const val SETUP_CHECKLIST_TAG = "crewcue.setup-checklist"

/** The tour dev routes' feature ids (client-core `Route`). */
const val RUNNER_TOUR_FEATURE = "onboarding-runner-tour"
const val CREW_TOUR_FEATURE = "onboarding-crew"

/** The accessibility id of a tab, the anchor a card names (`TourAnchor.accessibilityIdentifier`). */
fun tabAnchorTag(tab: ShellTab): String = "crewcue.tab.${tab.name.lowercase()}"

/** The tab a card's anchor id names, or null for a card that stands alone. */
fun tabForAnchor(anchorTag: String?): ShellTab? = ShellTab.entries.firstOrNull { tabAnchorTag(it) == anchorTag }

data class TourExampleLine(val label: String, val value: String)

/** client-core `TourCard`, as the tour ops answer it. */
data class TourCard(
    val step: String,
    val role: String,
    /** `crewcue.tab.*`, null when the card stands alone (notifications). */
    val anchorTag: String?,
    val title: String,
    val body: String,
    /** shareInvite, enableNotifications, testTracking, showStartLine, next. */
    val action: String,
    val primaryLabel: String,
    val secondaryLabel: String?,
    val secondaryOutcome: String?,
    val exampleHeading: String?,
    val example: List<TourExampleLine>,
    val progressLabel: String,
    /** "Skip tour", null on the last card. */
    val skipLabel: String?,
    val tag: String
) {
    val anchorTab: ShellTab? get() = tabForAnchor(anchorTag)

    companion object {
        fun from(json: JSONObject?): TourCard? {
            json ?: return null
            val step = json.optText("step").ifBlank { return null }
            val example = json.optJSONArray("example")
            return TourCard(
                step = step,
                role = json.optText("role"),
                anchorTag = json.optText("anchorIdentifier").ifBlank { null },
                title = json.optText("title"),
                body = json.optText("body"),
                action = json.optText("action"),
                primaryLabel = json.optText("primaryLabel"),
                secondaryLabel = json.optText("secondaryLabel").ifBlank { null },
                secondaryOutcome = json.optText("secondaryOutcome").ifBlank { null },
                exampleHeading = json.optText("exampleHeading").ifBlank { null },
                example = (0 until (example?.length() ?: 0)).mapNotNull { index ->
                    example?.optJSONObject(index)?.let { TourExampleLine(it.optText("label"), it.optText("value")) }
                },
                progressLabel = json.optText("progressLabel"),
                skipLabel = json.optText("skipLabel").ifBlank { null },
                tag = json.optText("accessibilityIdentifier")
            )
        }
    }
}

/** One row of the setup checklist card (`SetupChecklistItem`). */
data class SetupChecklistRow(
    val kind: String,
    val title: String,
    val detail: String,
    val done: Boolean,
    /** inviteShare, paceStopEdit, mapCheckpointPick, notifications, mapTracking. */
    val opens: String,
    val tag: String
)

/** client-core `SetupChecklist` for the Map card. */
data class SetupChecklistCard(
    val title: String,
    val summary: String,
    val next: String?,
    val show: String,
    val showLess: String,
    val hide: String,
    val items: List<SetupChecklistRow>
) {
    val nextRow: SetupChecklistRow? get() = items.firstOrNull { it.kind == next }

    companion object {
        fun from(json: JSONObject?): SetupChecklistCard? {
            json ?: return null
            val rows = json.optJSONArray("items") ?: return null
            return SetupChecklistCard(
                title = json.optText("title"),
                summary = json.optText("summary"),
                next = json.optText("next").ifBlank { null },
                show = json.optText("show"),
                showLess = json.optText("showLess"),
                hide = json.optText("hide"),
                items = (0 until rows.length()).mapNotNull { index ->
                    val row = rows.optJSONObject(index) ?: return@mapNotNull null
                    SetupChecklistRow(
                        kind = row.optText("kind"),
                        title = row.optText("title"),
                        detail = row.optText("detail"),
                        done = row.optBoolean("done"),
                        opens = row.optText("opens"),
                        tag = row.optText("accessibilityIdentifier")
                    )
                }
            )
        }
    }
}

/** client-core `LocationTest` as the `locationTest` op answers it; [test] goes back on the next op. */
data class LocationTestAnswer(
    val test: JSONObject,
    val phase: String,
    /** Tracking is on for another race: the test didn't start. */
    val blocked: Boolean,
    val message: String?,
    val isRunning: Boolean,
    val stopsTracking: Boolean,
    val waitsForAlways: Boolean,
    val outcome: String?
) {
    val wasTracking: Boolean get() = test.optBoolean("wasTracking")

    companion object {
        fun from(json: JSONObject?): LocationTestAnswer? {
            json ?: return null
            val test = json.optJSONObject("test") ?: return null
            return LocationTestAnswer(
                test = test,
                phase = json.optText("phase"),
                blocked = json.optBoolean("blocked"),
                message = json.optText("message").ifBlank { null },
                isRunning = json.optBoolean("isRunning"),
                stopsTracking = json.optBoolean("stopsTracking"),
                waitsForAlways = json.optBoolean("waitsForAlways"),
                outcome = json.optText("outcome").ifBlank { null }
            )
        }
    }
}

/** client-core `TourCardView`: the card's buttons and status line for this phone now. */
data class TourButtons(
    /** Null while the location test runs: no main button then. */
    val primaryLabel: String?,
    /** shareInvite, enableNotifications, testTracking, showStartLine, next. */
    val primaryAction: String,
    val secondaryLabel: String?,
    val secondaryOutcome: String?,
    val status: String?
) {
    companion object {
        fun from(json: JSONObject?): TourButtons? {
            json ?: return null
            return TourButtons(
                primaryLabel = json.optText("primaryLabel").ifBlank { null },
                primaryAction = json.optText("primaryAction"),
                secondaryLabel = json.optText("secondaryLabel").ifBlank { null },
                secondaryOutcome = json.optText("secondaryOutcome").ifBlank { null },
                status = json.optText("status").ifBlank { null }
            )
        }
    }
}

/** The tour lines that aren't on a card (`onboardingTourCopy`). */
data class TourText(
    val next: String = "",
    val notificationsOn: String = "",
    val notificationsOff: String = "",
    val inviteLoading: String = ""
) {
    companion object {
        fun from(json: JSONObject?): TourText {
            val tour = json?.optJSONObject("tour") ?: JSONObject()
            return TourText(
                next = tour.optText("next"),
                notificationsOn = tour.optText("notificationsOn"),
                notificationsOff = tour.optText("notificationsOff"),
                inviteLoading = tour.optText("inviteLoading")
            )
        }
    }
}
