package com.crewcue.android.ui.onboarding

import com.crewcue.android.billing.PRODUCT_RACE_PASS
import com.crewcue.android.billing.PRODUCT_RACE_PASS_FULL_CREW
import com.crewcue.android.data.optText
import com.crewcue.android.ui.map.CoursePoint
import com.crewcue.android.ui.map.MapCheckpoint
import com.crewcue.android.ui.map.TimelineRow
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/** Root test tag of the onboarding route (clients/behavior/onboarding-runner-setup.md). */
const val SETUP_TAG = "crewcue.onboarding-runner-setup"

/** Stable test tag for one control on the onboarding route. */
fun setupTag(part: String): String = "$SETUP_TAG.$part"

// The checklist's own identifiers (clients/behavior/onboarding-runner-setup.md, Accessibility labels).

/** The top app bar's back arrow on every setup step, spoken "Back". */
const val BACK_TAG = "crewcue.onboarding.back"
/** "Your name", the account step's field. */
const val DISPLAY_NAME_TAG = "crewcue.onboarding.display-name"
/** The race name: the field, then the read-only name once the race exists. */
const val RACE_NAME_TAG = "crewcue.onboarding.race-name"
/** The Cairn loader where the course preview goes, spoken "Reading your course…" or "Loading". */
const val COURSE_LOADING_TAG = "crewcue.onboarding.course-loading"
/** "Course saved" (with the file's name when known) on a phone that doesn't hold the file. */
const val COURSE_SAVED_TAG = "crewcue.onboarding.course-saved"
/** The picked course previewed: a checkmark, "Course uploaded" and the file name. */
const val COURSE_UPLOADED_TAG = "crewcue.onboarding.course-uploaded"
/** Cancel after a file picked after Back couldn't be read: the course from before stays. */
const val CANCEL_COURSE_TAG = "crewcue.onboarding.cancel-course"
/** The history step's three tips. */
const val HISTORY_TIPS_TAG = "crewcue.onboarding.history-tips"

/** Runner phase 1 steps, as client-core `OnboardingStep` names them. */
object SetupSteps {
    const val ACCOUNT = "account"
    const val COURSE = "course"
    const val START_TIME = "startTime"
    const val HISTORY = "history"
    const val TEASER = "projectionTeaser"
    val all = listOf(ACCOUNT, COURSE, START_TIME, HISTORY, TEASER)
}

/**
 * The race list an onboarding state was read with: `myRaces` rows (null while unknown), and how
 * many fresh lists `myRaces` had answered by then, so the runner's setup tells a fresh list apart.
 */
data class SetupRaces(val rows: JSONArray?, val version: Int)

/** client-core `OnboardingState`, as `readOnboarding` and `markOnboardingStep` answer it. */
data class OnboardingFlow(
    /** runner, crew, chooser, done, loading or raceLocked. */
    val flow: String,
    val role: String?,
    val roomId: String?,
    /** setup, preview, tour or join. */
    val phase: String?,
    val step: String?,
    val showsTabBar: Boolean,
    /** Why the race is locked (`raceLocked` only), shared copy. */
    val reason: String?
) {
    val isLoading: Boolean get() = flow == "loading"
    val isChooser: Boolean get() = flow == "chooser"
    val isRaceLocked: Boolean get() = flow == "raceLocked"
    val isRunnerSetup: Boolean get() = flow == "runner" && phase == "setup"
    /** Runner phase 2: the replay (`preview` step), then the paywall step. */
    val isRunnerPreview: Boolean get() = flow == "runner" && phase == "preview"
    /** The replay and its paywall are on: Not now or a purchase marks this step. */
    val isRacePreviewStep: Boolean get() = isRunnerPreview && step == PREVIEW_STEP
    val isCrewJoin: Boolean get() = flow == "crew" && phase == "join"

    /** The state back as `readOnboarding` answered it, for ops that read it (`raceAccess`). */
    fun toJson(): JSONObject = JSONObject()
        .put("flow", flow)
        .put("role", role ?: JSONObject.NULL)
        .put("roomId", roomId ?: JSONObject.NULL)
        .put("phase", phase ?: JSONObject.NULL)
        .put("step", step ?: JSONObject.NULL)
        .put("showsTabBar", showsTabBar)
        .put("reason", reason ?: JSONObject.NULL)

    companion object {
        fun from(state: JSONObject?): OnboardingFlow? {
            state ?: return null
            val flow = state.optText("flow").ifBlank { return null }
            return OnboardingFlow(
                flow = flow,
                role = state.optText("role").ifBlank { null },
                roomId = state.optText("roomId").ifBlank { null },
                phase = state.optText("phase").ifBlank { null },
                step = state.optText("step").ifBlank { null },
                showsTabBar = state.optBoolean("showsTabBar"),
                reason = state.optText("reason").ifBlank { null }
            )
        }
    }
}

