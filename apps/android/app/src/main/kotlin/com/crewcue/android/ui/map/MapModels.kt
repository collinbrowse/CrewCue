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
const val LOCATION_QUEUED = "Location sample queued."
const val LOCATION_EMPTY = "No location sample yet."
const val LOCATION_DENIED = "Location permission was denied."
const val LOCATION_OFFLINE = "Offline. Sample queued in the outbox."

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
    val scheduleLine: String
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
        modifier: androidx.compose.ui.Modifier,
        onMapTap: (Double, Double) -> Unit,
        onStyleReady: () -> Unit,
        onStyleFailed: () -> Unit,
        onTilesUnavailable: () -> Unit
    )
}

object CourseMaps {
    @Volatile
    var renderer: CourseMapRenderer? = null
}
