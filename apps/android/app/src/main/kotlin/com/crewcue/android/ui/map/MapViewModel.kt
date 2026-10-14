package com.crewcue.android.ui.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crewcue.android.data.RaceDayBridge
import com.crewcue.android.data.RuntimeResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class MapViewModel(
    private val raceDay: RaceDayBridge,
    private val roomId: String,
    private val role: String
) : ViewModel() {
    var checkpoints by mutableStateOf<List<MapCheckpoint>>(emptyList())
        private set
    var aidPages by mutableStateOf<List<AidPage>>(emptyList())
        private set
    var aidIndex by mutableStateOf(0)
        private set
    var aidLiveNext by mutableStateOf<Int?>(null)
        private set
    var aidFollow by mutableStateOf(true)
        private set
    var line by mutableStateOf<List<CoursePoint>>(emptyList())
        private set
    var courseStatus by mutableStateOf<String?>(null)
        private set
    var mapStatus by mutableStateOf<String?>(null)
        private set
    var pickLatitude by mutableStateOf("")
        private set
    var pickLongitude by mutableStateOf("")
        private set
    var pickTitle by mutableStateOf("")
        private set
    var pickMessage by mutableStateOf(PICK_EMPTY)
        private set
    var pickBusy by mutableStateOf(false)
        private set
    var destinationId by mutableStateOf<String?>(null)
        private set
    var navigateMessage by mutableStateOf(NAV_EMPTY)
        private set
    var navigateBusy by mutableStateOf(false)
        private set
    var locationMessage by mutableStateOf(LOCATION_EMPTY)
        private set

    private var lastRecordedMillis = 0L
    private var scheduleSheet: JSONObject? = null
    private var sampleLatitude: Double? = null
    private var sampleLongitude: Double? = null
    private val recordedAtFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun load() {
        viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { raceDay.loadRoom(roomId) }
            } catch (_: Throwable) {
                courseStatus = MAP_ERROR
                return@launch
            }
            when (result) {
                is RuntimeResult.Failure -> courseStatus = if (result.offline) MAP_OFFLINE else MAP_ERROR
                is RuntimeResult.Success -> {
                    applyRoom(result.result)
                    loadAidSheet()
                }
            }
        }
    }

    fun showAid(index: Int) {
        aidIndex = index
        aidFollow = aidLiveNext != null && index == aidLiveNext
        projectAid()
    }

    fun jumpToNextAid() {
        aidFollow = true
        projectAid()
    }

    fun onStyleReady() {
        mapStatus = null
    }

    fun onStyleFailed() {
        if (mapStatus != MAP_OFFLINE) mapStatus = MAP_ERROR
    }

    fun onTilesUnavailable() {
        mapStatus = MAP_OFFLINE
    }

    fun onMapTap(latitude: Double, longitude: Double) {
        pickLatitude = String.format(Locale.US, "%.6f", latitude)
        pickLongitude = String.format(Locale.US, "%.6f", longitude)
        pickMessage = PICK_SUCCESS
    }

    fun updatePickLatitude(value: String) {
        pickLatitude = value
    }

    fun updatePickLongitude(value: String) {
        pickLongitude = value
    }

    fun updatePickTitle(value: String) {
        pickTitle = value
    }

    fun chooseDestination(id: String) {
        destinationId = id
        if (navigateMessage == NAV_EMPTY) {
            navigateMessage = checkpoints.firstOrNull { it.id == id }?.title ?: id
        }
    }

    fun saveCheckpoint() {
        val latitude = pickLatitude.trim().toDoubleOrNull()
        val longitude = pickLongitude.trim().toDoubleOrNull()
        if (latitude == null || longitude == null) {
            pickMessage = PICK_EMPTY
            return
        }
        val title = pickTitle.trim().ifBlank { "Checkpoint" }
        val id = "cp-${System.nanoTime()}"
        viewModelScope.launch {
            pickBusy = true
            try {
                val result = try {
                    withContext(Dispatchers.IO) {
                        raceDay.placeCheckpoint(roomId, id, title, latitude, longitude)
                    }
                } catch (_: Throwable) {
                    pickMessage = PICK_ERROR
                    return@launch
                }
                pickMessage = when {
                    result.isOfflineResult() -> PICK_OFFLINE
                    result is RuntimeResult.Success -> {
                        load()
                        PICK_SUCCESS
                    }
                    else -> PICK_ERROR
                }
            } finally {
                pickBusy = false
            }
        }
    }

    fun startRoute(mode: String) {
        val destination = destinationId
        if (destination.isNullOrBlank()) {
            navigateMessage = NAV_EMPTY
            return
        }
        val origin = checkpoints.firstOrNull { it.id != destination }?.id
        if (origin == null) {
            navigateMessage = NAV_ERROR
            return
        }
        viewModelScope.launch {
            navigateBusy = true
            try {
                val result = try {
                    withContext(Dispatchers.IO) {
                        raceDay.route(roomId, mode, listOf(origin, destination))
                    }
                } catch (_: Throwable) {
                    navigateMessage = NAV_ERROR
                    return@launch
                }
                navigateMessage = when {
                    result.isOfflineResult() -> NAV_OFFLINE
                    result is RuntimeResult.Success -> distanceMessage(result.result)
                    else -> NAV_ERROR
                }
            } finally {
                navigateBusy = false
            }
        }
    }

    fun permissionDenied() {
        locationMessage = LOCATION_DENIED
    }

    fun locationMissing() {
        if (locationMessage != LOCATION_DENIED) locationMessage = LOCATION_EMPTY
    }

    fun onSample(latitude: Double, longitude: Double, accuracy: Double?, online: Boolean) {
        sampleLatitude = latitude
        sampleLongitude = longitude
        projectAid()
        if (role != "athlete") {
            locationMessage = String.format(Locale.US, "%.6f, %.6f", latitude, longitude)
            return
        }
        viewModelScope.launch {
            val recordedAt = nextRecordedAt()
            val enqueued = try {
                withContext(Dispatchers.IO) {
                    raceDay.enqueuePing(roomId, latitude, longitude, recordedAt, accuracy)
                }
            } catch (_: Throwable) {
                locationMessage = if (online) LOCATION_EMPTY else LOCATION_OFFLINE
                return@launch
            }
            if (enqueued is RuntimeResult.Failure && enqueued.message.contains("increase")) {
                val retry = try {
                    withContext(Dispatchers.IO) {
                        raceDay.enqueuePing(roomId, latitude, longitude, nextRecordedAt(), accuracy)
                    }
                } catch (_: Throwable) {
                    locationMessage = if (online) LOCATION_EMPTY else LOCATION_OFFLINE
                    return@launch
                }
                applyPing(retry, online)
                return@launch
            }
            applyPing(enqueued, online)
        }
    }

    private suspend fun applyPing(result: RuntimeResult, online: Boolean) {
        when (result) {
            is RuntimeResult.Failure -> {
                locationMessage = when {
                    result.message.contains("athlete") -> locationMessage
                    !online || result.offline -> LOCATION_OFFLINE
                    else -> result.message.ifBlank { LOCATION_EMPTY }
                }
            }
            is RuntimeResult.Success -> {
                val flushed = try {
                    withContext(Dispatchers.IO) { raceDay.flushOutbox() }
                } catch (_: Throwable) {
                    null
                }
                val flushOffline = flushed is RuntimeResult.Failure && flushed.offline
                locationMessage = if (!online || flushOffline) LOCATION_OFFLINE else LOCATION_QUEUED
            }
        }
    }

    private fun applyRoom(result: JSONObject) {
        if (result.optBoolean("offline")) {
            checkpoints = emptyList()
            line = emptyList()
            courseStatus = MAP_OFFLINE
            return
        }
        val parsedCheckpoints = parseCheckpoints(result.optJSONArray("checkpoints"))
        val parsedLine = parseLine(result.optJSONArray("line"))
        checkpoints = parsedCheckpoints
        line = parsedLine
        if (destinationId != null && parsedCheckpoints.none { it.id == destinationId }) {
            destinationId = null
            navigateMessage = NAV_EMPTY
        }
        courseStatus = if (parsedCheckpoints.isEmpty() && parsedLine.size < 2) MAP_EMPTY else null
    }

    private fun loadAidSheet() {
        viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) { raceDay.loadSchedule(roomId) }
            } catch (_: Throwable) {
                return@launch
            }
            if (result is RuntimeResult.Success) {
                scheduleSheet = result.result.optJSONObject("sheet")
                projectAid()
            }
        }
    }

    private fun projectAid() {
        val sheet = scheduleSheet
        val checkpoints = checkpointPayload()
        val latitude = sampleLatitude
        val longitude = sampleLongitude
        val index = aidIndex
        val follow = aidFollow
        viewModelScope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    raceDay.projectAidSheet(sheet, checkpoints, latitude, longitude, index, follow)
                }
            } catch (_: Throwable) {
                return@launch
            }
            if (result is RuntimeResult.Success) applyAid(result.result)
        }
    }

    private fun checkpointPayload(): JSONArray {
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

    private fun applyAid(payload: JSONObject) {
        val rows = payload.optJSONArray("pages")
        val pages = mutableListOf<AidPage>()
        if (rows != null) {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                pages += AidPage(
                    checkpointId = row.optString("checkpointId"),
                    index = row.optInt("index", index),
                    title = row.optString("title"),
                    kicker = row.optString("kicker"),
                    clockLabel = row.optString("clockLabel"),
                    remainLabel = row.optString("remainLabel"),
                    distanceLabel = row.optString("distanceLabel"),
                    stoppageLabel = row.optString("stoppageLabel"),
                    delayLabel = row.optString("delayLabel").ifBlank { null },
                    scheduleLine = row.optString("scheduleLine")
                )
            }
        }
        aidPages = pages
        aidIndex = payload.optInt("selectedIndex", 0)
        aidLiveNext = if (payload.isNull("liveNextIndex")) null else payload.optInt("liveNextIndex")
    }

    private fun parseCheckpoints(array: JSONArray?): List<MapCheckpoint> {
        if (array == null) return emptyList()
        val rows = mutableListOf<MapCheckpoint>()
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            val id = row.optString("id")
            val latitude = row.optDouble("latitude", Double.NaN)
            val longitude = row.optDouble("longitude", Double.NaN)
            if (id.isBlank() || latitude.isNaN() || longitude.isNaN()) continue
            val title = row.optString("title").ifBlank { id }
            val distance = if (row.has("distanceMetersFromStart")) row.optDouble("distanceMetersFromStart") else null
            val stoppage = if (row.has("plannedStopSeconds")) row.optDouble("plannedStopSeconds") else null
            rows += MapCheckpoint(id, title, latitude, longitude, distance, stoppage)
        }
        return rows
    }

    private fun parseLine(array: JSONArray?): List<CoursePoint> {
        if (array == null) return emptyList()
        val points = mutableListOf<CoursePoint>()
        for (index in 0 until array.length()) {
            val pair = array.optJSONArray(index) ?: continue
            if (pair.length() < 2) continue
            val longitude = pair.optDouble(0, Double.NaN)
            val latitude = pair.optDouble(1, Double.NaN)
            if (latitude.isNaN() || longitude.isNaN()) continue
            points += CoursePoint(latitude, longitude)
        }
        return points
    }

    private fun distanceMessage(result: JSONObject): String {
        val meters = when {
            result.has("distanceMeters") -> result.optDouble("distanceMeters", Double.NaN)
            else -> result.optJSONObject("route")?.optDouble("distanceMeters", Double.NaN) ?: Double.NaN
        }
        if (meters.isNaN()) return "Navigate."
        val miles = meters / 1609.344
        return "Navigate. ${String.format(Locale.US, "%.1f mi", miles)} to the next aid."
    }

    private fun nextRecordedAt(): String {
        var millis = System.currentTimeMillis()
        if (millis <= lastRecordedMillis) millis = lastRecordedMillis + 1
        lastRecordedMillis = millis
        return recordedAtFormat.format(millis)
    }

    private fun RuntimeResult.isOfflineResult(): Boolean = when (this) {
        is RuntimeResult.Failure -> offline
        is RuntimeResult.Success -> result.optBoolean("offline")
    }
}

class MapViewModelFactory(
    private val raceDay: RaceDayBridge,
    private val roomId: String,
    private val role: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return MapViewModel(raceDay, roomId, role) as T
    }
}