/**
 * Every string the onboarding screens show: client-core `OnboardingCopy` (the `onboardingCopy` op)
 * and the checklist's state copy (`featureScreen` for onboarding-runner-setup).
 */
data class OnboardingText(
    val chooserRunner: String = "",
    val chooserCrew: String = "",
    val unpaidBanner: String = "",
    /** The Race Pass page's one title and subtitle. */
    val racePassTitle: String = "",
    val racePassSubtitle: String = "",
    val courseSaveLimit: String = "",
    val startTimeDstGap: String = "",
    /** "Add a race name to continue.": the race needs a name and has none, typed or listed. */
    val raceNameMissing: String = "",
    /** The server found no route in the picked file: choose another (client-core `OnboardingCopy.courseUnreadable`). */
    val courseUnreadable: String = "",
    /** Any other failed course upload: try again or choose another file. */
    val courseUploadFailed: String = "",
    /** The history step's three tips, under its lead (the step's explanation). */
    val historyTips: List<String> = emptyList(),
    val stepTitles: Map<String, String> = emptyMap(),
    val stepExplanations: Map<String, String> = emptyMap(),
    val labels: Map<String, String> = emptyMap(),
    /** onboarding-runner-setup.md Success / Empty / Error / Offline. */
    val setupSuccess: String = "",
    val setupEmpty: String = "",
    val setupError: String = "",
    val setupOffline: String = "",
    /** The race-day replay and the paywall after it (onboarding-race-preview.md). */
    val replay: ReplayText = ReplayText()
) {
    fun label(key: String): String = labels[key].orEmpty()
    fun title(step: String): String = stepTitles[step].orEmpty()
    fun explanation(step: String): String = stepExplanations[step].orEmpty()

    /** "Back", the setup's top bar arrow's spoken label. */
    val back: String get() = replay.back

    /** "Loading", what a loader with no caption says. */
    val loading: String get() = replay.loading

    companion object {
        fun from(copy: JSONObject?, success: String, empty: String, error: String, offline: String): OnboardingText {
            val json = copy ?: JSONObject()
            val tips = json.optJSONArray("historyTips")
            return OnboardingText(
                chooserRunner = json.optText("chooserRunner"),
                chooserCrew = json.optText("chooserCrew"),
                unpaidBanner = json.optText("unpaidBanner"),
                racePassTitle = json.optText("racePassTitle"),
                racePassSubtitle = json.optText("racePassSubtitle"),
                courseSaveLimit = json.optText("courseSaveLimit"),
                startTimeDstGap = json.optText("startTimeDstGap"),
                raceNameMissing = json.optText("raceNameMissing"),
                courseUnreadable = json.optText("courseUnreadable"),
                courseUploadFailed = json.optText("courseUploadFailed"),
                historyTips = (0 until (tips?.length() ?: 0)).mapNotNull { tips?.optString(it)?.ifBlank { null } },
                stepTitles = json.optJSONObject("stepTitles").strings(),
                stepExplanations = json.optJSONObject("stepExplanations").strings(),
                labels = json.optJSONObject("labels").strings(),
                setupSuccess = success,
                setupEmpty = empty,
                setupError = error,
                setupOffline = offline,
                replay = ReplayText.from(json)
            )
        }

        private fun JSONObject?.strings(): Map<String, String> {
            this ?: return emptyMap()
            return keys().asSequence().associateWith { optText(it) }
        }
    }
}

