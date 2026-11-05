package com.crewcue.android.ui.map

const val MAP_EMPTY = "No course on the map."
const val MAP_ERROR = "Couldn't load the map style."
const val MAP_OFFLINE = "Offline. Map tiles are unavailable."
const val PICK_SUCCESS = "Tap the map to place a checkpoint."
const val PICK_EMPTY = "No checkpoint selected."
const val PICK_ERROR = "Couldn't save the checkpoint."
const val PICK_OFFLINE = "Offline. Checkpoint placement needs the network."
const val NAV_EMPTY = "No destination."
const val NAV_ERROR = "Couldn't start navigation."
const val NAV_OFFLINE = "Offline. Navigation needs a route."
const val LOCATION_QUEUED = "Location sample sent."
const val LOCATION_EMPTY = "No location sample yet."
const val LOCATION_DENIED = "Location permission was denied. Turn it on in Settings to share your position."
const val LOCATION_OFFLINE = "Offline. Sample queued in the outbox."
const val TRACKING_ON = "Tracking. Your crew sees your position."
const val TRACKING_OFF = "Tracking stopped."
const val TRACKING_FINISHED = "Finish crossed. Tracking stopped."
const val TRACKING_CREW = "Location comes from the runner's phone. This phone never shares its own position."
const val TRACKING_BACKGROUND_DENIED = "Tracking while the app is open. Allow location \"all the time\" so it keeps going with the screen off."
/** Shown until client-core's first readout arrives; matches `RaceDayReadouts.noPingLabel`. */
const val NO_PING_LABEL = "NO PING YET"
/** Matches client-core `TrackingSettings.defaultIntervalSeconds`, until the saved value loads. */
const val DEFAULT_TRACKING_INTERVAL_SECONDS = 180
/** Used until the first `latestPing` result supplies client-core's `refreshSeconds`. */
const val DEFAULT_RUNNER_REFRESH_MS = 30_000L

data class MapCheckpoint(
    val id: String,
    val title: String,
    val latitude: Double,
    val longitude: Double,
    val distanceMetersFromStart: Double? = null,
    val plannedStopSeconds: Double? = null
)

data class AidPage(
    val checkpointId: String,
    val index: Int,
    val title: String,
    val kicker: String,
    val clockLabel: String,
    val remainLabel: String,
    val distanceLabel: String,
    val stoppageLabel: String,
    val delayLabel: String?,
    val scheduleLine: String,
    val arrivalAt: String? = null,
    val elevationLabel: String? = null,
    val stoppageDurationLabel: String = "—",
    val elapsedLabel: String = "—"
)

/** Race-wide readouts derived in client-core (`RaceDayReadouts`). */
data class RaceReadout(
    val status: String = "unknown",
    val statusLabel: String = "",
    val progressFraction: Float = 0f,
    val progressLabel: String = "—",
    val percentLabel: String = "—",
    val totalMilesLabel: String = "—",
    val currentMileLabel: String = "0.0",
    val elapsedLabel: String = "—",
    val averagePaceLabel: String = "—",
    val lastPingLabel: String? = null,
    /** `none`, `live`, or `stale`, from the athlete's latest ping. */
    val pingState: String = "none",
    val pingLabel: String = NO_PING_LABEL,
    /** Server live finish ETA (ISO 8601 UTC). Null without a live projection. */
    val finishEtaAt: String? = null,
    val finishWindowStartAt: String? = null,
    val finishWindowEndAt: String? = null,
    /** The live ETA is built on a stale ping. */
    val liveEtaStale: Boolean = false
)

/** One Pace timeline row: done, current, or projected. */
data class TimelineRow(
    val checkpointId: String,
    val state: String,
    val kicker: String,
    val title: String,
    val clockArrivalAt: String?,
    val cutoffAt: String?,
    val cutoffStatus: String?,
    val distanceToLabel: String,
    val isFinish: Boolean,
    /** Server live arrival (ISO 8601 UTC) for a stop still ahead; [clockArrivalAt] stays the plan. */
    val liveArrivalAt: String? = null,
    val arrivalWindowStartAt: String? = null,
    val arrivalWindowEndAt: String? = null
)

data class CoursePoint(
    val latitude: Double,
    val longitude: Double
)

interface CourseMapRenderer {
    @androidx.compose.runtime.Composable
    fun Render(
        points: List<MapCheckpoint>,
        line: List<CoursePoint>,
        /** The runner's path from the API, oldest first; the last point is the runner. */
        track: List<CoursePoint>,
        modifier: androidx.compose.ui.Modifier,
        onMapTap: (Double, Double) -> Unit,
        onStyleReady: () -> Unit,
        onStyleFailed: () -> Unit,
        onTilesUnavailable: () -> Unit,
        recenterRequest: Int
    )
}

object CourseMaps {
    @Volatile
    var renderer: CourseMapRenderer? = null
}
