package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * The client-core runtime ops the runner's setup uses. One seam, so the ViewModel is tested on the
 * JVM with a fake; production goes through [RaceDayBridge]. Every call blocks: run it off Main.
 */
interface RunnerSetupRuntime {
    /** `markOnboardingStep`, with the shell's race list and active race. */
    fun markStep(step: String, outcome: String?, roomId: String?): RuntimeResult
    fun createRoom(name: String, userId: String, creatorName: String?): RuntimeResult
    fun gpxPreview(roomId: String, fileName: String, gpxXml: String): RuntimeResult
    fun raceStartInput(fields: RaceStartFields): RuntimeResult
    fun importCourse(roomId: String, fileName: String, gpxXml: String, raceStartAt: String, plannedPaceSecondsPerKm: Double?): RuntimeResult
    fun loadEstimate(roomId: String): RuntimeResult
    /** An athlete's automatic recompute: `POST /pacing-estimates`, then attach it to the race. */
    fun computeEstimate(roomId: String): RuntimeResult
    fun importActivity(fileName: String, contentBase64: String): RuntimeResult
    fun historyComparison(withHistoryFinishAt: String, withoutHistoryFinishAt: String, timeZone: String): RuntimeResult
    fun loadRoom(roomId: String): RuntimeResult
    fun loadSchedule(roomId: String): RuntimeResult
    /** Pace timeline rows from the schedule sheet and course. No runner: nobody has pinged yet. */
    fun timeline(sheet: JSONObject?, checkpoints: JSONArray, elevation: JSONArray?): RuntimeResult
}

class BridgeRunnerSetupRuntime(
    private val raceDay: RaceDayBridge,
    /** The shell's `myRaces` rows (null while unknown) and active race, sent with every mark. */
    private val raceContext: () -> Pair<JSONArray?, String?>
) : RunnerSetupRuntime {
    override fun markStep(step: String, outcome: String?, roomId: String?): RuntimeResult {
        val (races, active) = raceContext()
        return raceDay.markOnboardingStep(step, outcome, roomId, choice = null, races = races, activeRoomId = active)
    }

    override fun createRoom(name: String, userId: String, creatorName: String?): RuntimeResult =
        raceDay.createRoom(name, userId, userId, creatorName)

    override fun gpxPreview(roomId: String, fileName: String, gpxXml: String): RuntimeResult =
        raceDay.gpxPreview(roomId, fileName, gpxXml)

    override fun raceStartInput(fields: RaceStartFields): RuntimeResult =
        raceDay.raceStartInput(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.timeZone)

    override fun importCourse(
        roomId: String,
        fileName: String,
        gpxXml: String,
        raceStartAt: String,
        plannedPaceSecondsPerKm: Double?
    ): RuntimeResult = raceDay.importGpx(roomId, fileName, gpxXml, raceStartAt, plannedPaceSecondsPerKm)

    override fun loadEstimate(roomId: String): RuntimeResult = raceDay.loadEstimate(roomId)

    override fun computeEstimate(roomId: String): RuntimeResult =
        raceDay.computeEstimate(roomId, historyFingerprint = null, usableHistoryCount = 0, trigger = "auto", hasPlanOfRecord = false)

    override fun importActivity(fileName: String, contentBase64: String): RuntimeResult =
        raceDay.importActivityFile(fileName, contentBase64)

    override fun historyComparison(withHistoryFinishAt: String, withoutHistoryFinishAt: String, timeZone: String): RuntimeResult =
        raceDay.onboardingHistoryComparison(withHistoryFinishAt, withoutHistoryFinishAt, timeZone)

    override fun loadRoom(roomId: String): RuntimeResult = raceDay.loadRoom(roomId)

    override fun loadSchedule(roomId: String): RuntimeResult = raceDay.loadSchedule(roomId)

    override fun timeline(sheet: JSONObject?, checkpoints: JSONArray, elevation: JSONArray?): RuntimeResult =
        raceDay.projectAidSheet(sheet, checkpoints, runner = null, selectedIndex = 0, follow = true, elevation = elevation)
}

/**
 * What the runner typed so far, kept small enough for [androidx.lifecycle.SavedStateHandle]. The
 * course file itself is kept by [RunnerSetupDraftStore], beside it.
 */