/** One paywall option: who it covers, the store product behind it and its fallback price. */
data class PaywallOption(
    val title: String,
    /** The store product id (`BillingProduct` raw value). */
    val product: String,
    val productTitle: String,
    val detail: String,
    /** `BillingProduct.fallbackPrice`, until the store answers. */
    val fallbackPrice: String,
    /** Stable test tag; the buy button adds `.buy`. */
    val tag: String
)

/** client-core `OnboardingCopy` for the race-day replay and its paywall (the `onboardingCopy` op). */
data class ReplayText(
    val skip: String = "",
    val play: String = "",
    val pause: String = "",
    /** onboarding-race-preview.md Empty / Error / Offline. */
    val empty: String = "",
    val error: String = "",
    val offline: String = "",
    val mapTitle: String = "",
    val paceTitle: String = "",
    val chatTitle: String = "",
    val loading: String = "",
    val back: String = "",
    val notNow: String = "",
    val lockedRow: String = "",
    val lockedExplanation: String = "",
    /** "Buy {product}, {price}", the buy button's spoken label. */
    val buyLabelTemplate: String = "",
    /** Every beat's caption, in beat order, so the caption card keeps the longest one's height. */
    val captions: List<String> = emptyList(),
    /** Where to look at each beat (client-core `OnboardingCopy.replayFocus`), by beat. */
    val focus: Map<String, String> = emptyMap(),
    val options: List<PaywallOption> = emptyList()
) {
    fun panelTitle(panel: ReplayPanel): String = when (panel) {
        ReplayPanel.Map -> mapTitle
        ReplayPanel.Pace -> paceTitle
        ReplayPanel.Chat -> chatTitle
    }

    /** "Buy Race Pass, $14.99", with the store's localized [price] or the fallback. */
    fun buyLabel(option: PaywallOption, price: String): String =
        buyLabelTemplate.replace("{product}", option.productTitle).replace("{price}", price)

    companion object {
        const val RUNNER_PLUS_ONE_TAG = "crewcue.onboarding-paywall.runner-plus-one"
        const val FULL_CREW_TAG = "crewcue.onboarding-paywall.full-crew"

        fun from(json: JSONObject): ReplayText = ReplayText(
            skip = json.optText("replaySkip"),
            play = json.optText("replayPlay"),
            pause = json.optText("replayPause"),
            empty = json.optText("replayEmpty"),
            error = json.optText("replayError"),
            offline = json.optText("replayOffline"),
            mapTitle = json.optText("replayMapTitle"),
            paceTitle = json.optText("replayPaceTitle"),
            chatTitle = json.optText("replayChatTitle"),
            loading = json.optText("loading"),
            back = json.optText("back"),
            notNow = json.optText("paywallNotNow"),
            lockedRow = json.optText("lockedAidRow"),
            lockedExplanation = json.optText("lockedAidExplanation"),
            buyLabelTemplate = json.optText("paywallBuyLabelTemplate"),
            captions = json.optJSONObject("beatCaptions").let { beats ->
                listOf(ReplayBeats.FOLLOWING, ReplayBeats.FALLING_BEHIND, ReplayBeats.DEAD_ZONE, ReplayBeats.CREW_CHAT)
                    .mapNotNull { beat -> beats?.optText(beat)?.ifBlank { null } }
            },
            focus = json.optJSONObject("beatFocus")?.let { beats ->
                beats.keys().asSequence().associateWith { beats.optText(it) }.filterValues { it.isNotBlank() }
            }.orEmpty(),
            options = listOf(
                PaywallOption(
                    title = json.optText("paywallRunnerPlusOneTitle"),
                    product = PRODUCT_RACE_PASS,
                    productTitle = json.optText("paywallRunnerPlusOneProduct"),
                    detail = json.optText("paywallRunnerPlusOneDetail"),
                    fallbackPrice = json.optText("paywallRunnerPlusOnePrice"),
                    tag = RUNNER_PLUS_ONE_TAG
                ),
                PaywallOption(
                    title = json.optText("paywallFullCrewTitle"),
                    product = PRODUCT_RACE_PASS_FULL_CREW,
                    productTitle = json.optText("paywallFullCrewProduct"),
                    detail = json.optText("paywallFullCrewDetail"),
                    fallbackPrice = json.optText("paywallFullCrewPrice"),
                    tag = FULL_CREW_TAG
                )
            )
        )
    }
}

