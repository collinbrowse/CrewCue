package com.crewcue.android.ui.pace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.data.pendingWork
import com.crewcue.android.data.stopLines
import com.crewcue.android.ui.map.TimelineRow
import com.crewcue.android.ui.onboarding.TeaserRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class PaceStop(
    val id: String,
    val title: String,
    val arrival: String,
    val elapsed: String,
    val moving: String?,
    val waited: String?,
    val stoppage: String,
    val delay: String?,
    val line: String,
    /** Dwell rail label for the planned stop, e.g. "5 MIN STOP". */
    val stopLabel: String = "",
    /** "RACE 1:10:00": the planned race time at arrival, from client-core. */
    val raceTime: String = "",
    /** "Planned arrival 2:10 PM, 1 hour 10 minutes into the race". */
    val plannedArrivalSpoken: String = ""
)

/** One checkpoint row in Pace edit mode (#250). Values come from client-core `StopPlanDraft`. */
data class StopEditRow(
    val checkpointId: String,
    val title: String,
    val minutesText: String,
    val editable: Boolean,
    val changed: Boolean,
    val error: String?,
    val savedLabel: String,
    val stopLabel: String
)

class PaceViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String,
    /**
     * The onboarding replay: the estimate and the schedule only. No recompute, no check-in, no
     * course file, stop or settings edits, no outbox: nothing here ever writes.
     */
    val readOnly: Boolean = false
) : ViewModel() {
    var scheduleMessage by mutableStateOf<String?>(null)
        private set
    var scheduleLines by mutableStateOf<List<String>>(emptyList())
        private set
    var scheduleStops by mutableStateOf<List<PaceStop>>(emptyList())
        private set
    /** The checkpoints an unpaid race withholds (`sheet.locked.checkpointIds`), in course order. */
    var lockedIds by mutableStateOf<List<String>>(emptyList())
        private set
    var checkInOpen by mutableStateOf(false)
        private set
    var estimateMessage by mutableStateOf<String?>(null)
        private set
    val showsColdStart: Boolean
        get() = estimateMessage == COLD_START
    var estimateDetail by mutableStateOf<String?>(null)
        private set
    var mayRecalculate by mutableStateOf(false)
        private set
    var estimateBusy by mutableStateOf(false)
        private set
    var checkpointId by mutableStateOf("")
        private set
    var arrival by mutableStateOf("")
        private set
    var departure by mutableStateOf("")
        private set
    var checkInMessage by mutableStateOf<String?>(null)
        private set
    var checkInBusy by mutableStateOf(false)
        private set
    var gpxText by mutableStateOf("")
        private set
    var gpxFileName by mutableStateOf("route.gpx")
        private set
    var gpxMessage by mutableStateOf(GPX_EMPTY)
        private set
    var gpxBusy by mutableStateOf(false)
        private set
    var exportText by mutableStateOf<String?>(null)
        private set
    /** The crew sheet as table rows (stop, due time, race time) from client-core. */
    var crewSheetRows by mutableStateOf<List<CrewSheetRow>>(emptyList())
        private set
    /** Heads the shared crew sheet text; the screen sets it from the selected race. */
    var raceName = ""
    var exportMessage by mutableStateOf<String?>(null)
        private set
    var courseMessage by mutableStateOf<String?>(null)
        private set
    /** One sentence about the aid station stops (client-core `RaceToolsCopy.courseReadout`). */
    var stopSummary by mutableStateOf<String?>(null)
        private set
    /** Each aid stop, only when they differ: title to duration. */
    var courseStopRows by mutableStateOf<List<Pair<String, String>>>(emptyList())
        private set
    var cutoffLines by mutableStateOf<List<String>>(emptyList())
        private set
    /** Checkpoint titles by id, for the course readout and crew sheet; set with [noteCourseTitles]. */
    var courseTitles: Map<String, String> = emptyMap()
        private set
    /** The schedule's last read, so new titles rebuild the crew sheet and readout without a reload. */
    private var scheduleRead: Pair<Boolean, Boolean>? = null

    /**
     * The race's checkpoints loaded (or one was added on the map): name the crew sheet's and the
     * course readout's stops by title, not by id. Both rebuild from the cached schedule.
     */
    fun noteCourseTitles(titles: Map<String, String>) {
        if (titles == courseTitles) return
        courseTitles = titles
        val read = scheduleRead ?: return
        if (readOnly) return
        viewModelScope.launch {
            val exported = withContext(Dispatchers.IO) { raceDay.exportCrewSheet(roomId, raceName, titles) }
            applyExport(exported, scheduleOffline = read.first, scheduleFailed = read.second)
            loadCourseReadout(read.first)
        }
    }
    var mayEditStops by mutableStateOf(false)
        private set
    var stopEditing by mutableStateOf(false)
        private set
    var stopRows by mutableStateOf<List<StopEditRow>>(emptyList())
        private set
    /** Timeline rendered from the draft while editing; null otherwise. */
    var stopTimeline by mutableStateOf<List<TimelineRow>?>(null)
        private set
    var stopCanSave by mutableStateOf(false)
        private set
    var stopBusy by mutableStateOf(false)
        private set
    var stopMessage by mutableStateOf<String?>(null)
        private set
    var outboxMessage by mutableStateOf<String?>(null)
        private set
    var outboxLines by mutableStateOf<List<String>>(emptyList())
        private set

    private var raceStartAt = ""
    private var scheduleSheet: JSONObject? = null
    private var stopCheckpoints = JSONArray()
    private var stopProgressMeters = 0.0
    private val stopMinutes = mutableMapOf<String, String>()
    private var stopEdits = JSONArray()
    private var plannedPace: Double? = null
    private var historyFingerprint: String? = null
    private var usableHistoryCount = 0
    private var checkpointEdited = false
    private val estimateGate = Mutex()
    private var loadJob: Job? = null

    fun load() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (readOnly) {
                // The replay shows the estimate and the schedule; it has no tools, so no crew
                // sheet, course settings or outbox to read.
                launch { applySchedule(withContext(Dispatchers.IO) { raceDay.loadSchedule(roomId) }) }
                launch { refreshEstimate(explicit = false) }
                return@launch
            }
            launch { loadScheduleAndExport() }
            launch { refreshEstimate(explicit = false) }
            launch { refreshOutbox() }
        }
    }

    fun updateCheckpoint(value: String) {
        checkpointEdited = true
        checkpointId = value
    }

    fun updateArrival(value: String) {
        arrival = value
    }

    fun updateDeparture(value: String) {
        departure = value
    }

    fun updateGpxText(value: String) {
        gpxText = value
        if (value.isBlank()) gpxMessage = GPX_EMPTY
    }

    /** The room has an attached estimate. Sent with each compute so client-core can check the trigger. */
    private var hasPlanOfRecord = false

    fun recalculate() {
        if (readOnly) return
        viewModelScope.launch { refreshEstimate(explicit = true) }
    }

    fun submitCheckIn() {
        if (readOnly) return
        viewModelScope.launch {
            checkInBusy = true
            try {
                val enqueued = withContext(Dispatchers.IO) {
                    raceDay.enqueueCheckIn(roomId, checkpointId.trim(), arrival.trim(), departure.trim())
                }
                checkInMessage = when (enqueued) {
                    is RuntimeResult.Failure -> checkInFailure(enqueued)
                    is RuntimeResult.Success -> {
                        val flushed = withContext(Dispatchers.IO) { raceDay.flushOutbox() }
                        refreshOutbox()
                        flushMessage(flushed)
                    }
                }
            } finally {
                checkInBusy = false
            }
        }
    }

    fun importGpx(fileName: String, xml: String) {
        if (readOnly) return
        gpxFileName = fileName.ifBlank { "route.gpx" }
        viewModelScope.launch { sendGpx(xml) }
    }

    fun importPastedGpx() {
        if (readOnly) return
        viewModelScope.launch { sendGpx(gpxText) }
    }

    fun gpxUnreadable() {
        gpxMessage = GPX_ERROR
    }

    /**
     * Opens planned-stop editing. `passedIds` are the checkpoints the runner has passed (timeline
     * rows marked done); they stay locked, like the start and finish.
     */
    fun beginStopEdit(passedIds: Set<String>) {
        if (readOnly || !mayEditStops || stopBusy) return
        viewModelScope.launch {
            val room = withContext(Dispatchers.IO) { raceDay.loadRoom(roomId) }
            if (room !is RuntimeResult.Success) {
                stopMessage = if (room is RuntimeResult.Failure && room.offline) STOPS_OFFLINE else STOPS_ERROR
                return@launch
            }
            val checkpoints = room.result.optJSONArray("checkpoints") ?: JSONArray()
            stopCheckpoints = checkpoints
            stopProgressMeters = passedDistance(checkpoints, passedIds)
            stopMinutes.clear()
            stopMessage = null
            stopEditing = true
            projectStops()
        }
    }

    /**
     * The athlete's ping timeline marked more checkpoints passed. While editing, lock them (the draft is
     * rebuilt from the larger progress, so their typed minutes are dropped). Progress never goes back.
     */
    fun runnerPassed(passedIds: Set<String>) {
        if (!stopEditing) return
        val progress = passedDistance(stopCheckpoints, passedIds)
        if (progress <= stopProgressMeters) return
        stopProgressMeters = progress
        viewModelScope.launch { projectStops() }
    }

    fun cancelStopEdit() {
        if (stopBusy) return
        stopEditing = false
        stopTimeline = null
        stopRows = emptyList()
        stopMinutes.clear()
        stopMessage = null
    }

    fun updateStopMinutes(checkpointId: String, text: String) {
        stopMinutes[checkpointId] = text
        viewModelScope.launch { projectStops() }
    }

    fun stepStop(checkpointId: String, deltaMinutes: Int) {
        viewModelScope.launch { projectStops(stepCheckpointId = checkpointId, stepMinutes = deltaMinutes) }
    }

    /** Sends only the changed stops. On failure the draft stays open so nothing typed is lost. */
    fun saveStops() {
        if (readOnly || !stopCanSave || stopBusy) return
        viewModelScope.launch {
            stopBusy = true
            try {
                val result = withContext(Dispatchers.IO) { raceDay.updatePlannedStops(roomId, stopEdits) }
                when (result) {
                    is RuntimeResult.Failure -> stopMessage = if (result.offline) STOPS_OFFLINE else STOPS_ERROR
                    is RuntimeResult.Success -> {
                        stopMessage = result.result.optString("message").ifBlank { null }
                        if (result.result.optBoolean("saved")) {
                            stopEditing = false
                            stopTimeline = null
                            stopRows = emptyList()
                            stopMinutes.clear()
                            loadScheduleAndExport()
                        }
                    }
                }
            } finally {
                stopBusy = false
            }
        }
    }

    private suspend fun projectStops(stepCheckpointId: String? = null, stepMinutes: Int = 0) {
        if (!stopEditing) return
        val minutes = stopMinutes.toMap()
        val result = withContext(Dispatchers.IO) {
            raceDay.stopPlanDraft(stopCheckpoints, scheduleSheet, stopProgressMeters, minutes, stepCheckpointId, stepMinutes)
        }
        if (result !is RuntimeResult.Success || !stopEditing) return
        val json = result.result
        val rows = json.optJSONArray("rows") ?: JSONArray()
        stopRows = buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                add(
                    StopEditRow(
                        checkpointId = row.optString("checkpointId"),
                        title = row.optString("title"),
                        minutesText = row.optString("minutesText"),
                        editable = row.optBoolean("editable"),
                        changed = row.optBoolean("changed"),
                        error = row.optString("error").ifBlank { null },
                        savedLabel = row.optString("savedLabel"),
                        stopLabel = row.optString("stopLabel")
                    )
                )
            }
        }
        // A stepper tap changes the field text; keep the map in step with what the draft shows.
        if (stepCheckpointId != null) {
            stopRows.firstOrNull { it.checkpointId == stepCheckpointId }?.let { stopMinutes[stepCheckpointId] = it.minutesText }
        }
        stopTimeline = json.optJSONArray("timeline")?.let(::parseTimeline)
        stopCanSave = json.optBoolean("canSave")
        stopEdits = json.optJSONArray("edits") ?: JSONArray()
    }

    private fun passedDistance(checkpoints: JSONArray, passedIds: Set<String>): Double {
        var farthest = 0.0
        for (index in 0 until checkpoints.length()) {
            val row = checkpoints.optJSONObject(index) ?: continue
            if (row.optString("id") !in passedIds) continue
            val distance = row.optDouble("distanceMetersFromStart", 0.0)
            if (distance.isFinite() && distance > farthest) farthest = distance
        }
        return farthest
    }

    private fun parseTimeline(array: JSONArray): List<TimelineRow> = buildList {
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            add(
                TimelineRow(
                    checkpointId = row.optString("checkpointId"),
                    state = row.optString("state", "projected"),
                    kicker = row.optString("kicker"),
                    title = row.optString("title"),
                    clockArrivalAt = row.optString("clockArrivalAt").ifBlank { null },
                    cutoffAt = row.optString("cutoffAt").ifBlank { null },
                    cutoffStatus = row.optString("cutoffStatus").ifBlank { null },
                    distanceToLabel = row.optString("distanceToLabel", "—"),
                    isFinish = row.optBoolean("isFinish")
                )
            )
        }
    }

    private suspend fun loadScheduleAndExport() {
        val result = withContext(Dispatchers.IO) { raceDay.loadSchedule(roomId) }
        val offline = applySchedule(result)
        val failed = result is RuntimeResult.Failure && !offline
        scheduleRead = offline to failed
        val exported = withContext(Dispatchers.IO) { raceDay.exportCrewSheet(roomId, raceName, courseTitles) }
        applyExport(exported, scheduleOffline = offline, scheduleFailed = failed)
        loadCourseReadout(offline)
    }

    private fun applySchedule(result: RuntimeResult): Boolean {
        when (result) {
            is RuntimeResult.Failure -> {
                scheduleLines = emptyList()
                scheduleStops = emptyList()
                lockedIds = emptyList()
                scheduleMessage = if (result.offline) SCHEDULE_OFFLINE else SCHEDULE_ERROR
                return result.offline
            }
            is RuntimeResult.Success -> {
                val json = result.result
                val parsed = json.stopLines()
                val start = json.optString("raceStartAt").ifBlank {
                    json.optJSONObject("sheet")?.optString("raceStartAt").orEmpty()
                }
                if (start.isNotBlank()) raceStartAt = start
                json.optJSONObject("sheet")?.let { scheduleSheet = it }
                mayEditStops = !readOnly && json.optBoolean("mayEditCourse") && parsed.first.isNotEmpty()
                lockedIds = TeaserRow.lockedIds(json)
                scheduleLines = parsed.first
                scheduleStops = paceStops(json)
                if (!checkpointEdited) {
                    checkpointId = parsed.second.firstOrNull().orEmpty()
                }
                val offline = json.optBoolean("offline")
                scheduleMessage = when {
                    offline -> SCHEDULE_OFFLINE_CACHED
                    parsed.first.isEmpty() -> SCHEDULE_EMPTY
                    else -> null
                }
                return offline
            }
        }
    }

    private suspend fun refreshEstimate(explicit: Boolean) {
        estimateGate.withLock {
            estimateBusy = true
            try {
                if (!explicit) {
                    val loaded = withContext(Dispatchers.IO) { raceDay.loadEstimate(roomId) }
                    applyEstimate(loaded)
                    val shouldCompute = loaded is RuntimeResult.Success && loaded.result.optBoolean("recompute")
                    // The replay never recomputes: its estimate is the race's, as loaded.
                    if (!shouldCompute || readOnly) return@withLock
                }
                // Only the athlete's history recomputes automatically; a tap is an explicit Recalculate.
                val trigger = if (explicit) "recalculate" else "auto"
                val computed = withContext(Dispatchers.IO) {
                    raceDay.computeEstimate(roomId, historyFingerprint, usableHistoryCount, trigger, hasPlanOfRecord)
                }
                applyEstimate(computed)
            } finally {
                estimateBusy = false
            }
        }
    }

    private fun applyEstimate(result: RuntimeResult) {
        when (result) {
            is RuntimeResult.Failure -> {
                estimateMessage = if (result.offline) ESTIMATE_OFFLINE else ESTIMATE_ERROR
                if (!result.offline) estimateDetail = null
            }
            is RuntimeResult.Success -> applyEstimate(result.result)
        }
    }

    private fun applyEstimate(json: JSONObject) {
        mayRecalculate = mayShowRecalculate(json)
        val fingerprint = json.optString("historyFingerprint")
        if (fingerprint.isNotBlank()) historyFingerprint = fingerprint
        if (json.has("usableHistoryCount")) usableHistoryCount = json.optInt("usableHistoryCount")
        val start = json.optString("raceStartAt")
        if (start.isNotBlank()) raceStartAt = start
        val pace = json.optDouble("plannedPaceSecondsPerKm", Double.NaN)
        if (!pace.isNaN() && pace > 0) plannedPace = pace
        val summary = json.optString("summary").ifBlank { null }
        if (json.optBoolean("offline")) {
            estimateMessage = ESTIMATE_OFFLINE
            estimateDetail = summary ?: estimateDetail
            return
        }
        val hasEstimate = json.optBoolean("hasEstimate")
        hasPlanOfRecord = hasEstimate
        val copy = estimateCopy(hasEstimate, json.optBoolean("coldStart"), usableHistoryCount, summary)
        estimateMessage = copy.first
        estimateDetail = copy.second
    }

    private suspend fun sendGpx(xml: String) {
        if (xml.isBlank()) {
            gpxMessage = GPX_EMPTY
            return
        }
        gpxBusy = true
        gpxMessage = "Calculating race splits…"
        try {
            val result = withContext(Dispatchers.IO) {
                raceDay.importGpx(roomId, gpxFileName, xml, raceStartAt, plannedPace)
            }
            gpxMessage = when (result) {
                is RuntimeResult.Failure -> if (result.offline) GPX_OFFLINE else GPX_ERROR
                is RuntimeResult.Success -> when (result.result.optString("status")) {
                    "saved" -> GPX_SUCCESS
                    "queued" -> GPX_OFFLINE
                    else -> GPX_EMPTY
                }
            }
            if (gpxMessage == GPX_OFFLINE || gpxMessage == GPX_SUCCESS) refreshOutbox()
        } finally {
            gpxBusy = false
        }
    }

    private fun applyExport(result: RuntimeResult, scheduleOffline: Boolean, scheduleFailed: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> {
                exportText = null
                crewSheetRows = emptyList()
                exportMessage = if (result.offline) EXPORT_OFFLINE else EXPORT_ERROR
            }
            is RuntimeResult.Success -> {
                val text = result.result.optString("text").ifBlank { null }
                val empty = result.result.optBoolean("empty") || text == null
                exportText = if (empty) null else text
                val rows = result.result.optJSONArray("rows")
                crewSheetRows = if (empty || rows == null) emptyList() else (0 until rows.length()).mapNotNull { index ->
                    rows.optJSONObject(index)?.let {
                        CrewSheetRow(it.optString("title"), it.optString("arrival"), it.optString("elapsed"))
                    }
                }
                exportMessage = exportCopy(empty, scheduleOffline, scheduleFailed).ifBlank { null }
            }
        }
    }

    private suspend fun loadCourseReadout(offline: Boolean) {
        val result = withContext(Dispatchers.IO) { raceDay.courseReadout(roomId, courseTitles) }
        val json = (result as? RuntimeResult.Success)?.result
        if (json == null || json.optBoolean("empty")) {
            stopSummary = null
            courseStopRows = emptyList()
            cutoffLines = emptyList()
            courseMessage = if (offline) COURSE_OFFLINE_EMPTY else COURSE_EMPTY
            return
        }
        stopSummary = json.optString("summary").ifBlank { null }
        val rows = json.optJSONArray("rows")
        courseStopRows = (0 until (rows?.length() ?: 0)).mapNotNull { index ->
            rows?.optJSONObject(index)?.let { it.optString("title") to it.optString("duration") }
        }
        val cutoffs = json.optJSONArray("cutoffs")
        cutoffLines = (0 until (cutoffs?.length() ?: 0)).mapNotNull { cutoffs?.optString(it)?.ifBlank { null } }
        courseMessage = if (offline) COURSE_OFFLINE else null
    }

    private suspend fun refreshOutbox() {
        val result = withContext(Dispatchers.IO) { raceDay.listOutbox() }
        val status = result.pendingWork()
        outboxMessage = status.message
        outboxLines = status.lines
    }

    private fun checkInFailure(result: RuntimeResult.Failure): String {
        if (result.message == CHECKIN_EMPTY || result.message == CHECKIN_ERROR || result.message == CHECKIN_INVALID) {
            return result.message
        }
        if (result.offline) return CHECKIN_OFFLINE
        return CHECKIN_INVALID
    }

    private fun flushMessage(result: RuntimeResult): String {
        if (result is RuntimeResult.Failure) {
            return if (result.offline) CHECKIN_OFFLINE else CHECKIN_SUCCESS
        }
        val json = (result as RuntimeResult.Success).result
        val rejected = json.optJSONArray("rejected")
        val pending = json.optJSONArray("pending")
        if (rejected != null && rejected.length() > 0) return "Rejected by server policy."
        if (pending != null && pending.length() > 0) return CHECKIN_OFFLINE
        return CHECKIN_SUCCESS
    }

    fun openCheckIn(checkpoint: String) {
        val trimmed = checkpoint.trim()
        if (trimmed.isEmpty()) return
        checkpointId = trimmed
        checkInOpen = true
    }

    private fun paceStops(json: JSONObject): List<PaceStop> {
        val pages = json.optJSONObject("aidSheet")?.optJSONArray("pages") ?: return emptyList()
        return buildList {
            for (index in 0 until pages.length()) {
                val page = pages.optJSONObject(index) ?: continue
                val id = page.optString("checkpointId")
                if (id.isBlank()) continue
                add(
                    PaceStop(
                        id = id,
                        title = "${index + 1}. ${page.optString("title")}",
                        arrival = page.optString("clockLabel"),
                        elapsed = page.optString("elapsedLabel").ifBlank { "—" },
                        moving = page.optString("movingLabel").ifBlank { null },
                        waited = page.optString("waitedLabel").ifBlank { null },
                        stoppage = page.optString("stoppageDurationLabel").ifBlank { page.optString("stoppageLabel") },
                        delay = page.optString("delayLabel").ifBlank { null },
                        line = page.optString("scheduleLine"),
                        stopLabel = json.optJSONObject("plannedStopLabels")?.optString(id).orEmpty(),
                        raceTime = page.optString("raceTimeCaption"),
                        plannedArrivalSpoken = page.optString("plannedArrivalSpoken")
                    )
                )
            }
        }
    }

    companion object {
        /**
         * Message for the crew sheet card. The sheet is built from the schedule saved on this device,
         * so a schedule that failed with nothing saved is an error, not an empty sheet.
         */
        fun exportCopy(empty: Boolean, scheduleOffline: Boolean, scheduleFailed: Boolean): String = when {
            empty && scheduleFailed -> EXPORT_ERROR
            empty -> EXPORT_EMPTY
            scheduleOffline -> EXPORT_OFFLINE
            else -> EXPORT_SUCCESS
        }

        /**
         * Message and detail for the estimate card. Crew never load the athlete's history, so only the
         * estimate's own cold-start flag decides whether a plan of record is a cold start.
         */
        fun estimateCopy(hasEstimate: Boolean, coldStart: Boolean, usableHistoryCount: Int, summary: String?): Pair<String, String?> =
            when {
                !hasEstimate && usableHistoryCount > 0 -> ESTIMATE_EMPTY to null
                !hasEstimate -> COLD_START to null
                coldStart -> COLD_START to summary
                else -> (summary ?: ESTIMATE_EMPTY) to null
            }

        const val SCHEDULE_EMPTY = "No stops on this sheet."
        const val SCHEDULE_ERROR = "Couldn't load the schedule."
        const val SCHEDULE_OFFLINE = "Offline. Schedule not updated."
        const val SCHEDULE_OFFLINE_CACHED = "Offline. Schedule not updated. The last sheet stays readable on this device."
        const val COLD_START = "Cold start: no history yet. Coarse estimate only."
        const val ESTIMATE_EMPTY = "No estimate yet."
        const val ESTIMATE_ERROR = "Couldn't load the pace estimate."
        const val ESTIMATE_OFFLINE = "Offline. Estimate not updated."
        const val CHECKIN_SUCCESS = "Check-in queued."
        const val CHECKIN_EMPTY = "Arrival and departure are required."
        const val CHECKIN_ERROR = "Departure must be after arrival."
        const val CHECKIN_INVALID = "Couldn't validate check-in times."
        const val CHECKIN_OFFLINE = "Offline. Check-in queued in the outbox."
        const val GPX_SUCCESS = "Calculating race splits… then the course is saved."
        const val GPX_EMPTY = "The race's .gpx route. Sets the aid stations and schedule."
        const val GPX_ERROR = "Couldn't read the route file."
        const val GPX_OFFLINE = "Offline. The file stays on this device until upload."
        const val EXPORT_SUCCESS = ""
        const val EXPORT_EMPTY = "No schedule yet. Import the course file to build one."
        const val EXPORT_ERROR = "Couldn't build the crew sheet."
        const val EXPORT_OFFLINE = "Offline. Crew sheet is ready to share from this device."
        const val COURSE_EMPTY = "No schedule yet. Import the course file to build one."
        const val COURSE_OFFLINE = "Offline. From the last schedule saved on this phone."
        const val COURSE_OFFLINE_EMPTY = "Offline. No schedule saved on this phone yet."
        // Fallbacks only; the runtime returns client-core StopPlanCopy on every save outcome.
        const val STOPS_ERROR = "Couldn't save planned stops."
        const val STOPS_OFFLINE = "Offline. Planned stops not saved. Try again when you're online."
    }
}

/** One crew sheet row as client-core `RaceToolsCopy.crewSheetRows` built it. */
data class CrewSheetRow(val title: String, val arrival: String, val elapsed: String)

class PaceViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String,
    private val readOnly: Boolean = false
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return PaceViewModel(raceDay, roomId, readOnly) as T
    }
}

/**
 * Recalculate shows for every role client-core lets ask for one (`PlanAuthority.mayExplicitRecalculate`),
 * the runner included: the runner's phone also recomputes on its own (`mayAutoRecompute`), but a
 * tap is still an explicit request (clients/behavior/pace-estimate.md).
 */
internal fun mayShowRecalculate(estimate: JSONObject): Boolean = estimate.optBoolean("mayRecalculate")
