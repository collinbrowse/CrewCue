package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.optText
import com.crewcue.android.ui.map.CoursePoint
import com.crewcue.android.ui.map.MapCheckpoint
import com.crewcue.android.ui.map.TimelineRow
import org.json.JSONArray
import org.json.JSONObject

/** Root test tag of the onboarding route (clients/behavior/onboarding-runner-setup.md). */
const val SETUP_TAG = "crewcue.onboarding-runner-setup"

/** Stable test tag for one control on the onboarding route. */
fun setupTag(part: String): String = "$SETUP_TAG.$part"

/** Runner phase 1 steps, as client-core `OnboardingStep` names them. */
object SetupSteps {
    const val ACCOUNT = "account"
    const val COURSE = "course"
    const val START_TIME = "startTime"
    const val HISTORY = "history"
    const val TEASER = "projectionTeaser"
    val all = listOf(ACCOUNT, COURSE, START_TIME, HISTORY, TEASER)
}

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
    /** Runner phase 2 (replay and paywall). Not built yet: the shell's paywall stands in. */
    val isRunnerPreview: Boolean get() = flow == "runner" && phase == "preview"
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
    val courseSaveLimit: String = "",
    val startTimeDstGap: String = "",
    val stepTitles: Map<String, String> = emptyMap(),
    val stepExplanations: Map<String, String> = emptyMap(),
    val labels: Map<String, String> = emptyMap(),
    /** onboarding-runner-setup.md Success / Empty / Error / Offline. */
    val setupSuccess: String = "",
    val setupEmpty: String = "",
    val setupError: String = "",
    val setupOffline: String = ""
) {
    fun label(key: String): String = labels[key].orEmpty()
    fun title(step: String): String = stepTitles[step].orEmpty()
    fun explanation(step: String): String = stepExplanations[step].orEmpty()

    companion object {
        fun from(copy: JSONObject?, success: String, empty: String, error: String, offline: String): OnboardingText {
            val json = copy ?: JSONObject()
            return OnboardingText(
                chooserRunner = json.optText("chooserRunner"),
                chooserCrew = json.optText("chooserCrew"),
                unpaidBanner = json.optText("unpaidBanner"),
                courseSaveLimit = json.optText("courseSaveLimit"),
                startTimeDstGap = json.optText("startTimeDstGap"),
                stepTitles = json.optJSONObject("stepTitles").strings(),
                stepExplanations = json.optJSONObject("stepExplanations").strings(),
                labels = json.optJSONObject("labels").strings(),
                setupSuccess = success,
                setupEmpty = empty,
                setupError = error,
                setupOffline = offline
            )
        }

        private fun JSONObject?.strings(): Map<String, String> {
            this ?: return emptyMap()
            return keys().asSequence().associateWith { optText(it) }
        }
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

/** A course drawn from `gpxPreview` or `loadRoom`: the same shape either way. */
data class CoursePreview(
    val line: List<CoursePoint>,
    val checkpoints: List<MapCheckpoint>,
    /** `[distanceMeters, elevationMeters]`, from the route geometry on an unpaid race. */
    val elevation: List<Pair<Double, Double>>,
    val plannedPaceSecondsPerKm: Double?
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
            return CoursePreview(line, checkpoints, elevation, pace)
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
