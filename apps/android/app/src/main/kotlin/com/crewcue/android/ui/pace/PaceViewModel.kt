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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

class PaceViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModel() {
    var scheduleMessage by mutableStateOf<String?>(null)
        private set
    var scheduleLines by mutableStateOf<List<String>>(emptyList())
        private set
    var estimateMessage by mutableStateOf<String?>(null)
        private set
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
    var exportMessage by mutableStateOf<String?>(null)
        private set
    var cutoffNote by mutableStateOf("")
        private set
    var stoppageText by mutableStateOf("")
        private set
    var courseMessage by mutableStateOf<String?>(null)
        private set
    var courseBusy by mutableStateOf(false)
        private set
    var outboxMessage by mutableStateOf<String?>(null)
        private set
    var outboxLines by mutableStateOf<List<String>>(emptyList())
        private set

    private var raceStartAt = ""
    private var plannedPace: Double? = null
    private var historyFingerprint: String? = null
    private var usableHistoryCount = 0
    private var courseDirty = false
    private var checkpointEdited = false
    private val estimateGate = Mutex()
    private var loadJob: Job? = null

    fun load() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            launch { loadScheduleAndExport() }
            launch { refreshEstimate(explicit = false) }
            launch { loadCourse() }
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

    fun updateCutoff(value: String) {
        courseDirty = true
        cutoffNote = value
    }

    fun updateStoppage(value: String) {
        courseDirty = true
        stoppageText = value
    }

    fun recalculate() {
        viewModelScope.launch { refreshEstimate(explicit = true) }
    }

    fun submitCheckIn() {
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
        gpxFileName = fileName.ifBlank { "route.gpx" }
        viewModelScope.launch { sendGpx(xml) }
    }

    fun importPastedGpx() {
        viewModelScope.launch { sendGpx(gpxText) }
    }

    fun gpxUnreadable() {
        gpxMessage = GPX_ERROR
    }

    fun saveCourse() {
        val seconds = if (stoppageText.isBlank()) 0.0 else stoppageText.trim().toDoubleOrNull()
        if (seconds == null || seconds < 0.0 || !seconds.isFinite()) {
            courseMessage = COURSE_ERROR
            return
        }
        viewModelScope.launch {
            courseBusy = true
            try {
                val result = withContext(Dispatchers.IO) {
                    raceDay.writeCourseSettings(cutoffNote, seconds)
                }
                when (result) {
                    is RuntimeResult.Failure -> {
                        courseMessage = if (result.offline) COURSE_OFFLINE else COURSE_ERROR
                    }
                    is RuntimeResult.Success -> {
                        courseDirty = false
                        applyCourse(result, fromSave = true)
                    }
                }
            } finally {
                courseBusy = false
            }
        }
    }

    private suspend fun loadScheduleAndExport() {
        val result = withContext(Dispatchers.IO) { raceDay.loadSchedule(roomId) }
        val offline = applySchedule(result)
        val exported = withContext(Dispatchers.IO) { raceDay.exportCrewSheet() }
        applyExport(exported, scheduleOffline = offline)
    }

    private fun applySchedule(result: RuntimeResult): Boolean {
        when (result) {
            is RuntimeResult.Failure -> {
                scheduleLines = emptyList()
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
                scheduleLines = parsed.first
                if (!checkpointEdited) {
                    checkpointId = parsed.second.firstOrNull().orEmpty()
                }
                val offline = json.optBoolean("offline")
                scheduleMessage = when {
                    offline -> SCHEDULE_OFFLINE
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
                    if (!shouldCompute) return@withLock
                }
                val computed = withContext(Dispatchers.IO) {
                    raceDay.computeEstimate(roomId, historyFingerprint, usableHistoryCount)
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
        mayRecalculate = json.optBoolean("mayRecalculate") && !json.optBoolean("mayAutoRecompute")
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
        val cold = json.optBoolean("coldStart")
        when {
            !hasEstimate && usableHistoryCount > 0 -> {
                estimateMessage = ESTIMATE_EMPTY
                estimateDetail = null
            }
            !hasEstimate || cold || usableHistoryCount == 0 -> {
                estimateMessage = COLD_START
                estimateDetail = if (hasEstimate) summary else null
            }
            else -> {
                estimateMessage = summary ?: ESTIMATE_EMPTY
                estimateDetail = null
            }
        }
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

    private fun applyExport(result: RuntimeResult, scheduleOffline: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> {
                exportText = null
                exportMessage = if (result.offline) EXPORT_OFFLINE else EXPORT_ERROR
            }
            is RuntimeResult.Success -> {
                val text = result.result.optString("text").ifBlank { null }
                val empty = result.result.optBoolean("empty") || text == null
                if (empty) {
                    exportText = null
                    exportMessage = EXPORT_EMPTY
                } else {
                    exportText = text
                    exportMessage = if (scheduleOffline) EXPORT_OFFLINE else EXPORT_SUCCESS
                }
            }
        }
    }

    private suspend fun loadCourse() {
        val result = withContext(Dispatchers.IO) { raceDay.readCourseSettings(roomId) }
        if (courseDirty) {
            val offline = (result is RuntimeResult.Success && result.result.optBoolean("offline")) ||
                (result is RuntimeResult.Failure && result.offline)
            if (offline) courseMessage = COURSE_OFFLINE
            return
        }
        applyCourse(result, fromSave = false)
    }

    private fun applyCourse(result: RuntimeResult, fromSave: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> {
                courseMessage = if (result.offline) COURSE_OFFLINE else if (fromSave) COURSE_ERROR else COURSE_EMPTY
            }
            is RuntimeResult.Success -> {
                val json = result.result
                if (json.optBoolean("offline")) {
                    courseMessage = COURSE_OFFLINE
                }
                if (!courseDirty || fromSave) {
                    cutoffNote = json.optString("cutoffNote")
                    stoppageText = formatSeconds(json.optDouble("stoppageSeconds", 0.0))
                }
                if (fromSave) courseDirty = false
                if (!json.optBoolean("offline")) {
                    courseMessage = when {
                        fromSave && json.optBoolean("saved") -> COURSE_SUCCESS
                        json.optBoolean("empty") -> COURSE_EMPTY
                        else -> null
                    }
                }
            }
        }
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

    private fun formatSeconds(value: Double): String {
        if (!value.isFinite() || value == 0.0) return if (value == 0.0) "0" else ""
        val whole = value.toLong()
        return if (value == whole.toDouble()) whole.toString() else value.toString()
    }

    private companion object {
        const val SCHEDULE_EMPTY = "No stops on this sheet."
        const val SCHEDULE_ERROR = "Couldn't load the schedule."
        const val SCHEDULE_OFFLINE = "Offline. Schedule not updated."
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
        const val GPX_EMPTY = "Choose a route file."
        const val GPX_ERROR = "Couldn't read the route file."
        const val GPX_OFFLINE = "Offline. The file stays on this device until upload."
        const val EXPORT_SUCCESS = "Shows a plaintext crew sheet built on device."
        const val EXPORT_EMPTY = "Nothing to export."
        const val EXPORT_ERROR = "Couldn't build the crew sheet."
        const val EXPORT_OFFLINE = "Offline. Crew sheet is ready to share from this device."
        const val COURSE_SUCCESS = "Cutoff and stoppage saved as a draft."
        const val COURSE_EMPTY = "No course settings yet."
        const val COURSE_ERROR = "Couldn't save course settings."
        const val COURSE_OFFLINE = "Offline. Course settings stay on this device."
    }
}

class PaceViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return PaceViewModel(raceDay, roomId) as T
    }
}
