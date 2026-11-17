package com.crewcue.android.ui.map

import android.content.Context
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.WellKnownTileServer
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.tile.TileOperation

/**
 * OpenFreeMap: free, keyless vector tiles (OpenStreetMap data). The style's TileJSON carries the
 * OpenFreeMap / OpenMapTiles / OpenStreetMap attribution shown by the map's attribution button.
 */
private fun styleUrl(dark: Boolean): String =
    "https://tiles.openfreemap.org/styles/" + if (dark) "dark" else "liberty"

/**
 * A local style with only a background layer. Loaded when the tile server is unreachable so the
 * course line and checkpoints still draw on a blank background.
 */
private fun blankStyleJson(dark: Boolean): String {
    val color = if (dark) "#1c1c1e" else "#f2efe9"
    return """{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"$color"}}]}"""
}

private fun Context.isDarkMode(): Boolean =
    (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES
private const val LINE_SOURCE = "crewcue-course"
private const val LINE_LAYER = "crewcue-course-line"
private const val POINT_SOURCE = "crewcue-checkpoints"
/**
 * The checkpoint titles read their own copy of the points: a title whose glyphs fail to load (no
 * network, the blank style) fails its source's tiles, and must not take the markers with it.
 */
private const val TITLE_SOURCE = "crewcue-checkpoint-titles"
/** The font both OpenFreeMap styles serve; the default font stack 404s there. */
private const val TITLE_FONT = "Noto Sans Regular"
private const val CIRCLE_LAYER = "crewcue-checkpoint-circles"
private const val TITLE_LAYER = "crewcue-checkpoint-titles"
private const val TRACK_SOURCE = "crewcue-runner-track"
private const val TRACK_LAYER = "crewcue-runner-track-line"
private const val RUNNER_SOURCE = "crewcue-runner-position"
private const val RUNNER_LAYER = "crewcue-runner-position-dot"

object MapLibreBootstrap {
    @JvmStatic
    fun install(context: Context) {
        if (!MapLibre.hasInstance()) {
            MapLibre.getInstance(context.applicationContext, "", WellKnownTileServer.MapLibre)
        }
        CourseMaps.renderer = MapLibreCourseRenderer()
    }
}

private class MapLibreCourseRenderer : CourseMapRenderer {
    @Composable
    override fun Render(
        points: List<MapCheckpoint>,
        line: List<CoursePoint>,
        track: List<CoursePoint>,
        modifier: Modifier,
        onMapTap: (Double, Double) -> Unit,
        onStyleReady: () -> Unit,
        onStyleFailed: () -> Unit,
        onTilesUnavailable: () -> Unit,
        recenterRequest: Int,
        framing: CourseFraming
    ) {
        val context = LocalContext.current
        val dark = context.isDarkMode()
        val palette = remember(dark) { CoursePalette(dark) }
        val paletteState = rememberUpdatedState(palette)
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        val tap = rememberUpdatedState(onMapTap)
        val ready = rememberUpdatedState(onStyleReady)
        val failed = rememberUpdatedState(onStyleFailed)
        val tilesUnavailable = rememberUpdatedState(onTilesUnavailable)
        val pointState = rememberUpdatedState(points)
        val lineState = rememberUpdatedState(line)
        val trackState = rememberUpdatedState(track)
        val framingState = rememberUpdatedState(framing)
        val framed = remember { booleanArrayOf(false) }
        val usingBlankStyle = remember { booleanArrayOf(false) }
        val mapView = remember(context) {
            if (!MapLibre.hasInstance()) {
                MapLibre.getInstance(context.applicationContext, "", WellKnownTileServer.MapLibre)
            }
            MapView(context).also { view ->
                view.onCreate(null)
                view.addOnDidFailLoadingMapListener { message ->
                    if (!context.isOnline() || message.looksOffline()) {
                        tilesUnavailable.value()
                    } else {
                        failed.value()
                    }
                    if (!usingBlankStyle[0]) {
                        usingBlankStyle[0] = true
                        view.getMapAsync { map ->
                            // No ready.value(): the failure message stays up over the blank map.
                            map.setStyle(Style.Builder().fromJson(blankStyleJson(dark))) { style ->
                                runCatching { draw(style, map, view, lineState.value, pointState.value, framed, framingState.value, paletteState.value) }
                                runCatching { drawTrack(style, trackState.value, paletteState.value) }
                            }
                        }
                    }
                }
                view.addOnTileActionListener { operation, _, _, _, _, _, _ ->
                    if (operation == TileOperation.Error && !context.isOnline()) {
                        tilesUnavailable.value()
                    }
                }
                view.getMapAsync { map ->
                    map.addOnMapClickListener { latLng ->
                        tap.value(latLng.latitude, latLng.longitude)
                        true
                    }
                    if (!context.isOnline()) tilesUnavailable.value()
                    map.uiSettings.isLogoEnabled = false
                    map.uiSettings.setAttributionMargins(48, 420, 0, 0)
                    map.uiSettings.attributionGravity = android.view.Gravity.TOP or android.view.Gravity.START
                    map.setStyle(Style.Builder().fromUri(styleUrl(dark))) { style ->
                        ready.value()
                        runCatching { draw(style, map, view, lineState.value, pointState.value, framed, framingState.value, paletteState.value) }
                        runCatching { drawTrack(style, trackState.value, paletteState.value) }
                    }
                }
                // A preview fits the course again after a fold, unfold or resize; the Map screen
                // only until its first fit, so a crew member's pan stays.
                view.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
                    val resized = right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop
                    if (!resized || (framed[0] && !framingState.value.refitOnResize)) return@addOnLayoutChangeListener
                    view.post {
                        if (view.isDestroyed) return@post
                        view.getMapAsync { map ->
                            if (map.style?.isFullyLoaded != true) return@getMapAsync
                            if (fitCourse(map, view, lineState.value, pointState.value, framingState.value, animate = false)) framed[0] = true
                        }
                    }
                }
            }
        }
        DisposableEffect(lifecycle, mapView) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> mapView.onStart()
                    Lifecycle.Event.ON_RESUME -> mapView.onResume()
                    Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                    Lifecycle.Event.ON_STOP -> mapView.onStop()
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            mapView.onStart()
            onDispose {
                lifecycle.removeObserver(observer)
                mapView.onPause()
                mapView.onStop()
                if (!mapView.isDestroyed) mapView.onDestroy()
            }
        }
        AndroidView(
            factory = { mapView },
            modifier = modifier.semantics { contentDescription = "Course map" },
            update = { view ->
                view.getMapAsync { map ->
                    val style = map.style ?: return@getMapAsync
                    runCatching { draw(style, map, view, line, points, framed, framing, palette) }
                    runCatching { drawTrack(style, track, palette) }
                }
            }
        )
        LaunchedEffect(recenterRequest) {
            if (recenterRequest == 0) return@LaunchedEffect
            mapView.getMapAsync { map ->
                fitCourse(map, mapView, lineState.value, pointState.value, framingState.value, animate = true)
            }
        }
    }
}

