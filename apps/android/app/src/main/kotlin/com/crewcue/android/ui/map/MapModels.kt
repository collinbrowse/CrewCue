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
const val BATTERY_RESTRICTED = "Android may stop tracking to save battery. Set CrewCue's battery use to Unrestricted."
const val BATTERY_SETTINGS = "Open battery settings"
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
    val arrivalWindowEndAt: String? = null,
    /** client-core's clock for [clockArrivalAt] (`projectAidSheet` timeline `clockLabel`), when it sent one. */
    val clockLabel: String? = null
)

data class CoursePoint(
    val latitude: Double,
    val longitude: Double
)

/**
 * How the camera fits the course line and its checkpoints: the room left on each side, in dp,
 * whether every resize fits them again, and whether the room is cut down when the map is too small
 * for it ([shrinkToFit]).
 */
data class CourseFraming(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val refitOnResize: Boolean,
    val shrinkToFit: Boolean = false
) {
    /**
     * The room in px around the course on a [width] x [height] px map. With [shrinkToFit], two
     * opposite sides are cut down in proportion when they would leave the course less than
     * [MIN_COURSE_SHARE] of the map: room wider than the map makes MapLibre show the whole world.
     * Without it, the room as it is.
     */
    fun paddingPx(density: Float, width: Int, height: Int): CoursePadding {
        val across = room(left * density, right * density, width)
        val down = room(top * density, bottom * density, height)
        return CoursePadding(left = across.first, top = down.first, right = across.second, bottom = down.second)
    }

    private fun room(lead: Float, trail: Float, size: Int): Pair<Int, Int> {
        val most = size * (1 - MIN_COURSE_SHARE)
        val scale = if (shrinkToFit && lead + trail > most) most / (lead + trail) else 1f
        return (lead * scale).toInt() to (trail * scale).toInt()
    }

    companion object {
        /**
         * The Map screen: room for the top bar and chips above and the aid sheet below, never cut
         * down, so the course stays clear of the sheet. Fitted once, so a pan stays.
         */
        val Screen = CourseFraming(left = 48, top = 200, right = 96, bottom = 360, refitOnResize = false)

        /**
         * The onboarding replay's Map pane, below its caption: room for the chips above and the aid
         * sheet below, cut down in a short pane, and fitted again when a fold, an unfold or a resize
         * changes the pane.
         */
        val Replay = CourseFraming(left = 48, top = 150, right = 96, bottom = 280, refitOnResize = true, shrinkToFit = true)

        /**
         * A course preview card: room on every side, more below for the title under the lowest
         * marker, cut down on a small card. Fitted again after a fold, unfold or resize.
         */
        val Preview = CourseFraming(left = 24, top = 24, right = 24, bottom = 44, refitOnResize = true, shrinkToFit = true)

        /** The least of a [shrinkToFit] map's width or height the course keeps. */
        const val MIN_COURSE_SHARE = 0.4f
    }
}

/** Camera padding in px. */
data class CoursePadding(val left: Int, val top: Int, val right: Int, val bottom: Int)

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
        recenterRequest: Int,
        framing: CourseFraming,
        /** Each [track] point's `recordedAt` in epoch ms; read only with [glide]. */
        trackTimes: List<Long>,
        /**
         * The onboarding replay's gliding dot: read on every change, the dot is drawn where it says
         * and the trail up to it ([GlideLayout]). A null frame draws [track] whole with the dot on its
         * last point, as the race Map always does (it passes no [glide]).
         */
        glide: (() -> RunnerGlideFrame?)?,
        /**
         * The map finished rendering with everything loaded (MapLibre's did-finish-rendering-map,
         * fully rendered), with the course line and checkpoints it had drawn by then: a frame of
         * the course before a new one is applied names that course, not the new one. It can come
         * more than once; a map that never gets there never calls it.
         */
        onRendered: (line: List<CoursePoint>, points: List<MapCheckpoint>) -> Unit,
        /** Bumped to move the camera to the course's start (the tour's start-line card); 0 never moves. */
        startLineRequest: Int,
        /** The start-line move ran: the caller spends the request so it runs once. */
        onStartLineShown: () -> Unit
    )
}

object CourseMaps {
    @Volatile
    var renderer: CourseMapRenderer? = null
}