data class RunnerSetupDraft(
    /** The race created for this setup. A draft for another race is dropped. */
    val roomId: String? = null,
    val displayName: String = "",
    val courseFileName: String? = null,
    /** The runner saw the preview and moved on to the start time. Course and start time upload together. */
    val courseConfirmed: Boolean = false,
    val plannedPaceSecondsPerKm: Double? = null,
    val start: RaceStartFields? = null,
    /** The `raceStartAt` the course last uploaded with, so a second tap doesn't upload it again. */
    val uploadedStartAt: String? = null,
    /** The estimate's finish before and after the history import, for `onboardingHistoryComparison`. */
    val withoutHistoryFinishAt: String? = null,
    val withHistoryFinishAt: String? = null
) {
    fun toJson(): String = JSONObject()
        .put("roomId", roomId ?: JSONObject.NULL)
        .put("displayName", displayName)
        .put("courseFileName", courseFileName ?: JSONObject.NULL)
        .put("courseConfirmed", courseConfirmed)
        .put("plannedPaceSecondsPerKm", plannedPaceSecondsPerKm ?: JSONObject.NULL)
        .put("start", start?.toJson() ?: JSONObject.NULL)
        .put("uploadedStartAt", uploadedStartAt ?: JSONObject.NULL)
        .put("withoutHistoryFinishAt", withoutHistoryFinishAt ?: JSONObject.NULL)
        .put("withHistoryFinishAt", withHistoryFinishAt ?: JSONObject.NULL)
        .toString()

    companion object {
        fun from(raw: String?): RunnerSetupDraft? {
            if (raw.isNullOrBlank()) return null
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
            return RunnerSetupDraft(
                roomId = json.optText("roomId").ifBlank { null },
                displayName = json.optText("displayName"),
                courseFileName = json.optText("courseFileName").ifBlank { null },
                courseConfirmed = json.optBoolean("courseConfirmed"),
                plannedPaceSecondsPerKm = json.optDouble("plannedPaceSecondsPerKm", Double.NaN).takeIf { !it.isNaN() && it > 0 },
                start = RaceStartFields.from(json.optJSONObject("start")),
                uploadedStartAt = json.optText("uploadedStartAt").ifBlank { null },
                withoutHistoryFinishAt = json.optText("withoutHistoryFinishAt").ifBlank { null },
                withHistoryFinishAt = json.optText("withHistoryFinishAt").ifBlank { null }
            )
        }
    }
}

/**
 * Keeps the draft and the course file on disk, so a relaunch (not only process death) resumes the
 * course and start-time steps, which follow the server and so can't be marked. One user's at a time.
 */
interface RunnerSetupDraftStore {
    fun load(userId: String): RunnerSetupDraft?
    fun save(userId: String, draft: RunnerSetupDraft)
    fun readCourse(userId: String): String?
    fun writeCourse(userId: String, gpxXml: String): Boolean
    fun clear()
}

class FileRunnerSetupDraftStore(private val directory: File) : RunnerSetupDraftStore {
    private val draftFile get() = File(directory, "draft.json")
    private val courseFile get() = File(directory, "course.gpx")

    @Synchronized
    override fun load(userId: String): RunnerSetupDraft? {
        val json = runCatching { JSONObject(draftFile.readText()) }.getOrNull() ?: return null
        // Another account's draft never reaches this one.
        if (json.optText("userId") != userId) return null
        return RunnerSetupDraft.from(json.optJSONObject("draft")?.toString())
    }

    @Synchronized
    override fun save(userId: String, draft: RunnerSetupDraft) {
        runCatching {
            directory.mkdirs()
            val previous = runCatching { JSONObject(draftFile.readText()).optText("userId") }.getOrNull()
            if (previous != null && previous != userId) courseFile.delete()
            draftFile.writeText(JSONObject().put("userId", userId).put("draft", JSONObject(draft.toJson())).toString())
        }
    }

    @Synchronized
    override fun readCourse(userId: String): String? {
        val owner = runCatching { JSONObject(draftFile.readText()).optText("userId") }.getOrNull()
        if (owner != userId) return null
        return runCatching { courseFile.readText() }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    @Synchronized
    override fun writeCourse(userId: String, gpxXml: String): Boolean = runCatching {
        directory.mkdirs()
        courseFile.writeText(gpxXml)
        true
    }.getOrDefault(false)

    @Synchronized
    override fun clear() {
        directory.deleteRecursively()
    }
}