private fun draw(
    style: Style,
    map: MapLibreMap,
    view: MapView,
    line: List<CoursePoint>,
    points: List<MapCheckpoint>,
    framed: BooleanArray,
    framing: CourseFraming,
    palette: CoursePalette
) {
    if (line.size >= 2) {
        val geoJson = lineGeoJson(line)
        val existing = style.getSource(LINE_SOURCE) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(LINE_SOURCE, geoJson))
            style.addLayer(
                LineLayer(LINE_LAYER, LINE_SOURCE).withProperties(
                    PropertyFactory.lineColor(palette.line),
                    PropertyFactory.lineWidth(5f),
                    PropertyFactory.lineCap("round"),
                    PropertyFactory.lineJoin("round")
                )
            )
        } else {
            existing.setGeoJson(geoJson)
        }
    }
    if (points.isNotEmpty()) {
        val geoJson = pointGeoJson(points)
        val existing = style.getSource(POINT_SOURCE) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(POINT_SOURCE, geoJson))
            style.addSource(GeoJsonSource(TITLE_SOURCE, geoJson))
            style.addLayer(
                CircleLayer(CIRCLE_LAYER, POINT_SOURCE).withProperties(
                    PropertyFactory.circleRadius(7f),
                    PropertyFactory.circleColor(palette.marker),
                    PropertyFactory.circleStrokeColor(palette.line),
                    PropertyFactory.circleStrokeWidth(2.5f)
                )
            )
            style.addLayer(
                SymbolLayer(TITLE_LAYER, TITLE_SOURCE).withProperties(
                    PropertyFactory.textField(Expression.get("title")),
                    PropertyFactory.textFont(arrayOf(TITLE_FONT)),
                    PropertyFactory.textSize(12f),
                    PropertyFactory.textOffset(arrayOf(0f, 1.4f)),
                    PropertyFactory.textColor(palette.label),
                    PropertyFactory.textHaloColor(palette.halo),
                    PropertyFactory.textHaloWidth(2f)
                )
            )
        } else {
            existing.setGeoJson(geoJson)
            (style.getSource(TITLE_SOURCE) as? GeoJsonSource)?.setGeoJson(geoJson)
        }
    }
    // Not laid out yet, or nothing to fit: the layout listener fits it once the map has a size.
    if (!framed[0] && fitCourse(map, view, line, points, framing, animate = false)) framed[0] = true
}

/**
 * The runner's path and current position, over the course. Never moves the camera: a 30-second
 * refresh must not pull the map away from where the crew member panned it.
 */