/** The local date, time of day and IANA zone the runner picked. client-core converts it. */
data class RaceStartFields(
    val year: Int,
    val month: Int,
    val day: Int,
    val hour: Int,
    val minute: Int,
    val timeZone: String
) {
    fun toJson(): JSONObject = JSONObject()
        .put("year", year).put("month", month).put("day", day)
        .put("hour", hour).put("minute", minute).put("timeZone", timeZone)

    companion object {
        fun from(json: JSONObject?): RaceStartFields? {
            json ?: return null
            if (!json.has("year") || !json.has("month") || !json.has("day")) return null
            val zone = json.optText("timeZone").ifBlank { return null }
            return RaceStartFields(
                json.optInt("year"), json.optInt("month"), json.optInt("day"),
                json.optInt("hour"), json.optInt("minute"), zone
            )
        }
    }
}

/**
 * The race's zone by its generic name in [locale] ("Pacific Time"), when it isn't this phone's
 * zone, so times written in it say so (as on iOS). Null when it is the phone's. An id the platform
 * can't name stays as it is.
 */
fun raceZoneLabel(raceZone: String, phoneZone: String, locale: Locale): String? {
    if (raceZone == phoneZone) return null
    return runCatching { ZoneId.of(raceZone).getDisplayName(TextStyle.FULL, locale) }.getOrNull()?.ifBlank { null } ?: raceZone
}

/** A course drawn from `gpxPreview` or `loadRoom`: the same shape either way. */
data class CoursePreview(
    val line: List<CoursePoint>,
    val checkpoints: List<MapCheckpoint>,
    /** `[distanceMeters, elevationMeters]`, from the route geometry on an unpaid race. */
    val elevation: List<Pair<Double, Double>>,
    val plannedPaceSecondsPerKm: Double?,
    /** The course file's name as the server has it, when it says (a saved course read from the room). */
    val courseFileName: String? = null,
    /** client-core's line under the map, "31.1 mi · 4 checkpoints" (`OnboardingCopy.courseSummary`). */
    val summary: String? = null
) {
    val isEmpty: Boolean get() = line.size < 2 && checkpoints.isEmpty()

    fun checkpointJson(): JSONArray {
        val rows = JSONArray()
        checkpoints.forEach { checkpoint ->
            val row = JSONObject()
                .put("id", checkpoint.id)
                .put("title", checkpoint.title)
                .put("latitude", checkpoint.latitude)
                .put("longitude", checkpoint.longitude)
            checkpoint.distanceMetersFromStart?.let { row.put("distanceMetersFromStart", it) }
            checkpoint.plannedStopSeconds?.let { row.put("plannedStopSeconds", it) }
            rows.put(row)
        }
        return rows
    }

    fun elevationJson(): JSONArray {
        val rows = JSONArray()
        elevation.forEach { (distance, meters) -> rows.put(JSONArray().put(distance).put(meters)) }
        return rows
    }

    companion object {
        fun from(json: JSONObject): CoursePreview {
            val line = mutableListOf<CoursePoint>()
            json.optJSONArray("line")?.let { array ->
                for (index in 0 until array.length()) {
                    val pair = array.optJSONArray(index) ?: continue
                    val longitude = pair.optDouble(0, Double.NaN)
                    val latitude = pair.optDouble(1, Double.NaN)
                    if (!latitude.isNaN() && !longitude.isNaN()) line += CoursePoint(latitude, longitude)
                }
            }
            val checkpoints = mutableListOf<MapCheckpoint>()
            json.optJSONArray("checkpoints")?.let { array ->
                for (index in 0 until array.length()) {
                    val row = array.optJSONObject(index) ?: continue
                    val id = row.optText("id")
                    val latitude = row.optDouble("latitude", Double.NaN)
                    val longitude = row.optDouble("longitude", Double.NaN)
                    if (id.isBlank() || latitude.isNaN() || longitude.isNaN()) continue
                    checkpoints += MapCheckpoint(
                        id = id,
                        title = row.optText("title").ifBlank { id },
                        latitude = latitude,
                        longitude = longitude,
                        distanceMetersFromStart = if (row.has("distanceMetersFromStart")) row.optDouble("distanceMetersFromStart") else null,
                        plannedStopSeconds = if (row.has("plannedStopSeconds")) row.optDouble("plannedStopSeconds") else null
                    )
                }
            }
            val elevation = mutableListOf<Pair<Double, Double>>()
            json.optJSONArray("elevation")?.let { array ->
                for (index in 0 until array.length()) {
                    val pair = array.optJSONArray(index) ?: continue
                    val distance = pair.optDouble(0, Double.NaN)
                    val meters = pair.optDouble(1, Double.NaN)
                    if (!distance.isNaN() && !meters.isNaN()) elevation += distance to meters
                }
            }
            val pace = json.optDouble("plannedPaceSecondsPerKm", Double.NaN).takeIf { !it.isNaN() && it > 0 }
            return CoursePreview(
                line,
                checkpoints,
                elevation,
                pace,
                json.optText("courseFileName").trim().ifBlank { null },
                json.optText("summary").ifBlank { null }
            )
        }
    }
}

