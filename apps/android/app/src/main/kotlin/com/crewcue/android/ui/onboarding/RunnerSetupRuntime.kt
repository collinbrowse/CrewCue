package com.crewcue.android.ui.onboarding

import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.optText
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** `computeEstimate` `historyMode`: Skip's cold start, no history even after an import (as on iOS). */
const val HISTORY_NONE = "none"

/** `computeEstimate` `historyMode`: after an import, estimates without and with history; answers `comparison`. */
const val HISTORY_COMPARE = "compare"

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
    /** `raceStartInput` the other way: a saved start as the fields in [timeZone]. Pure and quick. */
    fun raceStartFields(raceStartAt: String, timeZone: String): RuntimeResult
    /** `PATCH /race-rooms/:roomId/race-start`: a start-only change. */
    fun updateRaceStart(roomId: String, raceStartAt: String): RuntimeResult
    /**
     * One client-core `RunnerSetupSteps` decision (the `runnerSetupStep` op); read it through
     * [SetupDecisions]. Pure and quick, except `courseFingerprint` on a large file.
     */
    fun setupStep(decision: String, input: JSONObject): RuntimeResult
    fun importCourse(roomId: String, fileName: String, gpxXml: String, raceStartAt: String, plannedPaceSecondsPerKm: Double?): RuntimeResult
    fun loadEstimate(roomId: String): RuntimeResult
    /**
     * An athlete's automatic recompute: `POST /pacing-estimates`, then attach it to the race
     * (client-core retries a `course_mismatch` once). [historyMode]: [HISTORY_NONE] or [HISTORY_COMPARE].
     */
    fun computeEstimate(roomId: String, historyMode: String? = null): RuntimeResult
    fun importActivity(fileName: String, contentBase64: String): RuntimeResult
    fun loadRoom(roomId: String): RuntimeResult
    fun loadSchedule(roomId: String): RuntimeResult
    /** Pace timeline rows from the schedule sheet and course. No runner: nobody has pinged yet. */
    fun timeline(sheet: JSONObject?, checkpoints: JSONArray, elevation: JSONArray?): RuntimeResult
    /**
     * client-core `SuggestedDisplayName`: [name] as the account step's suggestion, or null when it
     * is an email (or [email]'s local part). Pure and quick (no request), so it may run on Main.
     */
    fun suggestedDisplayName(name: String?, email: String?): String?
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

    override fun raceStartFields(raceStartAt: String, timeZone: String): RuntimeResult = raceDay.raceStartFields(raceStartAt, timeZone)

    override fun updateRaceStart(roomId: String, raceStartAt: String): RuntimeResult = raceDay.updateRaceStart(roomId, raceStartAt)

    override fun setupStep(decision: String, input: JSONObject): RuntimeResult = raceDay.runnerSetupStep(decision, input)

    override fun importCourse(
        roomId: String,
        fileName: String,
        gpxXml: String,
        raceStartAt: String,
        plannedPaceSecondsPerKm: Double?
    ): RuntimeResult = raceDay.importGpx(roomId, fileName, gpxXml, raceStartAt, plannedPaceSecondsPerKm)

    override fun loadEstimate(roomId: String): RuntimeResult = raceDay.loadEstimate(roomId)

    override fun computeEstimate(roomId: String, historyMode: String?): RuntimeResult =
        raceDay.computeEstimate(
            roomId,
            historyFingerprint = null,
            usableHistoryCount = 0,
            trigger = "auto",
            hasPlanOfRecord = false,
            historyMode = historyMode
        )

    override fun importActivity(fileName: String, contentBase64: String): RuntimeResult =
        raceDay.importActivityFile(fileName, contentBase64)

    override fun loadRoom(roomId: String): RuntimeResult = raceDay.loadRoom(roomId)

    override fun loadSchedule(roomId: String): RuntimeResult = raceDay.loadSchedule(roomId)

    override fun timeline(sheet: JSONObject?, checkpoints: JSONArray, elevation: JSONArray?): RuntimeResult =
        raceDay.projectAidSheet(sheet, checkpoints, runner = null, selectedIndex = 0, follow = true, elevation = elevation)

    override fun suggestedDisplayName(name: String?, email: String?): String? = raceDay.suggestedDisplayName(name, email)
}