private fun drawTrack(style: Style, track: List<CoursePoint>, palette: CoursePalette) {
    val lineJson = if (track.size >= 2) lineGeoJson(track) else EMPTY_COLLECTION
    val pathSource = style.getSource(TRACK_SOURCE) as? GeoJsonSource
    if (pathSource == null) {
        style.addSource(GeoJsonSource(TRACK_SOURCE, lineJson))
        style.addLayer(
            LineLayer(TRACK_LAYER, TRACK_SOURCE).withProperties(
                PropertyFactory.lineColor(palette.track),
                PropertyFactory.lineWidth(4f),
                PropertyFactory.lineCap("round"),
                PropertyFactory.lineJoin("round")
            )
        )
    } else {
        pathSource.setGeoJson(lineJson)
    }
    val last = track.lastOrNull()
    val dotJson = if (last == null) {
        EMPTY_COLLECTION
    } else {
        JSONObject()
            .put("type", "Feature")
            .put("properties", JSONObject().put("title", "Runner"))
            .put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray().put(last.longitude).put(last.latitude)))
            .toString()
    }
    val dotSource = style.getSource(RUNNER_SOURCE) as? GeoJsonSource
    if (dotSource == null) {
        style.addSource(GeoJsonSource(RUNNER_SOURCE, dotJson))
        style.addLayer(
            CircleLayer(RUNNER_LAYER, RUNNER_SOURCE).withProperties(
                PropertyFactory.circleRadius(9f),
                PropertyFactory.circleColor(palette.track),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(3f)
            )
        )
    } else {
        dotSource.setGeoJson(dotJson)
    }
}

private const val EMPTY_COLLECTION = """{"type":"FeatureCollection","features":[]}"""

/** Course colors on the map: Night Trail primary line, white markers with dark labels. */
private class CoursePalette(dark: Boolean) {
    /** The runner's path: the theme's secondary, so it reads apart from the course line. */
    val track = Color.parseColor(if (dark) "#ADC6FF" else "#0058BE")
    val line = Color.parseColor(if (dark) "#C9BFFF" else "#5440B9")
    val marker = Color.parseColor(if (dark) "#20201B" else "#FFFFFF")
    val label = Color.parseColor(if (dark) "#E5E2DA" else "#1C1C17")
    val halo = Color.parseColor(if (dark) "#14140F" else "#FFFFFF")
}

/**
 * Fits the camera to the course line and its checkpoints with [framing]'s room around them. False
 * when there is nothing to fit or the map has no size yet (a camera fitted then is the whole world).
 */
private fun fitCourse(
    map: MapLibreMap,
    view: MapView,
    line: List<CoursePoint>,
    points: List<MapCheckpoint>,
    framing: CourseFraming,
    animate: Boolean
): Boolean {
    val all = line + points.map { CoursePoint(it.latitude, it.longitude) }
    if (all.isEmpty() || view.width <= 0 || view.height <= 0) return false
    frame(map, all, framing, view.resources.displayMetrics.density, view.width, view.height, animate)
    return true
}

private fun frame(
    map: MapLibreMap,
    points: List<CoursePoint>,
    framing: CourseFraming,
    density: Float,
    width: Int,
    height: Int,
    animate: Boolean
) {
    val first = points.first()
    val same = points.all { it.latitude == first.latitude && it.longitude == first.longitude }
    if (points.size == 1 || same) {
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(first.latitude, first.longitude), 13.0))
        return
    }
    val bounds = LatLngBounds.Builder()
        .includes(points.map { LatLng(it.latitude, it.longitude) })
        .build()
    val (left, right) = room(framing.left * density, framing.right * density, width)
    val (top, bottom) = room(framing.top * density, framing.bottom * density, height)
    val update = CameraUpdateFactory.newLatLngBounds(bounds, left, top, right, bottom)
    if (animate) map.animateCamera(update) else map.moveCamera(update)
}

/**
 * The room on two opposite sides, in px, cut down in proportion when it would leave the course less
 * than [MIN_COURSE_SHARE] of [size]: padding wider than the map makes MapLibre show the whole world.
 */
private fun room(lead: Float, trail: Float, size: Int): Pair<Int, Int> {
    val most = size * (1 - MIN_COURSE_SHARE)
    val scale = if (lead + trail > most) most / (lead + trail) else 1f
    return (lead * scale).toInt() to (trail * scale).toInt()
}

private const val MIN_COURSE_SHARE = 0.4f

private fun lineGeoJson(line: List<CoursePoint>): String {
    val coordinates = JSONArray()
    line.forEach { point ->
        coordinates.put(JSONArray().put(point.longitude).put(point.latitude))
    }
    return JSONObject()
        .put("type", "Feature")
        .put("properties", JSONObject())
        .put(
            "geometry",
            JSONObject().put("type", "LineString").put("coordinates", coordinates)
        )
        .toString()
}

private fun pointGeoJson(points: List<MapCheckpoint>): String {
    val features = JSONArray()
    points.forEach { point ->
        features.put(
            JSONObject()
                .put("type", "Feature")
                .put("properties", JSONObject().put("title", point.title))
                .put(
                    "geometry",
                    JSONObject()
                        .put("type", "Point")
                        .put("coordinates", JSONArray().put(point.longitude).put(point.latitude))
                )
        )
    }
    return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
}