/** One Pace timeline row in the teaser: a row with its plan time, or a checkpoint locked until the race is paid. */
sealed interface TeaserRow {
    val checkpointId: String

    data class Open(val row: TimelineRow) : TeaserRow {
        override val checkpointId: String get() = row.checkpointId
    }

    data class Locked(override val checkpointId: String, val title: String) : TeaserRow

    companion object {
        /**
         * The start, then every checkpoint the server withheld (`locked.checkpointIds`, in course
         * order), then the finish. A row client-core built for a locked checkpoint becomes a locked row.
         */
        fun build(timeline: List<TimelineRow>, lockedIds: List<String>, titles: Map<String, String>): List<TeaserRow> {
            val locked = lockedIds.distinct()
            val lockedSet = locked.toSet()
            val open = timeline.filter { it.checkpointId !in lockedSet }
            val lockedRows = locked.map { id -> Locked(id, titles[id] ?: timeline.firstOrNull { it.checkpointId == id }?.title ?: id) }
            if (open.isEmpty()) return lockedRows
            return listOf<TeaserRow>(Open(open.first())) + lockedRows + open.drop(1).map { Open(it) }
        }

        /** `sheet.locked.checkpointIds` from a `loadSchedule` result. */
        fun lockedIds(schedule: JSONObject?): List<String> {
            val ids = schedule?.optJSONObject("sheet")?.optJSONObject("locked")?.optJSONArray("checkpointIds")
                ?: return emptyList()
            return (0 until ids.length()).map { ids.optString(it) }.filter { it.isNotBlank() }
        }
    }
}

/** Timeline rows as `projectAidSheet` answers them. */
fun parseTimeline(array: JSONArray?): List<TimelineRow> {
    array ?: return emptyList()
    val rows = mutableListOf<TimelineRow>()
    for (index in 0 until array.length()) {
        val row = array.optJSONObject(index) ?: continue
        rows += TimelineRow(
            checkpointId = row.optText("checkpointId"),
            state = row.optString("state", "projected"),
            kicker = row.optText("kicker"),
            title = row.optText("title"),
            clockArrivalAt = row.optText("clockArrivalAt").ifBlank { null },
            cutoffAt = row.optText("cutoffAt").ifBlank { null },
            cutoffStatus = row.optText("cutoffStatus").ifBlank { null },
            distanceToLabel = row.optString("distanceToLabel", "—"),
            isFinish = row.optBoolean("isFinish"),
            clockLabel = row.optText("clockLabel").ifBlank { null }
        )
    }
    return rows
}