/**
 * What the runner typed so far, kept small enough for [androidx.lifecycle.SavedStateHandle]. The
 * course file itself is kept by [RunnerSetupDraftStore], beside it. Fields added later read as
 * their defaults from an older draft.
 */
data class RunnerSetupDraft(
    /** The race created for this setup. A draft for another race is dropped. */
    val roomId: String? = null,
    val displayName: String = "",
    /**
     * The race's name as typed on the course step, kept as it is typed. The race is created with
     * it; there's no rename after that.
     */
    val raceName: String? = null,
    val courseFileName: String? = null,
    /** The runner saw the preview and moved on to the start time. Course and start time upload together. */
    val courseConfirmed: Boolean = false,
    val plannedPaceSecondsPerKm: Double? = null,
    val start: RaceStartFields? = null,
    /** client-core's history comparison line ("Finish 9:42 AM instead of 10:15 AM"), kept for a relaunch. */
    val historyLine: String? = null,
    /** The comparison attached the plan with the imported history, so Continue needs no new estimate. */
    val historyAttached: Boolean = false,
    /** A history file went in on this visit to the history step, so it offers Continue, not Skip. */
    val historyImported: Boolean = false,
    /**
     * A file was picked that the race hasn't saved yet (`PUT …/course` with the start). Null in
     * older drafts, read as saved.
     */
    val courseUnsaved: Boolean? = null,
    /**
     * The start the race saved, as this phone last knew it: set by a save from here, or taken
     * from the race list. A reviewed start time saves only when the start differs.
     */
    val savedRaceStartAt: String? = null,
    /** client-core's fingerprint of the file this phone holds. */
    val courseFingerprint: String? = null,
    /** The fingerprint of the file the race saved from this phone, so the same file isn't saved twice. */
    val savedCourseFingerprint: String? = null,
    /**
     * The course was saved again (`PUT …/course`), which drops the estimate the history step
     * attached: the history step runs again, a relaunch included.
     */
    val historyRedo: Boolean = false
) {
    fun toJson(): String = JSONObject()
        .put("roomId", roomId ?: JSONObject.NULL)
        .put("displayName", displayName)
        .put("raceName", raceName ?: JSONObject.NULL)
        .put("courseFileName", courseFileName ?: JSONObject.NULL)
        .put("courseConfirmed", courseConfirmed)
        .put("plannedPaceSecondsPerKm", plannedPaceSecondsPerKm ?: JSONObject.NULL)
        .put("start", start?.toJson() ?: JSONObject.NULL)
        .put("historyLine", historyLine ?: JSONObject.NULL)
        .put("historyAttached", historyAttached)
        .put("historyImported", historyImported)
        .put("courseUnsaved", courseUnsaved ?: JSONObject.NULL)
        .put("savedRaceStartAt", savedRaceStartAt ?: JSONObject.NULL)
        .put("courseFingerprint", courseFingerprint ?: JSONObject.NULL)
        .put("savedCourseFingerprint", savedCourseFingerprint ?: JSONObject.NULL)
        .put("historyRedo", historyRedo)
        .toString()

    companion object {
        fun from(raw: String?): RunnerSetupDraft? {
            if (raw.isNullOrBlank()) return null
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
            return RunnerSetupDraft(
                roomId = json.optText("roomId").ifBlank { null },
                displayName = json.optText("displayName"),
                // As typed, spaces included: only an empty name is none.
                raceName = json.optText("raceName").ifEmpty { null },
                courseFileName = json.optText("courseFileName").ifBlank { null },
                courseConfirmed = json.optBoolean("courseConfirmed"),
                plannedPaceSecondsPerKm = json.optDouble("plannedPaceSecondsPerKm", Double.NaN).takeIf { !it.isNaN() && it > 0 },
                start = RaceStartFields.from(json.optJSONObject("start")),
                historyLine = json.optText("historyLine").ifBlank { null },
                historyAttached = json.optBoolean("historyAttached"),
                historyImported = json.optBoolean("historyImported"),
                courseUnsaved = if (json.has("courseUnsaved") && !json.isNull("courseUnsaved")) json.optBoolean("courseUnsaved") else null,
                savedRaceStartAt = json.optText("savedRaceStartAt").ifBlank { null },
                courseFingerprint = json.optText("courseFingerprint").ifBlank { null },
                savedCourseFingerprint = json.optText("savedCourseFingerprint").ifBlank { null },
                historyRedo = json.optBoolean("historyRedo")
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
